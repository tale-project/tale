'use client';

import { Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

export interface DiffEntry {
  category: string;
  field: 'min' | 'max';
  from: number;
  to: number;
  direction: 'tighten' | 'loosen';
}

export interface ImpactEntry {
  category: string;
  field: string;
  current: number;
  willClampTo: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diff: DiffEntry[];
  impactPreview: ImpactEntry[];
}

/**
 * Slide-in detail panel for the bounds proposal banner. Renders the
 * full per-field diff and the per-category impact-preview produced by
 * `getPendingBoundsProposal`. The banner itself stays compact ([Apply]
 * / [Reject] / [View details]); admins who want the full table click
 * here. Lazy-loaded — banner-only mounts pay no overhead.
 */
export function RetentionBoundsDetailsDrawer({
  open,
  onOpenChange,
  diff,
  impactPreview,
}: Props) {
  const { t } = useT('governance');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      size="md"
      title={t(
        'retentionPolicy.boundsProposal.detailsTitle',
        'Proposed bound changes',
      )}
      description={t(
        'retentionPolicy.boundsProposal.detailsDescription',
        'Review the operator-proposed retention bound changes before applying or rejecting.',
      )}
    >
      <Stack gap={4}>
        <div>
          <Text className="text-base font-medium">
            {t(
              'retentionPolicy.boundsProposal.detailsTitle',
              'Proposed bound changes',
            )}
          </Text>
          <Text className="text-muted-foreground text-xs">
            {t(
              'retentionPolicy.boundsProposal.detailsDescription',
              'Review the operator-proposed retention bound changes before applying or rejecting.',
            )}
          </Text>
        </div>

        {diff.length > 0 && (
          <section>
            <Text className="text-sm font-medium">
              {t('retentionPolicy.boundsProposal.diffHeading', 'Bound changes')}
            </Text>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-4 text-xs">
              {diff.map((d) => (
                <li key={`${d.category}.${d.field}`}>
                  {t(
                    'retentionPolicy.boundsProposal.diffRow',
                    '{category}: {field} {from} → {to} ({direction})',
                    {
                      category: d.category,
                      field: d.field,
                      from: d.from,
                      to: d.to,
                      direction: d.direction,
                    },
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {impactPreview.length > 0 && (
          <section>
            <Text className="text-sm font-medium">
              {t(
                'retentionPolicy.boundsProposal.impactHeading',
                'Impact on your stored values',
              )}
            </Text>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-4 text-xs">
              {impactPreview.map((i) => (
                <li key={i.category}>
                  {t(
                    'retentionPolicy.boundsProposal.impactRow',
                    '{category}: {current} will clamp to {clamped}',
                    {
                      category: i.category,
                      current: i.current,
                      clamped: i.willClampTo,
                    },
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {diff.length === 0 && impactPreview.length === 0 && (
          <Text className="text-muted-foreground text-sm">
            {t(
              'retentionPolicy.boundsProposal.detailsEmpty',
              'No detailed changes recorded.',
            )}
          </Text>
        )}
      </Stack>
    </Sheet>
  );
}
