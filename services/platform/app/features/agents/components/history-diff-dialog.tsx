'use client';

import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

interface HistoryDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: AgentJsonConfig;
  snapshotConfig: AgentJsonConfig;
  snapshotDate: string;
  isRestoring: boolean;
  onRestore: () => void;
}

type ChangeType = 'modified' | 'added' | 'removed';

interface FieldChange {
  field: string;
  type: ChangeType;
  oldValue?: unknown;
  newValue?: unknown;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') {
    if (value.length > 80) return `"${value.slice(0, 80)}…"`;
    return `"${value}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length <= 3)
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[${value
      .slice(0, 3)
      .map((v) => JSON.stringify(v))
      .join(', ')}, …+${value.length - 3}]`;
  }
  return JSON.stringify(value);
}

function toRecord(config: AgentJsonConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config));
}

function computeChanges(
  currentConfig: AgentJsonConfig,
  snapshotConfig: AgentJsonConfig,
): FieldChange[] {
  const current = toRecord(currentConfig);
  const snapshot = toRecord(snapshotConfig);
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(current), ...Object.keys(snapshot)]);

  for (const key of allKeys) {
    const inCurrent = key in current;
    const inSnapshot = key in snapshot;
    const currentVal = current[key];
    const snapshotVal = snapshot[key];

    if (inCurrent && inSnapshot) {
      if (JSON.stringify(currentVal) !== JSON.stringify(snapshotVal)) {
        changes.push({
          field: key,
          type: 'modified',
          oldValue: currentVal,
          newValue: snapshotVal,
        });
      }
    } else if (inSnapshot && !inCurrent) {
      changes.push({ field: key, type: 'added', newValue: snapshotVal });
    } else if (inCurrent && !inSnapshot) {
      changes.push({ field: key, type: 'removed', oldValue: currentVal });
    }
  }

  return changes;
}

export function HistoryDiffDialog({
  open,
  onOpenChange,
  currentConfig,
  snapshotConfig,
  snapshotDate,
  isRestoring,
  onRestore,
}: HistoryDiffDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();

  const formattedDate = useMemo(
    () => formatDate(new Date(snapshotDate), 'long'),
    [snapshotDate, formatDate],
  );

  const changes = useMemo(
    () => computeChanges(currentConfig, snapshotConfig),
    [currentConfig, snapshotConfig],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('agents.history.diffTitle')}
      description={t('agents.history.diffDescription', {
        date: formattedDate,
      })}
      size="wide"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isRestoring}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onRestore}
            disabled={isRestoring || changes.length === 0}
          >
            {isRestoring
              ? tCommon('actions.loading')
              : t('agents.history.restore')}
          </Button>
        </div>
      }
    >
      {changes.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          {t('agents.history.noDifferences')}
        </p>
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-3 py-2 text-left font-medium">
                  {t('agents.history.field')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('agents.history.current')}
                </th>
                <th className="w-8 px-1 py-2" />
                <th className="px-3 py-2 text-left font-medium">
                  {t('agents.history.snapshot')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {changes.map((change) => (
                <tr key={change.field}>
                  <td className="text-muted-foreground px-3 py-2 font-mono">
                    {change.field}
                  </td>
                  <td className="text-foreground/70 max-w-[200px] truncate px-3 py-2 font-mono">
                    {change.type === 'added'
                      ? '—'
                      : formatValue(change.oldValue)}
                  </td>
                  <td className="text-muted-foreground px-1 py-2 text-center">
                    <ArrowRight className="inline size-3.5" />
                  </td>
                  <td className="text-foreground max-w-[200px] truncate px-3 py-2 font-mono">
                    {change.type === 'removed'
                      ? '—'
                      : formatValue(change.newValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
