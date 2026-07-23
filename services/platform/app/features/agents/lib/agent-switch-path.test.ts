import { describe, expect, it } from 'vitest';

import { agentSwitchPathname } from './agent-switch-path';

describe('agentSwitchPathname', () => {
  const org = 'org-1';
  const from = 'issue-triager';
  const to = 'coder';

  it('preserves portable editor tabs', () => {
    expect(
      agentSwitchPathname(
        `/dashboard/${org}/agents/${from}/instructions`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/agents/${to}/instructions`);
    expect(
      agentSwitchPathname(
        `/dashboard/${org}/agents/${from}/conversation-starters`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/agents/${to}/conversation-starters`);
  });

  it('resets unknown nested paths to the agent overview', () => {
    expect(
      agentSwitchPathname(
        `/dashboard/${org}/agents/${from}/something-else`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/agents/${to}`);
  });

  it('stays on the overview when already there', () => {
    expect(
      agentSwitchPathname(`/dashboard/${org}/agents/${from}`, org, from, to),
    ).toBe(`/dashboard/${org}/agents/${to}`);
  });

  it('encodes composite agent slugs', () => {
    const fromComposite = 'vat-desk/coordinator';
    const toComposite = 'vat-desk/researcher';
    expect(
      agentSwitchPathname(
        `/dashboard/${org}/agents/${encodeURIComponent(fromComposite)}/tools`,
        org,
        fromComposite,
        toComposite,
      ),
    ).toBe(`/dashboard/${org}/agents/${encodeURIComponent(toComposite)}/tools`);
  });
});
