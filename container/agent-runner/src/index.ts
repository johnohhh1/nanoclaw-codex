/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout.
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 */

import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
  activeSkills?: string[];
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ScriptResult {
  wakeAgent: boolean;
  data?: unknown;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  error?: { message?: string };
  message?: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;
const SCRIPT_TIMEOUT_MS = 30_000;
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const CODEX_HOME_ROOT = '/home/node';
const CODEX_MCP_NAME = 'nanoclaw';
const RUN_ARTIFACTS_DIR = '/tmp/nanoclaw-codex';
let supportsGlobalSearchFlag: boolean | null = null;

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function emitTrace(
  type: string,
  phase: string,
  summary: string,
  data?: Record<string, unknown>,
): void {
  console.error(
    `[agent-trace] ${JSON.stringify({
      type,
      phase,
      summary,
      data,
      timestamp: new Date().toISOString(),
    })}`,
  );
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : (assistantName || 'Assistant');
    const content = msg.content.length > 2000
      ? `${msg.content.slice(0, 2000)}...`
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

function archiveConversation(
  prompt: string,
  result: string | null,
  sessionId: string | undefined,
  assistantName?: string,
): void {
  try {
    const messages: ParsedMessage[] = [{ role: 'user', content: prompt }];
    if (result) {
      messages.push({ role: 'assistant', content: result });
    }

    const conversationsDir = '/workspace/group/conversations';
    fs.mkdirSync(conversationsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const name = sessionId ? sanitizeFilename(sessionId) : generateFallbackName();
    const filename = `${date}-${name}.md`;
    const filePath = path.join(conversationsDir, filename);
    const markdown = formatTranscriptMarkdown(
      messages,
      sessionId ? `Conversation ${sessionId}` : 'Conversation',
      assistantName,
    );

    fs.writeFileSync(filePath, markdown);
    log(`Archived conversation to ${filePath}`);
  } catch (err) {
    log(`Failed to archive conversation: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      // ignore
    }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(file => file.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }

    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

function preferredInstructionPath(dir: string): string | null {
  const agents = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(agents)) return agents;
  return null;
}

function readInstructionFile(dir: string): string | null {
  const instructionPath = preferredInstructionPath(dir);
  if (!instructionPath) return null;

  try {
    return fs.readFileSync(instructionPath, 'utf-8').trim();
  } catch (err) {
    log(`Failed to read instructions from ${instructionPath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function readOptionalTextFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch (err) {
    log(`Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function parseSkillDescription(content: string): string {
  const match = content.match(/description:\s*["']?(.+?)["']?(?:\n|$)/);
  return match?.[1]?.trim() || 'No description.';
}

function getAvailableRepoSkills(): Array<{ name: string; description: string }> {
  const skillsDir = '/workspace/skills-catalog';
  if (!fs.existsSync(skillsDir)) return [];

  const skills: Array<{ name: string; description: string }> = [];
  for (const entry of fs.readdirSync(skillsDir).sort()) {
    const skillPath = path.join(skillsDir, entry, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      skills.push({
        name: entry,
        description: parseSkillDescription(content),
      });
    } catch (err) {
      log(`Failed to read skill catalog entry ${entry}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return skills;
}

function buildSkillIndex(containerInput: ContainerInput): string {
  const installed = containerInput.activeSkills || [];
  const available = getAvailableRepoSkills();
  const availableLines = available.length
    ? available.map((skill) => `- ${skill.name}: ${skill.description}`)
    : ['- none'];
  const installedLines = installed.length
    ? installed.map((name) => `- ${name}`)
    : ['- none'];

  return [
    'Skill index:',
    `Installed repo skills for this group (${installed.length}):`,
    ...installedLines,
    '',
    `Available repo skills in /workspace/skills-catalog (${available.length}):`,
    ...availableLines,
    '',
    'Built-in container/operator capabilities:',
    '- agent-browser: installed for live browser inspection and UI automation',
    '- playwright: installed for deterministic browser automation and UI testing',
    '- docker: available when the Docker socket is mounted in the main sandbox',
    '- mcp__nanoclaw__send_message: immediate progress replies',
    '- mcp__nanoclaw__team_create / task_output / task_stop: subagents',
    '- mcp__nanoclaw__schedule_task / list_tasks / update_task: scheduling',
  ].join('\n');
}

function buildChannelHints(containerInput: ContainerInput): string {
  const hints: string[] = [];

  if (containerInput.chatJid.startsWith('web:')) {
    hints.push(
      'Web UI session guidance:',
      '- You are talking through the local NanoClaw Web UI.',
      '- Inside the sandbox, the host Web UI is reachable at http://host.docker.internal:3000. Use that instead of localhost.',
      '- If the user asks about the live UI, use agent-browser against http://host.docker.internal:3000 instead of guessing.',
      '- If /workspace/project exists, you can edit the real app source there and verify in the browser.',
      '- Voice input in the Web UI is browser-side transcription; you receive normal text.',
    );
  }

  if (containerInput.isMain) {
    hints.push(
      'Main/admin sandbox guidance:',
      '- /workspace/project is mounted read-write.',
      '- Docker may be available; verify with command -v docker and test -S /var/run/docker.sock before claiming status.',
      '- Prefer live checks over stale assumptions when reporting capabilities.',
    );
  }

  return hints.join('\n');
}

function getExtraDirs(): string[] {
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';

  if (!fs.existsSync(extraBase)) {
    return extraDirs;
  }

  for (const entry of fs.readdirSync(extraBase)) {
    const fullPath = path.join(extraBase, entry);
    try {
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    } catch (err) {
      log(`Failed to inspect additional directory ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return extraDirs;
}

function buildPrompt(prompt: string, containerInput: ContainerInput, extraDirs: string[]): string {
  const sections: string[] = [];

  if (!containerInput.isMain) {
    const globalInstructions = readInstructionFile('/workspace/global');
    if (globalInstructions) {
      sections.push('Global instructions:\n' + globalInstructions);
    }
  }

  const groupInstructions = readInstructionFile('/workspace/group');
  if (groupInstructions) {
    sections.push('Workspace instructions:\n' + groupInstructions);
  }

  const durableMemories = readOptionalTextFile('/workspace/group/MEMORIES.md');
  if (durableMemories) {
    sections.push('Durable group memory:\n' + durableMemories);
  }

  const channelHints = buildChannelHints(containerInput);
  if (channelHints) {
    sections.push(channelHints);
  }

  sections.push(buildSkillIndex(containerInput));

  for (const extraDir of extraDirs) {
    const extraInstructions = readInstructionFile(extraDir);
    if (extraInstructions) {
      sections.push(`Instructions from ${path.basename(extraDir)}:\n${extraInstructions}`);
    }
  }

  for (const skillName of containerInput.activeSkills || []) {
    const skillDir = path.join('/workspace/skills-catalog', skillName);
    const skillPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const skillInstructions = fs.readFileSync(skillPath, 'utf-8').trim();
    if (!skillInstructions) continue;
    sections.push(
      `Active skill "${skillName}" instructions:\n${skillInstructions}\n\nSupporting files for this skill are available under ${skillDir}.`,
    );
  }

  sections.push(prompt);
  const finalPrompt = sections.join('\n\n');
  emitTrace('prompt_built', 'prompt', 'Built final Codex prompt', {
    sectionCount: sections.length,
    promptLength: finalPrompt.length,
    activeSkillCount: containerInput.activeSkills?.length || 0,
  });
  return finalPrompt;
}

function execFileAsync(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const withOutput = new Error(
          `${error.message}\n${stderr || stdout}`.trim(),
        );
        reject(withOutput);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function configureCodexMcp(
  mcpServerPath: string,
  codexEnv: NodeJS.ProcessEnv,
  containerInput: ContainerInput,
): Promise<void> {
  fs.mkdirSync(path.join(CODEX_HOME_ROOT, '.codex'), { recursive: true });

  try {
    await execFileAsync(
      'codex',
      ['mcp', 'remove', CODEX_MCP_NAME],
      {
        cwd: '/workspace/group',
        env: codexEnv,
      },
    );
  } catch {
    // Ignore missing prior config.
  }

  const addArgs = [
    'mcp',
    'add',
    CODEX_MCP_NAME,
    '--env',
    `NANOCLAW_CHAT_JID=${containerInput.chatJid}`,
    '--env',
    `NANOCLAW_GROUP_FOLDER=${containerInput.groupFolder}`,
    '--env',
    `NANOCLAW_IS_MAIN=${containerInput.isMain ? '1' : '0'}`,
    '--',
    'node',
    mcpServerPath,
  ];

  const { stderr } = await execFileAsync('codex', addArgs, {
    cwd: '/workspace/group',
    env: codexEnv,
  });

  if (stderr.trim()) {
    log(`codex mcp add stderr: ${stderr.trim()}`);
  }
}

async function codexSupportsGlobalSearch(): Promise<boolean> {
  if (supportsGlobalSearchFlag != null) {
    return supportsGlobalSearchFlag;
  }

  try {
    const { stdout } = await execFileAsync('codex', ['--help'], {
      cwd: '/workspace/group',
      env: process.env,
    });
    supportsGlobalSearchFlag = stdout.includes('--search');
  } catch (err) {
    log(
      `Failed to probe Codex --search support: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    supportsGlobalSearchFlag = false;
  }

  return supportsGlobalSearchFlag;
}

function createRunArtifactsDir(): void {
  fs.mkdirSync(RUN_ARTIFACTS_DIR, { recursive: true });
}

async function runCodexTurn(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
): Promise<{ newSessionId?: string; closedDuringQuery: boolean }> {
  const extraDirs = getExtraDirs();
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  createRunArtifactsDir();

  const codexEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: CODEX_HOME_ROOT,
  };

  await configureCodexMcp(mcpServerPath, codexEnv, containerInput);

  const finalPrompt = buildPrompt(prompt, containerInput, extraDirs);
  const outputFile = path.join(
    RUN_ARTIFACTS_DIR,
    `last-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );

  const args: string[] = [];

  if (await codexSupportsGlobalSearch()) {
    args.push('--search');
  }

  if (sessionId) {
    args.push(
      'exec',
      'resume',
      sessionId,
      '-',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-o',
      outputFile,
    );
  } else {
    args.push(
      'exec',
      '-',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      '/workspace/group',
      '-o',
      outputFile,
    );

    for (const extraDir of extraDirs) {
      args.push('--add-dir', extraDir);
    }
  }

  return new Promise((resolve, reject) => {
    emitTrace('codex_started', 'execution', 'Starting Codex turn', {
      sessionId: sessionId || null,
      cwd: '/workspace/group',
    });

    const child = spawn('codex', args, {
      cwd: '/workspace/group',
      env: codexEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let latestSessionId = sessionId;
    let fatalError: string | null = null;
    let closedDuringQuery = false;

    const closePoll = setInterval(() => {
      if (shouldClose()) {
        closedDuringQuery = true;
        log('Close sentinel detected during Codex turn, terminating process');
        child.kill('SIGTERM');
      }
    }, IPC_POLL_MS);

    const handleStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed) as CodexEvent;
        if (event.type === 'thread.started' && event.thread_id) {
          latestSessionId = event.thread_id;
          emitTrace(
            'session_initialized',
            'execution',
            'Codex session initialized',
            { sessionId: latestSessionId },
          );
          log(`Session initialized: ${latestSessionId}`);
        } else if (event.type === 'turn.failed') {
          fatalError = event.error?.message || event.message || 'Codex turn failed';
        } else if (event.type === 'error' && event.message && !fatalError) {
          // Codex emits transient reconnect errors before recovering, so keep the
          // last one only as fallback if the command exits non-zero.
          fatalError = event.message;
        }
      } catch {
        log(`codex stdout: ${trimmed}`);
      }
    };

    const handleStderrLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      log(`codex stderr: ${trimmed}`);
    };

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleStdoutLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString();
      let newlineIndex = stderrBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stderrBuffer.slice(0, newlineIndex);
        stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
        handleStderrLine(line);
        newlineIndex = stderrBuffer.indexOf('\n');
      }
    });

    child.on('error', err => {
      clearInterval(closePoll);
      reject(err);
    });

    child.on('close', code => {
      clearInterval(closePoll);

      if (stdoutBuffer.trim()) {
        handleStdoutLine(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        handleStderrLine(stderrBuffer);
      }

      if (closedDuringQuery) {
        emitTrace(
          'agent_waiting',
          'idle',
          'Codex turn stopped after close sentinel',
          { sessionId: latestSessionId || null },
        );
        resolve({ newSessionId: latestSessionId, closedDuringQuery: true });
        return;
      }

      if (code !== 0) {
        reject(new Error(fatalError || `codex exited with code ${code ?? 'unknown'}`));
        return;
      }

      let result: string | null = null;
      try {
        if (fs.existsSync(outputFile)) {
          result = fs.readFileSync(outputFile, 'utf-8').trim() || null;
        }
      } catch (err) {
        reject(new Error(`Failed to read Codex output: ${err instanceof Error ? err.message : String(err)}`));
        return;
      } finally {
        try {
          fs.unlinkSync(outputFile);
        } catch {
          // ignore
        }
      }

      archiveConversation(prompt, result, latestSessionId, containerInput.assistantName);
      emitTrace('codex_finished', 'execution', 'Codex turn completed', {
        sessionId: latestSessionId || null,
        hasResult: Boolean(result),
        resultLength: result?.length || 0,
      });
      writeOutput({
        status: 'success',
        result,
        newSessionId: latestSessionId,
      });

      resolve({ newSessionId: latestSessionId, closedDuringQuery: false });
    });

    child.stdin.end(finalPrompt);
  });
}

async function runScript(script: string): Promise<ScriptResult | null> {
  const scriptPath = '/tmp/task-script.sh';
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return new Promise((resolve) => {
    execFile('bash', [scriptPath], {
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: process.env,
    }, (error, stdout, stderr) => {
      if (stderr) {
        log(`Script stderr: ${stderr.slice(0, 500)}`);
      }

      if (error) {
        log(`Script error: ${error.message}`);
        resolve(null);
        return;
      }

      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      if (!lastLine) {
        log('Script produced no output');
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(lastLine);
        if (typeof result.wakeAgent !== 'boolean') {
          log(`Script output missing wakeAgent boolean: ${lastLine.slice(0, 200)}`);
          resolve(null);
          return;
        }
        resolve(result as ScriptResult);
      } catch {
        log(`Script output is not valid JSON: ${lastLine.slice(0, 200)}`);
        resolve(null);
      }
    });
  });
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try {
      fs.unlinkSync('/tmp/input.json');
    } catch {
      // ignore
    }
    log(`Received input for group: ${containerInput.groupFolder}`);
    emitTrace('run_bootstrap', 'bootstrap', 'Container input parsed', {
      groupFolder: containerInput.groupFolder,
      chatJid: containerInput.chatJid,
      isMain: containerInput.isMain,
    });
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(CODEX_HOME_ROOT, '.codex'), { recursive: true });

  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    // ignore
  }

  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }

  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  if (containerInput.script && containerInput.isScheduledTask) {
    log('Running task script...');
    emitTrace('script_started', 'script', 'Running scheduled task script');
    const scriptResult = await runScript(containerInput.script);

    if (!scriptResult || !scriptResult.wakeAgent) {
      const reason = scriptResult ? 'wakeAgent=false' : 'script error/no output';
      log(`Script decided not to wake agent: ${reason}`);
      writeOutput({
        status: 'success',
        result: null,
      });
      return;
    }

    log('Script wakeAgent=true, enriching prompt with data');
    prompt = `[SCHEDULED TASK]\n\nScript output:\n${JSON.stringify(scriptResult.data, null, 2)}\n\nInstructions:\n${containerInput.prompt}`;
  }

  try {
    while (true) {
      log(`Starting Codex turn (session: ${sessionId || 'new'})...`);

      const queryResult = await runCodexTurn(
        prompt,
        sessionId,
        mcpServerPath,
        containerInput,
      );

      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }

      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during Codex turn, exiting');
        break;
      }

      writeOutput({
        status: 'success',
        result: null,
        newSessionId: sessionId,
      });

      log('Turn ended, waiting for next IPC message...');
      emitTrace('agent_waiting', 'idle', 'Waiting for next IPC message', {
        sessionId: sessionId || null,
      });

      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new turn`);
      emitTrace(
        'ipc_message_received',
        'execution',
        'Received follow-up IPC message',
        { length: nextMessage.length },
      );
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
