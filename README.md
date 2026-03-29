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
npm run build
./setup.sh
```

`./setup.sh` walks through environment detection, channel setup, optional Web UI defaults,
container build, group registration, and verification.

For local development, the common loop is:

```bash
npm run typecheck
npm test
npm run build
./container/build.sh
```

If you run NanoClaw under `systemd --user`, the live unit on this machine is:
- `~/.config/systemd/user/nanoclaw.service`

## Architecture

NanoClaw is a small Node.js orchestrator.

For a visual map, see [docs/ARCHITECTURE_DIAGRAM.md](/home/johnohhh1/nanoclaw/docs/ARCHITECTURE_DIAGRAM.md).
For an ops/service view, see [docs/OPS_ARCHITECTURE_DIAGRAM.md](/home/johnohhh1/nanoclaw/docs/OPS_ARCHITECTURE_DIAGRAM.md).
For the current audited runtime truth, see [docs/RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md).
For the cleanup/gap list, see [docs/ACTUAL_VS_DESIRED.md](/home/johnohhh1/nanoclaw/docs/ACTUAL_VS_DESIRED.md).

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

## Runtime Model

The current port is a host Node.js orchestrator plus per-group Docker sandboxes.

Runtime shape:
- host process loads configured channels, routing, scheduler, SQLite state, and group registration
- each active group gets an isolated container session with its own Codex state and IPC directory
- the in-container runner is Codex-native and uses `AGENTS.md` plus installed `SKILL.md` files for context
- main/admin groups get a stronger sandbox with real repo access; non-main groups stay scoped to their own group folder plus shared global context

Current runtime truth is documented in [docs/RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md).

## Channel Loading

Channels are loaded conditionally from `src/channels/index.ts`:
- Telegram loads when `TELEGRAM_BOT_TOKEN` is configured
- WhatsApp loads when `store/auth/` already contains auth state
- Web UI loads when `WEB_UI_PORT` is configured

The branch currently treats Telegram and Web UI as the main operator-facing control surfaces.

## Operator Surfaces

### Telegram

Telegram is the main remote admin surface.

Current bot commands:
- `/help`
- `/ping`
- `/chatid`
- `/status`
- `/runtime`
- `/capabilities`
- `/restart`

Admin-sensitive commands are restricted to the registered main Telegram chat.

## Web UI Channel

NanoClaw can expose a local browser chat channel using `nanoclaw-web-ui`.

Configure it in `.env`:

```ini
WEB_UI_PORT=24873
WEB_UI_HOST=0.0.0.0
WEB_UI_AUTH_TOKEN=
WEB_UI_GROUP_JID=web:web_ui
WEB_UI_GROUP_NAME=Web UI
```

Behavior:
- the Web UI channel is only loaded when `WEB_UI_PORT` is set
- it serves a local chat UI on `http://localhost:<WEB_UI_PORT>`
- it also exposes a dedicated operator console at `http://localhost:<WEB_UI_PORT>/ops`
- `setup.sh` now prompts you to choose a custom high port instead of nudging you toward a standard default
- it binds to `WEB_UI_HOST` and defaults to `0.0.0.0` so agent containers can reach it via `host.docker.internal`
- `WEB_UI_AUTH_TOKEN` is optional; when set, the browser must provide it to connect
- it registers one stable admin group by default: `web:web_ui`
- the UI uses `ASSISTANT_NAME` for the displayed assistant identity
- microphone input uses the browser Web Speech API client-side when available
- Web UI sessions run as an admin/operator surface, so Pepper can inspect `localhost`, use browser automation, and operate on the real repo from that channel

The web channel uses the same inbound message pipeline as Telegram: messages are stored, routed through the normal group queue, and replies are sent back over the active WebSocket transport. Browser tabs are transport sessions; the persistent group identity is the stable Web UI admin group.

Browser tooling inside the agent container now includes:
- `agent-browser` for quick interactive browsing
- `playwright` for deterministic browser automation, DOM inspection, and repeatable UI testing

Mission Control:
- `/ops` is the operator-facing console for watching runs
- it shows active/recent traces, timeline events, run details, changed files, diff snapshots, artifacts, and persisted trace lines
- runtime data is backed by `data/traces/<trace-id>.jsonl`
- operator APIs currently include:
  - `/api/runtime/runs`
  - `/api/runtime/traces/:traceId`

Current note:
- the default stable Web UI group is `web:web_ui`
- per-browser session state stays in the transport layer instead of polluting `registered_groups`

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

Browser tooling in the agent image includes:
- Chromium
- `agent-browser`
- `playwright`

For Web UI testing from inside the sandbox:
- host browser uses `http://localhost:3000`
- agent containers should use `http://host.docker.internal:3000`

## Memory Model

The current instruction contract is:
- `groups/main/AGENTS.md` for the main control group
- `groups/global/AGENTS.md` for shared non-main context
- `groups/<group>/AGENTS.md` for group-specific behavior

Each group also has its own session/state directory under `data/sessions/<group>/`.

Durable medium-term memory now also includes:
- `groups/<group>/MEMORIES.md` for facts that should survive thread rotation
- MCP memory tools:
  - `remember_fact`
  - `list_memories`
  - `forget_fact`

This sits between transient Codex thread history and static `AGENTS.md` instructions.

## Development

```bash
npm run typecheck
npm test
npm run build
./setup.sh
./container/build.sh
cd container/agent-runner && npm run build
```

Useful live-ops checks:

```bash
systemctl --user status nanoclaw
journalctl --user -u nanoclaw -n 100
curl http://localhost:3000/api/health
curl http://localhost:3000/api/runtime/runs
sqlite3 store/messages.db '.tables'
sqlite3 store/messages.db "select jid,name,folder,ifnull(is_main,0),ifnull(requires_trigger,1) from registered_groups order by jid;"
docker ps
```

If you are changing the container image or in-container runner:
- rebuild TypeScript with `npm run build`
- rebuild the agent image with `./container/build.sh`
- restart the service if you expect the live host process to pick up the change

## Current Port Notes

This branch is not just "NanoClaw with a different model."

It is a practical Codex-native port with:
- a real Codex CLI container runner
- MCP-backed tool bridging from the sandbox back to the host
- subagent and scheduled-task controls exposed through the in-container MCP server
- writable real-repo access for the main/admin sandbox
- live bind-mounted `/app/src` runner source so runner patches survive redeploys
- browser tooling and optional Docker runtime control inside the main sandbox

If you are deciding what is actually true today, prefer:
1. [docs/RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md)
2. the current source code
3. older architecture prose only if it still matches the audit

## Documentation

The docs in `docs/` are now best treated as developer references. Older product-design material that described the Claude-era skills marketplace and related setup flows has been removed or condensed in this branch.
