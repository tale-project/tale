// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AppShell } from '@tale/ui/app-shell';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import type { AgentConnection } from '../types';
import { useAgentConnectionsTableConfig } from './use-agent-connections-table-config';

const connection: AgentConnection = {
  id: 'conn-1',
  userId: 'ada',
  clientName: 'Claude Code',
  provenance: 'metadata_document',
  clientHost: 'claude.ai',
  scopes: ['tale:mcp'],
  createdAt: Date.UTC(2026, 9, 1, 12),
  lastUsedAt: null,
  revokedAt: null,
  revokeReason: null,
  personName: 'Ada Lovelace',
  personEmail: 'ada@example.test',
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

/** One agent's row, drawn by the real table with the columns this screen
 * holds — but for its menu, which needs the app's queries and says nothing of
 * what is asked here. */
function RowOfTable({ everyone }: { everyone: boolean }) {
  const { columns } = useAgentConnectionsTableConfig({
    organizationId: 'org-1',
    viewerUserId: 'olav',
    everyone,
  });
  const table = useReactTable({
    data: [connection],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div>
      {table.getRowModel().rows.flatMap((row) =>
        row
          .getVisibleCells()
          .filter((cell) => cell.column.id !== 'actions')
          .map((cell) => (
            <div key={cell.id} data-column={cell.column.id}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          )),
      )}
    </div>
  );
}

const originalMatchMedia = window.matchMedia;

/** A screen `width` pixels wide, as far as `matchMedia` can tell. */
function screenWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max !== null && width <= Number(max[1]),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function columnsAt(width: number, everyone: boolean) {
  screenWidth(width);
  const { result } = renderHook(
    () =>
      useAgentConnectionsTableConfig({
        organizationId: 'org-1',
        viewerUserId: 'ada',
        everyone,
      }),
    { wrapper: Providers },
  );
  return result.current.columns;
}

const ids = (width: number, everyone: boolean) =>
  columnsAt(width, everyone).map((column) => column.id);

/** The settings page's measure: the most a table under it has to work with. */
const PAGE_MEASURE = 766;

/** The columns of the connected agents, as many as the screen holds. */
describe('useAgentConnectionsTableConfig [AGCONN-R24]', () => {
  it('shows every column on a wide screen, the person where everyone’s agents are listed', () => {
    expect(ids(1440, false)).toEqual([
      'agent',
      'access',
      'connected',
      'lastUsed',
      'actions',
    ]);
    expect(ids(1440, true)).toEqual([
      'agent',
      'person',
      'access',
      'connected',
      'lastUsed',
      'actions',
    ]);
  });

  it('shows every column when the screen cannot say how wide it is', () => {
    // The first render of a client that has no `matchMedia` yet: wide.
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result } = renderHook(
      () =>
        useAgentConnectionsTableConfig({
          organizationId: 'org-1',
          viewerUserId: 'ada',
          everyone: true,
        }),
      { wrapper: Providers },
    );
    expect(result.current.columns.map((column) => column.id)).toHaveLength(6);
  });

  it('leaves the day it connected out beside the settings rail, where the page is narrower than its columns', () => {
    expect(ids(1100, true)).toEqual([
      'agent',
      'person',
      'access',
      'lastUsed',
      'actions',
    ]);
    expect(ids(800, true)).not.toContain('connected');
  });

  it('leaves the access and when the agent last called out on a large phone', () => {
    expect(ids(700, true)).toEqual(['agent', 'person', 'actions']);
    expect(ids(700, false)).toEqual(['agent', 'actions']);
  });

  it('keeps only the agent and its menu on a phone, whoever’s agents are listed', () => {
    expect(ids(390, false)).toEqual(['agent', 'actions']);
    expect(ids(390, true)).toEqual(['agent', 'actions']);
    expect(ids(320, true)).toEqual(['agent', 'actions']);
  });

  it('moves what a left-out column held under the agent’s name, only as far as it was left out', () => {
    const cells = (width: number, everyone: boolean) => {
      screenWidth(width);
      const { container } = render(<RowOfTable everyone={everyone} />, {
        wrapper: Providers,
      });
      const cell = (column: string) =>
        container.querySelector<HTMLElement>(`[data-column="${column}"]`);
      return {
        agent: cell('agent'),
        person: cell('person'),
        access: cell('access'),
      };
    };

    // Beside the settings rail the table has every column itself.
    const wide = cells(1440, true);
    expect(wide.access).not.toBeNull();
    expect(wide.agent).not.toHaveTextContent('Never used');
    expect(wide.agent).not.toHaveTextContent('Read and test');
    expect(wide.agent).not.toHaveTextContent('Ada Lovelace');
    cleanup();

    // A large phone has no room for the access; the person still has a column.
    const large = cells(700, true);
    expect(large.access).toBeNull();
    expect(large.person).toHaveTextContent('Ada Lovelace');
    expect(large.agent).toHaveTextContent('Read and test');
    expect(large.agent).toHaveTextContent('Never used');
    expect(large.agent).not.toHaveTextContent('Ada Lovelace');
    cleanup();

    // A phone has neither, in the view of everyone's agents…
    const phone = cells(390, true);
    expect(phone.person).toBeNull();
    expect(phone.access).toBeNull();
    expect(phone.agent).toHaveTextContent('Ada Lovelace');
    expect(phone.agent).toHaveTextContent('Read and test');
    expect(phone.agent).toHaveTextContent('Never used');
    cleanup();

    // …and in one's own there is no person column to make up for.
    const own = cells(390, false);
    expect(own.agent).toHaveTextContent('Read and test');
    expect(own.agent).not.toHaveTextContent('Ada Lovelace');
  });

  it('draws the boundaries where the tailwind breakpoints are', () => {
    expect(ids(639, true)).toEqual(['agent', 'actions']);
    expect(ids(640, true)).toEqual(['agent', 'person', 'actions']);
    expect(ids(767, true)).toEqual(['agent', 'person', 'actions']);
    expect(ids(768, true)).toContain('access');
    expect(ids(1279, true)).not.toContain('connected');
    expect(ids(1280, true)).toContain('connected');
  });

  it('declares sizes that add up to what the settings page holds, at every width and in both views', () => {
    for (const width of [
      320, 390, 640, 700, 768, 1024, 1100, 1279, 1280, 1920,
    ]) {
      for (const everyone of [false, true]) {
        const total = columnsAt(width, everyone).reduce(
          (sum, column) => sum + (column.size ?? 0),
          0,
        );
        expect(
          total,
          `${width}px, everyone ${String(everyone)}`,
        ).toBeLessThanOrEqual(PAGE_MEASURE);
      }
    }
  });

  it('does not use the sticky scroll layout, as the page owns the vertical scroll', () => {
    screenWidth(1440);
    const { result } = renderHook(
      () =>
        useAgentConnectionsTableConfig({
          organizationId: 'org-1',
          viewerUserId: 'ada',
          everyone: false,
        }),
      { wrapper: Providers },
    );
    expect(result.current.stickyLayout).toBe(false);
  });

  it('names the actions column for assistive technology', () => {
    const actions = columnsAt(1440, false).find(
      (column) => column.id === 'actions',
    );
    expect(typeof actions?.header).toBe('function');
  });
});
