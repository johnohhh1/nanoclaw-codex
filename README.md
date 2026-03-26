<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  A Codex-native agent harness for running isolated assistants inside containers.
</p>

## Status

This branch is a full runtime port away from Claude-specific infrastructure.

What exists here now:
- A Codex CLI based container agent runner
- Per-group container isolation and IPC
- Session persistence under `data/sessions/<group>/.codex/`
- `AGENTS.md` based memory/instructions
- Host-side `SKILL.md` based skills with `/skills` install/remove/create
- Scheduling, routing, SQLite state, and group management
- Telegram and WhatsApp channel adapters in `src/channels/`
- Codex-managed subagent delegation via the in-container MCP server
- Container-local helper skills in `container/skills/`

What does not exist anymore:
- Claude Agent SDK integration
- Claude remote control
- Claude-specific session and memory conventions
- The old Claude-era `.claude/skills/` marketplace and `/add-*` installer flow

## Quick Start

```bash
git clone https://github.com/<your-username>/nanoclaw.git
cd nanoclaw
npm install
./setup.sh
```

`./setup.sh` walks through environment detection, channel setup, container build,
group registration, and verification.

## Architecture

NanoClaw is a small Node.js orchestrator.

- `src/index.ts`: main loop and orchestration
- `src/container-runner.ts`: container spawn/mount logic
- `container/agent-runner/src/index.ts`: in-container Codex runner
- `src/ipc.ts`: filesystem IPC
- `src/task-scheduler.ts`: scheduled tasks
- `src/db.ts`: SQLite persistence
- `groups/main/AGENTS.md`: main-group instructions
- `groups/global/AGENTS.md`: shared instructions for non-main groups
- `skills/*/SKILL.md`: repo-local Codex skills
- `src/channels/telegram.ts`: Telegram adapter
- `src/channels/whatsapp.ts`: WhatsApp adapter

Currently shipped channel adapters:
- Telegram
- WhatsApp

Slack, Discord, Gmail, and similar integrations are not currently implemented in this branch.

## Memory Model

The current instruction contract is:
- `groups/main/AGENTS.md` for the main control group
- `groups/global/AGENTS.md` for shared non-main context
- `groups/<group>/AGENTS.md` for group-specific behavior

Each group also has its own session/state directory under `data/sessions/<group>/`.

## Development

```bash
npm run typecheck
npm test
./setup.sh
./container/build.sh
cd container/agent-runner && npm run build
```

## Documentation

The docs in `docs/` are now best treated as developer references. Older product-design material that described the Claude-era skills marketplace and related setup flows has been removed or condensed in this branch.
