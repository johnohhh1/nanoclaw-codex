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
- Scheduling, routing, SQLite state, and group management
- Container-local helper skills in `container/skills/`

What does not exist anymore:
- Host-side `.claude/skills/` installation flow
- Claude Agent SDK integration
- Claude remote control
- Claude-specific session and memory conventions

## Quick Start

```bash
git clone https://github.com/<your-username>/nanoclaw.git
cd nanoclaw
npm install
./container/build.sh
npm run build
npm run dev
```

If you want to run the agent manually inside the repo, use `codex`.

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

The core repo currently ships no channel implementations in `src/channels/` beyond the registry. If you want Telegram, Slack, WhatsApp, Gmail, or similar, add the channel code directly in your fork.

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
./container/build.sh
cd container/agent-runner && npm run build
```

## Documentation

The docs in `docs/` are now best treated as developer references. Older product-design material that described the Claude-era skills marketplace and related setup flows has been removed or condensed in this branch.
