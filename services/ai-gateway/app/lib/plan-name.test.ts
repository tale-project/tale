import { describe, expect, it } from 'vitest';

import { planName } from '@/app/lib/plan-name';
import { i18n } from '@/lib/i18n/i18n';

// The service's own instance, so the names come from the catalogs the panel
// ships (`messages/global.yml`) and the tier joins through real ICU.
const t = i18n.getFixedT('en', 'accounts');

describe('planName', () => {
  it('names a plan in the vendor’s own words', () => {
    expect(planName('openai', { plan: 'prolite', tier: null }, t)).toBe(
      'Pro Lite',
    );
    expect(planName('anthropic', { plan: 'team', tier: null }, t)).toBe('Team');
  });

  it('carries the multiple a plan is sold at', () => {
    expect(planName('anthropic', { plan: 'max', tier: '20x' }, t)).toBe(
      'Max 20x',
    );
  });

  it('shows the vendor’s id for a plan it has no name for', () => {
    expect(
      planName(
        'openai',
        { plan: 'self_serve_business_usage_based', tier: null },
        t,
      ),
    ).toBe('Self serve business usage based');
  });

  it('reads the same in every language, being a product name', () => {
    const de = i18n.getFixedT('de', 'accounts');
    const fr = i18n.getFixedT('fr', 'accounts');
    const max = { plan: 'max', tier: '5x' };
    expect(planName('anthropic', max, de)).toBe('Max 5x');
    expect(planName('anthropic', max, fr)).toBe('Max 5x');
  });
});
