import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { i18n } from '@/lib/i18n/i18n';

/**
 * Words the tab's title again in the language just picked. The title is worded
 * when a route loads (its `head`), so a language switched on a page would leave
 * the title in the old one until the next navigation; loading the open routes
 * again words it anew. It is the shell's business, not a page's: the language
 * is the person's, and any page may come to offer it.
 */
export function useRetitleOnLanguageChange(): void {
  const router = useRouter();
  useEffect(() => {
    const retitle = () => void router.invalidate();
    i18n.on('languageChanged', retitle);
    return () => {
      i18n.off('languageChanged', retitle);
    };
  }, [router]);
}
