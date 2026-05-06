'use client';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface Props {
  /** Days a row stays in the trash bucket before Pass B physically deletes it. */
  graceDays: number;
}

/**
 * Phase 13 — three-step lifecycle visualisation:
 *   Day 0 (active) → Day N (trashed/expired) → permanent (cascade)
 *
 * The middle stop's day count is driven by `graceDays`. `graceDays === 0`
 * collapses the trash window — Pass A immediately hard-deletes — so the
 * middle stop renders as "(no grace window)" in that case.
 */
export function RetentionTimeline({ graceDays }: Props) {
  const { t } = useT('governance');
  const noGrace = graceDays <= 0;

  return (
    <div
      role="img"
      aria-label={t(
        'retentionPolicy.timeline.ariaLabel',
        'Deletion lifecycle visualization',
      )}
      className="flex flex-col gap-3"
    >
      <div className="relative flex items-start justify-between">
        <Step
          label={t('retentionPolicy.timeline.activeLabel', 'Active')}
          sub={t(
            'retentionPolicy.timeline.activeSub',
            'Visible, fully accessible',
          )}
          tone="active"
        />
        <Connector
          tone={noGrace ? 'collapsed' : 'grace'}
          dashed={noGrace}
          label={
            noGrace
              ? t(
                  'retentionPolicy.timeline.noGraceConnector',
                  'no grace window',
                )
              : t(
                  'retentionPolicy.timeline.graceConnector',
                  'after retention window',
                )
          }
        />
        <Step
          label={
            noGrace
              ? t('retentionPolicy.timeline.skipTrashLabel', 'Skipped')
              : t('retentionPolicy.timeline.trashedLabel', 'Trashed / Expired')
          }
          sub={
            noGrace
              ? t('retentionPolicy.timeline.skipTrashSub', 'graceDays = 0')
              : t(
                  'retentionPolicy.timeline.trashedSub',
                  '{days}-day grace, restorable',
                  { days: graceDays },
                )
          }
          tone={noGrace ? 'inert' : 'trash'}
        />
        <Connector
          tone="cascade"
          label={t(
            'retentionPolicy.timeline.cascadeConnector',
            'cascade delete',
          )}
        />
        <Step
          label={t(
            'retentionPolicy.timeline.permanentLabel',
            'Permanently deleted',
          )}
          sub={t(
            'retentionPolicy.timeline.permanentSub',
            'Row + descendants gone',
          )}
          tone="permanent"
        />
      </div>
    </div>
  );
}

interface StepProps {
  label: string;
  sub: string;
  tone: 'active' | 'trash' | 'permanent' | 'inert';
}

function Step({ label, sub, tone }: StepProps) {
  return (
    <div className="flex w-32 flex-col items-center gap-1 text-center">
      <div
        className={cn(
          'h-3 w-3 rounded-full ring-2 ring-offset-2 ring-offset-background',
          tone === 'active' && 'bg-success ring-success/30',
          tone === 'trash' && 'bg-warning ring-warning/30',
          tone === 'permanent' && 'bg-destructive ring-destructive/30',
          tone === 'inert' && 'bg-muted ring-muted/30',
        )}
        aria-hidden="true"
      />
      <Text className="text-xs font-medium">{label}</Text>
      <Text className="text-muted-foreground text-[0.65rem] leading-tight">
        {sub}
      </Text>
    </div>
  );
}

interface ConnectorProps {
  tone: 'grace' | 'cascade' | 'collapsed';
  label: string;
  dashed?: boolean;
}

function Connector({ tone, label, dashed }: ConnectorProps) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 pt-1">
      <div
        aria-hidden="true"
        className={cn(
          'h-0.5 w-full',
          dashed ? 'border-t border-dashed border-current' : '',
          tone === 'grace' && 'bg-warning/40',
          tone === 'cascade' && 'bg-destructive/40',
          tone === 'collapsed' && 'border-muted-foreground/40 bg-transparent',
        )}
      />
      <Text className="text-muted-foreground text-[0.65rem] leading-tight">
        {label}
      </Text>
    </div>
  );
}
