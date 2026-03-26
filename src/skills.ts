import fs from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';

import { SKILLS_DIR } from './config.js';
import { getGroupSkills, installGroupSkill, removeGroupSkill } from './db.js';
import { SkillDefinition } from './types.js';

const MAX_SKILL_NAME_LENGTH = 64;
const ALLOWED_RESOURCES = new Set(['scripts', 'references', 'assets']);

const SKILL_TEMPLATE = `---
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
`;

const EXAMPLE_SCRIPT = `#!/usr/bin/env python3
"""
Example helper script for {skill_name}
"""

def main():
    print("TODO: implement {skill_name}")

if __name__ == "__main__":
    main()
`;

const EXAMPLE_REFERENCE = `# Reference Notes

Replace this file with detailed reference material for the skill.
`;

const EXAMPLE_ASSET = `Replace this placeholder with a real asset file if needed.
`;

function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error('No YAML frontmatter found');
  }

  const doc = parseDocument(match[1]);
  const data = doc.toJS();
  if (!data || typeof data !== 'object') {
    throw new Error('Frontmatter must be a YAML object');
  }

  const name =
    'name' in data ? String((data as Record<string, unknown>).name) : '';
  const description =
    'description' in data
      ? String((data as Record<string, unknown>).description)
      : '';

  return {
    name: name.trim(),
    description: description.trim() || 'No description.',
  };
}

export function normalizeSkillName(skillName: string): string {
  return skillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function titleCaseSkillName(skillName: string): string {
  return skillName
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function parseResources(rawResources?: string): string[] {
  if (!rawResources) return [];
  const resources = rawResources
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!ALLOWED_RESOURCES.has(resource)) {
      throw new Error(
        `Unknown resource "${resource}". Allowed: scripts, references, assets.`,
      );
    }
    if (!seen.has(resource)) {
      deduped.push(resource);
      seen.add(resource);
    }
  }
  return deduped;
}

function createExampleResource(
  skillDir: string,
  resource: string,
  skillName: string,
): void {
  const resourceDir = path.join(skillDir, resource);
  fs.mkdirSync(resourceDir, { recursive: true });

  if (resource === 'scripts') {
    fs.writeFileSync(
      path.join(resourceDir, 'example.py'),
      EXAMPLE_SCRIPT.replaceAll('{skill_name}', skillName),
    );
    return;
  }

  if (resource === 'references') {
    fs.writeFileSync(path.join(resourceDir, 'reference.md'), EXAMPLE_REFERENCE);
    return;
  }

  fs.writeFileSync(path.join(resourceDir, 'example.txt'), EXAMPLE_ASSET);
}

export function createSkill(
  rawSkillName: string,
  options?: {
    skillsDir?: string;
    resources?: string;
    includeExamples?: boolean;
  },
): SkillDefinition {
  const normalizedName = normalizeSkillName(rawSkillName);
  if (!normalizedName) {
    throw new Error('Skill name cannot be empty.');
  }
  if (normalizedName.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error(
      `Skill name is too long (${normalizedName.length}). Maximum is ${MAX_SKILL_NAME_LENGTH}.`,
    );
  }

  const skillsDir = options?.skillsDir ?? SKILLS_DIR;
  const skillDir = path.join(skillsDir, normalizedName);
  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill "${normalizedName}" already exists.`);
  }

  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(
    skillPath,
    SKILL_TEMPLATE.replaceAll('{skill_name}', normalizedName).replaceAll(
      '{skill_title}',
      titleCaseSkillName(normalizedName),
    ),
  );

  for (const resource of parseResources(options?.resources)) {
    if (options?.includeExamples) {
      createExampleResource(skillDir, resource, normalizedName);
    } else {
      fs.mkdirSync(path.join(skillDir, resource), { recursive: true });
    }
  }

  return {
    name: normalizedName,
    dir: skillDir,
    skillPath,
    description: '[TODO: explain what this skill does and when to use it]',
  };
}

export function discoverSkills(
  skillsDir: string = SKILLS_DIR,
): SkillDefinition[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const definitions: SkillDefinition[] = [];
  for (const entry of fs.readdirSync(skillsDir).sort()) {
    const dir = path.join(skillsDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const skillPath = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const content = fs.readFileSync(skillPath, 'utf-8');
    const frontmatter = parseSkillFrontmatter(content);
    definitions.push({
      name: frontmatter.name || entry,
      dir,
      skillPath,
      description: frontmatter.description,
    });
  }

  return definitions;
}

export function getSkillByName(
  skillName: string,
  skillsDir: string = SKILLS_DIR,
): SkillDefinition | undefined {
  return discoverSkills(skillsDir).find((skill) => skill.name === skillName);
}

export function listInstalledSkills(groupFolder: string): string[] {
  return getGroupSkills(groupFolder);
}

export function addSkillToGroup(groupFolder: string, skillName: string): void {
  installGroupSkill(groupFolder, skillName);
}

export function removeSkillFromGroup(
  groupFolder: string,
  skillName: string,
): void {
  removeGroupSkill(groupFolder, skillName);
}

export function formatSkillsReport(groupFolder: string): string {
  const available = discoverSkills();
  const installed = new Set(listInstalledSkills(groupFolder));

  const lines: string[] = [];
  lines.push('NanoClaw Skills');
  lines.push('');

  if (available.length === 0) {
    lines.push('No skills are available.');
    return lines.join('\n');
  }

  lines.push('Available:');
  for (const skill of available) {
    const marker = installed.has(skill.name) ? '[installed]' : '[available]';
    lines.push(`- ${skill.name} ${marker} — ${skill.description}`);
  }
  lines.push('');
  lines.push('Usage:');
  lines.push('- /skills');
  lines.push('- /skills add <name>');
  lines.push('- /skills remove <name>');
  lines.push('- /skills create <name>');

  return lines.join('\n');
}
