import { describe, expect, it } from 'vitest';

import {
  automationDetailPathname,
  automationSwitchPathname,
} from './detail-paths';

describe('automationDetailPathname', () => {
  it('encodes the slug and picks the shell from the project', () => {
    expect(
      automationDetailPathname({
        organizationId: 'org-1',
        automationSlug: 'billing/dunning',
      }),
    ).toBe('/dashboard/org-1/automations/billing__dunning');
    expect(
      automationDetailPathname({
        organizationId: 'org-1',
        automationSlug: 'billing/dunning',
        projectId: 'proj-1',
      }),
    ).toBe('/dashboard/org-1/projects/proj-1/automations/billing__dunning');
  });
});

describe('automationSwitchPathname', () => {
  const from = '/dashboard/org-1/automations/billing__dunning';
  const to = '/dashboard/org-1/projects/proj-1/automations/desk__prepare';

  it('keeps the open tab on the sibling, across shells', () => {
    expect(automationSwitchPathname(`${from}/editor`, from, to)).toBe(
      `${to}/editor`,
    );
    expect(automationSwitchPathname(`${from}/versions`, from, to)).toBe(
      `${to}/versions`,
    );
    expect(automationSwitchPathname(`${from}/runs`, from, to)).toBe(
      `${to}/runs`,
    );
  });

  it("resets a run's own page to the sibling's Runs list", () => {
    expect(automationSwitchPathname(`${from}/runs/run_1`, from, to)).toBe(
      `${to}/runs`,
    );
  });

  it('lands on the Editor from the bare root or an unknown path', () => {
    expect(automationSwitchPathname(from, from, to)).toBe(`${to}/editor`);
    expect(automationSwitchPathname(`${from}/`, from, to)).toBe(`${to}/editor`);
    expect(automationSwitchPathname(`${from}/metrics`, from, to)).toBe(
      `${to}/editor`,
    );
    expect(
      automationSwitchPathname('/dashboard/org-1/automations', from, to),
    ).toBe(`${to}/editor`);
  });

  it('never claims a sibling whose slug merely extends this one', () => {
    expect(automationSwitchPathname(`${from}-v2/versions`, from, to)).toBe(
      `${to}/editor`,
    );
  });
});
