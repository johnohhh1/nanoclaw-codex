# NanoClaw Runtime Audit

Audited on: `2026-03-26`

This document is the current-source-of-truth audit for the live NanoClaw port on this machine. It is intentionally operational and concrete: what is live, what is configured, what tools exist, and what caveats still remain.

## Scope

This audit is based on:
- current repo code under `/home/johnohhh1/nanoclaw`
- live user systemd unit
- current `.env`
- live listening ports
- current Docker image `nanoclaw-agent:latest`
- current SQLite registration state in `store/messages.db`

It is not based on memory or older design docs.

## Live Host Service

### Service

- Unit: [nanoclaw.service](/home/johnohhh1/.config/systemd/user/nanoclaw.service)
- Manager: `systemd --user`
- ExecStart: `node /home/johnohhh1/nanoclaw/dist/index.js`
- Working directory: `/home/johnohhh1/nanoclaw`
- Restart policy: `Restart=always`
- Kill mode: `KillMode=process`

### Service-level environment

From the live unit:
- `HOME=/home/johnohhh1`
- `PATH=/usr/local/bin:/usr/bin:/bin:/home/johnohhh1/.local/bin`
- `CONTAINER_MOUNT_DOCKER_SOCKET=true`
- `CONTAINER_DOCKER_SOCKET_PATH=/var/run/docker.sock`

### Logs

- stdout: [nanoclaw.log](/home/johnohhh1/nanoclaw/logs/nanoclaw.log)
- stderr: [nanoclaw.error.log](/home/johnohhh1/nanoclaw/logs/nanoclaw.error.log)

## Live App Environment

From the current `.env`:
- `TZ=America/New_York`
- `ASSISTANT_NAME=Pepper`
- `TELEGRAM_BOT_TOKEN` is configured
- `WEB_UI_PORT=3000`
- `WEB_UI_HOST=0.0.0.0`
- `WEB_UI_AUTH_TOKEN` is currently empty

Important:
- the repo `.env` is intentionally shadowed with `/dev/null` inside main containers, so agents do not read secrets from `/workspace/project/.env`

## Live Listening Ports

Observed on host:
- `0.0.0.0:3000` -> NanoClaw Web UI listener owned by the main Node process

Observed but not treated as NanoClaw in this audit:
- other unrelated services/ports on the machine

## Enabled Channels

Current channel loading logic in [channels/index.ts](/home/johnohhh1/nanoclaw/src/channels/index.ts):
- Telegram loads when `TELEGRAM_BOT_TOKEN` exists
- WhatsApp loads when `store/auth/` contains auth state
- Web UI loads when `WEB_UI_PORT` is configured

### Telegram

Adapter: [telegram.ts](/home/johnohhh1/nanoclaw/src/channels/telegram.ts)

Live command surface includes:
- `/help`
- `/ping`
- `/chatid`
- `/status`
- `/runtime`
- `/capabilities`
- `/restart`

Admin-sensitive commands are restricted to the registered main Telegram chat.

### WhatsApp

Adapter: [whatsapp.ts](/home/johnohhh1/nanoclaw/src/channels/whatsapp.ts)

Status:
- channel code exists
- auth state directory exists under [store/auth](/home/johnohhh1/nanoclaw/store/auth)
- channel is considered loadable when auth state is present

### Web UI

Adapter: [web.ts](/home/johnohhh1/nanoclaw/src/channels/web.ts)
Server: [web-ui-server.ts](/home/johnohhh1/nanoclaw/src/channels/web-ui-server.ts)
Assets: [assets/web-ui](/home/johnohhh1/nanoclaw/assets/web-ui)

Live behavior:
- listens on host `0.0.0.0:3000`
- browser reaches it at `http://localhost:3000`
- sandboxed agent containers reach it at `http://host.docker.internal:3000`
- Web UI auth token is optional and currently blank
- browser microphone input is client-side Web Speech API transcription only
- operator console is available at `http://localhost:3000/ops`
- runtime APIs currently include:
  - `/api/health`
  - `/api/runtime/runs`
  - `/api/runtime/traces/:traceId`

Current design decision:
- Web UI sessions are treated as an admin/operator surface
- auto-registered Web UI groups are marked `isMain: true`

## Registered Groups

Current `registered_groups` table audit:

| JID | Name | Folder | isMain | requiresTrigger |
|---|---|---|---:|---:|
| `tg:6796278148` | `Pepper` | `telegram-pepper` | 1 | 1 |
| `web:web_ui` | `Web UI` | `web_ui` | 1 | 0 |

Operational note:
- the Web UI registration model is now normalized to one stable admin identity
- per-browser session state lives in the WebSocket transport instead of `registered_groups`

## Persistence / State

### Primary host state

- Database: [store/messages.db](/home/johnohhh1/nanoclaw/store/messages.db)
- WhatsApp auth: [store/auth](/home/johnohhh1/nanoclaw/store/auth)
- Group instructions: [groups](/home/johnohhh1/nanoclaw/groups)
- Durable group memory: `groups/<group>/MEMORIES.md`
- Repo skills: [skills](/home/johnohhh1/nanoclaw/skills)
- Group Codex state: [data/sessions](/home/johnohhh1/nanoclaw/data/sessions)
- Runtime traces: [data/traces](/home/johnohhh1/nanoclaw/data/traces)

### Database responsibilities

`store/messages.db` currently holds:
- messages
- chat metadata
- registered groups
- group-installed skills
- scheduled tasks
- router/session cursors

## Container Runtime

### Runtime backend

- Runtime binary: Docker
- Code path: [container-runtime.ts](/home/johnohhh1/nanoclaw/src/container-runtime.ts)
- Host gateway mapping: `host.docker.internal:host-gateway` is added on Linux

### Agent image

- Image: `nanoclaw-agent:latest`
- Dockerfile: [container/Dockerfile](/home/johnohhh1/nanoclaw/container/Dockerfile)

Audited image environment:
- `AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
- `NODE_PATH=/app/node_modules`

### Audited in-image tools

Verified from the image:
- `agent-browser` -> `/usr/local/bin/agent-browser`
- `playwright` -> `/usr/local/bin/playwright`
- `docker` -> `/usr/bin/docker`
- `node` -> `v22.22.2`
- `codex` -> `codex-cli 0.117.0`

Verified behavior:
- Playwright CLI works
- `require('playwright')` works from ad-hoc Node scripts in the image
- Chromium launch through Playwright works

## Container Mount Model

Source of truth: [container-runner.ts](/home/johnohhh1/nanoclaw/src/container-runner.ts)

### Main/admin container mounts

Main groups receive:
- project root -> `/workspace/project` (read-write)
- project `.env` shadowed by `/dev/null` at `/workspace/project/.env`
- own group folder -> `/workspace/group` (read-write)
- repo skills -> `/workspace/skills-catalog`
- per-group Codex state -> `/home/node/.codex`
- per-group IPC dir -> `/workspace/ipc`
- live agent-runner source -> `/app/src` (bind-mounted from real repo)
- Docker socket -> `/var/run/docker.sock` when enabled

### Non-main container mounts

Non-main groups receive:
- own group folder -> `/workspace/group` (read-write)
- `groups/global` -> `/workspace/global` (read-only)
- repo skills -> `/workspace/skills-catalog` (read-only)
- per-group Codex state -> `/home/node/.codex`
- per-group IPC dir -> `/workspace/ipc`
- live agent-runner source -> `/app/src`

### Effective consequences

- main can patch the real repo through `/workspace/project`
- all containers use the live bind-mounted `container/agent-runner/src` under `/app/src`
- group Codex state is isolated per group
- IPC is isolated per group

## In-Container Agent Runtime

Main runner: [container/agent-runner/src/index.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/index.ts)
MCP server: [ipc-mcp-stdio.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts)

### Prompt sources

The runner builds prompt context from:
- group `AGENTS.md`
- `groups/global/AGENTS.md` for non-main
- installed repo skills from `/workspace/skills-catalog`
- built-in capability summary / skill index
- task and group snapshots
- channel-specific guidance, including Web UI guidance

### Runtime trace instrumentation

Host/operator trace source:
- [traces.ts](/home/johnohhh1/nanoclaw/src/traces.ts)

Current traced events include:
- run start / finish / failure
- prompt build
- container start
- runner bootstrap
- Codex turn start
- Codex session initialization
- assistant output
- outbound message send

Current run-enrichment captures:
- changed repo files for main/admin runs via host `git diff --name-only`
- repo diff snapshot for main/admin runs
- discovered artifacts in the group folder based on file modification time
- persisted JSONL trace lines readable through the Web UI runtime API

Persistence model:
- per-run JSONL traces under `data/traces/<trace-id>.jsonl`
- `/ops` reads active runs from memory and can recover persisted traces after service restart

### MCP tools exposed to Pepper

Audited MCP tool surface:
- `send_message`
- `remember_fact`
- `list_memories`
- `forget_fact`
- `team_create`
- `team_send_message`
- `task_output`
- `task_stop`
- `team_delete`
- `schedule_task`
- `list_tasks`
- `pause_task`
- `resume_task`
- `cancel_task`
- `update_task`
- `register_group`

## Built-In Container Skills

Audited under [container/skills](/home/johnohhh1/nanoclaw/container/skills):
- `agent-browser`
- `capabilities`
- `playwright`
- `slack-formatting`
- `status`

### Browser tooling split

Current intended usage:
- `agent-browser` for quick exploratory browsing and element interaction
- `playwright` for deterministic, scripted browser automation and repeatable UI verification

## Repo-Level Skills

Host-managed repo skills live under [skills](/home/johnohhh1/nanoclaw/skills) and are installed per group through `/skills`.

Current runner behavior:
- installed repo skills are injected into prompt context
- a generated skill index is included in the in-container prompt

## Capability Improvements Added During This Port

Audited as present in code/runtime:
- writable real repo mount for main group
- live `/app/src` bound to real `container/agent-runner/src`
- Docker CLI present in the agent image
- Docker socket mount enabled in the live user service
- Telegram admin commands for status/restart/capabilities
- Web UI channel with browser-side voice transcription
- Web UI binding on `0.0.0.0`
- host-reachable Web UI from containers via `host.docker.internal:3000`
- Playwright added to container tooling
- capability/status reporting improvements

## Known Caveats / Debt

### 1. Web UI registration is normalized

The Web UI now uses one stable admin registration, `web:web_ui`, while browser-tab/session state stays in the WebSocket transport layer.

### 2. Docs are still catching up

The code and runtime now reflect more capability than the older architecture prose implied. This audit is more current than older conceptual docs.

### 3. Web UI is host-served, not container-served

The Web UI lives in the host Node process, so from inside agent containers the correct target is `host.docker.internal:3000`, not `localhost:3000`.

### 4. Service state and repo state can drift

Some behavior is controlled by:
- systemd unit env
- repo `.env`
- current built `dist/`
- current Docker image

When debugging, verify all four rather than assuming the repo alone is authoritative.

## Fast Audit Commands

```bash
systemctl --user status nanoclaw --no-pager
systemctl --user cat nanoclaw
ss -ltnp | rg ':3000\\b'
curl -s http://localhost:3000/api/health
sqlite3 store/messages.db "select jid, name, folder, ifnull(is_main,0), ifnull(requires_trigger,1) from registered_groups order by folder;"
docker image inspect nanoclaw-agent:latest --format '{{json .Config.Env}}'
docker run --rm --entrypoint sh nanoclaw-agent:latest -lc "command -v agent-browser; command -v playwright; command -v docker; node --version; codex --version | head -n 1"
```

## Primary Source Files

- [src/index.ts](/home/johnohhh1/nanoclaw/src/index.ts)
- [src/container-runner.ts](/home/johnohhh1/nanoclaw/src/container-runner.ts)
- [src/container-runtime.ts](/home/johnohhh1/nanoclaw/src/container-runtime.ts)
- [src/ipc.ts](/home/johnohhh1/nanoclaw/src/ipc.ts)
- [src/db.ts](/home/johnohhh1/nanoclaw/src/db.ts)
- [src/channels/telegram.ts](/home/johnohhh1/nanoclaw/src/channels/telegram.ts)
- [src/channels/whatsapp.ts](/home/johnohhh1/nanoclaw/src/channels/whatsapp.ts)
- [src/channels/web.ts](/home/johnohhh1/nanoclaw/src/channels/web.ts)
- [container/agent-runner/src/index.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/index.ts)
- [container/agent-runner/src/ipc-mcp-stdio.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts)
- [container/Dockerfile](/home/johnohhh1/nanoclaw/container/Dockerfile)
