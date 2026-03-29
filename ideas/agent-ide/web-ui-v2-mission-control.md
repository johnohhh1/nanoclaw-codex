# Web UI v2: Mission Control

## Goal

Upgrade the current Web UI from a chat surface into an operator console.

The point is not to copy Mission Control's product engine. The point is to give NanoClaw operators a live place to watch Pepper work, inspect runtime state, and intervene when needed.

This should remain a NanoClaw control surface:
- chat still works
- messages still flow through the existing channel pipeline
- the new UI adds observability and controls on top

## Why This Matters

Right now the Web UI is useful but thin:
- send message
- receive reply
- use microphone input

What is missing is operator visibility:
- what run is active
- what Pepper is doing right now
- what command is running
- what files changed
- what the container/browser are doing
- whether the run is healthy or stuck

This is the blindfold problem.

## Reference Inspiration

Mission Control is a good visual/operator reference for:
- activity dashboard
- operator chat attached to live work
- health/status badges
- command palette
- multi-panel workspace

We should borrow the cockpit ideas, not the product-autopilot workflow.

## Product Definition

### What Web UI v2 is

- a live operator console for Pepper
- a task/run dashboard tied to NanoClaw's real runtime
- a mission-control layer on top of the existing Web UI channel

### What Web UI v2 is not

- not a replacement for Telegram
- not a full browser IDE on day one
- not a clone of Mission Control's autonomous product engine
- not a fake dashboard inferred from assistant prose

## Design Principles

1. Runtime truth over chat claims
- show actual events, commands, status, and diffs
- do not infer state from Pepper saying "I am testing now"

2. Operator first
- make current run identity obvious
- make failures loud
- make intervention easy

3. Extend, do not replace
- keep the existing Web UI transport and chat model
- layer observability and controls on top

4. Build in slices
- start with event visibility
- add controls second
- add replay and richer previews later

## Core Screens

### 1. Mission Control Dashboard

Purpose:
- see all active and recent runs in one place

Show:
- active runs
- queued runs
- recent completed runs
- per-run status
- current phase
- elapsed time
- channel and group
- container health

### 2. Live Run View

Purpose:
- watch one run in real time

Show:
- run header with status and identity
- live event timeline
- terminal/output stream
- current diff
- changed files
- browser artifacts
- runtime metadata
- operator chat for that run

### 3. Command Palette

Purpose:
- fast operator actions without hunting through the UI

Initial commands:
- `/status`
- `/capabilities`
- `/restart`
- `/stop-run`
- `/open-diff`
- `/open-logs`
- `/open-browser-artifacts`

### 4. Diagnostics View

Purpose:
- answer "what can Pepper do right now?"

Show:
- channel status
- Web UI host/port
- Docker CLI/socket status
- browser tooling status
- image/tool versions
- registered groups
- current container mount model summary

## Layout

## Top bar

- assistant identity
- channel badge
- service health badge
- active run count
- command palette trigger

## Left rail

- active runs
- recent runs
- filters:
  - active
  - failed
  - completed
  - Telegram
  - Web UI

## Main column

- current run summary
- live timeline
- operator chat input/output

## Right rail

Tabbed panes:
- Diff
- Files
- Browser
- Metadata
- Diagnostics

## Bottom drawer

- live terminal output
- command output
- stderr emphasis

## Data Model

The UI should be driven by structured runtime events.

### Required entities

- `run`
- `event`
- `artifact`
- `command`
- `browser_session`
- `container_session`

### Minimum run fields

- `trace_id`
- `chat_jid`
- `group_folder`
- `channel`
- `assistant_name`
- `status`
- `phase`
- `started_at`
- `updated_at`
- `finished_at`
- `container_name`
- `codex_session_id`

### Minimum event fields

- `id`
- `trace_id`
- `timestamp`
- `type`
- `phase`
- `summary`
- `data`

## Event Types

Minimum first-class event types:
- `run_started`
- `message_received`
- `prompt_built`
- `container_started`
- `codex_started`
- `command_started`
- `command_output`
- `command_finished`
- `file_changed`
- `diff_updated`
- `tool_called`
- `browser_action`
- `artifact_created`
- `message_sent`
- `run_finished`
- `run_failed`

Important rule:
- terminal text is not enough
- command lifecycle must be represented structurally

## Backend Shape

### Event source of truth

Emit events from the real choke points:
- [src/index.ts](/home/johnohhh1/nanoclaw/src/index.ts)
- [src/container-runner.ts](/home/johnohhh1/nanoclaw/src/container-runner.ts)
- [src/ipc.ts](/home/johnohhh1/nanoclaw/src/ipc.ts)
- [container/agent-runner/src/index.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/index.ts)
- [container/agent-runner/src/ipc-mcp-stdio.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts)

### Recommended storage

Phase 1 recommendation:
- JSONL trace files per run

Suggested path:
- `data/traces/<trace-id>.jsonl`

Reason:
- simple
- durable
- easy to tail
- easy to debug manually

Later option:
- move or mirror into SQLite for richer querying

### Recommended transport

- WebSocket from host process to Web UI

The Web UI already has a WebSocket channel model, so this should be additive:
- existing chat transport remains
- add a second event stream or event message namespace

## UI Components

### Run cards

Each run card should show:
- title or latest task summary
- channel
- group
- status
- phase
- elapsed time
- last event summary

### Timeline

Each timeline row should show:
- timestamp
- icon by event type
- one-line summary
- expandable detail payload

### Diff pane

Initial version:
- changed files list
- raw `git diff --no-color`

Later version:
- syntax-highlighted patch viewer

### Browser pane

Initial version:
- list of screenshots / artifacts
- browser event log

Later version:
- embedded latest screenshot
- DOM/state summary

### Terminal pane

Show:
- active command
- stdout/stderr stream
- exit code on finish

## Controls

Start with low-risk operator controls:
- stop current run
- send follow-up message
- copy trace id
- open changed files
- restart service
- refresh diagnostics

Do not start with destructive controls like:
- reset repo
- delete container
- wipe state

## Visual Direction

This should feel like an operations cockpit, not a generic chatbot.

Desired tone:
- dark or neutral control-room surface is acceptable here
- strong contrast and status colors
- dense but readable information layout
- timeline and badges should be easy to scan

Avoid:
- giant empty chat bubbles
- consumer-chat-app layout as the primary metaphor
- decorative chrome that hides runtime information

## Recommended Build Order

### Phase 1: Observable Runs

Ship:
- trace ids
- event stream
- run list
- live timeline
- terminal stream
- metadata panel

Success condition:
- user can watch Pepper work without relying on assistant prose

### Phase 2: Change Awareness

Ship:
- changed files list
- diff pane
- browser artifact pane
- command palette

Success condition:
- user can tell what changed and what tools were used

### Phase 3: Operator Controls

Ship:
- stop run
- restart service
- diagnostics panel
- deeper admin commands

Success condition:
- user can operate Pepper from the UI, not just observe

### Phase 4: Replay and Forensics

Ship:
- run history
- replay view
- searchable traces
- failure drill-down

Success condition:
- old runs are debuggable after the fact

## NanoClaw-Specific Constraints

This spec must respect the current port reality:
- Web UI is a channel, not the whole app
- Telegram remains an important operator surface
- main/admin sandbox has stronger privileges than non-main
- the current Web UI identity model is still messy and should be normalized later
- host and container networking differ:
  - browser uses `localhost`
  - container uses `host.docker.internal`

## First Implementation Slice

If starting immediately, build this exact slice first:

1. Add `trace_id` generation for each run.
2. Write JSONL events for:
- run started
- container started
- command started
- command output
- command finished
- message sent
- run finished
3. Add a Web UI route/view for active runs.
4. Add a live timeline panel and terminal panel.
5. Add a metadata sidebar with channel, group, container, and session id.

That is the smallest slice that materially fixes the blindfold problem.

## Definition of Done for v2 MVP

Web UI v2 MVP is done when:
- an operator can watch an active Pepper run in real time
- the operator can see what command is running
- the operator can see terminal output and current status
- the operator can identify the container, group, and trace id
- the system is showing runtime truth, not just assistant narration
