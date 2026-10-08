import { within } from '@testing-library/dom';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  sampleRequest,
  TriggerWebhookPanel,
  webhookAddresses,
} from './trigger-webhook-panel';

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

const refetch = vi.fn();
let runsRead: {
  data?: unknown[];
  isPending: boolean;
  isError: boolean;
};

vi.mock('../hooks/queries', () => ({
  useAutomationTriggerRuns: () => ({ ...runsRead, refetch }),
}));

const ORIGIN = 'https://tale.example';
const PLACE = {
  organizationId: 'org-1',
  projectId: undefined,
  name: 'linear-intake',
};
const PROJECTS = [
  { _id: 'proj-1', name: 'Document desk' },
  { _id: 'proj-2', name: 'Support' },
];

function renderPanel(
  overrides: Partial<Parameters<typeof TriggerWebhookPanel>[0]> = {},
) {
  const onRotate = vi.fn();
  const result = render(
    <TriggerWebhookPanel
      place={PLACE}
      origin={ORIGIN}
      projects={[]}
      mintedToken={null}
      hasToken
      storedWebhook
      canEdit
      rotating={false}
      onRotate={onRotate}
      {...overrides}
    />,
  );
  return { ...result, onRotate };
}

describe('webhookAddresses', () => {
  it('answers on the organization’s door when installed in no project', () => {
    expect(webhookAddresses(ORIGIN, [], undefined)).toEqual([
      {
        key: 'org',
        project: undefined,
        base: 'https://tale.example/api/automations/webhook/',
      },
    ]);
  });

  it('answers on each project’s door, the route’s project first', () => {
    expect(
      webhookAddresses(ORIGIN, PROJECTS, 'proj-2').map((a) => a.base),
    ).toEqual([
      'https://tale.example/api/projects/proj-2/automations/webhook/',
      'https://tale.example/api/projects/proj-1/automations/webhook/',
    ]);
  });
});

describe('sampleRequest', () => {
  it('reads the URL from the sender’s environment, with a delivery id', () => {
    expect(sampleRequest(null)).toBe(
      [
        'curl --fail-with-body --request POST "$TALE_WEBHOOK_URL" \\',
        "  --header 'Content-Type: application/json' \\",
        "  --header 'Idempotency-Key: <one-id-per-event>' \\",
        `  --data '{"example": true}'`,
      ].join('\n'),
    );
  });

  it('names a freshly minted URL', () => {
    expect(sampleRequest('https://tale.example/x')).toMatch(
      /^curl --fail-with-body --request POST "https:\/\/tale\.example\/x" \\/,
    );
  });
});

describe('TriggerWebhookPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runsRead = { data: [], isPending: false, isError: false };
  });

  it('shows each address once, copyable, right after the token is minted', () => {
    renderPanel({ projects: PROJECTS, mintedToken: 'wht_1' });
    const banner = screen
      .getByRole('heading', { name: 'Webhook URL — copy it now' })
      .closest('[data-slot="alert"]');
    if (!(banner instanceof HTMLElement)) throw new Error('no alert');
    expect(
      within(banner).getByRole('button', {
        name: 'Document desk https://tale.example/api/projects/proj-1/automations/webhook/wht_1',
      }),
    ).toBeVisible();
    expect(
      within(banner).getByRole('button', { name: /^Support / }),
    ).toBeVisible();
    // The test request names the first address.
    expect(
      screen.getByText(
        /POST "https:\/\/tale\.example\/api\/projects\/proj-1\/automations\/webhook\/wht_1"/,
      ),
    ).toBeVisible();
  });

  it('masks the token afterwards, saying so to a screen reader, with Rotate token', async () => {
    const { user, onRotate } = renderPanel();
    const list = screen.getByRole('list', { name: 'Webhook endpoint' });
    const [item] = within(list).getAllByRole('listitem');
    expect(item).toHaveTextContent(
      'https://tale.example/api/automations/webhook/••••••••',
    );
    expect(within(list).getByText('Webhook URL, token hidden')).toHaveClass(
      'sr-only',
    );
    expect(
      screen.getByText(
        'The token was shown once, when it was created. Rotate it to get a new URL.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Rotate token' }));
    expect(onRotate).toHaveBeenCalledTimes(1);
  });

  it('says a webhook not saved yet has no URL, and offers no rotation', () => {
    renderPanel({ hasToken: false, storedWebhook: false });
    expect(
      screen.getByText('Save to mint the token; the full URL is shown once.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Rotate token' })).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Recent deliveries' }),
    ).toBeNull();
  });

  it('gives members the addresses without Rotate token', () => {
    renderPanel({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'Rotate token' })).toBeNull();
  });

  describe('recent deliveries', () => {
    const STARTED = Date.UTC(2026, 9, 12, 7, 0);

    it('lists each run with how its delivery was recognised, its state and a link', () => {
      runsRead = {
        isPending: false,
        isError: false,
        data: [
          {
            runId: 'run-3',
            startedAt: STARTED + 120_000,
            status: 'failed',
            deliverySource: 'header',
            header: 'x-github-delivery',
          },
          {
            runId: 'run-2',
            startedAt: STARTED + 60_000,
            status: 'success',
            deliverySource: 'body',
            header: null,
          },
          {
            runId: 'run-1',
            startedAt: STARTED,
            status: 'success',
            deliverySource: null,
            header: null,
          },
        ],
      };
      renderPanel();
      const list = screen.getByRole('list', { name: 'Recent deliveries' });
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('ID from x-github-delivery');
      expect(items[0]).toHaveTextContent('Failed');
      expect(items[1]).toHaveTextContent('No delivery ID');
      expect(items[2]).not.toHaveTextContent(/·/);
      expect(
        within(items[0] as HTMLElement).getByRole('link', { name: 'View run' }),
      ).toHaveAttribute(
        'href',
        '/dashboard/org-1/automations/linear-intake/runs/run-3',
      );
      expect(
        screen.getByText(
          "Refused requests aren't listed; the sender sees why in its response.",
        ),
      ).toBeVisible();
    });

    it('says when there are none yet', () => {
      renderPanel();
      expect(
        screen.getByText(
          'No deliveries yet. Send a test request to see one here.',
        ),
      ).toBeVisible();
    });

    it('holds three rows while it reads', () => {
      runsRead = { isPending: true, isError: false };
      const { container } = renderPanel();
      expect(
        container.querySelectorAll('[aria-hidden="true"] .animate-pulse'),
      ).toHaveLength(3);
    });

    it('says a failed read failed, with Try again', async () => {
      runsRead = { isPending: false, isError: true };
      const { user } = renderPanel();
      expect(screen.getByText("Couldn't load the deliveries.")).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it('has no axe violations with deliveries', async () => {
    runsRead = {
      isPending: false,
      isError: false,
      data: [
        {
          runId: 'run-3',
          startedAt: Date.UTC(2026, 9, 12, 7, 0),
          status: 'success',
          deliverySource: 'header',
          header: 'idempotency-key',
        },
      ],
    };
    const result = renderPanel({ projects: PROJECTS });
    await checkAccessibility(result);
  });
});
