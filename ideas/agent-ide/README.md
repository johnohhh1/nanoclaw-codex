# Agent IDE

This idea is for a live operator-facing IDE/workbench for Pepper inside NanoClaw.

Goal:
- stop operating Pepper blind
- show what the agent is actively doing while it works
- expose run state, commands, diffs, browser actions, and artifacts in one place

This is not meant to replace chat. It is meant to make chat-driven agent work observable.

Related docs:
- [Runtime Audit](/home/johnohhh1/nanoclaw/docs/RUNTIME_AUDIT.md)
- [Architecture Diagram](/home/johnohhh1/nanoclaw/docs/ARCHITECTURE_DIAGRAM.md)
- [Ops Diagram](/home/johnohhh1/nanoclaw/docs/OPS_ARCHITECTURE_DIAGRAM.md)
- [Actual vs Desired](/home/johnohhh1/nanoclaw/docs/ACTUAL_VS_DESIRED.md)
- [Web UI v2: Mission Control](/home/johnohhh1/nanoclaw/ideas/agent-ide/web-ui-v2-mission-control.md)
- [Implementation Plan: Web UI v2](/home/johnohhh1/nanoclaw/ideas/agent-ide/implementation-plan-web-ui-v2.md)

Core idea:
- add structured runtime events
- persist them by run/trace
- expose them over WebSocket/SSE
- render them in a Web UI page as a lightweight agent IDE
