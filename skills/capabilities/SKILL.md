---
name: capabilities
description: Report what this NanoClaw instance can do in the current group, including installed skills, visible workspace context, and available tools.
---

# capabilities

Use this skill when the user asks what is installed, what tools are available, or what the bot can do in the current environment.

## Output

Provide a concise, read-only summary of:
- active skills for the current group
- relevant workspace visibility such as `/workspace/group`, `/workspace/global`, and `/workspace/project`
- container utilities that are actually available
- NanoClaw capabilities exposed through the runtime

Keep the report factual. Do not claim features that are not visible in the current environment.
