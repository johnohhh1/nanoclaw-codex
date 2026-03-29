import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { OneCLI } from '@onecli-sh/sdk';

import {
  ASSISTANT_NAME,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  ONECLI_URL,
  POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { loadConfiguredChannels } from './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  deleteRegisteredGroupsByPrefix,
  getGroupSkills,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import {
  restoreRemoteControl,
  startRemoteControl,
  stopRemoteControl,
} from './remote-control.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import {
  addSkillToGroup,
  createSkill,
  formatSkillsReport,
  getSkillByName,
  removeSkillFromGroup,
} from './skills.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import {
  createTraceRun,
  emitRuntimeEvent,
  finishTraceRun,
} from './traces.js';
import {
  formatCapabilitiesReport,
  formatMainOnlyMessage,
  formatRuntimeReport,
  formatStatusReport,
} from './reports.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();

const onecli = new OneCLI({ url: ONECLI_URL });

async function connectChannelSafely(
  channel: Channel,
  timeoutMs = 20_000,
): Promise<boolean> {
  try {
    await Promise.race([
      channel.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`connect timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch (err) {
    logger.warn(
      {
        channel: channel.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'Channel connect failed; skipping channel startup',
    );
    try {
      await channel.disconnect();
    } catch {
      // ignore cleanup failure
    }
    return false;
  }
}

function ensureOneCLIAgent(jid: string, group: RegisteredGroup): void {
  if (group.isMain) return;
  const identifier = group.folder.toLowerCase().replace(/_/g, '-');
  onecli.ensureAgent({ name: group.name, identifier }).then(
    (res) => {
      logger.info(
        { jid, identifier, created: res.created },
        'OneCLI agent ensured',
      );
    },
    (err) => {
      logger.debug(
        { jid, identifier, err: String(err) },
        'OneCLI agent ensure skipped',
      );
    },
  );
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}


function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  const groupMdFile = path.join(groupDir, 'AGENTS.md');
  const memoriesFile = path.join(groupDir, 'MEMORIES.md');
  // Copy AGENTS.md template into the new group folder so agents have
  // identity and instructions from the first run.  (Fixes #1391)
  if (!fs.existsSync(groupMdFile)) {
    const templateFile = path.join(
      GROUPS_DIR,
      group.isMain ? 'main' : 'global',
      'AGENTS.md',
    );
    if (fs.existsSync(templateFile)) {
      let content = fs.readFileSync(templateFile, 'utf-8');
      if (ASSISTANT_NAME !== 'Andy') {
        content = content.replace(/^# Andy$/m, `# ${ASSISTANT_NAME}`);
        content = content.replace(/You are Andy/g, `You are ${ASSISTANT_NAME}`);
      }
      fs.writeFileSync(groupMdFile, content);
      logger.info({ folder: group.folder }, 'Created AGENTS.md from template');
    }
  }
  if (!fs.existsSync(memoriesFile)) {
    fs.writeFileSync(
      memoriesFile,
      '# Durable Memories\n\nUse this file for medium-term facts that should survive thread rotation.\n',
    );
    logger.info({ folder: group.folder }, 'Created MEMORIES.md template');
  }

  // Ensure a corresponding OneCLI agent exists (best-effort, non-blocking)
  ensureOneCLIAgent(jid, group);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function collectGroupArtifacts(
  groupFolder: string,
  startedAt: string,
  limit = 20,
): string[] {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const startedMs = new Date(startedAt).getTime();
  const collected: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (collected.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'logs') continue;
        walk(fullPath);
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < startedMs) continue;
      collected.push(path.relative(process.cwd(), fullPath));
    }
  };

  if (fs.existsSync(groupDir)) {
    walk(groupDir);
  }

  return collected.sort();
}

function captureRepoDiffSnapshot(): { changedFiles: string[]; diff: string } {
  try {
    const changedFiles = execFileSync(
      'git',
      ['diff', '--name-only'],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const diff = execFileSync(
      'git',
      ['diff', '--no-color', '--', '.'],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        maxBuffer: 8 * 1024 * 1024,
      },
    ).slice(0, 200_000);

    return { changedFiles, diff };
  } catch (err) {
    logger.warn({ err }, 'Failed to capture repo diff snapshot');
    return { changedFiles: [], diff: '' };
  }
}

function captureRunEnrichment(
  group: RegisteredGroup,
  traceStartedAt: string,
): {
  changedFiles: string[];
  diff: string;
  artifacts: string[];
} {
  const artifacts = collectGroupArtifacts(group.folder, traceStartedAt);
  if (!group.isMain) {
    return { changedFiles: [], diff: '', artifacts };
  }
  const repo = captureRepoDiffSnapshot();
  return {
    changedFiles: repo.changedFiles,
    diff: repo.diff,
    artifacts,
  };
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const triggerPattern = getTriggerPattern(group.trigger);
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        triggerPattern.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);
  const traceRun = createTraceRun({
    chatJid,
    groupFolder: group.folder,
    assistantName: ASSISTANT_NAME,
  });
  emitRuntimeEvent({
    traceId: traceRun.trace_id,
    type: 'run_started',
    phase: 'queued',
    summary: `Started run for ${group.folder}`,
    data: {
      messageCount: missedMessages.length,
      isMainGroup,
    },
  });
  emitRuntimeEvent({
    traceId: traceRun.trace_id,
    type: 'message_received',
    phase: 'queued',
    summary: `Loaded ${missedMessages.length} pending message(s)`,
    data: {
      messageIds: missedMessages.map((m) => m.id),
      sinceTimestamp,
    },
  });
  emitRuntimeEvent({
    traceId: traceRun.trace_id,
    type: 'prompt_built',
    phase: 'prompt',
    summary: 'Built prompt from queued messages',
    data: {
      promptLength: prompt.length,
    },
  });

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    traceRun.trace_id,
    async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.length} chars`);
      emitRuntimeEvent({
        traceId: traceRun.trace_id,
        type: 'assistant_output',
        phase: 'execution',
        summary: `Assistant produced ${raw.length} characters`,
        data: {
          rawLength: raw.length,
          sessionId: result.newSessionId || sessions[group.folder] || null,
        },
      });
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
        emitRuntimeEvent({
          traceId: traceRun.trace_id,
          type: 'message_sent',
          phase: 'delivery',
          summary: 'Sent assistant output to channel',
          data: {
            textLength: text.length,
            channel: channel.name,
          },
        });
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
    },
  );

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    const enrichment = captureRunEnrichment(group, traceRun.started_at);
    finishTraceRun({
      traceId: traceRun.trace_id,
      status: 'error',
      summary: 'Run failed and cursor was rolled back',
      data: {
        outputSentToUser,
        changed_files: enrichment.changedFiles,
        diff: enrichment.diff,
        artifacts: enrichment.artifacts,
      },
    });
    return false;
  }

  const enrichment = captureRunEnrichment(group, traceRun.started_at);
  finishTraceRun({
    traceId: traceRun.trace_id,
    status: 'completed',
    summary: 'Run completed successfully',
    data: {
      outputSentToUser,
      messageCount: missedMessages.length,
      changed_files: enrichment.changedFiles,
      diff: enrichment.diff,
      artifacts: enrichment.artifacts,
    },
  });
  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  traceId: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];
  const activeSkills = getGroupSkills(group.folder);

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        activeSkills,
      },
      (proc, containerName) => {
        queue.registerProcess(chatJid, proc, containerName, group.folder);
        emitRuntimeEvent({
          traceId,
          type: 'container_started',
          phase: 'container',
          summary: `Started container ${containerName}`,
          data: {
            containerName,
            groupFolder: group.folder,
          },
        });
      },
      wrappedOnOutput,
      (event) => {
        emitRuntimeEvent({
          traceId,
          type: (event.type as Parameters<typeof emitRuntimeEvent>[0]['type']) || 'agent_waiting',
          phase: event.phase || 'execution',
          summary: event.summary || event.type,
          data: event.data,
        });
      },
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (default trigger: ${DEFAULT_TRIGGER})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const triggerPattern = getTriggerPattern(group.trigger);
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                triggerPattern.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Ensure OneCLI agents exist for all registered groups.
  // Recovers from missed creates (e.g. OneCLI was down at registration time).
  for (const [jid, group] of Object.entries(registeredGroups)) {
    ensureOneCLIAgent(jid, group);
  }

  restoreRemoteControl();
  await loadConfiguredChannels();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle /remote-control and /remote-control-end commands
  async function handleRemoteControl(
    command: string,
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      logger.warn(
        { chatJid, sender: msg.sender },
        'Remote control rejected: not main group',
      );
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;

    if (command === '/remote-control') {
      const result = await startRemoteControl(
        msg.sender,
        chatJid,
        process.cwd(),
      );
      if (result.ok) {
        await channel.sendMessage(chatJid, result.url);
      } else {
        await channel.sendMessage(
          chatJid,
          `Remote Control failed: ${result.error}`,
        );
      }
    } else {
      const result = stopRemoteControl();
      if (result.ok) {
        await channel.sendMessage(chatJid, 'Remote Control session ended.');
      } else {
        await channel.sendMessage(chatJid, result.error);
      }
    }
  }

  async function handleSkillsCommand(
    chatJid: string,
    raw: string,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group) return;

    const channel = findChannel(channels, chatJid);
    if (!channel) return;

    const parts = raw.trim().split(/\s+/);
    if (parts.length === 1) {
      await channel.sendMessage(chatJid, formatSkillsReport(group.folder));
      return;
    }

    if (parts[1] === 'create') {
      if (parts.length !== 3) {
        await channel.sendMessage(chatJid, 'Usage:\n/skills create <name>');
        return;
      }

      try {
        const created = createSkill(parts[2], {
          resources: 'scripts,references,assets',
        });
        await channel.sendMessage(
          chatJid,
          `Created skill "${created.name}" at ${path.relative(process.cwd(), created.dir)}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await channel.sendMessage(chatJid, `Skill creation failed: ${message}`);
      }
      return;
    }

    if (parts.length !== 3) {
      await channel.sendMessage(
        chatJid,
        'Usage:\n/skills\n/skills add <name>\n/skills remove <name>\n/skills create <name>',
      );
      return;
    }

    const [, action, skillName] = parts;
    const skill = getSkillByName(skillName);
    if (!skill) {
      await channel.sendMessage(
        chatJid,
        `Unknown skill "${skillName}". Run /skills to see available skills.`,
      );
      return;
    }

    if (action === 'add') {
      addSkillToGroup(group.folder, skillName);
      await channel.sendMessage(
        chatJid,
        `Installed skill "${skillName}" for ${group.name}.`,
      );
      return;
    }

    if (action === 'remove') {
      removeSkillFromGroup(group.folder, skillName);
      await channel.sendMessage(
        chatJid,
        `Removed skill "${skillName}" from ${group.name}.`,
      );
      return;
    }

    await channel.sendMessage(
      chatJid,
      'Usage:\n/skills\n/skills add <name>\n/skills remove <name>\n/skills create <name>',
    );
  }

  async function handleCapabilitiesCommand(chatJid: string): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      const channel = findChannel(channels, chatJid);
      if (channel) {
        await channel.sendMessage(
          chatJid,
          formatMainOnlyMessage('/capabilities'),
        );
      }
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;
    await channel.sendMessage(chatJid, formatCapabilitiesReport(group));
  }

  async function handleStatusCommand(chatJid: string): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      const channel = findChannel(channels, chatJid);
      if (channel) {
        await channel.sendMessage(chatJid, formatMainOnlyMessage('/status'));
      }
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;
    await channel.sendMessage(
      chatJid,
      formatStatusReport(group, channels.map((ch) => ch.name)),
    );
  }

  async function handleRuntimeCommand(chatJid: string): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      const channel = findChannel(channels, chatJid);
      if (channel) {
        await channel.sendMessage(chatJid, formatMainOnlyMessage('/runtime'));
      }
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;
    await channel.sendMessage(
      chatJid,
      formatRuntimeReport(group, {
        connectedChannels: channels.map((ch) => ch.name),
        registeredGroupsCount: Object.keys(registeredGroups).length,
        sessionsCount: Object.keys(sessions).length,
      }),
    );
  }

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      const trimmed = msg.content.trim();
      if (trimmed === '/remote-control' || trimmed === '/remote-control-end') {
        handleRemoteControl(trimmed, chatJid, msg).catch((err) =>
          logger.error({ err, chatJid }, 'Remote control command error'),
        );
        return;
      }

      if (trimmed === '/skills' || trimmed.startsWith('/skills ')) {
        handleSkillsCommand(chatJid, trimmed).catch((err) =>
          logger.error({ err, chatJid }, 'Skills command error'),
        );
        return;
      }

      if (trimmed === '/capabilities') {
        handleCapabilitiesCommand(chatJid).catch((err) =>
          logger.error({ err, chatJid }, 'Capabilities command error'),
        );
        return;
      }

      if (trimmed === '/status') {
        handleStatusCommand(chatJid).catch((err) =>
          logger.error({ err, chatJid }, 'Status command error'),
        );
        return;
      }

      if (trimmed === '/runtime') {
        handleRuntimeCommand(chatJid).catch((err) =>
          logger.error({ err, chatJid }, 'Runtime command error'),
        );
        return;
      }

      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      storeMessage(msg);
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
    connectedChannelNames: () => channels.map((ch) => ch.name),
    sessionCount: () => Object.keys(sessions).length,
    ensureRegisteredChat: (chatJid: string, group: RegisteredGroup) => {
      const existing = registeredGroups[chatJid];
      if (
        existing &&
        existing.folder === group.folder &&
        existing.name === group.name &&
        existing.trigger === group.trigger &&
        existing.requiresTrigger === group.requiresTrigger &&
        existing.isMain === group.isMain
      ) {
        return existing;
      }
      if (existing) {
        registerGroup(chatJid, {
          ...existing,
          ...group,
          added_at: existing.added_at || group.added_at,
        });
        return registeredGroups[chatJid];
      }
      registerGroup(chatJid, group);
      return registeredGroups[chatJid];
    },
    cleanupRegisteredChatsByPrefix: (prefix: string, keepJids: string[] = []) => {
      let removed = 0;
      for (const jid of Object.keys(registeredGroups)) {
        if (!jid.startsWith(prefix) || keepJids.includes(jid)) continue;
        delete registeredGroups[jid];
        removed += 1;
      }
      const dbRemoved = deleteRegisteredGroupsByPrefix(prefix, keepJids);
      if (removed > 0 || dbRemoved > 0) {
        logger.info(
          { prefix, keepJids, memoryRemoved: removed, dbRemoved },
          'Cleaned up registered chats by prefix',
        );
      }
    },
  };

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    if (await connectChannelSafely(channel)) {
      channels.push(channel);
    }
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
    onTasksChanged: () => {
      const tasks = getAllTasks();
      const taskRows = tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      }));
      for (const group of Object.values(registeredGroups)) {
        writeTasksSnapshot(group.folder, group.isMain === true, taskRows);
      }
    },
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
