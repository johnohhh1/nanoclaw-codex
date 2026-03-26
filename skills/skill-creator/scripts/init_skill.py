#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill from template.
"""

import argparse
import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = {"scripts", "references", "assets"}

SKILL_TEMPLATE = """---
name: {skill_name}
description: "[TODO: explain what this skill does and when to use it]"
---

# {skill_title}

## Overview

[TODO: explain the workflow this skill captures]

## When To Use

[TODO: describe the requests or situations that should trigger this skill]

## Workflow

[TODO: add the repeatable steps, scripts, references, and constraints]
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Example helper script for {skill_name}
"""

def main():
    print("TODO: implement {skill_name}")

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# Reference Notes

Replace this file with detailed reference material for the skill.
"""

EXAMPLE_ASSET = """Replace this placeholder with a real asset file if needed.
"""


def normalize_skill_name(skill_name):
    normalized = skill_name.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def title_case_skill_name(skill_name):
    return " ".join(word.capitalize() for word in skill_name.split("-"))


def parse_resources(raw_resources):
    if not raw_resources:
        return []
    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        print(f"[ERROR] Unknown resource type(s): {', '.join(invalid)}")
        print(f"   Allowed: {allowed}")
        sys.exit(1)

    deduped = []
    seen = set()
    for resource in resources:
        if resource not in seen:
            deduped.append(resource)
            seen.add(resource)
    return deduped


def create_resource_dirs(skill_dir, skill_name, resources, include_examples):
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)

        if resource == "scripts":
            if include_examples:
                example_script = resource_dir / "example.py"
                example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
                example_script.chmod(0o755)
        elif resource == "references":
            if include_examples:
                example_reference = resource_dir / "reference.md"
                example_reference.write_text(EXAMPLE_REFERENCE)
        elif resource == "assets":
            if include_examples:
                example_asset = resource_dir / "example.txt"
                example_asset.write_text(EXAMPLE_ASSET)


def init_skill(skill_name, path, resources, include_examples):
    normalized_name = normalize_skill_name(skill_name)
    if not normalized_name:
        print("[ERROR] Skill name is empty after normalization")
        return None
    if len(normalized_name) > MAX_SKILL_NAME_LENGTH:
        print(f"[ERROR] Skill name too long ({len(normalized_name)} > {MAX_SKILL_NAME_LENGTH})")
        return None

    base_path = Path(path).expanduser().resolve()
    base_path.mkdir(parents=True, exist_ok=True)

    skill_dir = base_path / normalized_name
    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        return None

    skill_dir.mkdir(parents=True)
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
        SKILL_TEMPLATE.format(
            skill_name=normalized_name,
            skill_title=title_case_skill_name(normalized_name),
        )
    )

    create_resource_dirs(skill_dir, normalized_name, resources, include_examples)
    print(f"[OK] Created skill: {skill_dir}")
    return skill_dir


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_name")
    parser.add_argument("--path", required=True)
    parser.add_argument("--resources", default="")
    parser.add_argument("--examples", action="store_true")
    args = parser.parse_args()

    skill_dir = init_skill(
        args.skill_name,
        args.path,
        parse_resources(args.resources),
        args.examples,
    )
    sys.exit(0 if skill_dir else 1)


if __name__ == "__main__":
    main()
