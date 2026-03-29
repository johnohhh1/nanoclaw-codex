import path from 'path';

import { ASSISTANT_NAME, DEFAULT_TRIGGER } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import {
  getOperatorRun,
  listOperatorRuns,
  readTraceLog,
  subscribeRuntimeEvents,
} from '../traces.js';
import { Channel } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';
import WebUIServer from './web-ui-server.js';

const WEB_UI_FOLDER = 'web_ui';
const DEFAULT_WEB_UI_GROUP_JID = 'web:web_ui';
const DEFAULT_WEB_UI_GROUP_NAME = 'Web UI';

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
  private readonly stableChatJid: string;
  private readonly stableChatName: string;
  private readonly opts: ChannelOpts;
  private unsubscribeRuntime?: () => void;

  constructor(opts: ChannelOpts) {
    const envVars = readEnvFile([
      'WEB_UI_PORT',
      'WEB_UI_HOST',
      'WEB_UI_AUTH_TOKEN',
      'WEB_UI_GROUP_JID',
      'WEB_UI_GROUP_NAME',
    ]);
    this.port = parsePort(process.env.WEB_UI_PORT || envVars.WEB_UI_PORT);
    this.host = process.env.WEB_UI_HOST || envVars.WEB_UI_HOST || '0.0.0.0';
    this.authToken =
      process.env.WEB_UI_AUTH_TOKEN || envVars.WEB_UI_AUTH_TOKEN || '';
    this.stableChatJid =
      process.env.WEB_UI_GROUP_JID ||
      envVars.WEB_UI_GROUP_JID ||
      DEFAULT_WEB_UI_GROUP_JID;
    this.stableChatName =
      process.env.WEB_UI_GROUP_NAME ||
      envVars.WEB_UI_GROUP_NAME ||
      DEFAULT_WEB_UI_GROUP_NAME;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const staticPath = path.resolve(process.cwd(), 'assets', 'web-ui');
    this.opts.cleanupRegisteredChatsByPrefix?.('web:', [this.stableChatJid]);
    this.opts.ensureRegisteredChat?.(this.stableChatJid, {
      name: this.stableChatName,
      folder: WEB_UI_FOLDER,
      trigger: DEFAULT_TRIGGER,
      added_at: new Date().toISOString(),
      requiresTrigger: false,
      isMain: true,
    });
    this.server = new WebUIServer({
      port: this.port,
      host: this.host,
      authToken: this.authToken,
      assistantName: ASSISTANT_NAME,
      staticPath,
      getStableChatJid: () => this.stableChatJid,
      getRuntimeSnapshot: () => listOperatorRuns(),
      getTraceDetail: (traceId: string) => ({
        run: getOperatorRun(traceId),
        lines: readTraceLog(traceId),
      }),
      onMessage: async (message) => {
        const { timestamp } = message;
        this.opts.onChatMetadata(
          this.stableChatJid,
          timestamp,
          this.stableChatName,
          'web',
          false,
        );
        this.opts.onMessage(this.stableChatJid, {
          id: message.id,
          chat_jid: this.stableChatJid,
          sender: message.sessionId,
          sender_name: message.senderName,
          content: message.content,
          timestamp,
          is_from_me: false,
        });
      },
    });

    await this.server.start();
    this.unsubscribeRuntime = subscribeRuntimeEvents((event, run) => {
      this.server?.broadcast({
        type: 'run_event',
        event,
        run,
        snapshot: listOperatorRuns(),
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.server) {
      logger.warn({ jid }, 'Web UI server not initialized');
      return;
    }

    const delivered = this.server.sendToChat(jid, {
      type: 'message',
      from: 'assistant',
      content: text,
      chatJid: jid,
      timestamp: new Date().toISOString(),
    });

    if (delivered === 0) {
      logger.warn({ jid }, 'No active Web UI session for outbound message');
      return;
    }
    logger.info({ jid, delivered, length: text.length }, 'Web UI message sent');
  }

  isConnected(): boolean {
    return this.server?.isRunning() ?? false;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }
}

registerChannel('web', (opts: ChannelOpts) => new WebChannel(opts));
