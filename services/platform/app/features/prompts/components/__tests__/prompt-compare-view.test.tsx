// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import type { PromptVersionEntry } from '../../hooks/queries';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      const text = `${ns}.${key}`;
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          text,
        );
      }
      return text;
    },
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({ formatDate: () => 'April 1, 2026' }),
}));

import { PromptCompareView } from '../prompt-compare-view';

const baseEntry = (
  overrides: Partial<PromptVersionEntry> = {},
): PromptVersionEntry => ({
  version: 1,
  content: 'line one\nline two',
  publishedAt: 1_700_000_000_000,
  publishedBy: 'user-1',
  publishedByName: 'Alice',
  title: 'Test Prompt',
  scope: 'personal',
  ...overrides,
});

afterEach(() => cleanup());

describe('PromptCompareView', () => {
  it('passes axe audit on a content diff', async () => {
    const { container } = render(
      <PromptCompareView
        current={baseEntry({ version: 2, content: 'line one\nline TWO' })}
        snapshot={baseEntry({ version: 1, content: 'line one\nline two' })}
        onRestore={vi.fn()}
        onBack={vi.fn()}
        isRestoring={false}
      />,
    );
    await checkAccessibility(container);
  });

  it('shows the no-differences message when content and metadata match', () => {
    const same = baseEntry();
    render(
      <PromptCompareView
        current={same}
        snapshot={same}
        onRestore={vi.fn()}
        onBack={vi.fn()}
        isRestoring={false}
      />,
    );
    expect(
      screen.getByText('prompts.history.noDifferences'),
    ).toBeInTheDocument();
  });

  it('disables the Restore button when there are no differences', () => {
    const same = baseEntry();
    render(
      <PromptCompareView
        current={same}
        snapshot={same}
        onRestore={vi.fn()}
        onBack={vi.fn()}
        isRestoring={false}
      />,
    );
    const restoreBtn = screen.getByRole('button', {
      name: /prompts\.history\.restore/i,
    });
    expect(restoreBtn).toBeDisabled();
  });

  it('renders the metadata diff section when only metadata differs', () => {
    const current = baseEntry({ version: 2, title: 'New title' });
    const snapshot = baseEntry({ version: 1, title: 'Old title' });
    render(
      <PromptCompareView
        current={current}
        snapshot={snapshot}
        onRestore={vi.fn()}
        onBack={vi.fn()}
        isRestoring={false}
      />,
    );
    expect(
      screen.getByText('prompts.history.metadataDiffLabel'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('prompts.history.metadataField.title'),
    ).toBeInTheDocument();
  });

  it('renders the diff legend with current and snapshot version numbers', () => {
    render(
      <PromptCompareView
        current={baseEntry({ version: 2, content: 'a' })}
        snapshot={baseEntry({ version: 1, content: 'b' })}
        onRestore={vi.fn()}
        onBack={vi.fn()}
        isRestoring={false}
      />,
    );
    expect(
      screen.getByText(/prompts\.history\.diffLegend/),
    ).toBeInTheDocument();
  });
});
