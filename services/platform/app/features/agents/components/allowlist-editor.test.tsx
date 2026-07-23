// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

import {
  AllowlistEditor,
  allowlistModeOf,
  allowlistValueFor,
} from './allowlist-editor';

// The tri-state contract from lib/agents/resolve.ts: ABSENT = not narrowed,
// EMPTY = nothing, a list = exactly those ids — and `null` on the wire is
// what widens back to absent.
describe('allowlist mode mapping', () => {
  it('derives the mode from a document list', () => {
    expect(allowlistModeOf(undefined)).toBe('all');
    expect(allowlistModeOf([])).toBe('none');
    expect(allowlistModeOf(['a'])).toBe('selected');
  });

  it('persists all as null (clear), none as [], selected as the ids', () => {
    expect(allowlistValueFor('all', ['a'])).toBeNull();
    expect(allowlistValueFor('none', ['a'])).toEqual([]);
    expect(allowlistValueFor('selected', ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('AllowlistEditor', () => {
  it('shows the option list only in selected mode, with kept-unknown entries flagged', async () => {
    const onModeChange = vi.fn();
    const onToggle = vi.fn();
    const options = [
      {
        id: 'automation.billing/dunning',
        label: 'automation.billing/dunning',
        description: 'Run the billing dunning automation.',
      },
      {
        id: 'integration.slack.send',
        label: 'integration.slack.send',
        unknown: true,
      },
    ];

    const { rerender, user } = render(
      <AllowlistEditor
        mode="all"
        onModeChange={onModeChange}
        options={options}
        selected={new Set(['integration.slack.send'])}
        onToggle={onToggle}
        labelKeyPrefix="tools"
        emptyCatalogText="empty"
      />,
    );
    expect(
      screen.queryByText('automation.billing/dunning'),
    ).not.toBeInTheDocument();

    rerender(
      <AllowlistEditor
        mode="selected"
        onModeChange={onModeChange}
        options={options}
        selected={new Set(['integration.slack.send'])}
        onToggle={onToggle}
        labelKeyPrefix="tools"
        emptyCatalogText="empty"
      />,
    );
    expect(screen.getByText('automation.billing/dunning')).toBeInTheDocument();
    expect(
      screen.getByText('settings.agents.allowlist.unknownKept'),
    ).toBeInTheDocument();

    await user.click(screen.getByText('automation.billing/dunning'));
    expect(onToggle).toHaveBeenCalledWith('automation.billing/dunning', true);
  });
});
