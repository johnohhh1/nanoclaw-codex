import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  STORE_DIR: '/tmp/nanoclaw-test-store',
  ASSISTANT_NAME: 'Andy',
  ASSISTANT_HAS_OWN_NUMBER: false,
}));
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../db.js', () => ({
  getLastGroupSync: vi.fn(() => null),
  setLastGroupSync: vi.fn(),
  updateChatName: vi.fn(),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
    },
  };
});
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));

function createFakeSocket() {
  const ev = new EventEmitter();
  return {
    ev: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        ev.on(event, handler);
      },
    },
    user: {
      id: '1234567890:1@s.whatsapp.net',
      lid: '9876543210:1@lid',
    },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    groupFetchAllParticipating: vi.fn().mockResolvedValue({}),
    end: vi.fn(),
    _ev: ev,
  };
}

let fakeSocket: ReturnType<typeof createFakeSocket>;

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn(() => fakeSocket),
  Browsers: { macOS: vi.fn(() => ['macOS', 'Chrome', '']) },
  DisconnectReason: {
    loggedOut: 401,
    timedOut: 408,
  },
  makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: {
      creds: {},
      keys: {},
    },
    saveCreds: vi.fn(),
  }),
}));

import { WhatsAppChannel } from './whatsapp.js';

function createOpts() {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'registered@g.us': {
        name: 'Test Group',
        folder: 'test-group',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
  };
}

async function connectChannel(channel: WhatsAppChannel): Promise<void> {
  const p = channel.connect();
  await new Promise((r) => setTimeout(r, 0));
  fakeSocket._ev.emit('connection.update', { connection: 'open' });
  return p;
}

describe('WhatsAppChannel', () => {
  beforeEach(() => {
    fakeSocket = createFakeSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects successfully', async () => {
    const channel = new WhatsAppChannel(createOpts());
    await connectChannel(channel);
    expect(channel.isConnected()).toBe(true);
  });

  it('delivers a registered group message', async () => {
    const opts = createOpts();
    const channel = new WhatsAppChannel(opts);
    await connectChannel(channel);

    fakeSocket._ev.emit('messages.upsert', {
      messages: [
        {
          key: {
            id: 'msg-1',
            remoteJid: 'registered@g.us',
            participant: '5551234@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'Hello Andy' },
          pushName: 'Alice',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(opts.onChatMetadata).toHaveBeenCalledWith(
      'registered@g.us',
      expect.any(String),
      undefined,
      'whatsapp',
      true,
    );
    expect(opts.onMessage).toHaveBeenCalledWith(
      'registered@g.us',
      expect.objectContaining({
        content: 'Hello Andy',
        sender_name: 'Alice',
      }),
    );
  });
});
