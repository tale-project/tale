import { Link } from '@tanstack/react-router';

import { ShellAlert } from '@/app/components/layout/shell-alert';
import { useT } from '@/lib/i18n/client';

/**
 * The embedding nudge's row: what is missing and the link to set it up.
 * `EmbeddingSetupBanner` decides whether it shows.
 */
export function EmbeddingSetupAlert({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');

  return (
    <ShellAlert>
      <span className="grow">
        <span className="font-medium">
          {t('dataResidency.orgEmbedding.banner.title')}
        </span>
        {/* On a phone, and on a viewport too short to spare the lines (a
            phone held sideways, a laptop at 200 %), the explanation is read
            out but not drawn: it wrapped the banner to three or four lines
            above every page, and the title plus the link already say what
            to do. */}
        <span className="short-viewport:sr-only sr-only sm:not-sr-only">
          {' — '}
          {t('dataResidency.orgEmbedding.banner.body')}
        </span>
      </span>
      <Link
        to="/dashboard/$id/settings/data-residency"
        params={{ id: organizationId }}
        className="underline underline-offset-2"
      >
        {t('dataResidency.orgEmbedding.banner.link')}
      </Link>
    </ShellAlert>
  );
}
