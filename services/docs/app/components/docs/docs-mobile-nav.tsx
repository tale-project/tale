import * as Dialog from '@radix-ui/react-dialog';
import { useRouterState } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DocsNavList } from '@/app/components/docs/docs-sidebar';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsMobileNavProps {
  locale: SupportedLocale;
  /** Slug of the active page; used for highlighting. */
  activeSlug: string;
}

/**
 * Mobile-only navigation drawer. Renders a hamburger trigger that opens a
 * Radix Dialog drawer containing the same nav tree as `DocsSidebar`. The
 * drawer auto-closes on route change and on Esc (handled by Radix Dialog).
 */
export function DocsMobileNav({ locale, activeSlug }: DocsMobileNavProps) {
  const { t } = useT('nav');
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={t('openMenu')}
        className="border-border-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/40 bg-bg-base/85 fixed top-3 left-3 z-50 inline-flex size-9 items-center justify-center rounded-md border backdrop-blur transition-colors focus-visible:ring-2 focus-visible:outline-none lg:hidden"
      >
        <Menu aria-hidden className="size-4" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
        <Dialog.Content
          aria-label={t('docs')}
          className="border-border-base bg-bg-base fixed top-0 left-0 z-50 flex h-dvh w-[min(20rem,85vw)] flex-col overflow-hidden border-r shadow-2xl lg:hidden"
        >
          <Dialog.Title className="sr-only">{t('docs')}</Dialog.Title>
          <div className="border-border-base flex h-16 shrink-0 items-center justify-between border-b px-4">
            <span className="text-fg-base text-sm font-medium">
              {t('docs')}
            </span>
            <Dialog.Close
              aria-label={t('closeMenu')}
              className="text-fg-muted hover:text-fg-base inline-flex size-8 items-center justify-center rounded-md transition-colors"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <nav
            aria-label="Documentation"
            className="flex-1 overflow-y-auto px-4"
          >
            <DocsNavList
              locale={locale}
              activeSlug={activeSlug}
              onNavigate={() => setOpen(false)}
            />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
