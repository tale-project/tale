import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';

import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface NotFoundPageProps {
  locale: SupportedLocale;
}

export function NotFoundPage({ locale }: NotFoundPageProps) {
  const { t } = useT('notFound');
  return (
    <div className="flex flex-col items-start gap-4 py-16">
      <h1 className="text-fg-base text-3xl font-semibold">{t('title')}</h1>
      <p className="text-fg-muted">{t('description')}</p>
      <Button asChild variant="secondary">
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, 'index') as any}
        >
          {t('home')}
        </Link>
      </Button>
    </div>
  );
}
