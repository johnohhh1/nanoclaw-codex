# Contributing

NanoClaw is a Codex-native runtime. Contributions should match the current system, not removed Claude-era behavior.

## Accepted Changes

- Bug fixes
- Security fixes
- Runtime simplifications
- Documentation updates
- Tests
- Channel implementations added directly to the repo

## Not Accepted

- Reintroducing `.claude`-based state or skills
- Reintroducing Claude remote control
- Reintroducing marketplace/plugin flows that do not exist in this branch
- Adding documentation for removed product paths as if they still work

## Expectations

1. Keep each PR focused.
2. Update tests when behavior changes.
3. Run `npm run typecheck` and `npm test`.
4. If you touch the in-container runtime, also run `cd container/agent-runner && npm run build`.

## Channels

The core repo already ships Telegram, WhatsApp, and Web UI adapters in `src/channels/`.
If you want to add another integration, add the source directly to the repo rather than describing it as an external skill.
