---
name: agent-browser
description: Browse the web for research, extraction, and UI interaction tasks. Use when page navigation, form interaction, screenshots, or DOM-aware inspection would help.
---

# agent-browser

Use the `agent-browser` CLI when a browser is the right tool for the job. Prefer it over shell scraping for interactive pages, flows behind buttons or forms, and UI verification work.

## Quick Workflow

```bash
agent-browser open <url>
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser screenshot
```

## When To Use

- Research tasks where page content matters.
- UI testing and reproducing browser workflows.
- Form filling, navigation, and stateful interaction.
- Screenshot or PDF capture.

Supporting resources for this skill should live under `scripts/`, `references/`, or `assets/` in the same directory when needed.
