# Requirements

This branch targets a Codex-native NanoClaw runtime.

## Core Requirements

- Codex CLI based execution inside containers
- `AGENTS.md` based instruction loading
- Per-group isolated state
- SQLite persistence
- Filesystem IPC between host and container
- Scheduled tasks
- Small, understandable host orchestrator

## Explicit Non-Goals

- Host-side `.claude` or `.codex` skills marketplaces
- Slash-command driven installer flows
- Claude Agent SDK compatibility layers
- Remote-control support carried over from Claude Code

## Channel Model

The current repo keeps the channel registry scaffolding but does not ship concrete channel implementations in `src/channels/`. Channel code should be added directly in the repository when needed.
