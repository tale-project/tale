'use client';

import { LinkButton } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { FileQuestion } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface DashboardNotFoundProps {
  /** Org id used to build the "Back to dashboard" recovery link. */
  organizationId: string;
  className?: string;
}

/**
 * Styled 404 shown for an unknown route under `/dashboard/$id`. Renders inside
 * the dashboard layout's `<Outlet/>`, so the side-nav rail and shell stay up;
 * this only fills the content area with a heading, message, and a recovery link
 * back to the org dashboard. Mirrors the app's other empty/error states
 * (AccessDenied, GlobalErrorDisplay) for visual consistency.
 */
export function DashboardNotFound({
  organizationId,
  className,
}: DashboardNotFoundProps) {
  const { t } = useT('common');

  return (
    <div
      className={cn(
        'flex min-h-[50vh] flex-1 flex-col items-center justify-center px-6 text-center',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <div
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-6 flex size-16 items-center justify-center rounded-full"
        >
          <FileQuestion className="size-7" />
        </div>
        <Heading level={1} size="2xl" className="mb-2">
          {t('notFound.title')}
        </Heading>
        <Text variant="muted">{t('notFound.description')}</Text>
        <LinkButton
          href={`/dashboard/${organizationId}`}
          variant="primary"
          className="mt-8"
        >
          {t('notFound.backToDashboard')}
        </LinkButton>
      </div>
    </div>
  );
}
