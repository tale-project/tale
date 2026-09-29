import { describe, expect, it } from 'vitest';

import { isListedForViewer, isLiveAutomation } from './reader-listing';

describe('isLiveAutomation', () => {
  it('is true once a version is deployed', () => {
    expect(isLiveAutomation({ deployedVersion: 1 })).toBe(true);
  });

  it('is false for an undeployed draft', () => {
    expect(isLiveAutomation({})).toBe(false);
  });
});

describe('isListedForViewer', () => {
  it('lists every automation for an author', () => {
    expect(isListedForViewer({}, true)).toBe(true);
    expect(isListedForViewer({ deployedVersion: 2 }, true)).toBe(true);
  });

  it('lists only deployed automations for a reader', () => {
    expect(isListedForViewer({}, false)).toBe(false);
    expect(isListedForViewer({ deployedVersion: 2 }, false)).toBe(true);
  });
});
