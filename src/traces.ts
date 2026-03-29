import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';

export type RuntimeEventType =
  | 'run_started'
  | 'message_received'
  | 'run_bootstrap'
  | 'prompt_built'
  | 'container_started'
  | 'codex_started'
  | 'session_initialized'
  | 'codex_finished'
  | 'assistant_output'
  | 'message_sent'
  | 'agent_waiting'
  | 'script_started'
  | 'ipc_message_received'
  | 'run_finished'
  | 'run_failed';

export interface RuntimeEvent {
  id: string;
  trace_id: string;
  timestamp: string;
  type: RuntimeEventType;
  phase: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ActiveRun {
  trace_id: string;
  chat_jid: string;
  group_folder: string;
  channel: string;
  assistant_name: string;
  status: 'running' | 'completed' | 'error';
  phase: string;
  started_at: string;
  updated_at: string;
  finished_at?: string;
  container_name?: string;
  codex_session_id?: string;
  changed_files?: string[];
  diff?: string;
  artifacts?: string[];
  last_event_summary: string;
  events: RuntimeEvent[];
}

type RuntimeEventListener = (event: RuntimeEvent, run: ActiveRun) => void;

const TRACE_DIR = path.join(DATA_DIR, 'traces');
const MAX_EVENTS_PER_RUN = 200;
const MAX_FINISHED_RUNS = 30;

const activeRuns = new Map<string, ActiveRun>();
const finishedRuns: ActiveRun[] = [];
const listeners = new Set<RuntimeEventListener>();

function ensureTraceDir(): void {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function appendTraceLine(traceId: string, payload: unknown): void {
  ensureTraceDir();
  fs.appendFileSync(
    path.join(TRACE_DIR, `${traceId}.jsonl`),
    `${JSON.stringify(payload)}\n`,
  );
}

function inferChannel(chatJid: string): string {
  if (chatJid.startsWith('tg:')) return 'telegram';
  if (chatJid.startsWith('web:')) return 'web';
  if (chatJid.startsWith('wa:')) return 'whatsapp';
  return 'unknown';
}

export function createTraceRun(input: {
  chatJid: string;
  groupFolder: string;
  assistantName: string;
}): ActiveRun {
  const now = new Date().toISOString();
  const run: ActiveRun = {
    trace_id: makeId('trace'),
    chat_jid: input.chatJid,
    group_folder: input.groupFolder,
    channel: inferChannel(input.chatJid),
    assistant_name: input.assistantName,
    status: 'running',
    phase: 'queued',
    started_at: now,
    updated_at: now,
    last_event_summary: 'Run created',
    events: [],
  };
  activeRuns.set(run.trace_id, run);
  appendTraceLine(run.trace_id, {
    type: 'trace_created',
    timestamp: now,
    trace_id: run.trace_id,
    chat_jid: run.chat_jid,
    group_folder: run.group_folder,
    channel: run.channel,
    assistant_name: run.assistant_name,
  });
  return run;
}

export function emitRuntimeEvent(input: {
  traceId: string;
  type: RuntimeEventType;
  phase: string;
  summary: string;
  data?: Record<string, unknown>;
}): RuntimeEvent | null {
  const run = activeRuns.get(input.traceId);
  if (!run) return null;

  const event: RuntimeEvent = {
    id: makeId('evt'),
    trace_id: input.traceId,
    timestamp: new Date().toISOString(),
    type: input.type,
    phase: input.phase,
    summary: input.summary,
    data: input.data,
  };

  run.phase = input.phase;
  run.updated_at = event.timestamp;
  run.last_event_summary = input.summary;
  run.events.push(event);
  if (run.events.length > MAX_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
  }

  if (input.data?.containerName && typeof input.data.containerName === 'string') {
    run.container_name = input.data.containerName;
  }
  if (
    input.data?.sessionId &&
    typeof input.data.sessionId === 'string' &&
    input.data.sessionId
  ) {
    run.codex_session_id = input.data.sessionId;
  }
  if (Array.isArray(input.data?.changed_files)) {
    run.changed_files = input.data.changed_files.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  if (typeof input.data?.diff === 'string') {
    run.diff = input.data.diff;
  }
  if (Array.isArray(input.data?.artifacts)) {
    run.artifacts = input.data.artifacts.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }

  appendTraceLine(input.traceId, event);
  for (const listener of listeners) {
    listener(event, { ...run, events: [...run.events] });
  }
  return event;
}

export function finishTraceRun(input: {
  traceId: string;
  status: 'completed' | 'error';
  summary: string;
  data?: Record<string, unknown>;
}): void {
  const run = activeRuns.get(input.traceId);
  if (!run) return;

  run.status = input.status;
  run.phase = input.status === 'completed' ? 'complete' : 'error';
  run.finished_at = new Date().toISOString();
  run.updated_at = run.finished_at;
  activeRuns.delete(input.traceId);
  const event: RuntimeEvent = {
    id: makeId('evt'),
    trace_id: input.traceId,
    timestamp: run.finished_at,
    type: input.status === 'completed' ? 'run_finished' : 'run_failed',
    phase: run.phase,
    summary: input.summary,
    data: input.data,
  };
  run.last_event_summary = input.summary;
  if (Array.isArray(input.data?.changed_files)) {
    run.changed_files = input.data.changed_files.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  if (typeof input.data?.diff === 'string') {
    run.diff = input.data.diff;
  }
  if (Array.isArray(input.data?.artifacts)) {
    run.artifacts = input.data.artifacts.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  run.events.push(event);
  if (run.events.length > MAX_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
  }
  appendTraceLine(input.traceId, event);

  const finishedRun = {
    ...run,
    events: [...run.events],
  };
  finishedRuns.unshift(finishedRun);
  if (finishedRuns.length > MAX_FINISHED_RUNS) {
    finishedRuns.splice(MAX_FINISHED_RUNS);
  }
  for (const listener of listeners) {
    listener(event, finishedRun);
  }
}

export function listOperatorRuns(): {
  active: ActiveRun[];
  recent: ActiveRun[];
} {
  return {
    active: [...activeRuns.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    ),
    recent: [...finishedRuns].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    ),
  };
}

export function getOperatorRun(traceId: string): ActiveRun | null {
  const existing =
    activeRuns.get(traceId) ||
    finishedRuns.find((run) => run.trace_id === traceId) ||
    null;
  if (existing) return existing;

  const lines = readTraceLog(traceId);
  if (lines.length === 0) return null;

  const parsed = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const first = parsed[0] || {};
  const events = parsed
    .filter(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.trace_id === 'string' &&
        typeof entry.type === 'string' &&
        typeof entry.phase === 'string' &&
        typeof entry.summary === 'string' &&
        typeof entry.timestamp === 'string',
    )
    .map(
      (entry) =>
        ({
          id: entry.id,
          trace_id: entry.trace_id,
          timestamp: entry.timestamp,
          type: entry.type,
          phase: entry.phase,
          summary: entry.summary,
          data:
            entry.data && typeof entry.data === 'object'
              ? (entry.data as Record<string, unknown>)
              : undefined,
        }) as RuntimeEvent,
    );
  const lastEvent = events[events.length - 1];

  return {
    trace_id: traceId,
    chat_jid: String(first.chat_jid || ''),
    group_folder: String(first.group_folder || ''),
    channel: String(first.channel || 'unknown'),
    assistant_name: String(first.assistant_name || 'Assistant'),
    status:
      lastEvent?.type === 'run_failed'
        ? 'error'
        : lastEvent?.type === 'run_finished'
          ? 'completed'
          : 'running',
    phase: String(lastEvent?.phase || 'unknown'),
    started_at: String(first.timestamp || ''),
    updated_at: String(lastEvent?.timestamp || first.timestamp || ''),
    finished_at:
      lastEvent?.type === 'run_failed' || lastEvent?.type === 'run_finished'
        ? String(lastEvent.timestamp || '')
        : undefined,
    container_name:
      typeof lastEvent?.data?.containerName === 'string'
        ? lastEvent.data.containerName
        : undefined,
    codex_session_id:
      typeof lastEvent?.data?.sessionId === 'string'
        ? lastEvent.data.sessionId
        : undefined,
    changed_files:
      Array.isArray(lastEvent?.data?.changed_files)
        ? lastEvent.data.changed_files.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : undefined,
    diff:
      typeof lastEvent?.data?.diff === 'string' ? lastEvent.data.diff : undefined,
    artifacts:
      Array.isArray(lastEvent?.data?.artifacts)
        ? lastEvent.data.artifacts.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : undefined,
    last_event_summary: String(lastEvent?.summary || 'Recovered from trace log'),
    events,
  };
}

export function readTraceLog(traceId: string): string[] {
  const tracePath = path.join(TRACE_DIR, `${traceId}.jsonl`);
  if (!fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function subscribeRuntimeEvents(
  listener: RuntimeEventListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
