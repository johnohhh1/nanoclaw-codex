import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import {
  ASSISTANT_NAME,
  CONTAINER_DOCKER_SOCKET_PATH,
  CONTAINER_IMAGE,
  CONTAINER_MOUNT_DOCKER_SOCKET,
  IS_OPERATOR_PROFILE,
  RUNTIME_PROFILE,
} from './config.js';
import { getGroupSkills } from './db.js';
import { readEnvFile } from './env.js';
import { discoverSkills } from './skills.js';
import { RegisteredGroup } from './types.js';

const WEB_UI_FOLDER = 'web_ui';

function readWebUiEnv(): {
  port: string;
  host: string;
  groupJid: string;
  groupName: string;
} {
  const envVars = readEnvFile([
    'WEB_UI_PORT',
    'WEB_UI_HOST',
    'WEB_UI_GROUP_JID',
    'WEB_UI_GROUP_NAME',
  ]);
  return {
    port: process.env.WEB_UI_PORT || envVars.WEB_UI_PORT || '',
    host: process.env.WEB_UI_HOST || envVars.WEB_UI_HOST || '0.0.0.0',
    groupJid:
      process.env.WEB_UI_GROUP_JID || envVars.WEB_UI_GROUP_JID || 'web:web_ui',
    groupName:
      process.env.WEB_UI_GROUP_NAME || envVars.WEB_UI_GROUP_NAME || 'Web UI',
  };
}

function listBuiltInContainerSkills(): string[] {
  const skillsDir = path.join(process.cwd(), 'container', 'skills');
  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) =>
        fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readCommandVersion(
  command: string,
  args: string[] = ['--version'],
): string {
  try {
    return execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0]
      .slice(0, 160);
  } catch {
    return 'unavailable';
  }
}

export function formatProcessUptime(): string {
  const totalSeconds = Math.floor(process.uptime());
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function formatMainOnlyMessage(command: string): string {
  return `${command} is available in the main admin chat only.`;
}

export function formatCapabilitiesReport(group: RegisteredGroup): string {
  const webUi = readWebUiEnv();
  const availableSkills = discoverSkills();
  const installedSkills = getGroupSkills(group.folder);
  const builtInSkills = listBuiltInContainerSkills();

  const lines: string[] = [];
  lines.push('*NanoClaw Capabilities*');
  lines.push(`Assistant: ${ASSISTANT_NAME}`);
  lines.push(`Group: ${group.folder}`);
  lines.push(`Main channel: ${group.isMain ? 'yes' : 'no'}`);
  lines.push(`Runtime profile: ${RUNTIME_PROFILE}`);
  lines.push('');
  lines.push('*Messaging*');
  lines.push('• Telegram channel');
  lines.push('• WhatsApp channel');
  if (webUi.port) {
    lines.push(`• Web UI channel on http://localhost:${webUi.port}`);
    lines.push(`• Stable Web UI group: \`${webUi.groupJid}\``);
  }
  lines.push('');
  lines.push('*Operator Tools*');
  lines.push('• agent-browser for quick browser inspection');
  lines.push('• Playwright for deterministic browser automation');
  if (IS_OPERATOR_PROFILE) {
    lines.push('• Real project access in the trusted main sandbox');
    lines.push('• Docker CLI and optional Docker socket in the trusted main sandbox');
  } else {
    lines.push('• Safe profile: no real project-root bind and no Docker socket by default');
  }
  lines.push('• Immediate progress replies via send_message');
  lines.push('• Subagents via team_create / team_send_message / task_output');
  lines.push('• Scheduled tasks via schedule_task / list_tasks / update_task');
  lines.push('');
  lines.push('*Installed Repo Skills*');
  if (installedSkills.length === 0) {
    lines.push('• none installed for this group');
  } else {
    for (const skillName of installedSkills) {
      const skill = availableSkills.find((entry) => entry.name === skillName);
      lines.push(`• ${skillName}${skill ? ` — ${skill.description}` : ''}`);
    }
  }
  lines.push('');
  lines.push('*Built-In Container Skills*');
  if (builtInSkills.length === 0) {
    lines.push('• none discovered');
  } else {
    for (const skillName of builtInSkills) {
      lines.push(`• ${skillName}`);
    }
  }
  lines.push('');
  lines.push(`Available repo skills: ${availableSkills.length}`);
  lines.push(`Built-in container skills: ${builtInSkills.length}`);
  lines.push('Use `/skills` to inspect and install repo skills.');

  return lines.join('\n');
}

export function formatStatusReport(
  group: RegisteredGroup,
  connectedChannels: string[],
): string {
  const envVars = readEnvFile(['WEB_UI_PORT', 'CONTAINER_MOUNT_DOCKER_SOCKET']);
  const installedSkills = getGroupSkills(group.folder);
  const lines: string[] = [];
  lines.push('*NanoClaw Status*');
  lines.push(`Assistant: ${ASSISTANT_NAME}`);
  lines.push(`PID: \`${process.pid}\``);
  lines.push(`Uptime: \`${formatProcessUptime()}\``);
  lines.push(`Group: \`${group.folder}\``);
  lines.push(`Main channel: ${group.isMain ? 'yes' : 'no'}`);
  lines.push(`Runtime profile: ${RUNTIME_PROFILE}`);
  lines.push(`Installed skills: ${installedSkills.length}`);
  const webUiPort = process.env.WEB_UI_PORT || envVars.WEB_UI_PORT;
  lines.push(`Web UI: ${webUiPort ? `localhost:${webUiPort}` : 'disabled'}`);
  const dockerSocketMount =
    process.env.CONTAINER_MOUNT_DOCKER_SOCKET ||
    envVars.CONTAINER_MOUNT_DOCKER_SOCKET;
  lines.push(
    `Docker socket mount: ${dockerSocketMount === 'true' ? 'enabled' : 'disabled'}`,
  );
  lines.push(`Connected channels: ${connectedChannels.join(', ')}`);

  return lines.join('\n');
}

export function formatRuntimeReport(
  group: RegisteredGroup,
  opts: {
    connectedChannels: string[];
    registeredGroupsCount: number;
    sessionsCount: number;
  },
): string {
  const webUi = readWebUiEnv();
  const envVars = readEnvFile([
    'CONTAINER_MOUNT_DOCKER_SOCKET',
    'CONTAINER_DOCKER_SOCKET_PATH',
  ]);
  const dockerSocketMount =
    process.env.CONTAINER_MOUNT_DOCKER_SOCKET ||
    envVars.CONTAINER_MOUNT_DOCKER_SOCKET ||
    String(CONTAINER_MOUNT_DOCKER_SOCKET);
  const dockerSocketPath =
    process.env.CONTAINER_DOCKER_SOCKET_PATH ||
    envVars.CONTAINER_DOCKER_SOCKET_PATH ||
    CONTAINER_DOCKER_SOCKET_PATH;

  const lines: string[] = [];
  lines.push('*NanoClaw Runtime*');
  lines.push(`Assistant: ${ASSISTANT_NAME}`);
  lines.push(`PID: \`${process.pid}\``);
  lines.push(`Uptime: \`${formatProcessUptime()}\``);
  lines.push(`Group: \`${group.folder}\``);
  lines.push(`Main channel: ${group.isMain ? 'yes' : 'no'}`);
  lines.push(`Runtime profile: \`${RUNTIME_PROFILE}\``);
  lines.push(`Connected channels: ${opts.connectedChannels.join(', ')}`);
  lines.push('');
  lines.push('*Web UI*');
  lines.push(`Host: \`${webUi.host}\``);
  lines.push(`Port: \`${webUi.port || 'disabled'}\``);
  lines.push(`Stable group JID: \`${webUi.groupJid}\``);
  lines.push(`Stable group folder: \`${WEB_UI_FOLDER}\``);
  lines.push(
    `Ops page: ${webUi.port ? `http://localhost:${webUi.port}/ops` : 'disabled'}`,
  );
  lines.push('');
  lines.push('*Container*');
  lines.push(`Image: \`${CONTAINER_IMAGE}\``);
  lines.push(
    `Docker socket mount: \`${dockerSocketMount === 'true' ? 'enabled' : 'disabled'}\``,
  );
  lines.push(`Docker socket path: \`${dockerSocketPath}\``);
  lines.push(
    `Socket present on host: \`${fs.existsSync(dockerSocketPath) ? 'yes' : 'no'}\``,
  );
  lines.push(`Project path: \`${process.cwd()}\``);
  lines.push('');
  lines.push('*Tool Versions*');
  lines.push(`Node: \`${process.version}\``);
  lines.push(`git: \`${readCommandVersion('git')}\``);
  lines.push(`codex: \`${readCommandVersion('codex')}\``);
  lines.push(`docker: \`${readCommandVersion('docker')}\``);
  lines.push(`playwright: \`${readCommandVersion('playwright')}\``);
  lines.push('');
  lines.push('*State*');
  lines.push(`Registered groups: \`${opts.registeredGroupsCount}\``);
  lines.push(`Active sessions: \`${opts.sessionsCount}\``);
  lines.push(
    'Use `/status`, `/capabilities`, and `/runtime` together for current truth.',
  );

  return lines.join('\n');
}
