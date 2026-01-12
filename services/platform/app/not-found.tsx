'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HStack, Spacer } from '@/components/ui/layout';
import { TaleLogoText } from '@/components/ui/logo/tale-logo-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPage } from '@/components/ui/status-page';
import { UserButton } from '@/components/user-button';
import { useAuth } from '@/hooks/use-convex-auth';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useT('common');
  const { isAuthenticated, isLoading } = useAuth();

  const header = (
    <HStack className="pt-8 px-20">
      <Link
        href={isAuthenticated ? '/dashboard' : '/'}
        className="hover:opacity-70"
      >
        <TaleLogoText />
      </Link>
      <Spacer />
      {isLoading ? (
        <div className="flex size-9 items-center justify-center">
          <Skeleton className="size-5 rounded-full" />
        </div>
      ) : isAuthenticated ? (
        <UserButton align="end" />
      ) : (
        <Link href="/log-in">
          <Button variant="outline">{t('actions.logIn')}</Button>
        </Link>
      )}
    </HStack>
  );

  return (
    <StatusPage
      header={header}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <Link href={isAuthenticated ? '/dashboard' : '/'}>
          <Button>{t('notFound.goHome')}</Button>
        </Link>
      }
    />
  );
}
