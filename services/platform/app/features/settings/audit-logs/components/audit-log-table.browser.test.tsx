import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { AuditLogDoc } from '@/app/lib/backend/contract/docs';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { AuditLogTable } from './audit-log-table';

import '@/app/globals.css';

/**
 * The audit detail dialog in real Chromium, for what jsdom cannot judge:
 * contrast in both themes, that a value reads as it was written — a label in
 * sentence case, a name or an id untouched by text transforms — and that a
 * long state scrolls where a keyboard can reach it.
 */

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined, isLoading: false }),
}));

// Ada saved version 7 of invoice-intake from Claude Code; the version's
// settings are long enough to scroll.
const log: AuditLogDoc = {
  _id: 'log-agent',
  _creationTime: 1_700_000_000_000,
  organizationId: 'org-1',
  actorId: 'user-ada',
  actorEmail: 'ada@example.com',
  actorRole: 'developer',
  actorType: 'api',
  action: 'automation.version.saved',
  category: 'workflow',
  resourceType: 'automation',
  resourceId: 'automation-invoice-intake',
  resourceName: 'invoice-intake',
  timestamp: 1_700_000_000_000,
  status: 'success',
  newState: Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [`setting${index}`, index]),
  ),
  metadata: {
    version: 7,
    via: 'mcp',
    tool: 'save_automation',
    apiKeyId: 'key-ada-laptop',
    clientName: 'claude-code',
  },
};

/** The value a detail row shows beside its label. */
function detailValue(dialog: HTMLElement, label: string): HTMLElement {
  // A row's label is the cell with its value beside it.
  const value = within(dialog)
    .getAllByText(label)
    .map((candidate) => candidate.nextElementSibling)
    .find((sibling) => sibling instanceof HTMLElement);
  if (!(value instanceof HTMLElement)) throw new Error(`No ${label} row`);
  return value;
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

// A short phone, where the whole entry scrolls in the dialog's body, and a
// desktop, where it does not.
describe.each([
  [375, 520],
  [1280, 900],
])('Audit detail dialog at %ix%ipx (real Chromium)', (width, height) => {
  it.each(['light', 'dark'])(
    'shows the coding agent rows as written and passes axe in %s mode',
    async (theme) => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      render(
        <AuditLogTable
          paginatedResult={{
            results: [log],
            status: 'Exhausted',
            isLoading: false,
            loadMore: vi.fn(),
            error: null,
            retry: vi.fn(),
            isRetrying: false,
            unavailable: false,
            errorCount: 0,
          }}
          revealLogId={log._id}
          revealNonce={1}
        />,
      );
      const dialog = await screen.findByRole('dialog');
      // Let the dialog finish opening: axe reads colours at rest.
      await new Promise((resolve) => setTimeout(resolve, 400));

      for (const [label, value] of [
        ['Action', 'Automation version saved'],
        ['User', 'ada@example.com'],
        ['Source', 'Coding agent'],
        ['Client', 'claude-code'],
        ['Target', 'invoice-intake'],
      ] as const) {
        const cell = detailValue(dialog, label);
        expect(cell).toHaveTextContent(value);
        expect(getComputedStyle(cell).textTransform).toBe('none');
      }

      // The long state scrolls in its own box, which the keyboard reaches.
      const newState = within(dialog).getByRole('region', {
        name: 'New state',
      });
      expect(newState.scrollHeight).toBeGreaterThan(newState.clientHeight);
      for (let tab = 0; tab < 6 && document.activeElement !== newState; tab++)
        await userEvent.keyboard('{Tab}');
      expect(newState).toHaveFocus();

      const audit = await axe.run(dialog, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(audit.violations).toEqual([]);
      expect(audit.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );
});
