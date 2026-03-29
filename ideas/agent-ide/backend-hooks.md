# Backend Hooks

## Principle

Hook the actual runtime choke points instead of scraping logs later.

## Best hook points

### Host runtime

- [src/index.ts](/home/johnohhh1/nanoclaw/src/index.ts)
  - run started
  - run finished
  - message received
  - message sent

- [src/container-runner.ts](/home/johnohhh1/nanoclaw/src/container-runner.ts)
  - container started
  - container name assigned
  - streamed output chunks
  - container exit

- [src/ipc.ts](/home/johnohhh1/nanoclaw/src/ipc.ts)
  - task operations
  - group registration events

### Container runtime

- [container/agent-runner/src/index.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/index.ts)
  - prompt construction phase
  - Codex run phase
  - browser tool selection
  - output completion

- [container/agent-runner/src/ipc-mcp-stdio.ts](/home/johnohhh1/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts)
  - MCP tool calls
  - subagent lifecycle
  - scheduling calls

## Event transport options

### Option A: JSONL on disk

Pros:
- simple
- durable
- easy to debug

Cons:
- needs tail/follow mechanism

### Option B: SQLite trace tables

Pros:
- queryable
- consistent with current state model

Cons:
- slightly more schema work

### Option C: in-memory + WebSocket only

Pros:
- fastest to prototype

Cons:
- poor history
- less durable

## Recommended first move

- write JSONL traces per run
- add WebSocket stream later
