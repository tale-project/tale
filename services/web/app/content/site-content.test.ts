import { describe, expect, it } from 'vitest';

import { AGENTS } from '@/app/content/agents';
import { CERTIFICATION_KEYS } from '@/app/content/certifications';
import { INTEGRATION_LOGOS } from '@/app/content/connectors';
import {
  buildPlatformNavItems,
  buildResourcesNavItems,
} from '@/app/content/nav-items';
import {
  FOOTER_COMPANY_CTAS,
  GET_STARTED_HREF,
  HEADER_CTAS,
  HEADER_PRIMARY_CTA,
} from '@/app/content/site-ctas';
import { GET_STARTED_URL } from '@/lib/docs-url';
import { EXTERNAL_LINKS } from '@/lib/external-links';

describe('site content contracts', () => {
  it('keeps certification claim order stable for hero + compliance', () => {
    expect([...CERTIFICATION_KEYS]).toEqual([
      'iso27001',
      'soc2',
      'gdpr',
      'mit',
      'openSource',
    ]);
  });

  it('lists the eight external agents from the product docs roster', () => {
    expect(AGENTS.map((a) => a.name)).toEqual([
      'Claude',
      'Codex',
      'Gemini',
      'Cursor',
      'Hermes',
      'OpenClaw',
      'Pi',
      'OpenCode',
    ]);
  });

  it('lists connector logos with unique names', () => {
    const names = INTEGRATION_LOGOS.map((l) => l.name);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
  });

  it('builds platform + resources nav rows for desktop and mobile', () => {
    const platform = buildPlatformNavItems();
    expect(platform.map((p) => p.navKey)).toEqual([
      'chat',
      'projects',
      'knowledge',
      'agents',
      'automations',
      'governance',
    ]);
    const resources = buildResourcesNavItems();
    expect(resources[0]?.href).toBeDefined();
    expect(resources.slice(1).every((r) => r.path)).toBe(true);
  });

  it('pins header CTA: Get started → docs (primary; no Request a demo)', () => {
    expect(HEADER_PRIMARY_CTA).toMatchObject({
      kind: 'external',
      labelKey: 'getStarted',
      href: GET_STARTED_URL,
    });
    expect(HEADER_CTAS).toEqual([HEADER_PRIMARY_CTA]);
    expect(GET_STARTED_HREF).toBe(GET_STARTED_URL);
  });

  it('pins footer company CTAs: Contact us + Request a demo', () => {
    expect(FOOTER_COMPANY_CTAS.map((c) => c.labelKey)).toEqual([
      'contactUs',
      'requestDemo',
    ]);
  });

  it('keeps the public GitHub repo URL stable for chrome links', () => {
    expect(EXTERNAL_LINKS.github).toMatch(/^https:\/\/github\.com\//);
  });
});
