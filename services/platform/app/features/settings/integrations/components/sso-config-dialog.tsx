'use client';

import { CheckCircle, Loader2, X, XCircle } from 'lucide-react';

import type {
  PlatformRole,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { Badge } from '@/app/components/ui/feedback/badge';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { Center, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { narrowStringUnion } from '@/lib/utils/type-guards';

import { useSsoConfigForm } from '../hooks/use-sso-config-form';
import { RoleMappingSection } from './sso-config/role-mapping-section';

interface SSOConfigDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  existingProvider?: SsoProvider | null;
}

export function SSOConfigDialog({
  open,
  onOpenChange,
  organizationId,
  existingProvider,
}: SSOConfigDialogProps) {
  const {
    t,
    tCommon,
    platformRoles,
    issuer,
    setIssuer,
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    autoProvisionTeam,
    setAutoProvisionTeam,
    excludeGroups,
    setExcludeGroups,
    autoProvisionRole,
    setAutoProvisionRole,
    roleMappingRules,
    defaultRole,
    setDefaultRole,
    enableOneDriveAccess,
    setEnableOneDriveAccess,
    testResult,
    isSubmitting,
    isTesting,
    isLoadingConfig,
    isConnected,
    handleSave,
    handleDisconnect,
    handleTest,
    addMappingRule,
    removeMappingRule,
    updateMappingRule,
  } = useSsoConfigForm({
    open,
    onOpenChange,
    organizationId,
    existingProvider,
  });

  const isFormValid = isConnected
    ? !!issuer?.trim() && !!clientId?.trim()
    : !!issuer?.trim() && !!clientId?.trim() && !!clientSecret?.trim();

  const panelTitle = isConnected
    ? t('integrations.panel.integrationDetails')
    : t('integrations.panel.addIntegration');

  const handleClose = () => {
    if (!isSubmitting) onOpenChange?.(false);
  };

  return (
    <Sheet
      open={open ?? false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return;
        onOpenChange?.(nextOpen);
      }}
      title={t('integrations.sso.title')}
      size="md"
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b px-6 py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {panelTitle}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={handleClose}
        />
      </HStack>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Stack gap={4}>
          <HStack gap={3} align="center">
            <Center className="border-border size-10 rounded-md border">
              <MicrosoftIcon className="size-5" />
            </Center>
            <Stack gap={1}>
              <Text variant="label">{t('integrations.sso.name')}</Text>
              {isConnected ? (
                <Badge variant="green" dot>
                  {t('integrations.badge.connected')}
                </Badge>
              ) : (
                <Badge variant="outline">
                  {t('integrations.badge.connect')}
                </Badge>
              )}
            </Stack>
          </HStack>

          <Text variant="muted" className="text-sm leading-relaxed">
            {t('integrations.sso.description')}
          </Text>

          {isConnected && (
            <StatusIndicator variant="success">
              {t('integrations.sso.connectedToEntra')}
            </StatusIndicator>
          )}

          <FormSection>
            <Input
              id="sso-issuer"
              label={t('integrations.sso.issuerLabel')}
              description={t('integrations.sso.issuerHelp')}
              placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              disabled={isSubmitting || isLoadingConfig}
            />

            <Input
              id="sso-client-id"
              label={t('integrations.sso.clientIdLabel')}
              description={t('integrations.sso.clientIdHelp')}
              placeholder={
                isLoadingConfig
                  ? tCommon('actions.loading')
                  : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
              }
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={isSubmitting || isLoadingConfig}
            />

            <Input
              id="sso-client-secret"
              type="password"
              label={t('integrations.sso.clientSecretLabel')}
              description={t('integrations.sso.clientSecretHelp')}
              placeholder={isConnected ? '••••••••••••••••' : ''}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={isSubmitting || isLoadingConfig}
            />

            <ActionRow gap={3}>
              <Button
                type="button"
                variant="secondary"
                onClick={handleTest}
                disabled={
                  isTesting || isSubmitting || isLoadingConfig || !isFormValid
                }
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('integrations.sso.testing')}
                  </>
                ) : (
                  t('integrations.sso.testConnection')
                )}
              </Button>
              {testResult && (
                <HStack gap={1} align="center">
                  {testResult.valid ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-600">
                        {t('integrations.sso.testPassed')}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm text-red-600">
                        {t('integrations.sso.testFailed')}
                      </span>
                    </>
                  )}
                </HStack>
              )}
            </ActionRow>

            <Switch
              id="onedrive-access-toggle"
              label={t('integrations.sso.oneDriveAccessLabel')}
              description={t('integrations.sso.oneDriveAccessHelp')}
              checked={enableOneDriveAccess}
              onCheckedChange={setEnableOneDriveAccess}
              disabled={isSubmitting || isLoadingConfig}
            />

            <Switch
              id="auto-provision-team-toggle"
              label={t('integrations.sso.autoProvisionTeamLabel')}
              description={t('integrations.sso.autoProvisionTeamHelp')}
              checked={autoProvisionTeam}
              onCheckedChange={setAutoProvisionTeam}
              disabled={isSubmitting || isLoadingConfig}
            />

            {autoProvisionTeam && (
              <Input
                id="sso-exclude-groups"
                label={t('integrations.sso.excludeGroupsLabel')}
                description={t('integrations.sso.excludeGroupsHelp')}
                placeholder="All-Employees, Domain-Users"
                value={excludeGroups}
                onChange={(e) => setExcludeGroups(e.target.value)}
                disabled={isSubmitting || isLoadingConfig}
              />
            )}

            <Switch
              id="auto-provision-role-toggle"
              label={t('integrations.sso.autoProvisionRoleLabel')}
              description={t('integrations.sso.autoProvisionRoleHelp')}
              checked={autoProvisionRole}
              onCheckedChange={setAutoProvisionRole}
              disabled={isSubmitting || isLoadingConfig}
            />

            {autoProvisionRole && (
              <RoleMappingSection
                rules={roleMappingRules}
                platformRoles={platformRoles}
                disabled={isSubmitting || isLoadingConfig}
                onAdd={addMappingRule}
                onRemove={removeMappingRule}
                onUpdate={updateMappingRule}
              />
            )}

            <Select
              value={defaultRole}
              onValueChange={(value) => {
                const narrowed = narrowStringUnion<PlatformRole>(value, [
                  'admin',
                  'developer',
                  'editor',
                  'member',
                  'disabled',
                ] as const);
                if (narrowed) {
                  setDefaultRole(narrowed);
                }
              }}
              disabled={isSubmitting || isLoadingConfig}
              id="default-role-select"
              label={t('integrations.sso.defaultRoleLabel')}
              description={
                autoProvisionRole
                  ? t('integrations.sso.defaultRoleHelp')
                  : t('integrations.sso.defaultRoleHelpNoAutoProvision')
              }
              className="w-48"
              options={platformRoles}
            />
          </FormSection>
        </Stack>
      </div>

      <div className="border-border shrink-0 border-t px-6 py-4">
        {isConnected ? (
          <HStack justify="between" align="center">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isSubmitting}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting
                ? t('integrations.disconnecting')
                : t('integrations.disconnect')}
            </button>
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !isFormValid}
            >
              {isSubmitting
                ? t('integrations.sso.updating')
                : t('integrations.panel.saveChanges')}
            </Button>
          </HStack>
        ) : (
          <HStack justify="end" align="center" gap={3}>
            <button
              type="button"
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {tCommon('actions.cancel')}
            </button>
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !isFormValid}
            >
              {isSubmitting
                ? t('integrations.sso.configuring')
                : t('integrations.panel.connectName', {
                    name: t('integrations.sso.name'),
                  })}
            </Button>
          </HStack>
        )}
      </div>
    </Sheet>
  );
}
