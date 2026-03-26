# Spec

NanoClaw is a small Node.js orchestrator that runs Codex inside isolated containers.

## High-Level Flow

1. A host-side channel or scheduler produces a prompt.
2. `src/index.ts` routes the work to the appropriate group.
3. `src/container-runner.ts` spawns an isolated container with group mounts, IPC, and session state.
4. `container/agent-runner/src/index.ts` runs Codex CLI inside the container.
5. The container uses the NanoClaw MCP bridge for messaging, task control, and group registration.
6. Results stream back to the host through stdout markers.

## State

- Group instructions: `groups/<group>/AGENTS.md`
- Shared non-main instructions: `groups/global/AGENTS.md`
- Main-group instructions: `groups/main/AGENTS.md`
- Per-group runtime state: `data/sessions/<group>/.codex/`
- Database: `store/messages.db`

## Current Scope

- Codex-native container execution
- Scheduling
- IPC/MCP bridge
- Group isolation
- SQLite state

## Removed From This Branch

- Claude Agent SDK runtime
- `.claude` session format
- Claude remote control
- Host-side branch/marketplace skill system
