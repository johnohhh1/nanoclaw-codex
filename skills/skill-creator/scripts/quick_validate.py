#!/usr/bin/env python3
"""
Quick validation script for NanoClaw skills.
"""

import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_PROPERTIES = {"name", "description", "license", "allowed-tools", "metadata"}


def parse_frontmatter(content):
    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", content, re.DOTALL)
    if not match:
        return None, "Invalid frontmatter format"

    keys = []
    values = {}
    for raw_line in match.group(1).splitlines():
        if not raw_line.strip() or raw_line.startswith((" ", "\t")):
            continue
        if ":" not in raw_line:
            return None, f"Invalid frontmatter line: {raw_line}"
        key, value = raw_line.split(":", 1)
        key = key.strip()
        keys.append(key)
        values[key] = value.strip()
    return (keys, values), None


def validate_skill(skill_path):
    skill_path = Path(skill_path)
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text()
    if not content.startswith("---"):
        return False, "No YAML frontmatter found"

    parsed, error = parse_frontmatter(content)
    if error:
        return False, error

    keys, values = parsed
    unexpected = sorted(set(keys) - ALLOWED_PROPERTIES)
    if unexpected:
        return (
            False,
            "Unexpected key(s) in SKILL.md frontmatter: "
            + ", ".join(unexpected),
        )

    name = values.get("name", "").strip()
    if not name:
        return False, "Missing 'name' in frontmatter"
    if not re.match(r"^[a-z0-9-]+$", name):
        return False, f"Name '{name}' should be hyphen-case"
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
    if len(name) > MAX_SKILL_NAME_LENGTH:
        return False, f"Name is too long ({len(name)} characters). Maximum is {MAX_SKILL_NAME_LENGTH}."

    description = values.get("description", "").strip()
    if not description:
        return False, "Missing 'description' in frontmatter"
    if "<" in description or ">" in description:
        return False, "Description cannot contain angle brackets (< or >)"
    if len(description) > 1024:
        return False, f"Description is too long ({len(description)} characters). Maximum is 1024 characters."

    return True, "Skill is valid!"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
