import { HardHat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Full-pane placeholder for surfaces whose backend is offline while the
 * platform AI backend is rewritten. Route shells stay mounted (URLs remain
 * stable and navigable); only the feature body is replaced by this gate.
 *
 * Each gated route drops its gate when its backend is rebuilt — grep for
 * `<RebuildGate` to see what is still pending.
 */
export function RebuildGate({ feature }: { feature: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center"
      role="status"
    >
      <HardHat aria-hidden className="text-muted-foreground size-10" />
      <h1 className="text-lg font-semibold">{t('common.rebuildGate.title')}</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {t('common.rebuildGate.description', { feature })}
      </p>
    </div>
  );
}
