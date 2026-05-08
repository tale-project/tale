'use client';

import { Button } from '@tale/ui/button';
import { useCallback, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { RetentionPolicyConfig } from '@/lib/shared/schemas/governance';
import {
  type RetentionCategory,
  unitForCategory,
} from '@/lib/shared/schemas/retention';

import { useUpsertRetentionPolicy } from '../hooks/mutations';
import type { CategoryBounds } from '../hooks/use-retention-bounds';
import { type CategoryWireMapping, WIRE_MAPPING } from './retention-categories';
import { RetentionForm } from './retention-form';

interface RetentionEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedConfig: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
  organizationId: string;
  cannotManage: boolean;
}

/**
 * Read structured `data` off a Convex error without `instanceof
 * ConvexError`. Vite chunk splitting can produce multiple ConvexError
 * class copies, breaking instanceof — duck-type instead.
 */
function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data is runtime-checked above
  return data as Record<string, unknown>;
}

export function RetentionEditDrawer({
  open,
  onOpenChange,
  savedConfig,
  bounds,
  organizationId,
  cannotManage,
}: RetentionEditDrawerProps) {
  const { t } = useT('governance');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('retentionPolicy.drawer.title', 'Edit retention policy')}
      description={t(
        'retentionPolicy.drawer.description',
        'Configure how long each data type is kept before deletion.',
      )}
      size="md"
    >
      {/* Keyed so each open re-mounts the form with a fresh snapshot of
          `savedConfig`. Re-syncing via useEffect risks racing the Save
          button's closure, the same trap CategoryEditSheet hit. */}
      {open && (
        <RetentionEditFormBody
          key={JSON.stringify(savedConfig)}
          savedConfig={savedConfig}
          bounds={bounds}
          organizationId={organizationId}
          cannotManage={cannotManage}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Sheet>
  );
}

interface RetentionEditFormBodyProps {
  savedConfig: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
  organizationId: string;
  cannotManage: boolean;
  onClose: () => void;
}

function RetentionEditFormBody({
  savedConfig,
  bounds,
  organizationId,
  cannotManage,
  onClose,
}: RetentionEditFormBodyProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const upsertMutation = useUpsertRetentionPolicy();

  const [config, setConfig] = useState(savedConfig);
  const [errors, setErrors] = useState(new Map<RetentionCategory, string>());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const inputDisabled = cannotManage || upsertMutation.isPending;
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

  const handleResetToDefaults = useCallback(() => {
    setConfig((prev) => {
      const next: RetentionPolicyConfig = { ...prev, deletionGraceDays: 30 };
      for (const wire of WIRE_MAPPING) {
        const bound = bounds.get(wire.id);
        if (!bound) continue;
        Object.assign(next, { [wire.configKey]: bound.default });
        if (wire.enabledKey) {
          Object.assign(next, { [wire.enabledKey]: true });
        }
      }
      return next;
    });
    setErrors(new Map());
  }, [bounds]);

  const persist = useCallback(
    async (next: RetentionPolicyConfig) => {
      try {
        await upsertMutation.mutateAsync({ organizationId, config: next });
        setErrors(new Map());
        setConfirmOpen(false);
        toast({
          title: t('toastSavedTitle'),
          description: t('retentionPolicy.saved'),
          variant: 'success',
        });
        onClose();
      } catch (error: unknown) {
        const errData = readConvexErrorData(error);
        const code =
          typeof errData?.code === 'string' ? errData.code : undefined;
        const offending =
          typeof errData?.category === 'string'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- backend RETENTION_BELOW_FLOOR/EXCEEDS_CEILING errors set category to a RetentionCategory value
              (errData.category as RetentionCategory)
            : undefined;
        if (
          (code === 'RETENTION_BELOW_FLOOR' ||
            code === 'RETENTION_EXCEEDS_CEILING') &&
          offending
        ) {
          const bound =
            typeof errData?.bound === 'number' ? errData.bound : null;
          const unit =
            bounds.get(offending)?.unit ?? unitForCategory(offending);
          const msg =
            code === 'RETENTION_BELOW_FLOOR'
              ? t(
                  'retentionPolicy.errors.belowFloor',
                  'Below operator floor (min {bound} {unit}).',
                  { bound: bound ?? '?', unit },
                )
              : t(
                  'retentionPolicy.errors.exceedsCeiling',
                  'Exceeds operator ceiling (max {bound} {unit}).',
                  { bound: bound ?? '?', unit },
                );
          setErrors((prev) => {
            const m = new Map(prev);
            m.set(offending, msg);
            return m;
          });
          setConfirmOpen(false);
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({
          title: t('toastSaveFailedTitle'),
          description: message,
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertMutation, toast, t, bounds, onClose],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 pr-10">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('retentionPolicy.drawer.title', 'Edit retention policy')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t(
            'retentionPolicy.drawer.description',
            'Configure how long each data type is kept before deletion.',
          )}
        </p>
      </div>

      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-6">
          <RetentionForm
            value={config}
            onChange={setConfig}
            bounds={bounds}
            errors={errors}
            inputDisabled={inputDisabled}
          />

          <div className="max-w-xs">
            <Input
              label={t(
                'retentionPolicy.deletionGrace.label',
                'Grace period (days)',
              )}
              type="number"
              value={config.deletionGraceDays ?? 30}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  deletionGraceDays: e.target.value
                    ? Number(e.target.value)
                    : 0,
                }))
              }
              disabled={inputDisabled}
              size="sm"
              min={0}
              max={90}
              description={t(
                'retentionPolicy.deletionGrace.helper',
                '0 = Pass A immediately hard-deletes (no trash window). >0 keeps rows visible in admin Trash for that many days before Pass B physically removes them.',
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t pt-4">
        <Button
          variant="secondary"
          size="sm"
          disabled={inputDisabled}
          onClick={handleResetToDefaults}
        >
          {t('retentionPolicy.reset', 'Reset to defaults')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || inputDisabled}
            onClick={() => setConfirmOpen(true)}
          >
            {t('retentionPolicy.save', 'Save changes')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!upsertMutation.isPending) setConfirmOpen(next);
        }}
        title={t('retentionPolicy.diff.title', 'Confirm retention changes')}
        description={t(
          'retentionPolicy.diff.description',
          'Review the changes before saving. Cleanup applies the new policy on its next run.',
        )}
        confirmText={t('retentionPolicy.diff.confirmLabel', 'Save changes')}
        cancelText={tCommon('actions.cancel')}
        isLoading={upsertMutation.isPending}
        onConfirm={() => void persist(config)}
      >
        <DiffList from={savedConfig} to={config} bounds={bounds} />
      </ConfirmDialog>
    </div>
  );
}

interface DiffEntry {
  i18nKey: string;
  id: string;
  fromText: string;
  toText: string;
}

function DiffList({
  from,
  to,
  bounds,
}: {
  from: RetentionPolicyConfig;
  to: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
}): ReactNode {
  const { t } = useT('governance');
  const entries = computeDiff(from, to, bounds);
  if (entries.length === 0) {
    return (
      <Text className="text-muted-foreground text-sm">
        {t('retentionPolicy.diff.noChanges', 'No changes to save.')}
      </Text>
    );
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
      {entries.map((e) => (
        <li
          key={`${e.id}.${e.fromText}-${e.toText}`}
          className="flex items-baseline justify-between gap-3 font-mono text-xs"
        >
          <span className="text-foreground">
            {t(`retentionPolicy.${e.i18nKey}.title`, e.id)}
          </span>
          <span className="text-muted-foreground">
            {e.fromText} → {e.toText}
          </span>
        </li>
      ))}
    </ul>
  );
}

function computeDiff(
  from: RetentionPolicyConfig,
  to: RetentionPolicyConfig,
  bounds: Map<RetentionCategory, CategoryBounds>,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const wire of WIRE_MAPPING) {
    pushDiffForWire(wire, from, to, bounds, out);
  }
  if ((from.deletionGraceDays ?? 30) !== (to.deletionGraceDays ?? 30)) {
    out.push({
      id: 'deletionGraceDays',
      i18nKey: 'deletionGrace',
      fromText: String(from.deletionGraceDays ?? 30),
      toText: String(to.deletionGraceDays ?? 30),
    });
  }
  return out;
}

function pushDiffForWire(
  wire: CategoryWireMapping,
  from: RetentionPolicyConfig,
  to: RetentionPolicyConfig,
  bounds: Map<RetentionCategory, CategoryBounds>,
  out: DiffEntry[],
): void {
  const bound = bounds.get(wire.id);
  const unit = bound?.unit ?? unitForCategory(wire.id);
  if (wire.enabledKey) {
    const fromEnabled = Boolean(from[wire.enabledKey]);
    const toEnabled = Boolean(to[wire.enabledKey]);
    if (fromEnabled !== toEnabled) {
      out.push({
        id: wire.id,
        i18nKey: wire.i18nKey,
        fromText: fromEnabled ? 'enabled' : 'disabled',
        toText: toEnabled ? 'enabled' : 'disabled',
      });
    }
  }
  const fromVal = from[wire.configKey];
  const toVal = to[wire.configKey];
  if (
    typeof fromVal === 'number' &&
    typeof toVal === 'number' &&
    fromVal !== toVal
  ) {
    out.push({
      id: wire.id,
      i18nKey: wire.i18nKey,
      fromText: `${fromVal} ${unit}`,
      toText: `${toVal} ${unit}`,
    });
  } else if (
    fromVal !== toVal &&
    (typeof fromVal === 'number' || typeof toVal === 'number')
  ) {
    out.push({
      id: wire.id,
      i18nKey: wire.i18nKey,
      fromText: typeof fromVal === 'number' ? `${fromVal} ${unit}` : '—',
      toText: typeof toVal === 'number' ? `${toVal} ${unit}` : '—',
    });
  }
}
