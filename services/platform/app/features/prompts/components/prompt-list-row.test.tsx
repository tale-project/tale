// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import type { PromptTemplate } from '../hooks/queries';

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

const toastMock = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { PromptListRow } from './prompt-list-row';

const prompt: PromptTemplate = {
  _id: 'p1' as PromptTemplate['_id'],
  _creationTime: 1_700_000_000_000,
  organizationId: 'org-1',
  createdBy: 'user-1',
  title: 'Quick draft',
  content: 'hello world',
  scope: 'personal',
  usageCount: 0,
  version: 3,
};

afterEach(() => {
  cleanup();
  toastMock.mockReset();
});

describe('PromptListRow', () => {
  it('passes axe audit', async () => {
    // Wrap in role="list" because the row uses role="listitem" — axe rejects
    // a listitem without a list parent. The library-dialog supplies this in
    // production.
    const { container } = render(
      <div role="list">
        <PromptListRow
          prompt={prompt}
          onUse={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onViewHistory={vi.fn()}
          canModify
          isLast={false}
        />
      </div>,
    );
    await checkAccessibility(container);
  });

  it('exposes version badge with translated aria-label (not aria-hidden)', () => {
    render(
      <PromptListRow
        prompt={prompt}
        onUse={vi.fn()}
        canModify={false}
        isLast={false}
      />,
    );
    const badge = screen.getByLabelText('prompts.version.badge');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('aria-hidden')).not.toBe('true');
  });

  it('calls onUse when the row primary button is clicked', () => {
    const onUse = vi.fn();
    render(
      <PromptListRow
        prompt={prompt}
        onUse={onUse}
        canModify={false}
        isLast={false}
      />,
    );
    fireEvent.click(screen.getByText('Quick draft'));
    expect(onUse).toHaveBeenCalledWith(prompt);
  });

  it('exposes the more-actions button with translated aria-label', () => {
    render(
      <PromptListRow
        prompt={prompt}
        onUse={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        canModify
        isLast={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'prompts.actions.more' }),
    ).toBeInTheDocument();
  });
});
