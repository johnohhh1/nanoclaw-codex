# UI Layout

## Layout goal

The page should feel like an operator console, not just another chat screen.

## Proposed layout

### Left column

- active runs
- recent runs
- filters by group/channel/status

### Main center column

- live event timeline
- phase/status banner
- current task summary

### Right column

Tabbed content:
- diff
- changed files
- browser artifacts
- metadata

### Bottom drawer

- terminal/output stream
- command logs

## Important UX rules

- always show what is current
- show failures loudly
- make run identity obvious
- prefer real-time updates over refresh-based polling if possible

## Nice later additions

- replay mode
- embedded screenshots
- embedded file preview
- pause/stop controls
