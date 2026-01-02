'use client';

import { Button } from '@/components/ui/button';
import { HStack, Spacer } from '@/components/ui/layout';
import { StatusPage } from '@/components/ui/status-page';
import Link from 'next/link';
import { UserButton } from '@/components/auth/user-button';
import { TaleLogoText } from '@/components/tale-logo-text';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useT('common');

  const header = (
    <HStack className="pt-8 px-20">
      <Link href="/dashboard" className="hover:opacity-70">
        <TaleLogoText />
      </Link>
      <Spacer />
      <UserButton align="end" />
    </HStack>
  );

  return (
    <StatusPage
      header={header}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <Link href="/dashboard">
          <Button>{t('notFound.goHome')}</Button>
        </Link>
      }
    />
  );
}
