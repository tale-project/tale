'use client';

/**
 * The Automations-catalog detail panel — the `IntegrationPanel` twin for a
 * not-yet-installed automation. Opened by a catalog card click (mirrors
 * `Integrations`' card-click → `IntegrationPanel`): a Sheet previewing what
 * installing brings — the bundle's builtin views, workflows, agents, skills,
 * and required integrations (the shared `AutomationContentsList`, with LIVE
 * connect state) — before the operator commits. The footer's Install button
 * opens the EXISTING `AutomationInstallWizard`; its preflight/override-consent
 * flow is reused unchanged, never reimplemented here. Name/description render
 * through `useAutomationDisplay` (the manifest's self-translated `i18n` block),
 * never the raw literals.
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Row, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { UserPen, X } from 'lucide-react';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useAutomationDisplay } from '../hooks/use-automation-text';
import { type AutomationSummary } from '../hooks/use-automations';
import {
  deriveBundleInstallStatus,
  useAutomationInstallActions,
  useAutomationInstallStates,
} from '../hooks/use-install-state';
import { AutomationContentsList } from './automation-contents-list';
import {
  AutomationIcon,
  AutomationLabels,
  AutomationMarker,
} from './automation-icon';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';
import { BundleInstallWizard } from './install-wizard/bundle-install-wizard';

interface AutomationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  automation: AutomationSummary;
  /** A custom (uploaded) automation — earns a "Custom" corner glyph on its icon
   *  tile (built-in catalog automations don't). */
  isCustom: boolean;
}

export function AutomationPanel({
  open,
  onOpenChange,
  organizationId,
  automation,
  isCustom,
}: AutomationPanelProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const display = useAutomationDisplay()(automation);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Flipped once the wizard reports the install committed. Dismissing or
  // finishing the wizard then also closes this preview panel — otherwise it
  // lingers behind the closed wizard with an "Install" button over an
  // already-installed automation (a confusing re-install trap).
  const [installed, setInstalled] = useState(false);
  const handleWizardOpenChange = (next: boolean) => {
    setWizardOpen(next);
    if (!next && installed) onOpenChange(false);
  };
  const isBundle = automation.kind === 'bundle';

  // A bundle carries no install row of its own — its state derives from its
  // members'. Reactive, so the heading and footer flip the moment a wizard
  // commit or an uninstall lands.
  const { bySlug: installStates } = useAutomationInstallStates(organizationId);
  const bundleInstalled =
    isBundle &&
    deriveBundleInstallStatus(automation.members ?? [], installStates) !==
      'not-installed';
  const { uninstallBundle, isPending: uninstallPending } =
    useAutomationInstallActions(organizationId);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const handleUninstallBundle = async () => {
    try {
      await uninstallBundle(automation.slug);
      toast({ title: t('install.bundleUninstalled'), variant: 'success' });
    } catch (error) {
      console.error(error);
      toast({
        title: t('install.bundleUninstallFailed'),
        variant: 'destructive',
      });
    } finally {
      setUninstallOpen(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('panel.title')}
      size="md"
      hideClose
      className="flex flex-col gap-0 overflow-y-hidden p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('panel.title')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        <Stack gap={6}>
          <HStack gap={3} className="items-start">
            {(() => {
              const tile = (
                <Row
                  gap={0}
                  justify="center"
                  className="bg-muted text-muted-foreground size-10 shrink-0 rounded-lg"
                >
                  <AutomationIcon automation={automation} className="size-5" />
                </Row>
              );
              // Same corner-glyph marker the catalog card uses — never a
              // title-row chip.
              return isCustom ? (
                <AutomationMarker
                  icon={UserPen}
                  label={t('custom')}
                  className="shrink-0"
                >
                  {tile}
                </AutomationMarker>
              ) : (
                tile
              );
            })()}
            <VStack gap={1} className="min-w-0">
              <Text as="span" className="text-sm font-medium">
                {display.name}
              </Text>
              <HStack gap={2} className="flex-wrap items-center">
                <Badge variant="slate">
                  {t(
                    automation.scope === 'project'
                      ? 'details.scopeProject'
                      : 'details.scopeOrg',
                  )}
                </Badge>
                <AutomationLabels labels={automation.labels} />
              </HStack>
            </VStack>
          </HStack>

          <Text variant="muted" className="text-sm leading-relaxed">
            {display.description || t('install.notInstalledDescription')}
          </Text>

          <AutomationContentsList
            organizationId={organizationId}
            automation={automation}
            heading={t(
              bundleInstalled
                ? 'panel.whatsInstalled'
                : 'panel.whatWillBeInstalled',
            )}
          />
        </Stack>
      </div>

      <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
        <HStack justify="end" align="center" gap={2}>
          {bundleInstalled ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setUninstallOpen(true)}
                disabled={uninstallPending}
              >
                {t('install.uninstall')}
              </Button>
              <Button onClick={() => setWizardOpen(true)}>
                {t('install.reinstall')}
              </Button>
            </>
          ) : (
            <Button onClick={() => setWizardOpen(true)}>
              {t('panel.install')}
            </Button>
          )}
        </HStack>
      </div>

      {isBundle && (
        <DeleteDialog
          open={uninstallOpen}
          onOpenChange={setUninstallOpen}
          title={t('install.uninstallBundleTitle')}
          description={t('install.uninstallBundleDescription', {
            count: (automation.members ?? []).length,
          })}
          preview={{ primary: display.name }}
          warningTitle={t('install.uninstallWarningTitle')}
          warning={t('install.uninstallWarning')}
          deleteText={t('install.uninstallBundle')}
          isDeleting={uninstallPending}
          onDelete={() => void handleUninstallBundle()}
        >
          {uninstallOpen && (
            <AutomationContentsList
              organizationId={organizationId}
              automation={automation}
              heading={t('install.uninstallContents')}
            />
          )}
        </DeleteDialog>
      )}

      {isBundle ? (
        <BundleInstallWizard
          open={wizardOpen}
          onOpenChange={handleWizardOpenChange}
          onInstalled={() => setInstalled(true)}
          organizationId={organizationId}
          bundleSlug={automation.slug}
          bundleName={display.name}
          scope={automation.scope}
        />
      ) : (
        <AutomationInstallWizard
          open={wizardOpen}
          onOpenChange={handleWizardOpenChange}
          onInstalled={() => setInstalled(true)}
          organizationId={organizationId}
          automationSlug={automation.slug}
          automationName={display.name}
          scope={automation.scope}
          requiredIntegrations={automation.requiredIntegrations}
        />
      )}
    </Sheet>
  );
}
