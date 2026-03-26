import { describe, it, expect, beforeEach } from 'vitest';

import {
  startRemoteControl,
  stopRemoteControl,
  restoreRemoteControl,
  getActiveSession,
  _resetForTesting,
  _getStateFilePath,
} from './remote-control.js';

describe('remote-control', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('exposes a stable state file path for compatibility', () => {
    expect(_getStateFilePath()).toContain('remote-control.json');
  });

  it('returns unsupported from startRemoteControl', async () => {
    const result = await startRemoteControl('user1', 'tg:123', '/project');

    expect(result).toEqual({
      ok: false,
      error: 'Remote Control is not available in the Codex-native port.',
    });
  });

  it('restoreRemoteControl keeps no active session', () => {
    restoreRemoteControl();
    expect(getActiveSession()).toBeNull();
  });

  it('stopRemoteControl returns no-active-session when disabled', () => {
    expect(stopRemoteControl()).toEqual({
      ok: false,
      error: 'No active Remote Control session',
    });
  });
});
