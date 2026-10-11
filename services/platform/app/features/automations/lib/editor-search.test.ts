import { describe, expect, it } from 'vitest';

import {
  automationEditorSearchSchema,
  automationVersionCompareSearchSchema,
  versionParam,
} from './editor-search';

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

describe('a version comparison address', () => {
  it('reads the compared version as a whole number from 1 on', () => {
    expect(versionParam('7')).toBe(7);
    expect(versionParam('0')).toBeNull();
    expect(versionParam('07')).toBeNull();
    expect(versionParam('v7')).toBeNull();
    expect(versionParam('1e3')).toBeNull();
  });

  it('reads a malformed search value as absent', () => {
    expect(
      automationVersionCompareSearchSchema.parse({
        from: 3,
        view: 'yaml',
        node: 'collect',
      }),
    ).toEqual({ from: 3, view: 'yaml', node: 'collect' });
    expect(
      automationVersionCompareSearchSchema.parse({
        from: -1,
        view: 'pictures',
        node: '',
      }),
    ).toEqual({});
  });
});
