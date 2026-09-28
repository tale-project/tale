import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen } from '@/tests/utils/render';

import { FeedbackMetricsPage } from './feedback-metrics-page';

const query = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: query,
}));
vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}));

afterEach(async () => {
  cleanup();
  query.mockReset();
  await forgetSavedLocale();
});

describe('FeedbackMetricsPage after a lapsed session', () => {
  it.each(SHIPPED_LOCALES)(
    'shows the session sentence instead of the serialized refusal (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      const error = await lapsedSessionRefusal().catch(
        (refusal: unknown) => refusal,
      );
      query.mockReturnValue({ data: undefined, isLoading: false, error });

      render(
        <FeedbackMetricsPage
          organizationId="org-1"
          period="7"
          kind="all"
          withCommentOnly={false}
          onChangePeriod={vi.fn()}
          onChangeKind={vi.fn()}
          onToggleCommentOnly={vi.fn()}
          onSelectAgent={vi.fn()}
          onSelectModel={vi.fn()}
          onClearFilters={vi.fn()}
        />,
      );

      expect(screen.getByText(SESSION_ENDED[locale])).toBeVisible();
      expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
    },
  );
});
