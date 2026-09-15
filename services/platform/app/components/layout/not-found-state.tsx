'use client';

import { LinkButton } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { SearchX } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface NotFoundStateProps {
  /** Where the "Back to dashboard" recovery link leads. */
  href: string;
}

/**
 * The body of every platform 404: the app's dead-end empty state — the same
 * `SearchX` glyph the automation and run not-found states carry — with one way
 * out, back to the dashboard. Its title is the only heading on the page, so it
 * renders as the `h1`. `DashboardNotFound` places it in the dashboard's content
 * area; `RouteNotFound` frames it as a standalone page outside the dashboard.
 */
export function NotFoundState({ href }: NotFoundStateProps) {
  const { t } = useT('common');

  return (
    <EmptyState
      icon={SearchX}
      title={t('notFound.title')}
      description={t('notFound.description')}
      headingLevel={1}
      action={
        <LinkButton href={href} variant="secondary">
          {t('notFound.backToDashboard')}
        </LinkButton>
      }
    />
  );
}
