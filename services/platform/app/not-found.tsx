'use client';

import Link from 'next/link';
import { Button, LinkButton } from '@/components/ui/primitives/button';
import { Center } from '@/components/ui/layout/layout';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { StatusPage } from '@/components/ui/feedback/status-page';
import { StatusPageHeader } from '@/components/layout/status-page-header';
import { UserButton } from '@/components/user-button';
import { useAuth } from '@/hooks/use-convex-auth';
import { useT } from '@/lib/i18n/client';

export default function NotFound() {
  const { t } = useT('common');
  const { isAuthenticated, isLoading } = useAuth();

  const header = (
    <StatusPageHeader logoHref={isAuthenticated ? '/dashboard' : '/'}>
      {isLoading ? (
        <Center>
          <Skeleton size="sm" shape="circle" />
        </Center>
      ) : isAuthenticated ? (
        <UserButton align="end" />
      ) : (
        <Link href="/log-in">
          <Button variant="outline">{t('actions.logIn')}</Button>
        </Link>
      )}
    </StatusPageHeader>
  );

  return (
    <StatusPage
      header={header}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <LinkButton href={isAuthenticated ? '/dashboard' : '/'}>
          {t('notFound.goHome')}
        </LinkButton>
      }
    />
  );
}
