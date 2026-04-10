# Requirements

This branch targets a Codex-native NanoClaw runtime.

## Core Requirements

- Codex CLI based execution inside containers
- `AGENTS.md` based instruction loading
- Per-group isolated state
- Safe-by-default install posture for new users
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

The current repo ships concrete channel implementations in `src/channels/` for:
- Telegram
- WhatsApp
- Web UI

Additional channels should be added directly in the repository when needed.
