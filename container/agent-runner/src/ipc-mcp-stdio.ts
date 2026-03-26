/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { ChildProcess, spawn } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const SUBAGENTS_DIR = path.join(IPC_DIR, 'subagents');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

interface CodexEvent {
  type?: string;
  thread_id?: string;
  error?: { message?: string };
  message?: string;
}

interface SubagentState {
  id: string;
  name: string;
  agentType: 'default' | 'worker' | 'explorer';
  sessionId?: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  lastResult?: string;
  lastError?: string;
  queue: string[];
  process?: ChildProcess;
}

const subagents = new Map<string, SubagentState>();

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

function buildSubagentPrompt(
  agentType: SubagentState['agentType'],
  name: string,
  prompt: string,
): string {
  if (agentType === 'explorer') {
    return `You are the "${name}" subagent. Work in read-only exploration mode. Gather evidence, trace the relevant code paths, and return concise findings with file references. Do not make code changes.\n\nTask:\n${prompt}`;
  }

  if (agentType === 'worker') {
    return `You are the "${name}" subagent. Focus on execution. Make the requested changes or perform the requested investigation and return the concrete outcome, including files touched when relevant.\n\nTask:\n${prompt}`;
  }

  return `You are the "${name}" subagent. Complete the assigned task and return a concise result.\n\nTask:\n${prompt}`;
}

function getSubagentState(id: string): SubagentState | undefined {
  return subagents.get(id);
}

function startSubagentTurn(state: SubagentState, prompt: string): void {
  if (state.status === 'stopped' || state.process) {
    return;
  }

  fs.mkdirSync(SUBAGENTS_DIR, { recursive: true });
  const outputFile = path.join(
    SUBAGENTS_DIR,
    `${state.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );

  const args: string[] = state.sessionId
    ? ['exec', 'resume', state.sessionId, '-']
    : ['exec', '-'];

  args.push(
    '--json',
    '--color', 'never',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--search',
    '-C', '/workspace/group',
    '-o', outputFile,
  );

  if (state.agentType === 'explorer') {
    args.push('-s', 'read-only');
  }

  const child = spawn('codex', args, {
    cwd: '/workspace/group',
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.process = child;
  state.status = 'running';
  state.lastError = undefined;

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let fatalError: string | undefined;

  const handleStdoutLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as CodexEvent;
      if (event.type === 'thread.started' && event.thread_id) {
        state.sessionId = event.thread_id;
      } else if (event.type === 'turn.failed') {
        fatalError = event.error?.message || event.message || 'Codex turn failed';
      } else if (event.type === 'error' && event.message && !fatalError) {
        fatalError = event.message;
      }
    } catch {
      // ignore non-JSON lines
    }
  };

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      handleStdoutLine(stdoutBuffer.slice(0, newlineIndex));
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on('close', (code) => {
    state.process = undefined;
    if (stdoutBuffer.trim()) {
      handleStdoutLine(stdoutBuffer);
    }

    if (code === 0) {
      try {
        if (fs.existsSync(outputFile)) {
          state.lastResult = fs.readFileSync(outputFile, 'utf-8').trim();
        }
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
      }
      state.status = 'idle';
    } else {
      state.lastError =
        fatalError ||
        stderrBuffer.trim() ||
        `codex exited with code ${code ?? 'unknown'}`;
      state.status = 'error';
    }

    if (state.queue.length > 0) {
      const nextPrompt = state.queue.shift();
      if (nextPrompt) {
        startSubagentTurn(state, nextPrompt);
      }
    }
  });

  child.stdin.write(buildSubagentPrompt(state.agentType, state.name, prompt));
  child.stdin.end();
}

async function waitForSubagent(
  state: SubagentState,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (state.process && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

process.on('exit', () => {
  for (const state of subagents.values()) {
    state.process?.kill('SIGTERM');
  }
});

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'team_create',
  'Spawn a Codex subagent for a delegated task. Use this when the work can run in parallel or should be isolated from the parent context.',
  {
    name: z.string().describe('Short subagent name or role label'),
    prompt: z.string().describe('Task instructions for the subagent'),
    agent_type: z
      .enum(['default', 'worker', 'explorer'])
      .default('worker')
      .describe('worker=execution focused, explorer=read-only investigation, default=general purpose'),
  },
  async (args) => {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state: SubagentState = {
      id,
      name: args.name,
      agentType: args.agent_type,
      status: 'idle',
      queue: [],
    };
    subagents.set(id, state);
    startSubagentTurn(state, args.prompt);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Started subagent ${id} (${args.agent_type}). Use task_output to check results, team_send_message to send follow-up instructions, or task_stop to cancel it.`,
        },
      ],
    };
  },
);

server.tool(
  'team_send_message',
  'Send follow-up instructions to an existing subagent. If it is currently running, the message is queued and will run as the next turn.',
  {
    task_id: z.string().describe('Subagent ID returned from team_create'),
    prompt: z.string().describe('Follow-up instructions for the subagent'),
  },
  async (args) => {
    const state = getSubagentState(args.task_id);
    if (!state) {
      return {
        content: [{ type: 'text' as const, text: `Unknown subagent: ${args.task_id}` }],
        isError: true,
      };
    }
    if (state.status === 'stopped') {
      return {
        content: [{ type: 'text' as const, text: `Subagent ${args.task_id} is stopped.` }],
        isError: true,
      };
    }

    if (state.process) {
      state.queue.push(args.prompt);
      return {
        content: [{ type: 'text' as const, text: `Queued follow-up for ${args.task_id}.` }],
      };
    }

    startSubagentTurn(state, args.prompt);
    return {
      content: [{ type: 'text' as const, text: `Sent follow-up to ${args.task_id}.` }],
    };
  },
);

server.tool(
  'task_output',
  'Get the latest output from a delegated subagent. Optionally wait for the current turn to finish.',
  {
    task_id: z.string().describe('Subagent ID returned from team_create'),
    wait: z.boolean().default(false).describe('Wait for the current turn to finish before reading output'),
    timeout_seconds: z.number().int().positive().max(600).default(60).describe('Maximum time to wait when wait=true'),
  },
  async (args) => {
    const state = getSubagentState(args.task_id);
    if (!state) {
      return {
        content: [{ type: 'text' as const, text: `Unknown subagent: ${args.task_id}` }],
        isError: true,
      };
    }

    if (args.wait && state.process) {
      await waitForSubagent(state, args.timeout_seconds * 1000);
    }

    const lines = [
      `id: ${state.id}`,
      `name: ${state.name}`,
      `status: ${state.status}`,
      `session_id: ${state.sessionId || 'none'}`,
    ];

    if (state.lastError) {
      lines.push(`error: ${state.lastError}`);
    }
    if (state.lastResult) {
      lines.push('');
      lines.push(state.lastResult);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

server.tool(
  'task_stop',
  'Stop a running subagent and clear any queued follow-up work.',
  {
    task_id: z.string().describe('Subagent ID returned from team_create'),
  },
  async (args) => {
    const state = getSubagentState(args.task_id);
    if (!state) {
      return {
        content: [{ type: 'text' as const, text: `Unknown subagent: ${args.task_id}` }],
        isError: true,
      };
    }

    state.queue = [];
    state.status = 'stopped';
    state.process?.kill('SIGTERM');
    state.process = undefined;

    return {
      content: [{ type: 'text' as const, text: `Stopped subagent ${args.task_id}.` }],
    };
  },
);

server.tool(
  'team_delete',
  'Alias for task_stop. Stops and clears a delegated subagent.',
  {
    task_id: z.string().describe('Subagent ID returned from team_create'),
  },
  async (args) => {
    const state = getSubagentState(args.task_id);
    if (!state) {
      return {
        content: [{ type: 'text' as const, text: `Unknown subagent: ${args.task_id}` }],
        isError: true,
      };
    }

    state.queue = [];
    state.status = 'stopped';
    state.process?.kill('SIGTERM');
    state.process = undefined;

    return {
      content: [{ type: 'text' as const, text: `Deleted subagent ${args.task_id}.` }],
    };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
    script: z.string().optional().describe('Optional bash script to run before waking the agent. Script must output JSON on the last line of stdout: { "wakeAgent": boolean, "data"?: any }. If wakeAgent is false, the agent is not called. Test your script with bash -c "..." before scheduling.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text' as const, text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".` }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      script: args.script || undefined,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('New schedule type'),
    schedule_value: z.string().optional().describe('New schedule value (see schedule_task for format)'),
    script: z.string().optional().describe('New script for the task. Set to empty string to remove the script.'),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (args.schedule_type === 'cron' || (!args.schedule_type && args.schedule_value)) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}".` }],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}".` }],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.script !== undefined) data.script = args.script;
    if (args.schedule_type !== undefined) data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined) data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} update requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z.string().describe('The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
