'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { UserButton } from '@/components/auth/user-button';
import { TaleLogoText } from '@/components/tale-logo-text';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useT('common');
  return (
    <section>
      <div className="pt-8 px-20 flex items-center">
        <Link href="/dashboard" className="hover:opacity-70">
          <TaleLogoText />
        </Link>
        <span className="ml-auto">
          <UserButton align="end" />
        </span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-[14.5rem]">
        <div className="space-y-4 max-w-[25.875rem]">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground text-center">
            {t('notFound.title')}
          </h2>
          <p className="text-muted-foreground text-center">
            {t('notFound.description')}
          </p>
        </div>

        <div className="mt-6">
          <Link href="/dashboard">
            <Button>{t('notFound.goHome')}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
