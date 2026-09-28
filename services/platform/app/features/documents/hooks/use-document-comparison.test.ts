import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

const { compareAction } = vi.hoisted(() => ({ compareAction: vi.fn() }));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: compareAction }),
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
});
