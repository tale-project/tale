'use client';

/**
 * Reinstall with preflight — the one reinstall flow every surface shares (the
 * lifecycle ⋯ menu, the broken-install banner, the invalid-view repair
 * button): run the server preflight first, show a confirm dialog that EMBEDS
 * the list of files the reinstall would overwrite (checkbox-gated when any
 * exist), then reinstall with those overrides confirmed. A race — the disk
 * changing between preview and confirm — rejects server-side with
 * `AUTOMATION_INSTALL_OVERRIDES` and surfaces as a destructive toast; the dialog
 * stays open for a fresh look.
 */
import { Checkbox } from '@tale/ui/checkbox';
import { HStack, VStack } from '@tale/ui/layout';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { OverrideEntriesList } from '../components/install-wizard/review-overrides-step';
import {
  type AutomationInstallPreview,
  isInstallOverridesError,
  useAutomationInstallActions,
} from './use-install-state';

export function useReinstallWithPreflight(
  organizationId: string,
  onReinstalled?: () => void,
): {
  /** Preflight the automation, then open the confirm dialog. */
  requestReinstall: (automationSlug: string) => Promise<void>;
  /** Render this once near the trigger — the shared confirm dialog. */
  dialog: ReactNode;
  isPending: boolean;
} {
  const { t } = useT('automations');
  const { preview, reinstall, isPending } =
    useAutomationInstallActions(organizationId);
  const [target, setTarget] = useState<{
    automationSlug: string;
    preview: AutomationInstallPreview;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const checkboxId = useId();

  const requestReinstall = useCallback(
    async (automationSlug: string) => {
      let result: AutomationInstallPreview = { entries: [], overrides: [] };
      try {
        result = await preview(automationSlug);
      } catch (err) {
        // Degrade to an unlisted confirm — the server re-checks overrides on
        // the reinstall itself, so nothing is silently overwritten.
        console.warn('[useReinstallWithPreflight] preview failed:', err);
      }
      setConfirmed(false);
      setTarget({ automationSlug, preview: result });
    },
    [preview],
  );

  const overrideEntries = useMemo(
    () =>
      (target?.preview.entries ?? []).filter((e) => e.status === 'override'),
    [target],
  );
  const hasOverrides = overrideEntries.length > 0;

  const handleConfirm = useCallback(async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await reinstall(
        target.automationSlug,
        hasOverrides && confirmed ? target.preview.overrides : undefined,
      );
      toast({ title: t('install.reinstalled'), variant: 'success' });
      setTarget(null);
      onReinstalled?.();
    } catch (error) {
      if (isInstallOverridesError(error)) {
        // The disk changed since the preview — stale confirmation. Keep the
        // dialog open; re-requesting refreshes the list.
        toast({
          title: t('installWizard.overridesChanged'),
          variant: 'destructive',
        });
      } else {
        console.error(error);
        toast({ title: t('install.reinstallFailed'), variant: 'destructive' });
        setTarget(null);
      }
    } finally {
      setBusy(false);
    }
  }, [target, busy, reinstall, hasOverrides, confirmed, onReinstalled, t]);

  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
      title={t('install.reinstallOverridesTitle')}
      description={
        hasOverrides
          ? t('install.reinstallOverridesDescription')
          : t('install.reinstallOverridesNoChanges')
      }
      confirmText={t('install.reinstall')}
      isLoading={busy}
      disableConfirm={hasOverrides && !confirmed}
      onConfirm={() => void handleConfirm()}
    >
      {hasOverrides && (
        <VStack gap={4} className="mt-2">
          <OverrideEntriesList entries={overrideEntries} />
          <HStack gap={2} align="center">
            <Checkbox
              id={checkboxId}
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
            />
            <label htmlFor={checkboxId} className="text-sm">
              {t('installWizard.reviewConfirmLabel')}
            </label>
          </HStack>
        </VStack>
      )}
    </ConfirmDialog>
  );

  return { requestReinstall, dialog, isPending: isPending || busy };
}
