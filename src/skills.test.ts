import fs from 'fs';
import os from 'os';
import path from 'path';

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  addSkillToGroup,
  createSkill as createSkillDir,
  discoverSkills,
  formatSkillsReport,
  getSkillByName,
  listInstalledSkills,
  removeSkillFromGroup,
} from './skills.js';

function createSkill(root: string, name: string, body: string): void {
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body);
}

beforeEach(() => {
  _initTestDatabase();
});

describe('skills', () => {
  it('discovers skills from SKILL.md directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-skills-'));
    createSkill(
      dir,
      'capabilities',
      '---\nname: capabilities\ndescription: Show what the bot can do.\n---\n\n# capabilities\n',
    );
    createSkill(
      dir,
      'status',
      '---\nname: status\ndescription: Quick status report.\n---\n\n# status\n',
    );
    fs.writeFileSync(path.join(dir, 'README.md'), 'ignore me');

    expect(discoverSkills(dir)).toEqual([
      {
        name: 'capabilities',
        dir: path.join(dir, 'capabilities'),
        skillPath: path.join(dir, 'capabilities', 'SKILL.md'),
        description: 'Show what the bot can do.',
      },
      {
        name: 'status',
        dir: path.join(dir, 'status'),
        skillPath: path.join(dir, 'status', 'SKILL.md'),
        description: 'Quick status report.',
      },
    ]);
  });

  it('looks up skills by name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-skills-'));
    createSkill(
      dir,
      'status',
      '---\nname: status\ndescription: Quick status report.\n---\n\n# status\n',
    );

    expect(getSkillByName('status', dir)?.description).toBe(
      'Quick status report.',
    );
    expect(getSkillByName('missing', dir)).toBeUndefined();
  });

  it('tracks installed skills per group', () => {
    addSkillToGroup('main', 'capabilities');
    addSkillToGroup('main', 'status');
    removeSkillFromGroup('main', 'capabilities');

    expect(listInstalledSkills('main')).toEqual(['status']);
  });

  it('formats a report showing available and installed skills', () => {
    addSkillToGroup('main', 'status');

    const report = formatSkillsReport('main');

    expect(report).toContain('NanoClaw Skills');
    expect(report).toContain('agent-browser [available]');
    expect(report).toContain('status [installed]');
    expect(report).toContain('/skills add <name>');
    expect(report).toContain('/skills remove <name>');
    expect(report).toContain('/skills create <name>');
  });

  it('creates a skill scaffold with optional resource directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-skills-'));
    const created = createSkillDir('My New Skill', {
      skillsDir: dir,
      resources: 'scripts,references,assets',
      includeExamples: true,
    });

    expect(created.name).toBe('my-new-skill');
    expect(fs.existsSync(path.join(created.dir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(created.dir, 'scripts', 'example.py'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(created.dir, 'references', 'reference.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(created.dir, 'assets', 'example.txt'))).toBe(
      true,
    );
  });
});
