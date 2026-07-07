// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { WfWebhook } from '../hooks/queries';
import { WebhooksSection } from './webhooks-section';

// Regression for #2343: the create dialog warns "Save this webhook URL. The
// token in the URL acts as the authentication credential." — yet the table
// used to render the full token-bearing URL in plaintext (text + title
// tooltip) on every visit. The table must mask the token; the copy button
// keeps copying the full URL (token retrievability is by design, see #2064).

let mockWebhooks: WfWebhook[] = [];

vi.mock('../hooks/queries', () => ({
  useWebhooks: () => ({ webhooks: mockWebhooks, isLoading: false }),
}));

vi.mock('../hooks/slug-mutations', () => ({
  useCreateWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleWebhook: () => ({ mutateAsync: vi.fn() }),
  useDeleteWebhook: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The section reads the site URL from a context provider that the render
// wrapper (AppShell) does not mount; the hook throws without it. Stub it to a
// fixed origin so the row URLs are deterministic.
vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://example.test',
}));

// The DataTable inside the section reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other section tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// A realistic 64-hex token (see convex/workflows/triggers/helpers/crypto.ts).
const TOKEN =
  'f00dfeedcafe0123456789abcdef0123456789abcdef0123456789abcdef0123';
// maskSecretPreview: first 3 chars, fixed-width mask, last 3 chars.
const MASKED_URL = 'https://example.test/api/workflows/wh/f00••••123';
const FULL_URL = `https://example.test/api/workflows/wh/${TOKEN}`;

// Resolved from messages/en.json (automations.triggers.webhooks.*).
const COPY_URL = 'Webhook URL';

// The DataTable's actions column intentionally uses an empty header (header:
// ''), a standard data-table pattern — matches the other *-table tests.
const axeOptions = {
  rules: { 'empty-table-header': { enabled: false } },
};

function webhookRow(overrides: Partial<WfWebhook> = {}): WfWebhook {
  return {
    _id: 'wh-1',
    token: TOKEN,
    isActive: true,
    lastTriggeredAt: undefined,
    ...overrides,
  } as WfWebhook;
}

function renderSection() {
  return render(
    <WebhooksSection
      workflowRootId="root-1"
      organizationId="org-1"
      workflowSlug="my-workflow"
    />,
  );
}

beforeEach(() => {
  mockWebhooks = [webhookRow()];
});

afterEach(() => {
  mockWebhooks = [];
});

describe('WebhooksSection', () => {
  describe('token masking (#2343)', () => {
    it('never renders the token in the table — text or tooltip', async () => {
      const { container } = renderSection();

      // The masked URL is what the row shows…
      expect(screen.getByText(MASKED_URL)).toBeInTheDocument();
      // …and the raw token appears nowhere in the DOM, including `title`.
      expect(container.innerHTML).not.toContain(TOKEN);

      await checkAccessibility(container, axeOptions);
    });

    it('still copies the full token-bearing URL', async () => {
      renderSection();

      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockResolvedValue(undefined);

      fireEvent.click(screen.getByRole('button', { name: COPY_URL }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(FULL_URL);
      });
    });
  });
});
