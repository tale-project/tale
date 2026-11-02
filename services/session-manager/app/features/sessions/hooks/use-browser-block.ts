import { useMeta } from '@/app/hooks/use-meta';
import { useT } from '@/lib/i18n/client';

/**
 * Why no session can start right now, in the person's words: the browser is
 * still being installed, or is not there (null: sessions can start). The app
 * says nothing until it knows, so a control is not disabled for a moment on
 * every load.
 */
export function useBrowserBlock(): string | null {
  const { t } = useT('sessions');
  const { data } = useMeta();
  if (data === undefined || data.browserInstalled) return null;
  return data.browserInstalling ? t('block.installing') : t('block.missing');
}
