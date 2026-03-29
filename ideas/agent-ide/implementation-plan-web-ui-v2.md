# Implementation Plan: Web UI v2

## Objective

Build a Mission-Control-style operator console on top of the existing Web UI channel without breaking the current chat workflow.

## Scope Boundary

This plan covers:
- runtime event capture
- trace persistence
- live event streaming to the Web UI
- a first operator-console page

This plan does not cover:
- a full embedded IDE
- full replay/history search
- approvals/workflow engine redesign

## Recommended Technical Shape

### Backend

- add trace/event utilities under `src/`
- persist per-run traces to JSONL under `data/traces/`
- expose a live event stream from the host process
- keep event generation in the real runtime paths, not in UI code

### Frontend

- extend the current Web UI assets under `assets/web-ui/`
- keep the existing chat page working
- add an operator-console route or panel

### Transport

- use WebSocket for live updates
- either:
  - multiplex event messages on the existing socket
  - or add a dedicated `/ws/events`

Recommendation:
- keep one socket and namespace message types cleanly

## Files Most Likely To Change

Host runtime:
- [src/index.ts](/home/johnohhh1/nanoclaw/src/index.ts)
- [src/container-runner.ts](/home/johnohhh1/nanoclaw/src/container-runner.ts)
- [src/channels/web.ts](/home/johnohhh1/nanoclaw/src/channels/web.ts)
- [src/channels/web-ui-server.ts](/home/johnohhh1/nanoclaw/src/channels/web-ui-server.ts)

New backend modules likely:
- `src/traces.ts`
- `src/runtime-events.ts`

Container runtime:
- [container/agent-runner/src/index.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/index.ts)
- [container/agent-runner/src/ipc-mcp-stdio.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts)

Frontend assets:
- [assets/web-ui/index.html](/home/johnohhh1/nanoclaw/assets/web-ui/index.html)
- [assets/web-ui/js/app.js](/home/johnohhh1/nanoclaw/assets/web-ui/js/app.js)
- [assets/web-ui/css/styles.css](/home/johnohhh1/nanoclaw/assets/web-ui/css/styles.css)

## Phase Plan

### Phase 1: Trace Plumbing

Build:
- trace id generation
- event schema/types
- JSONL writer
- run start/finish events
- container lifecycle events
- command lifecycle events

Output:
- trace files appear under `data/traces/`
- active runs can be tailed from disk

### Phase 2: Live Event Stream

Build:
- host event bus
- WebSocket event broadcast
- Web UI event subscription

Output:
- browser receives live run events without polling

### Phase 3: Operator Console UI

Build:
- active run list
- timeline panel
- terminal panel
- metadata panel

Output:
- operators can watch one active run live

### Phase 4: Change Awareness

Build:
- changed files panel
- raw diff panel
- browser artifacts list

Output:
- operators can see what changed during a run

### Phase 5: Controls and Diagnostics

Build:
- command palette
- stop run
- diagnostics panel
- runtime capability summary

Output:
- operators can intervene and inspect runtime state directly

## Event Schema Starter

Minimum event payload:

```json
{
  "id": "evt_123",
  "trace_id": "trace_abc",
  "timestamp": "2026-03-28T12:00:00.000Z",
  "type": "command_started",
  "phase": "execution",
  "summary": "Started npm test",
  "data": {
    "command": "npm",
    "args": ["test"],
    "cwd": "/workspace/project"
  }
}
```

## Risks

### Risk 1: Fake observability

Problem:
- assistant text gets mistaken for runtime truth

Mitigation:
- only show structured runtime events in the console panels

### Risk 2: Too much data

Problem:
- command output can flood the UI

Mitigation:
- stream incrementally
- cap retained visible buffer
- allow expand/download for full logs later

### Risk 3: Cross-run confusion

Problem:
- multiple runs overlap and mix together

Mitigation:
- require trace ids and explicit run headers everywhere

### Risk 4: Host vs container ambiguity

Problem:
- users cannot tell where a command ran

Mitigation:
- every event should identify host vs container origin

## Recommended First Ticket

Implement only this:
- create `src/traces.ts`
- add `trace_id` per run
- append JSONL events from `src/index.ts` and `src/container-runner.ts`
- show a simple active-run event feed in the existing Web UI

That is the fastest path to visible value.
