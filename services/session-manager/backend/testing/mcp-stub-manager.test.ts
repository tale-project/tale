import { describe, expect, it } from 'vitest';

import {
  metaSchema,
  proxySchema,
  secretSchema,
  secretSummarySchema,
  sessionSchema,
  settingsSchema,
} from '../../lib/api/schemas.ts';
import {
  metaFixture,
  proxyFixture,
  secretFixture,
  sessionFixture,
  settingsFixture,
  stubManager,
  summaryOf,
} from './mcp-stub-manager.ts';

describe('the API fixtures', () => {
  it('are valid API objects', () => {
    expect(sessionSchema.parse(sessionFixture())).toEqual(sessionFixture());
    expect(proxySchema.parse(proxyFixture())).toEqual(proxyFixture());
    expect(secretSchema.parse(secretFixture())).toEqual(secretFixture());
    expect(secretSummarySchema.parse(summaryOf(secretFixture()))).toEqual(
      summaryOf(secretFixture()),
    );
    expect(metaSchema.parse(metaFixture())).toEqual(metaFixture());
    expect(settingsSchema.parse(settingsFixture())).toEqual(settingsFixture());
  });

  it('take overrides', () => {
    expect(sessionFixture({ name: 'shop', status: 'stopped' })).toMatchObject({
      name: 'shop',
      status: 'stopped',
    });
  });

  it('make a summary without the values', () => {
    expect(summaryOf(secretFixture())).not.toHaveProperty('fields');
  });
});

describe('stubManager', () => {
  it('lets AI access be on and the start page be the default', () => {
    expect(stubManager().settings()).toEqual(settingsFixture());
  });

  it('throws for what the test did not provide', () => {
    expect(() => stubManager().listSessions()).toThrow(
      'The stub manager has no listSessions',
    );
  });

  it('uses the methods a test passes', () => {
    const manager = stubManager({ listSessions: () => [sessionFixture()] });
    expect(manager.listSessions()).toEqual([sessionFixture()]);
  });
});
