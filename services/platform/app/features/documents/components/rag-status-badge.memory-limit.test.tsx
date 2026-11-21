// @vitest-environment jsdom
/**
 * A document that needs more memory than this server gives one file fails
 * its index until an administrator raises the limit. The server stores the
 * failure as an English sentence that names the limit; the dialog says the
 * same in the reader's language beside it, with the limit that sentence
 * names and the setting that raises it. The catalogs are the real ones:
 * what is read here is what a person reads.
 */
import '@testing-library/jest-dom/vitest';
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoryLimitSentence } from '@/lib/shared/memory-limit';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
vi.mock('../hooks/actions', () => ({
  useRetryRagIndexing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-1' }),
}));

import { RagStatusBadge } from './rag-status-badge';

afterEach(async () => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('the dialog of a document that needs more memory than one file is given', () => {
  it.each(['en', 'de', 'fr'])(
    'names the limit and the setting, in the reader’s language (%s)',
    async (locale) => {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      await i18n.changeLanguage(locale);
      const words = i18n.getFixedT(locale, 'documents');
      const { user, container } = render(
        <RagStatusBadge
          status="failed"
          errorCode="memory_limit"
          error={memoryLimitSentence(96)}
          documentId="doc-1"
        />,
      );
      // Indexing can be retried once the limit is raised.
      expect(
        screen.getByRole('button', { name: words('rag.retryIndexing') }),
      ).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: words('rag.dialog.failed.title') }),
      );

      // The stored sentence stays, as for every failure, and the hint says
      // the same in the reader's language. Compared as written: French
      // puts a space that does not break before its semicolon.
      const stored = screen.getByText(memoryLimitSentence(96));
      expect(stored).toBeVisible();
      const hint = screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          (element.textContent ?? '').includes('HEAVY_SLOT_MEMORY_MB'),
      );
      expect(hint).toBeVisible();
      expect(hint.textContent).toBe(
        words('rag.dialog.failed.memoryLimit.hint', {
          limit: 96,
          setting: 'HEAVY_SLOT_MEMORY_MB',
        }),
      );
      expect(hint.textContent).toContain('96');
      expect(hint.textContent).toContain('HEAVY_SLOT_MEMORY_MB');
      if (locale !== 'en') {
        expect(hint.textContent).not.toContain('This file needs more memory');
      }
      await checkAccessibility(container);
    },
  );

  it('says nothing of memory for another failure', async () => {
    const words = i18n.getFixedT('en', 'documents');
    const { user } = render(
      <RagStatusBadge
        status="failed"
        errorCode="indexer_error"
        error="Indexing failed on the platform’s side."
        documentId="doc-1"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: words('rag.dialog.failed.title') }),
    );
    expect(screen.queryByText(/HEAVY_SLOT_MEMORY_MB/)).not.toBeInTheDocument();
  });

  it('says nothing of memory when the failure’s sentence names no limit', async () => {
    const words = i18n.getFixedT('en', 'documents');
    const { user } = render(
      <RagStatusBadge
        status="failed"
        errorCode="memory_limit"
        error="Something else went wrong."
        documentId="doc-1"
      />,
    );
    await user.click(
      screen.getByRole('button', { name: words('rag.dialog.failed.title') }),
    );
    expect(screen.queryByText(/HEAVY_SLOT_MEMORY_MB/)).not.toBeInTheDocument();
  });
});
