import { within } from '@testing-library/dom';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Issue } from '@/lib/engine/core/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { TriggerInputCheck } from '../hooks/use-trigger-input-check';
import { TriggerInputPreview } from './trigger-input-preview';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement, forwardRef } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params, children, ...rest },
      ref,
    ) {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [key, value]) => acc.replace(`$${key}`, value),
        to ?? '',
      );
      return createElement('a', { ref, href: path, ...rest }, children);
    }),
  };
});

const FIRED_AT = Date.UTC(2026, 9, 13, 7, 0);
const PLACE = {
  organizationId: 'org-1',
  projectId: undefined,
  name: 'github-triage-issues',
};

function scheduleCheck(
  overrides: Partial<TriggerInputCheck>,
): TriggerInputCheck {
  return {
    input: { trigger: 'schedule', firedAt: FIRED_AT },
    firedAt: FIRED_AT,
    missing: [],
    verdict: null,
    warnings: [],
    ...overrides,
  };
}

describe('TriggerInputPreview', () => {
  it('shows what a schedule’s run receives, and what firedAt is', () => {
    render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({})}
        version={undefined}
        place={PLACE}
      />,
    );
    const section = screen.getByRole('region', { name: 'This run receives' });
    expect(within(section).getByText(/"trigger": "schedule"/)).toBeVisible();
    expect(
      within(section).getByText(new RegExp(`"firedAt": ${FIRED_AT}`)),
    ).toBeVisible();
    expect(
      within(section).getByText(
        /^firedAt: the due time in milliseconds since 1970 \(UTC\)\. Here, /,
      ),
    ).toBeVisible();
    expect(
      within(section).getByRole('button', { name: 'Copy the input' }),
    ).toBeInTheDocument();
    // Nothing is deployed: no verdict either way.
    expect(within(section).queryByText(/accepts this input/)).toBeNull();
  });

  it('says the deployed version accepts it', () => {
    render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({ verdict: { kind: 'accepted' } })}
        version={3}
        place={PLACE}
      />,
    );
    expect(screen.getByText('Version 3 accepts this input.')).toBeVisible();
  });

  it('says the deployed version refuses it, naming the fields, with the way to the editor', () => {
    render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({
          verdict: { kind: 'refused', paths: ['owner', 'repo'] },
        })}
        version={3}
        place={PLACE}
      />,
    );
    const banner = screen
      .getByRole('heading', { name: "Version 3 doesn't accept this input" })
      .closest('[data-slot="alert"]');
    if (!(banner instanceof HTMLElement)) throw new Error('no banner');
    expect(banner).toHaveAttribute('aria-live', 'off');
    expect(banner).toHaveTextContent(
      'Its inputs refuse what this trigger sends, so every start would be skipped. Add the missing fields to the fixed input, or change the inputs in the editor.',
    );
    expect(within(banner).getByText('owner, repo')).toBeVisible();
    expect(
      within(banner).getByRole('link', { name: 'Open the editor' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/github-triage-issues/editor',
    );
  });

  it('says how a webhook’s body and an event’s data arrive', () => {
    const { rerender } = render(
      <TriggerInputPreview
        surface="panel"
        kind="webhook"
        check={scheduleCheck({
          input: { trigger: 'webhook', payload: { example: true } },
          firedAt: null,
        })}
        version={undefined}
      />,
    );
    expect(
      screen.getByText(/^Your request body arrives as payload/),
    ).toBeVisible();
    rerender(
      <TriggerInputPreview
        surface="panel"
        kind="event"
        check={scheduleCheck({
          input: { trigger: 'event', event: 'task.created', payload: {} },
          firedAt: null,
        })}
        version={undefined}
      />,
    );
    expect(
      screen.getByText(/^The event data arrives as payload/),
    ).toBeVisible();
  });

  it('reads a template the fixed input holds as the save warned', () => {
    const warning: Issue = {
      level: 'warning',
      code: 'TRIGGER_INPUT_NOT_TEMPLATED',
      message: 'The fixed input holds a template.',
      params: { paths: ['/owner'] },
    };
    render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({ warnings: [warning] })}
        version={3}
      />,
    );
    expect(
      screen.getByRole('heading', { name: "Fixed input isn't filled in" }),
    ).toBeVisible();
  });

  it('puts the action beside the title', () => {
    render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({})}
        version={3}
        action={<button type="button">Run now</button>}
      />,
    );
    const section = screen.getByRole('region', { name: 'This run receives' });
    expect(
      within(section).getByRole('button', { name: 'Run now' }),
    ).toBeVisible();
  });

  it('folds away in the wizard', () => {
    render(
      <TriggerInputPreview
        surface="wizard"
        kind="schedule"
        check={scheduleCheck({})}
        version={undefined}
      />,
    );
    const details = screen
      .getByText('This run receives', { selector: 'summary' })
      .closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders nothing while an event trigger names no event', () => {
    const { container } = render(
      <TriggerInputPreview
        surface="panel"
        kind="event"
        check={scheduleCheck({ input: null, firedAt: null })}
        version={3}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // The design system's Alert titles itself at level 5; under this
  // section's h3 that jump trips axe's heading-order, as every Alert under a
  // section heading does. Only that one rule is off.
  it('has no axe violations when refused', async () => {
    const result = render(
      <TriggerInputPreview
        surface="panel"
        kind="schedule"
        check={scheduleCheck({
          verdict: { kind: 'refused', paths: ['owner'] },
        })}
        version={3}
        place={PLACE}
      />,
    );
    await checkAccessibility(result, {
      rules: { 'heading-order': { enabled: false } },
    });
  });
});
