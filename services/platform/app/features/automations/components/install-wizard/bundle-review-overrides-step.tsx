'use client';

/**
 * The BUNDLE install wizard's override-review step — the same confirmation
 * gate `ReviewOverridesStep` runs for a single automation, grouped one collapsible
 * section per member: a bundle install can overwrite files across several
 * members at once, so the operator reviews (and confirms) each member's
 * overrides individually before Next enables. Reuses `OverrideEntriesList`
 * unchanged inside each section — only the per-member grouping is new.
 */
import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { HStack, VStack } from '@tale/ui/layout';
import { useId } from 'react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';

import type { AutomationInstallPreviewEntry } from '../../hooks/use-install-state';
import { OverrideEntriesList } from './review-overrides-step';

export interface BundleMemberOverrides {
  automationSlug: string;
  automationName: string;
  /** This member's own `override`-status entries only. */
  entries: readonly AutomationInstallPreviewEntry[];
}

export function BundleReviewOverridesStep({
  members,
  confirmedAutomations,
  onConfirmedChange,
}: {
  /** Members that have at least one `override` entry. */
  members: readonly BundleMemberOverrides[];
  confirmedAutomations: ReadonlySet<string>;
  onConfirmedChange: (automationSlug: string, confirmed: boolean) => void;
}) {
  const { t } = useT('automations');
  const checkboxIdBase = useId();
  const allConfirmed = members.every((m) =>
    confirmedAutomations.has(m.automationSlug),
  );

  return (
    <WizardStep id="review-overrides" valid={allConfirmed}>
      <VStack gap={4}>
        <Alert
          variant="warning"
          title={t('installWizard.reviewTitle')}
          description={t('installWizard.bundleReviewDescription')}
        />
        {members.map((member) => (
          <CollapsibleDetails
            key={member.automationSlug}
            summary={member.automationName}
            open
          >
            <VStack gap={3} className="pt-2 pl-5">
              <OverrideEntriesList entries={member.entries} />
              <HStack gap={2} align="center">
                <Checkbox
                  id={`${checkboxIdBase}-${member.automationSlug}`}
                  checked={confirmedAutomations.has(member.automationSlug)}
                  onCheckedChange={(checked) =>
                    onConfirmedChange(member.automationSlug, checked === true)
                  }
                />
                <label
                  htmlFor={`${checkboxIdBase}-${member.automationSlug}`}
                  className="text-sm"
                >
                  {t('installWizard.reviewConfirmLabel')}
                </label>
              </HStack>
            </VStack>
          </CollapsibleDetails>
        ))}
      </VStack>
    </WizardStep>
  );
}
