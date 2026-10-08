import { describe, expect, it } from 'vitest';

import { automationEditorSearchSchema } from './editor-search';

/**
 * The Editor tab's link: the version on screen, the view, the open node.
 * A bad value reads as absent, so a mangled link still opens the
 * automation.
 */
describe('automationEditorSearchSchema', () => {
  it('opens the Source view', () => {
    expect(automationEditorSearchSchema.parse({ view: 'source' })).toEqual({
      view: 'source',
    });
  });

  it('reads the version, the view and the open node', () => {
    expect(
      automationEditorSearchSchema.parse({
        version: 4,
        view: 'list',
        node: 'open_issues',
      }),
    ).toEqual({ version: 4, view: 'list', node: 'open_issues' });
  });

  it('opens Start and End by their own names', () => {
    expect(automationEditorSearchSchema.parse({ node: '__start' })).toEqual({
      node: '__start',
    });
    expect(automationEditorSearchSchema.parse({ node: '__end' })).toEqual({
      node: '__end',
    });
  });

  it('reads a malformed value as absent', () => {
    expect(
      automationEditorSearchSchema.parse({
        version: 0,
        view: 'yaml',
        node: 'Not a node id',
      }),
    ).toEqual({});
    expect(automationEditorSearchSchema.parse({ node: '__gate:x' })).toEqual(
      {},
    );
  });
});
