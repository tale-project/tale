// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { projectKeyReaches } from './api-key-scope.ts';

/**
 * Where a project's own API key may go on `/api/v1`: the door refuses every
 * other route before a handler runs, so no organization-wide resource can
 * answer such a key from the audience it sees inside its project.
 */
describe('projectKeyReaches [APIKEY-R6]', () => {
  const PROJECT = 'project-1';

  it.each([
    ['GET', '/api/v1/projects/project-1'],
    ['PATCH', '/api/v1/projects/project-1'],
    ['GET', '/api/v1/projects/project-1/threads'],
    ['POST', '/api/v1/projects/project-1/tasks/task-9/comments'],
    ['GET', '/projects/project-1/files'],
    ['GET', '/api/v1/me'],
    ['GET', '/api/v1/projects'],
    ['HEAD', '/api/v1/projects/'],
    ['POST', '/api/v1/openai/chat/completions'],
    ['POST', '/api/v1/anthropic/v1/messages'],
  ])('lets %s %s through', (method, path) => {
    expect(projectKeyReaches(method, path, PROJECT)).toBe(true);
  });

  it.each([
    // A project is created at the organization's door, never by a key.
    ['POST', '/api/v1/projects'],
    ['GET', '/api/v1/projects/project-2'],
    ['GET', '/api/v1/projects/project-10/threads'],
    ['GET', '/api/v1/projects/project-1x'],
    ['GET', '/api/v1/contacts'],
    ['GET', '/api/v1/teams'],
    ['POST', '/api/v1/mcp'],
    ['GET', '/api/v1/me/extra'],
    ['GET', '/api/v1/documents'],
  ])('refuses %s %s', (method, path) => {
    expect(projectKeyReaches(method, path, PROJECT)).toBe(false);
  });

  it('reads an escaped project id as the id it spells', () => {
    expect(
      projectKeyReaches('GET', '/api/v1/projects/project%2D1/threads', PROJECT),
    ).toBe(true);
    expect(
      projectKeyReaches('GET', '/api/v1/projects/project%2D2/threads', PROJECT),
    ).toBe(false);
  });

  it('refuses a malformed escape, which names no project', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(projectKeyReaches('GET', '/api/v1/projects/%E0%A4%A', PROJECT)).toBe(
      false,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
