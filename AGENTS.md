# NanoClaw

Codex-native agent harness. Use this file as the top-level repository instructions.

## Current Reality

- The agent runtime is Codex CLI, not Claude Agent SDK.
- Group and global instruction files are `AGENTS.md`.
- Per-group runtime state lives under `data/sessions/<group>/.codex/`.
- Host-side branch-based skills and marketplace flows have been removed from this branch.
- Container-local helper skills still exist in `container/skills/`.

## Important Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main orchestration loop |
| `src/container-runner.ts` | Host-side container lifecycle |
| `container/agent-runner/src/index.ts` | In-container Codex execution |
| `src/ipc.ts` | Filesystem IPC |
| `src/task-scheduler.ts` | Scheduled task execution |
| `src/db.ts` | SQLite persistence |
| `groups/main/AGENTS.md` | Main-group instructions |
| `groups/global/AGENTS.md` | Shared non-main instructions |

## Development

```bash
npm run typecheck
npm test
./container/build.sh
cd container/agent-runner && npm run build
```

## Scope

This branch should describe and implement only the Codex-native runtime that currently exists in the repo. Do not reintroduce Claude-era skills, remote control, or `.claude`-based assumptions.
