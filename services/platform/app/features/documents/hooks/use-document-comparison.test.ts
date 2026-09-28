import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

const { compareAction, actionOptions } = vi.hoisted(() => ({
  compareAction: vi.fn(),
  actionOptions: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (name: string, options: unknown) => {
    actionOptions(name, options);
    return { mutateAsync: compareAction };
  },
}));

import { useDocumentComparison } from './use-document-comparison';

const ARGS = {
  baseStorageId: 'blob-1',
  baseFileName: 'contract-v1.docx',
  comparisonStorageId: 'blob-2',
  comparisonFileName: 'contract-v2.docx',
};

afterEach(async () => {
  compareAction.mockReset();
  await i18n.changeLanguage('en');
});

// The history dialog shows this error under its version picker. The
// refusal's own `message` is its serialized payload, which it used to show.
describe('useDocumentComparison', () => {
  it.each(SHIPPED_LOCALES)(
    'says the session ended when the comparison is refused (%s)',
    async (locale) => {
      await i18n.changeLanguage(locale);
      compareAction.mockImplementation(() => lapsedSessionRefusal());
      const { result } = renderHook(() =>
        useDocumentComparison({ organizationId: 'org-1' }),
      );

      await act(async () => {
        await result.current.compare(ARGS).catch(() => undefined);
      });

      expect(result.current.error).toBe(SESSION_ENDED[locale]);
    },
  );

  /** Run one comparison to its failure; the error it rejected with. */
  async function failedComparison() {
    const { result } = renderHook(() =>
      useDocumentComparison({ organizationId: 'org-1' }),
    );
    let thrown: unknown;
    await act(async () => {
      await result.current.compare(ARGS).catch((error: unknown) => {
        thrown = error;
      });
    });
    return { shown: result.current.error, thrown };
  }

  // A fault used to read "Comparison failed" in English in every language,
  // and a body of the wrong shape showed the developer's "Invalid comparison
  // response".
  it.each(SHIPPED_LOCALES)(
    'says the comparison failed, in the language of the page, for a fault (%s)',
    async (locale) => {
      await i18n.changeLanguage(locale);
      const compareFailed = i18n.t('history.compareFailed', {
        ns: 'documents',
      });

      compareAction.mockRejectedValueOnce(
        new BackendApiError(503, 'Service Unavailable'),
      );
      expect((await failedComparison()).shown).toBe(compareFailed);

      compareAction.mockResolvedValueOnce({ changeBlocks: [] });
      const invalid = await failedComparison();
      expect(invalid.shown).toBe(compareFailed);
      expect(invalid.thrown).toBeInstanceOf(TypeError);
    },
  );

  it('says a lost connection in words', async () => {
    compareAction.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await failedComparison()).shown).toBe(
      i18n.t('errors.connectionLost', { ns: 'common' }),
    );
  });

  // The dialog reports a failure in its own toast and under the picker.
  it("keeps the action's default toast silent", () => {
    renderHook(() => useDocumentComparison({ organizationId: 'org-1' }));
    expect(actionOptions).toHaveBeenCalledWith(
      'documents/compare_documents:compareDocuments',
      { errorToast: false },
    );
  });
});
