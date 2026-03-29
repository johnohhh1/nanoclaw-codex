# MVP

## Minimum useful version

The first version should show enough to remove the “blindfold” problem.

## MVP panels

### 1. Active runs list

Show:
- trace/run id
- group/chat
- start time
- status
- current phase

### 2. Live activity timeline

Show structured events such as:
- run started
- container started
- command started/finished
- file changed
- tool called
- browser action
- run finished

### 3. Terminal/output panel

Show:
- streamed stdout/stderr from relevant commands
- container output
- failure lines clearly

### 4. Diff panel

Show:
- current working diff for the run
- file list of changed files

### 5. Metadata panel

Show:
- container name
- group folder
- chat JID
- session id
- elapsed time

## Out of MVP

- embedded rich code editor
- historical replay
- full browser preview pane
- fine-grained approvals
