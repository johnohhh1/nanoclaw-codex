# NanoClaw Actual vs Desired

This is the gap list derived from [RUNTIME_AUDIT.md](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md).

It separates:
- **Actual**: what exists today
- **Desired**: what the system should become
- **Gap / next move**: the concrete cleanup or refactor implied by the difference

## 1. Web UI Identity Model

### Actual

- Web UI now uses one stable admin JID by default: `web:web_ui`
- browser-tab/session state is kept in the WebSocket transport
- `registered_groups` no longer accumulates per-session Web UI rows

### Desired

- one stable Web UI admin identity
- one clean registration path
- no session-shaped `registered_groups` sprawl

### Gap / next move

- keep this as the only registration path
- optionally expose the stable Web UI JID more explicitly in the UI itself

## 2. Runtime Truth Source

### Actual

- the most truthful source right now is the runtime audit plus the code
- older architecture prose still under-describes what we wired in during the port

### Desired

- docs, diagrams, and runtime behavior all line up
- architecture docs are regenerated from audited truth, not partial memory

### Gap / next move

- treat `RUNTIME_AUDIT.md` as the canonical truth doc
- redraw future diagrams from the audit
- prune or rewrite older misleading docs

## 3. Config Authority

### Actual

- behavior can be controlled by:
  - systemd unit env
  - repo `.env`
  - built `dist/`
  - current Docker image

### Desired

- fewer places where live behavior can drift
- obvious precedence and easier debugging

### Gap / next move

- document precedence clearly
- consider consolidating more runtime config into one explicit source
- keep `/runtime` aligned with the live merged config report

## 4. Web UI Reachability

### Actual

- browser uses `http://localhost:3000`
- containers must use `http://host.docker.internal:3000`
- this was fixed, but it is still a conceptual split operators have to remember

### Desired

- obvious, documented host/container network semantics
- Pepper never guesses the wrong endpoint

### Gap / next move

- preserve current prompt guidance
- consider a helper env var or runtime note injected into Web sessions so the endpoint difference is explicit

## 5. Capability Discovery

### Actual

- Pepper now has `/capabilities`, `/status`, and a richer `/runtime`
- `/capabilities` now includes built-in container skills as well as repo-installed skills

### Desired

- one authoritative capability surface for the agent and the operator
- easy answer to “what can Pepper do right now?”

### Gap / next move

- add an operator-facing diagnostics panel or command palette in the Web UI that surfaces the same report interactively

## 6. Browser Tooling

### Actual

- both `agent-browser` and `playwright` are installed and working
- usage is documented, but no higher-level abstraction chooses automatically between them

### Desired

- clear selection rule:
  - `agent-browser` for quick exploration
  - `playwright` for scripted/repeatable verification

### Gap / next move

- keep that rule in docs and prompts
- optionally add a dedicated `browser-testing` or `ui-verify` skill that encapsulates the choice

## 7. Channel Admin Surface

### Actual

- Telegram has explicit admin commands
- Web UI is now treated as an operator surface, but does not yet have the same formal slash-command UX shape

### Desired

- consistent admin experience across control surfaces
- same operational commands no matter where Pepper is being used

### Gap / next move

- expose the same command vocabulary for Web sessions
- optionally add an in-UI command palette or admin panel

## 8. Image / Tool Version Reporting

### Actual

- runtime audit can inspect tool versions manually
- live operator experience still requires shell access for full image/tool introspection

### Desired

- Pepper can self-report exact versions and image/tool state

### Gap / next move

- add a runtime report command that includes:
  - `codex --version`
  - `playwright --version`
  - Docker CLI/socket state
  - Web UI port/host

## 9. Operational Cleanliness

### Actual

- branch/worktree often needed small follow-up formatting commits due to hooks
- there is now a real audit doc, but the system still evolved via many hotfixes

### Desired

- a calmer baseline where the next refactor is done from documented truth, not session memory

### Gap / next move

- use the audit as the baseline before any bigger refactor or rebrand
- treat major changes as:
  1. update audit
  2. change runtime
  3. regenerate diagrams

## Recommended Order

If you want the highest-value cleanup path after this:

1. Unify admin/operator commands across Telegram and Web UI.
2. Add live diff/file/browser artifact events during runs instead of only finish-time snapshots.
3. Add an operator-facing diagnostics/control palette in the Web UI.
4. Regenerate diagrams after those changes.
