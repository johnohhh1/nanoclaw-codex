import { describe, expect, it } from 'vitest';

import { shouldResetRejectedModelSession } from './session-recovery.js';

describe('shouldResetRejectedModelSession', () => {
  it('resets a resumed session whose model is rejected during compaction', () => {
    expect(
      shouldResetRejectedModelSession(
        'session-id',
        "Error running remote compact task: The 'gpt-5.2-codex' model is not supported when using Codex with a ChatGPT account.",
      ),
    ).toBe(true);
  });

  it('resets a resumed session when the selected model is rejected directly', () => {
    expect(
      shouldResetRejectedModelSession(
        'session-id',
        `{"type":"invalid_request_error","message":"The 'gpt-5.2-codex' model is not supported when using Codex with a ChatGPT account."}`,
      ),
    ).toBe(true);
  });

  it('does not reset unrelated failures or failures without a session', () => {
    expect(
      shouldResetRejectedModelSession(
        'session-id',
        'Container exited with code 1',
      ),
    ).toBe(false);
    expect(
      shouldResetRejectedModelSession(
        undefined,
        'Remote compact task: model is not supported when using Codex with a ChatGPT account.',
      ),
    ).toBe(false);
  });
});
