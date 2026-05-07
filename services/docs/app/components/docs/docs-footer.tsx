import { Link } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';

export function DocsFooter() {
  const { t } = useT('footer');
  return (
    <footer className="border-border-base mt-16 border-t py-8 print:hidden">
      <div className="text-fg-muted mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-5 text-xs sm:flex-row sm:items-center sm:justify-between md:px-8">
        <p>{t('copyrightLine1', { year: new Date().getFullYear() })}</p>
        <nav aria-label={t('footerNav')} className="flex gap-4">
          <a
            href="https://tale.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-fg-base transition-colors"
          >
            tale.dev
          </a>
          <Link
            // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
            to={'/llms.txt' as any}
            className="hover:text-fg-base transition-colors"
          >
            llms.txt
          </Link>
          <a
            href="https://github.com/tale-project/tale"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-fg-base transition-colors"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
