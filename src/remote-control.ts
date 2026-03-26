import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

interface RemoteControlSession {
  pid: number;
  url: string;
  startedBy: string;
  startedInChat: string;
  startedAt: string;
}

let activeSession: RemoteControlSession | null = null;

const STATE_FILE = path.join(DATA_DIR, 'remote-control.json');
const UNSUPPORTED_ERROR =
  'Remote Control is not available in the Codex-native port.';

export function restoreRemoteControl(): void {
  activeSession = null;
}

export function getActiveSession(): RemoteControlSession | null {
  return activeSession;
}

/** @internal — exported for testing only */
export function _resetForTesting(): void {
  activeSession = null;
}

/** @internal — exported for testing only */
export function _getStateFilePath(): string {
  return STATE_FILE;
}

export async function startRemoteControl(
  sender: string,
  chatJid: string,
  cwd: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  logger.warn(
    { sender, chatJid, cwd },
    'Remote Control requested but unsupported in Codex-native port',
  );
  return { ok: false, error: UNSUPPORTED_ERROR };
}

export function stopRemoteControl():
  | {
      ok: true;
    }
  | { ok: false; error: string } {
  if (!activeSession) {
    return { ok: false, error: 'No active Remote Control session' };
  }

  activeSession = null;
  return { ok: true };
}
