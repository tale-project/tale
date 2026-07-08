'use client';

/**
 * The install wizard's override-review step: shown (immediately before the
 * install step) only when the server preflight found existing org files the
 * install would OVERWRITE. Lists them grouped by localized kind and gates
 * Next on an explicit, labelled confirmation checkbox — the confirmed keys
 * are what `installAutomation` receives as `confirmedOverrides`.
 */
import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useId, useMemo } from 'react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';

import type { AutomationInstallPreviewEntry } from '../../hooks/use-install-state';

/** Stable display order for the grouped kinds. */
const KIND_ORDER = [
  'agent',
  'view',
  'integration',
  'skill',
  'manifest',
  'icon',
  'asset',
] as const;

/**
 * The overridden files, grouped by localized kind — agents/workflows show
 * their slug, everything else its path. Shared between the install wizard's
 * review step and the reinstall-preflight dialog.
 */
export function OverrideEntriesList({
  entries,
}: {
  entries: readonly AutomationInstallPreviewEntry[];
}) {
  const { t } = useT('automations');
  const groups = useMemo(() => {
    const byKind = new Map<string, AutomationInstallPreviewEntry[]>();
    for (const entry of entries) {
      const list = byKind.get(entry.kind) ?? [];
      list.push(entry);
      byKind.set(entry.kind, list);
    }
    const order = (kind: string): number => {
      const idx = (KIND_ORDER as readonly string[]).indexOf(kind);
      return idx === -1 ? KIND_ORDER.length : idx;
    };
    return [...byKind.entries()].sort(([a], [b]) => order(a) - order(b));
  }, [entries]);

  return (
    <VStack gap={3}>
      {groups.map(([kind, kindEntries]) => (
        <VStack key={kind} gap={1}>
          <Text as="span" variant="label" className="text-sm">
            {t(`installWizard.reviewKind.${kind}`)}
          </Text>
          <ul className="list-none space-y-0.5">
            {kindEntries.map((entry) => (
              <li key={`${entry.domain}:${entry.path}`}>
                <Text as="span" variant="muted" className="font-mono text-sm">
                  {kind === 'agent' && entry.slug ? entry.slug : entry.path}
                </Text>
              </li>
            ))}
          </ul>
        </VStack>
      ))}
    </VStack>
  );
}

export function ReviewOverridesStep({
  entries,
  confirmed,
  onConfirmedChange,
}: {
  /** The preflight's `override` entries (what installing would overwrite). */
  entries: readonly AutomationInstallPreviewEntry[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}) {
  const { t } = useT('automations');
  const checkboxId = useId();

  return (
    <WizardStep id="review-overrides" valid={confirmed}>
      <VStack gap={4}>
        <Alert variant="warning" title={t('installWizard.reviewTitle')}>
          <OverrideEntriesList entries={entries} />
        </Alert>
        <HStack gap={2} align="center">
          <Checkbox
            id={checkboxId}
            checked={confirmed}
            onCheckedChange={(checked) => onConfirmedChange(checked === true)}
          />
          <label htmlFor={checkboxId} className="text-sm">
            {t('installWizard.reviewConfirmLabel')}
          </label>
        </HStack>
      </VStack>
    </WizardStep>
  );
}
