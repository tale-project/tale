'use client';

import { LinkButton } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Center, Stack } from '@tale/ui/layout';
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
 * (AccessDenied, GlobalErrorDisplay) for visual consistency. Composes the
 * design-system layout primitives (`Center`, `Stack`) rather than raw flex divs.
 */
export function DashboardNotFound({
  organizationId,
  className,
}: DashboardNotFoundProps) {
  const { t } = useT('common');

  return (
    <Center className={cn('min-h-[50vh] flex-1 px-6 text-center', className)}>
      <Stack align="center" gap={0} className="mx-auto w-full max-w-md">
        <Center
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-6 size-16 rounded-full"
        >
          <FileQuestion className="size-7" />
        </Center>
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
      </Stack>
    </Center>
  );
}
