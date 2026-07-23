import { beforeAll, describe, expect, it } from 'vitest';

import { registerNodeType } from '../core/slots';
import { searchCatalog } from './catalog-search';

function testIntegration(type: string, description: string, tags: string[]) {
  registerNodeType({
    type,
    kind: 'integration',
    outputKind: 'structured',
    description,
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: type,
      description,
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      tags,
      mock: () => ({ ok: true }),
    },
  });
}

beforeAll(() => {
  testIntegration('mail.send', 'Send an email to a recipient', ['email']);
  testIntegration('slack.post_message', 'Post a chat message to a channel', [
    'chat',
  ]);
  testIntegration('weather.lookup', 'Current weather for a city', ['forecast']);
  testIntegration('crm.create_ticket', 'Open a support ticket', ['helpdesk']);
});

describe('searchCatalog', () => {
  it('ranks exact type-name matches first', () => {
    const results = searchCatalog('slack message');
    expect(results[0]?.type).toBe('slack.post_message');
  });

  it('finds capabilities through synonyms', () => {
    // "email" expands to "mail"; the type name carries it.
    const types = searchCatalog('email someone').map((r) => r.type);
    expect(types).toContain('mail.send');
    // "issue" is a synonym route to ticket/support/helpdesk.
    expect(searchCatalog('ticket').map((r) => r.type)).toContain(
      'crm.create_ticket',
    );
  });

  it('matches word prefixes', () => {
    expect(searchCatalog('forec').map((r) => r.type)).toContain(
      'weather.lookup',
    );
  });

  it('tolerates one-edit typos on longer terms', () => {
    expect(searchCatalog('wether report').map((r) => r.type)).toContain(
      'weather.lookup',
    );
  });

  it('returns schema and output signature for each match', () => {
    const [first] = searchCatalog('weather');
    expect(first?.input_schema).toEqual({ type: 'object' });
    expect(first?.output).toBe('{ ok: boolean }');
  });

  it('returns nothing for unrelated queries', () => {
    expect(searchCatalog('quantum entanglement zx9')).toEqual([]);
  });

  it('caps results at the limit', () => {
    expect(searchCatalog('message email chat', 1)).toHaveLength(1);
  });
});
