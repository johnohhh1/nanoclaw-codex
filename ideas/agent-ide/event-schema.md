# Event Schema

## Principle

Do not infer activity from chat text.

Emit real structured events from the runtime.

## Common fields

Every event should include:
- `trace_id`
- `event_id`
- `timestamp`
- `type`
- `group_folder`
- `chat_jid`
- `container_name` when available
- `session_id` when available

## Core event types

### Run lifecycle

- `run_started`
- `run_finished`
- `run_failed`

### Container lifecycle

- `container_started`
- `container_stopped`

### Command lifecycle

- `command_started`
- `command_output`
- `command_finished`

### File activity

- `file_read`
- `file_written`
- `file_changed`
- `diff_updated`

### Browser activity

- `browser_opened`
- `browser_action`
- `browser_screenshot`

### Tooling

- `tool_called`
- `mcp_called`
- `subagent_started`
- `subagent_finished`

### Messaging

- `message_received`
- `message_sent`

## Example event

```json
{
  "trace_id": "run_20260327_001",
  "event_id": "evt_0012",
  "timestamp": "2026-03-27T12:00:00.000Z",
  "type": "command_started",
  "group_folder": "web_ui",
  "chat_jid": "web:session_123",
  "container_name": "nanoclaw-web-ui-123",
  "session_id": "thread_abc",
  "command": "npm run build"
}
```
