import { Button } from '@tale/ui/button';
import { Loader2 } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/** A pending history read stays in the keyboard's place while blocking
 * repeat activation. Native disabled would move focus out of the history. */
export function TaskHistoryEarlierButton({
  isLoading,
  onLoadEarlier,
  size,
}: {
  isLoading: boolean;
  onLoadEarlier: () => void;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('tasks');
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      icon={isLoading ? Loader2 : undefined}
      iconClassName="animate-spin motion-reduce:animate-none"
      aria-busy={isLoading || undefined}
      aria-disabled={isLoading || undefined}
      onClick={(event) => {
        if (isLoading) event.preventDefault();
        else onLoadEarlier();
      }}
    >
      {t('detail.showEarlierComments')}
    </Button>
  );
}
