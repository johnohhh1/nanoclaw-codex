import path from 'path';

import { ASSISTANT_NAME, DEFAULT_TRIGGER } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { Channel } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';
import WebUIServer from './web-ui-server.js';

const WEB_UI_FOLDER = 'web_ui';

function parsePort(rawPort: string | undefined): number {
  const parsed = rawPort ? parseInt(rawPort, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 3000;
}

export class WebChannel implements Channel {
  name = 'web';

  private server: WebUIServer | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly authToken: string;
  private readonly opts: ChannelOpts;
  private readonly sessionByChatJid = new Map<string, string>();

  constructor(opts: ChannelOpts) {
    const envVars = readEnvFile([
      'WEB_UI_PORT',
      'WEB_UI_HOST',
      'WEB_UI_AUTH_TOKEN',
    ]);
    this.port = parsePort(process.env.WEB_UI_PORT || envVars.WEB_UI_PORT);
    this.host = process.env.WEB_UI_HOST || envVars.WEB_UI_HOST || '0.0.0.0';
    this.authToken =
      process.env.WEB_UI_AUTH_TOKEN || envVars.WEB_UI_AUTH_TOKEN || '';
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const staticPath = path.resolve(process.cwd(), 'assets', 'web-ui');
    this.server = new WebUIServer({
      port: this.port,
      host: this.host,
      authToken: this.authToken,
      assistantName: ASSISTANT_NAME,
      staticPath,
      onMessage: async (message) => {
        const { chatJid, sessionId, timestamp } = message;
        this.sessionByChatJid.set(chatJid, sessionId);
        this.opts.ensureRegisteredChat?.(chatJid, {
          name: 'Web UI',
          folder: WEB_UI_FOLDER,
          trigger: DEFAULT_TRIGGER,
          added_at: new Date().toISOString(),
          requiresTrigger: false,
          isMain: true,
        });
        this.opts.onChatMetadata(chatJid, timestamp, 'Web UI', 'web', false);
        this.opts.onMessage(chatJid, {
          id: message.id,
          chat_jid: chatJid,
          sender: message.sender,
          sender_name: message.senderName,
          content: message.content,
          timestamp,
          is_from_me: false,
        });
      },
    });

    await this.server.start();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.server) {
      logger.warn({ jid }, 'Web UI server not initialized');
      return;
    }

    const sessionId = this.sessionByChatJid.get(jid);
    if (!sessionId) {
      logger.warn({ jid }, 'No active Web UI session for outbound message');
      return;
    }

    const sent = this.server.sendToSession(sessionId, {
      type: 'message',
      from: 'assistant',
      content: text,
      chatJid: jid,
      timestamp: new Date().toISOString(),
    });

    if (!sent) {
      this.sessionByChatJid.delete(jid);
      logger.warn(
        { jid, sessionId },
        'Failed to send Web UI message to session',
      );
      return;
    }

    logger.info({ jid, sessionId, length: text.length }, 'Web UI message sent');
  }

  isConnected(): boolean {
    return this.server?.isRunning() ?? false;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    this.sessionByChatJid.clear();
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }
}

registerChannel('web', (opts: ChannelOpts) => new WebChannel(opts));
