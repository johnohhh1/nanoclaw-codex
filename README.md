<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  A Codex-native agent harness for running isolated assistants inside containers.
</p>

## What It Is

NanoClaw is a small Node.js host runtime that:
- receives messages from supported channels
- routes work to per-group containerized Codex agents
- persists chat, group, and task state in SQLite
- exposes host-side tools back into the sandbox through filesystem IPC and MCP

The current repo ships:
- Telegram
- WhatsApp
- Web UI
- scheduled tasks
- per-group `AGENTS.md` instructions
- repo-local `SKILL.md` skills
- in-container subagent delegation

## Runtime Model

NanoClaw has two layers:

1. Host runtime
- `src/index.ts`
- channel adapters
- routing, scheduling, SQLite, IPC, traces

2. Per-group agent containers
- `src/container-runner.ts`
- `container/agent-runner/src/index.ts`
- isolated Codex state under `data/sessions/<group>/.codex/`

Each group gets its own container-facing state, IPC directory, and instruction context.

## Install Profiles

New installs should use the `safe` profile unless you explicitly want a highly autonomous personal operator setup.

### `safe`

Default posture for general users.

The main group does not get:
- real project-root bind mounts
- live `/app/src` bind mounts
- Docker socket access by default

### `operator`

Trusted personal-rig mode.

The main group can be given:
- writable access to the real repo
- live bind-mounted in-container runner source
- optional Docker socket access

Set the profile in `.env`:

```ini
NANOCLAW_PROFILE=safe
```

or

```ini
NANOCLAW_PROFILE=operator
```

## Quick Start

```bash
git clone https://github.com/johnohhh1/nanoclaw-codex.git
cd nanoclaw-codex
npm install
npm run build
./setup.sh
```

`./setup.sh` will:
- detect the host environment
- ask which runtime profile to use
- configure a supported channel
- optionally configure the Web UI
- build the container image
- register the first group
- verify the install

## Channels

### Telegram

Loads when `TELEGRAM_BOT_TOKEN` is configured.

Current command surface includes:
- `/help`
- `/ping`
- `/chatid`
- `/status`
- `/runtime`
- `/capabilities`
- `/restart`

Main-admin commands are restricted to the registered main Telegram chat.

### WhatsApp

Loads when `store/auth/` contains auth state.

Auth is handled with:

```bash
npm run auth
```

### Web UI

Loads when `WEB_UI_PORT` is configured.

Relevant settings:

```ini
WEB_UI_PORT=24873
WEB_UI_HOST=0.0.0.0
WEB_UI_AUTH_TOKEN=
WEB_UI_GROUP_JID=web:web_ui
WEB_UI_GROUP_NAME=Web UI
```

Behavior:
- chat UI at `http://localhost:<WEB_UI_PORT>`
- operator console at `http://localhost:<WEB_UI_PORT>/ops`
- stable group identity `web:web_ui` by default
- browser microphone input uses the Web Speech API client-side
- `safe` installs generate a Web UI auth token automatically if left blank during setup
- Web UI is only auto-elevated to a main/admin surface in `operator` profile

## Security Posture

The main security boundary is the container mount model.

Important defaults:
- non-main groups do not receive the real project root
- the project `.env` is shadowed when the real repo is mounted
- additional mounts are validated against an external allowlist
- `safe` profile keeps main-group autonomy materially narrower than `operator`

Read [docs/SECURITY.md](docs/SECURITY.md) for details.

## Important Paths

- [src/index.ts](src/index.ts)
- [src/container-runner.ts](src/container-runner.ts)
- [container/agent-runner/src/index.ts](container/agent-runner/src/index.ts)
- [src/ipc.ts](src/ipc.ts)
- [src/task-scheduler.ts](src/task-scheduler.ts)
- [src/db.ts](src/db.ts)
- [groups/main/AGENTS.md](groups/main/AGENTS.md)
- [groups/global/AGENTS.md](groups/global/AGENTS.md)

## Development

```bash
npm run typecheck
npm test
npm run build
./container/build.sh
cd container/agent-runner && npm run build
```

## Documentation

Use these in order:

1. [docs/RUNTIME_AUDIT.md](docs/RUNTIME_AUDIT.md)
2. current source code
3. supporting docs in [docs/](docs/)

Historical or experimental documents should not be treated as the primary product contract.
