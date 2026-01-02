import { Button } from '@/components/ui/button';
import { HStack, Spacer } from '@/components/ui/layout';
import { StatusPage } from '@/components/ui/status-page';
import Link from 'next/link';
import { TaleLogoText } from '@/components/tale-logo-text';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const { t } = await getT('common');

  const header = (
    <HStack className="pt-8 px-20">
      <Link href="/" className="hover:opacity-70">
        <TaleLogoText />
      </Link>
      <Spacer />
      <Link href="/log-in">
        <Button variant="outline">{t('actions.logIn')}</Button>
      </Link>
    </HStack>
  );

  return (
    <StatusPage
      header={header}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <Link href="/">
          <Button>{t('notFound.goHome')}</Button>
        </Link>
      }
    />
  );
}
