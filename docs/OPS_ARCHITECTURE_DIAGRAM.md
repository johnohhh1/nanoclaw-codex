# NanoClaw Actual Ops Diagram

This is the ops view of the live port, redrawn from [RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md).

It is meant to answer:
- what is actually running
- what listens on what
- where state lives
- what to restart
- where failures are isolated

## Actual Ops Topology

```mermaid
flowchart TB
    classDef ingress fill:#17324d,color:#fff,stroke:#5aa9ff,stroke-width:1px;
    classDef svc fill:#1f3b2d,color:#fff,stroke:#5fd18b,stroke-width:1px;
    classDef state fill:#4a3316,color:#fff,stroke:#ffbf66,stroke-width:1px;
    classDef rt fill:#4a1f3b,color:#fff,stroke:#ff7db8,stroke-width:1px;
    classDef caveat fill:#4a2222,color:#fff,stroke:#ff7d7d,stroke-width:1px;

    USER["JohnO / operators"]:::ingress
    TG["Telegram main chat"]:::ingress
    WA["WhatsApp sessions"]:::ingress
    WEB["Browser -> localhost:3000"]:::ingress

    SYSTEMD["systemd --user\nnanoclaw.service"]:::svc
    NODE["NanoClaw host process\nnode dist/index.js"]:::svc

    PORT3000["Listener\n0.0.0.0:3000"]:::svc
    LOGOUT["logs/nanoclaw.log"]:::state
    LOGERR["logs/nanoclaw.error.log"]:::state

    DB["store/messages.db"]:::state
    AUTH["store/auth"]:::state
    GROUPS["groups/*"]:::state
    SESS["data/sessions/<group>/.codex"]:::state
    IPC["per-group IPC dirs"]:::state

    DOCKER["Docker daemon"]:::rt
    CTRS["nanoclaw-agent:latest\nper-group containers"]:::rt
    TOOLS["in-container tools\ncodex, agent-browser,\nplaywright, docker"]:::rt

    WEBDYN["Caveat:\nweb:* registrations are\ndynamic session-shaped"]:::caveat

    USER --> SYSTEMD
    USER --> TG
    USER --> WA
    USER --> WEB

    SYSTEMD --> NODE
    NODE --> PORT3000
    NODE --> LOGOUT
    NODE --> LOGERR
    TG --> NODE
    WA --> NODE
    WEB --> PORT3000

    NODE --> DB
    NODE --> AUTH
    NODE --> GROUPS
    NODE --> SESS
    NODE --> IPC
    NODE --> DOCKER
    DOCKER --> CTRS
    CTRS --> TOOLS

    WEB --> WEBDYN
```

## Current Restart / Debug Boundaries

```mermaid
flowchart LR
    classDef svc fill:#1f3b2d,color:#fff,stroke:#5fd18b,stroke-width:1px;
    classDef rt fill:#4a1f3b,color:#fff,stroke:#ff7db8,stroke-width:1px;
    classDef state fill:#4a3316,color:#fff,stroke:#ffbf66,stroke-width:1px;

    SVC["systemctl --user restart nanoclaw"]:::svc --> HOST["Host process"]:::svc
    HOST --> WEBUI["Web UI :3000"]:::svc
    HOST --> CHANS["Telegram / WhatsApp / Web adapters"]:::svc
    HOST --> STATE["SQLite + group/task state"]:::state
    HOST --> DOCKER["Docker-launched group containers"]:::rt
    DOCKER --> AGENT["In-container Codex agent"]:::rt
```

## Current Failure Domains

### If the user service fails

- Web UI disappears from `:3000`
- Telegram and WhatsApp stop replying
- no new agent containers start

### If Docker fails

- host service can still run
- channel ingestion/storage may still work
- all actual agent execution fails

### If SQLite fails

- messages, registered groups, task state, and routing/session state all degrade together

### If one group container fails

- that group stalls or retries
- other groups can still run

## Current Live Ops Facts

- user service: `nanoclaw.service`
- host listener: `0.0.0.0:3000`
- agent image: `nanoclaw-agent:latest`
- Docker socket mounting: enabled in live user unit
- Telegram main group: registered and main
- Web UI group: registered and main, but currently session-shaped

## Fast Checks

```bash
systemctl --user status nanoclaw --no-pager
systemctl --user cat nanoclaw
ss -ltnp | rg ':3000\\b'
curl -s http://localhost:3000/api/health
tail -n 50 logs/nanoclaw.log
tail -n 50 logs/nanoclaw.error.log
docker ps --format '{{.Names}} {{.Status}}' | rg '^nanoclaw-'
sqlite3 store/messages.db "select jid, name, folder, ifnull(is_main,0), ifnull(requires_trigger,1) from registered_groups order by folder;"
```

## See Also

- [RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md)
- [ACTUAL_VS_DESIRED.md](/home/johnohhh1/nanoclaw/docs/ACTUAL_VS_DESIRED.md)
