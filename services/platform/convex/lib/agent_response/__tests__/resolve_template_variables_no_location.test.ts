import { describe, it, expect, vi } from 'vitest';

import { buildUserProfile } from '../resolve_template_variables';

describe('buildUserProfile without location', () => {
  it('does not include location line', () => {
    const profile = buildUserProfile(
      {
        organizationId: 'org_1',
        timezone: 'America/New_York',
        language: 'en-US',
      },
      {
        userName: 'Alice',
        userEmail: 'alice@example.com',
        organizationName: 'Acme',
      },
    );

    expect(profile).toContain('- Name: Alice');
    expect(profile).toContain('- Timezone: America/New_York');
    expect(profile).not.toContain('Location');
    expect(profile).not.toContain('coordinates');
  });

  it('resolves user.coordinates and user.location as unknown variables', async () => {
    const { resolveTemplateVariables } =
      await import('../resolve_template_variables');

    const ctx = {
      runQuery: vi.fn(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await resolveTemplateVariables(
      ctx,
      'Coords: {{user.coordinates}}, Loc: {{user.location}}',
      { organizationId: 'org_1' },
    );

    // These variables are no longer recognized — should be preserved as-is
    expect(result).toBe('Coords: {{user.coordinates}}, Loc: {{user.location}}');
  });
});
