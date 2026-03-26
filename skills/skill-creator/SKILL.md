---
name: skill-creator
description: Create, validate, and package NanoClaw skills. Use when adding a new repeatable workflow or updating an existing skill under the repo skills/ tree.
---

# skill-creator

Use this skill when a repeatable workflow should become a reusable NanoClaw skill.

## Skill Layout

Each skill lives under `skills/<skill-name>/` and must contain `SKILL.md`.

Optional subdirectories:
- `scripts/` for executable helpers
- `references/` for detailed reference material
- `assets/` for templates or files used in outputs

## Workflow

1. Scaffold a new skill with `scripts/init_skill.py`.
2. Edit `SKILL.md` and any supporting files.
3. Validate with `scripts/quick_validate.py`.
4. Package with `scripts/package_skill.py` when you need a distributable archive.

Use concise frontmatter:
- `name`
- `description`

Keep the body focused on the workflow Codex should follow.
