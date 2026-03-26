import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));
vi.mock('../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type Handler = (...args: any[]) => any;
const botRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('grammy', () => ({
  Bot: class MockBot {
    commandHandlers = new Map<string, Handler>();
    filterHandlers = new Map<string, Handler[]>();
    errorHandler: Handler | null = null;
    api = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      setMyCommands: vi.fn().mockResolvedValue(undefined),
    };

    constructor() {
      botRef.current = this;
    }

    command(name: string, handler: Handler) {
      this.commandHandlers.set(name, handler);
    }

    on(filter: string, handler: Handler) {
      const existing = this.filterHandlers.get(filter) || [];
      existing.push(handler);
      this.filterHandlers.set(filter, existing);
    }

    catch(handler: Handler) {
      this.errorHandler = handler;
    }

    start(opts: { onStart: (botInfo: any) => void }) {
      opts.onStart({ username: 'andy_ai_bot', id: 12345 });
    }

    stop() {}
  },
}));

import { TelegramChannel } from './telegram.js';

function createOpts() {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'tg:100200300': {
        name: 'Test Group',
        folder: 'test-group',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
        isMain: true,
      },
    })),
  };
}

function currentBot() {
  return botRef.current;
}

describe('TelegramChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects and registers handlers', async () => {
    const channel = new TelegramChannel('token', createOpts());
    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(currentBot().commandHandlers.has('help')).toBe(true);
    expect(currentBot().commandHandlers.has('chatid')).toBe(true);
    expect(currentBot().commandHandlers.has('status')).toBe(true);
    expect(currentBot().commandHandlers.has('restart')).toBe(true);
    expect(currentBot().filterHandlers.has('message:text')).toBe(true);
    expect(currentBot().api.setMyCommands).toHaveBeenCalled();
  });

  it('stores a registered group text message', async () => {
    const opts = createOpts();
    const channel = new TelegramChannel('token', opts);
    await channel.connect();

    const handlers = currentBot().filterHandlers.get('message:text') || [];
    const ctx = {
      chat: { id: 100200300, type: 'group', title: 'Test Group' },
      from: { id: 99001, first_name: 'Alice', username: 'alice_user' },
      message: {
        text: 'Hello everyone',
        date: Math.floor(Date.now() / 1000),
        message_id: 1,
        entities: [],
      },
      me: { username: 'andy_ai_bot' },
    };

    for (const handler of handlers) {
      await handler(ctx);
    }

    expect(opts.onChatMetadata).toHaveBeenCalledWith(
      'tg:100200300',
      expect.any(String),
      'Test Group',
      'telegram',
      true,
    );
    expect(opts.onMessage).toHaveBeenCalledWith(
      'tg:100200300',
      expect.objectContaining({
        content: 'Hello everyone',
        sender_name: 'Alice',
      }),
    );
  });

  it('restarts only from the main Telegram chat', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const timeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof setTimeout);

    const channel = new TelegramChannel('token', createOpts());
    await channel.connect();

    const restart = currentBot().commandHandlers.get('restart');
    const reply = vi.fn().mockResolvedValue(undefined);
    await restart({
      chat: { id: 100200300, type: 'group' },
      reply,
    });

    expect(reply).toHaveBeenCalledWith('Restarting NanoClaw now.');
    expect(exitSpy).toHaveBeenCalledWith(0);

    timeoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('rejects restart from a non-main chat', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const channel = new TelegramChannel('token', createOpts());
    await channel.connect();

    const restart = currentBot().commandHandlers.get('restart');
    const reply = vi.fn().mockResolvedValue(undefined);
    await restart({
      chat: { id: 777, type: 'private' },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(
      'This command is only available in the main admin chat.',
    );
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});
