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
- Telegram, WhatsApp, and Web UI channel adapters in `src/channels/`
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
- Web UI

Slack, Discord, Gmail, and similar integrations are not currently implemented in this branch.

## Web UI Channel

NanoClaw can expose a local browser chat channel using `nanoclaw-web-ui`.

Configure it in `.env`:

```ini
WEB_UI_PORT=3000
WEB_UI_HOST=0.0.0.0
WEB_UI_AUTH_TOKEN=
```

Behavior:
- the Web UI channel is only loaded when `WEB_UI_PORT` is set
- it serves a local chat UI on `http://localhost:<WEB_UI_PORT>`
- it binds to `WEB_UI_HOST` and defaults to `0.0.0.0` so agent containers can reach it via `host.docker.internal`
- `WEB_UI_AUTH_TOKEN` is optional; when set, the browser must provide it to connect
- the UI uses `ASSISTANT_NAME` for the displayed assistant identity
- microphone input uses the browser Web Speech API client-side when available
- Web UI sessions run as an admin/operator surface, so Pepper can inspect `localhost`, use browser automation, and operate on the real repo from that channel

The web channel uses the same inbound message pipeline as Telegram: messages are stored, routed through the normal group queue, and replies are sent back over the active WebSocket session.

Browser tooling inside the agent container now includes:
- `agent-browser` for quick interactive browsing
- `playwright` for deterministic browser automation, DOM inspection, and repeatable UI testing

## Main Container Behavior

For the main/admin group, the live container now:
- mounts the real repo at `/workspace/project` as read-write
- bind-mounts `container/agent-runner/src` directly into `/app/src`
- can mount `/var/run/docker.sock` for runtime control
- includes the Docker CLI in the agent image when the container is rebuilt

The in-container runner is now patched in real project source, not just a session copy. That means fixes to `container/agent-runner/src/*` survive image rebuilds and redeploys.

If you want Docker control from inside the main agent container, the host service needs:

```ini
CONTAINER_MOUNT_DOCKER_SOCKET=true
CONTAINER_DOCKER_SOCKET_PATH=/var/run/docker.sock
```

With those set and the image rebuilt, the main live sandbox has:
- `docker` available in `PATH`
- `/var/run/docker.sock` mounted
- access to the socket group for non-root operation

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
