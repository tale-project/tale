/**
 * Unit tests for workflow slug validation and URL round-tripping.
 *
 * Workflow slugs are derived from the file path under `workflows/` and support
 * nested folders (`folder/subfolder/name`, e.g. `projects/tasks/...`). The `/`
 * separator round-trips to the URL-safe `__` form and back. These tests pin
 * that contract so the nesting depth and the round-trip can never silently
 * regress.
 */

import { describe, expect, it } from 'vitest';

import {
  slugToUrlParam,
  urlParamToSlug,
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from './file_utils';

describe('validateWorkflowSlug', () => {
  it('accepts flat, two-level, and three-level slugs', () => {
    expect(validateWorkflowSlug('my_workflow')).toBe(true);
    expect(validateWorkflowSlug('github/sync-issues-from-github')).toBe(true);
    expect(validateWorkflowSlug('projects/tasks/run-assigned-task')).toBe(true);
    expect(
      validateWorkflowSlug('projects/discussions/react-to-discussion-mention'),
    ).toBe(true);
  });

  it('rejects reserved separators, traversal, and malformed segments', () => {
    expect(validateWorkflowSlug('projects__tasks/run')).toBe(false); // `__` reserved
    expect(validateWorkflowSlug('/leading-slash')).toBe(false);
    expect(validateWorkflowSlug('projects//tasks')).toBe(false); // empty segment
    expect(validateWorkflowSlug('Projects/Tasks')).toBe(false); // uppercase
    expect(validateWorkflowSlug('projects/tasks/')).toBe(false); // trailing slash
  });
});

describe('slug <-> URL param round-trip', () => {
  it('round-trips a three-level slug through the `__` URL form', () => {
    const slug = 'projects/tasks/run-assigned-task';
    const param = slugToUrlParam(slug);
    expect(param).toBe('projects__tasks__run-assigned-task');
    expect(urlParamToSlug(param)).toBe(slug);
  });
});

describe('workflowSlugFromRelativePath', () => {
  it('derives a three-level slug from a nested path', () => {
    expect(
      workflowSlugFromRelativePath('projects/tasks/run-assigned-task.json'),
    ).toBe('projects/tasks/run-assigned-task');
  });
});
