import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

let loaded = false;

export async function loadConfiguredChannels(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN', 'WEB_UI_PORT']);
  const telegramToken =
    process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '';
  const webUiPort = process.env.WEB_UI_PORT || envVars.WEB_UI_PORT || '';

  if (telegramToken) {
    await import('./telegram.js');
    logger.info('Loaded Telegram channel');
  } else {
    logger.info('Skipping Telegram channel: TELEGRAM_BOT_TOKEN not configured');
  }

  const whatsappAuthDir = path.join(STORE_DIR, 'auth');
  const hasWhatsAppAuth =
    fs.existsSync(whatsappAuthDir) &&
    fs.readdirSync(whatsappAuthDir).length > 0;

  if (hasWhatsAppAuth) {
    await import('./whatsapp.js');
    logger.info('Loaded WhatsApp channel');
  } else {
    logger.info('Skipping WhatsApp channel: no auth state found');
  }

  if (webUiPort) {
    await import('./web.js');
    logger.info({ port: webUiPort }, 'Loaded Web UI channel');
  } else {
    logger.info('Skipping Web UI channel: WEB_UI_PORT not configured');
  }
}
