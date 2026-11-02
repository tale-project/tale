import { useQuoted } from '@/app/hooks/use-quoted';
import { useT } from '@/lib/i18n/client';
import type { NoticeCode } from '@/lib/live-view';

import type { LiveNotice } from './use-live-view';

/**
 * What a notice of the browser says to the person, in their language: one
 * sentence per kind of notice. Where the browser's own words are all there is
 * to say what went wrong, they follow as a quoted detail (they are English in
 * every language, as the reason of a proxy check is).
 */
export function useNoticeText(): (notice: LiveNotice) => string {
  const { t } = useT('viewer');
  const { quoted } = useQuoted();
  return ({ code, message }) => {
    const detail = quoted(message);
    const sentences: Record<NoticeCode, string> = {
      address_refused: t('notice.addressRefused'),
      tab_gone: t('notice.tabGone'),
      tab_not_opened: t('notice.tabNotOpened', { detail }),
      key_failed: t('notice.keyFailed', { detail }),
      action_failed: t('notice.actionFailed', { detail }),
    };
    return sentences[code];
  };
}
