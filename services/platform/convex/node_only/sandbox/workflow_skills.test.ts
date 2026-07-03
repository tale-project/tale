// Unit tests for the pure parts of the workflow-skill stager: the
// stage/prune/availability plan (repo precedence, org deletions, allowlist
// containment) and the Tale-monorepo workspace marker. The I/O wrapper is
// best-effort glue over these and is exercised live.

import { describe, expect, it } from 'vitest';

import { WORKFLOW_SKILL_NAMES } from '../../lib/skills/guidance';
import type { SessionFsEntry } from './helpers/session_client';
import {
  isTaleRepoWorkspace,
  planWorkflowSkillStaging,
} from './workflow_skills';

const dir = (name: string): SessionFsEntry => ({
  name,
  type: 'dir',
  size: 0,
  mtimeMs: 0,
});
const file = (name: string): SessionFsEntry => ({
  name,
  type: 'file',
  size: 0,
  mtimeMs: 0,
});

const ALL_ON_DISK = new Set(WORKFLOW_SKILL_NAMES);
const NONE = new Set<string>();

describe('planWorkflowSkillStaging', () => {
  it('stages every seeded workflow skill when nothing shadows it', () => {
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: ALL_ON_DISK,
      repoOwned: NONE,
      stagedDirNames: NONE,
    });
    expect(plan.toStage).toEqual([...WORKFLOW_SKILL_NAMES]);
    expect(plan.toPrune).toEqual([]);
    expect(plan.available).toEqual(ALL_ON_DISK);
  });

  it('a repo-owned skill is not staged but stays available', () => {
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: ALL_ON_DISK,
      repoOwned: new Set(['implement-feature']),
      stagedDirNames: NONE,
    });
    expect(plan.toStage).not.toContain('implement-feature');
    expect(plan.available.has('implement-feature')).toBe(true);
  });

  it('an org-deleted skill that is still staged gets pruned and drops from availability', () => {
    const onDisk = new Set(ALL_ON_DISK);
    onDisk.delete('deep-research');
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: onDisk,
      repoOwned: NONE,
      stagedDirNames: new Set(['deep-research']),
    });
    expect(plan.toPrune).toEqual(['deep-research']);
    expect(plan.available.has('deep-research')).toBe(false);
  });

  it('a repo-shadowed skill staged earlier gets pruned but stays available', () => {
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: ALL_ON_DISK,
      repoOwned: new Set(['fix-bug']),
      stagedDirNames: new Set(['fix-bug']),
    });
    expect(plan.toPrune).toEqual(['fix-bug']);
    expect(plan.available.has('fix-bug')).toBe(true);
  });

  it('never stages or prunes non-workflow names', () => {
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: new Set([...ALL_ON_DISK, 'my-org-skill']),
      repoOwned: NONE,
      stagedDirNames: new Set([
        'integration-github',
        'browser-human-control',
        'visual-aspect-analyzer',
        'my-org-skill',
      ]),
    });
    expect(plan.toStage).not.toContain('my-org-skill');
    expect(plan.toPrune).toEqual([]);
    expect(plan.available.has('my-org-skill')).toBe(false);
  });

  it('claims only repo-owned skills when the org dir is empty', () => {
    const plan = planWorkflowSkillStaging({
      orgSkillsOnDisk: NONE,
      repoOwned: new Set(['create-pr', 'not-a-workflow-skill']),
      stagedDirNames: NONE,
    });
    expect(plan.toStage).toEqual([]);
    expect(plan.available).toEqual(new Set(['create-pr']));
  });
});

describe('isTaleRepoWorkspace', () => {
  it('is true only when both Tale markers are directories', () => {
    expect(
      isTaleRepoWorkspace([dir('.agents'), dir('builtin-configs'), dir('src')]),
    ).toBe(true);
    expect(isTaleRepoWorkspace([dir('.agents'), dir('src')])).toBe(false);
    expect(isTaleRepoWorkspace([dir('builtin-configs')])).toBe(false);
    expect(isTaleRepoWorkspace([dir('src'), dir('node_modules')])).toBe(false);
  });

  it('a file named like a marker does not count', () => {
    expect(isTaleRepoWorkspace([file('.agents'), dir('builtin-configs')])).toBe(
      false,
    );
  });

  it('a missing listing (no workspace yet) is not the Tale repo', () => {
    expect(isTaleRepoWorkspace(null)).toBe(false);
    expect(isTaleRepoWorkspace([])).toBe(false);
  });
});
