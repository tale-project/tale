/**
 * Conversation routing's file is read by every image in a rolling deploy,
 * including one from before `sourceRules` existed. That reader must still
 * parse the new file and keep routing by its address rules; a source rule
 * must never fail the whole file (a failed parse silences routing) or widen
 * into an any-mailbox rule.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import {
  API_SOURCE_PATTERN,
  conversationRoutingConfigSchema,
  conversationRoutingSourceRuleSchema,
} from './governance';

/** The schema as it stood before source rules — a verbatim copy. */
const previousSchema = z.object({
  enabled: z.boolean().optional(),
  rules: z
    .array(
      z.object({
        address: z.string().email(),
        teamId: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .default([]),
});

const NEW_FILE = {
  enabled: true,
  rules: [{ address: 'support@acme.test', teamId: 't-support' }],
  sourceRules: [
    { mailbox: 'cred-general', teamId: 't-general' },
    { mailbox: 'cred-general', address: 'jobs@acme.test', userId: 'u-1' },
    { apiSource: 'helpdesk', teamId: 't-helpdesk' },
  ],
};

describe('conversation routing file', () => {
  it('parses on a reader from before source rules, keeping its address rules', () => {
    const parsed = previousSchema.safeParse(NEW_FILE);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rules).toEqual(NEW_FILE.rules);
    expect(parsed.data).not.toHaveProperty('sourceRules');
  });

  it('parses a file from before source rules with none', () => {
    const parsed = conversationRoutingConfigSchema.parse({
      rules: [{ address: 'support@acme.test', teamId: 't' }],
    });
    expect(parsed.sourceRules).toEqual([]);
  });

  it('round-trips a file with both kinds of rule', () => {
    expect(conversationRoutingConfigSchema.parse(NEW_FILE)).toEqual(NEW_FILE);
  });
});

describe('conversationRoutingSourceRuleSchema', () => {
  it.each([
    ['neither a mailbox nor an API source', { teamId: 't' }],
    [
      'both a mailbox and an API source',
      { mailbox: 'cred-a', apiSource: 'helpdesk', teamId: 't' },
    ],
    [
      'an address on an API source rule',
      { apiSource: 'helpdesk', address: 'a@acme.test', teamId: 't' },
    ],
    ['an API source outside the slug pattern', { apiSource: 'Help Desk' }],
  ])('refuses %s', (_case, rule) => {
    expect(conversationRoutingSourceRuleSchema.safeParse(rule).success).toBe(
      false,
    );
  });

  it('accepts a mailbox rule with or without an address', () => {
    for (const rule of [
      { mailbox: 'cred-a', teamId: 't' },
      { mailbox: 'cred-a', address: 'support+tag@acme.test', userId: 'u' },
    ]) {
      expect(conversationRoutingSourceRuleSchema.safeParse(rule).success).toBe(
        true,
      );
    }
  });

  it('shares the API source pattern the conversations mirror enforces', () => {
    expect(API_SOURCE_PATTERN.test('helpdesk')).toBe(true);
    expect(API_SOURCE_PATTERN.test('mailbox:cred-a')).toBe(false);
  });
});
