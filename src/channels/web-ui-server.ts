import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebMessage {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  sessionId: string;
}

export interface WebServerOptions {
  port?: number;
  host?: string;
  authToken?: string;
  assistantName?: string;
  staticPath?: string;
  onMessage?: (message: WebMessage) => void | Promise<void>;
  onAuthenticate?: (sessionId: string) => boolean;
}

interface WebSession {
  ws: WebSocket;
  sessionId: string;
  isAuthenticated: boolean;
  lastActivity: Date;
}

interface ServerConfig {
  PORT: number;
  HOST: string;
  AUTH_TOKEN: string;
  ASSISTANT_NAME: string;
  STATIC_PATH: string;
}

const defaultConfig: ServerConfig = {
  PORT: parseInt(process.env.WEB_UI_PORT || '3000', 10),
  HOST: process.env.WEB_UI_HOST || 'localhost',
  AUTH_TOKEN: process.env.WEB_UI_AUTH_TOKEN || '',
  ASSISTANT_NAME: process.env.ASSISTANT_NAME || 'NanoClaw',
  STATIC_PATH: process.env.STATIC_PATH || path.join(__dirname, '../public'),
};

export default class WebUIServer {
  private app = express();
  private server = createServer(this.app);
  private wss: WebSocketServer;
  private sessions = new Map<string, WebSession>();
  private connected = false;
  private config: ServerConfig;
  private onMessageCallback?: WebServerOptions['onMessage'];
  private onAuthenticateCallback?: WebServerOptions['onAuthenticate'];

  constructor(options: WebServerOptions = {}) {
    this.config = {
      PORT: options.port ?? defaultConfig.PORT,
      HOST: options.host ?? defaultConfig.HOST,
      AUTH_TOKEN: options.authToken ?? defaultConfig.AUTH_TOKEN,
      ASSISTANT_NAME: options.assistantName ?? defaultConfig.ASSISTANT_NAME,
      STATIC_PATH: options.staticPath ?? defaultConfig.STATIC_PATH,
    };
    this.onMessageCallback = options.onMessage;
    this.onAuthenticateCallback = options.onAuthenticate;

    this.app.use(express.json());
    this.app.use(express.static(this.config.STATIC_PATH));

    this.app.get('/api/health', (_req, res) => {
      res.json({
        status: 'ok',
        assistant: this.config.ASSISTANT_NAME,
        timestamp: new Date().toISOString(),
      });
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const sessionId = this.generateSessionId();
      logger.info(
        { sessionId, ip: req.socket.remoteAddress },
        'WebSocket connection initiated',
      );

      this.sendToWs(ws, {
        type: 'connected',
        sessionId,
        assistant: this.config.ASSISTANT_NAME,
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          void this.handleWsMessage(ws, sessionId, message);
        } catch (err) {
          logger.warn({ sessionId, err }, 'Invalid WebSocket message');
          this.sendToWs(ws, { type: 'error', message: 'Invalid JSON' });
        }
      });

      ws.on('close', () => {
        if (this.sessions.delete(sessionId)) {
          logger.info({ sessionId }, 'WebSocket disconnected');
        }
      });

      ws.on('error', (err) => {
        logger.warn({ sessionId, err }, 'WebSocket error');
      });
    });
  }

  private async handleWsMessage(
    ws: WebSocket,
    sessionId: string,
    message: unknown,
  ): Promise<void> {
    const payload =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>)
        : {};
    const session = this.sessions.get(sessionId);

    switch (payload.type) {
      case 'auth': {
        const token =
          typeof payload.token === 'string' ? payload.token.trim() : '';
        const isAuthenticated =
          !this.config.AUTH_TOKEN || token === this.config.AUTH_TOKEN;

        if (this.onAuthenticateCallback?.(sessionId) === false) {
          this.sendToWs(ws, {
            type: 'auth',
            success: false,
            error: 'Authentication denied',
          });
          return;
        }

        if (!isAuthenticated) {
          this.sendToWs(ws, {
            type: 'auth',
            success: false,
            error: 'Invalid token',
          });
          return;
        }

        this.sessions.set(sessionId, {
          ws,
          sessionId,
          isAuthenticated: true,
          lastActivity: new Date(),
        });

        this.sendToWs(ws, {
          type: 'auth',
          success: true,
          sessionId,
          assistantName: this.config.ASSISTANT_NAME,
        });
        logger.info({ sessionId }, 'Web session authenticated');
        return;
      }

      case 'message': {
        if (!session || !session.isAuthenticated) {
          this.sendToWs(ws, { type: 'error', message: 'Not authenticated' });
          return;
        }

        const content =
          typeof payload.content === 'string' ? payload.content.trim() : '';
        const chatJid =
          typeof payload.chatJid === 'string' &&
          payload.chatJid.startsWith('web:')
            ? payload.chatJid
            : `web:${sessionId}`;
        const messageId =
          typeof payload.id === 'string' && payload.id
            ? payload.id
            : `web_${Date.now()}`;

        if (!content) {
          this.sendToWs(ws, { type: 'error', message: 'Invalid content' });
          return;
        }

        session.lastActivity = new Date();

        if (this.onMessageCallback) {
          try {
            await this.onMessageCallback({
              id: messageId,
              chatJid,
              sender: sessionId,
              senderName: 'Web User',
              content,
              timestamp: new Date().toISOString(),
              sessionId,
            });
          } catch (err) {
            logger.error({ sessionId, err }, 'Error in web message handler');
          }
        }
        return;
      }

      case 'ping': {
        if (session) {
          session.lastActivity = new Date();
          this.sendToWs(ws, { type: 'pong' });
        }
        return;
      }

      default:
        this.sendToWs(ws, { type: 'error', message: 'Unknown message type' });
    }
  }

  private sendToWs(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  sendToSession(sessionId: string, data: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.sendToWs(session.ws, data);
    return true;
  }

  getSessions(): Array<{ sessionId: string; lastActivity: Date }> {
    return [...this.sessions.entries()].map(([id, session]) => ({
      sessionId: id,
      lastActivity: session.lastActivity,
    }));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.PORT, this.config.HOST, () => {
        this.connected = true;
        logger.info(
          {
            port: this.config.PORT,
            host: this.config.HOST,
            assistant: this.config.ASSISTANT_NAME,
          },
          'Web UI server started',
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.close();
      }
    }
    this.sessions.clear();
    this.wss.close();

    return new Promise((resolve) => {
      this.server.close(() => {
        this.connected = false;
        logger.info('Web UI server stopped');
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.connected;
  }

  private generateSessionId(): string {
    return `web_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
