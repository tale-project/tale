'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Center, HStack, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { CheckCircle, KeyRound, Loader2, X, XCircle } from 'lucide-react';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import type {
  PlatformRole,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';
import { narrowStringUnion } from '@/lib/utils/type-guards';

import {
  type SsoProviderType,
  useSsoConfigForm,
} from '../hooks/use-sso-config-form';
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
    providerType,
    setProviderType,
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
    emailClaim,
    setEmailClaim,
    nameClaim,
    setNameClaim,
    groupsClaim,
    setGroupsClaim,
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

  const isGeneric = providerType === 'generic-oidc';

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
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        <Stack gap={4}>
          <HStack gap={3} align="center">
            <Center className="border-border size-10 rounded-md border">
              {isGeneric ? (
                <KeyRound className="size-5" />
              ) : (
                <MicrosoftIcon className="size-5" />
              )}
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
            {isGeneric
              ? t('integrations.sso.descriptionGeneric')
              : t('integrations.sso.description')}
          </Text>

          {isConnected && (
            <StatusIndicator variant="success">
              {isGeneric
                ? t('integrations.sso.connectedToGeneric')
                : t('integrations.sso.connectedToEntra')}
            </StatusIndicator>
          )}

          <FormSection>
            <Select
              id="sso-provider-type"
              label={t('integrations.sso.providerTypeLabel')}
              description={t('integrations.sso.providerTypeHelp')}
              value={providerType}
              onValueChange={(value) => {
                const narrowed = narrowStringUnion<SsoProviderType>(value, [
                  'entra-id',
                  'generic-oidc',
                ] as const);
                if (narrowed) {
                  setProviderType(narrowed);
                }
              }}
              disabled={isSubmitting || isLoadingConfig || isConnected}
              options={[
                {
                  value: 'entra-id',
                  label: t('integrations.sso.providerTypeEntra'),
                },
                {
                  value: 'generic-oidc',
                  label: t('integrations.sso.providerTypeGeneric'),
                },
              ]}
            />

            <Input
              id="sso-issuer"
              label={t('integrations.sso.issuerLabel')}
              description={
                isGeneric
                  ? t('integrations.sso.issuerHelpGeneric')
                  : t('integrations.sso.issuerHelp')
              }
              placeholder={
                isGeneric
                  ? 'https://idp.example.com'
                  : 'https://login.microsoftonline.com/{tenant-id}/v2.0'
              }
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              disabled={isSubmitting || isLoadingConfig}
            />

            <Input
              id="sso-client-id"
              label={t('integrations.sso.clientIdLabel')}
              description={
                isGeneric
                  ? t('integrations.sso.clientIdHelpGeneric')
                  : t('integrations.sso.clientIdHelp')
              }
              placeholder={
                isLoadingConfig
                  ? tCommon('actions.loading')
                  : isGeneric
                    ? 'your-client-id'
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
              description={
                isGeneric
                  ? t('integrations.sso.clientSecretHelpGeneric')
                  : t('integrations.sso.clientSecretHelp')
              }
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

            {!isGeneric && (
              <Switch
                id="onedrive-access-toggle"
                label={t('integrations.sso.oneDriveAccessLabel')}
                description={t('integrations.sso.oneDriveAccessHelp')}
                checked={enableOneDriveAccess}
                onCheckedChange={setEnableOneDriveAccess}
                disabled={isSubmitting || isLoadingConfig}
              />
            )}

            {isGeneric && (
              <>
                <Input
                  id="sso-email-claim"
                  label={t('integrations.sso.emailClaimLabel')}
                  description={t('integrations.sso.emailClaimHelp')}
                  placeholder="email"
                  value={emailClaim}
                  onChange={(e) => setEmailClaim(e.target.value)}
                  disabled={isSubmitting || isLoadingConfig}
                />

                <Input
                  id="sso-name-claim"
                  label={t('integrations.sso.nameClaimLabel')}
                  description={t('integrations.sso.nameClaimHelp')}
                  placeholder="name"
                  value={nameClaim}
                  onChange={(e) => setNameClaim(e.target.value)}
                  disabled={isSubmitting || isLoadingConfig}
                />

                <Input
                  id="sso-groups-claim"
                  label={t('integrations.sso.groupsClaimLabel')}
                  description={t('integrations.sso.groupsClaimHelp')}
                  placeholder="groups"
                  value={groupsClaim}
                  onChange={(e) => setGroupsClaim(e.target.value)}
                  disabled={isSubmitting || isLoadingConfig}
                />
              </>
            )}

            <Switch
              id="auto-provision-team-toggle"
              label={t('integrations.sso.autoProvisionTeamLabel')}
              description={
                isGeneric
                  ? t('integrations.sso.autoProvisionTeamHelpGeneric')
                  : t('integrations.sso.autoProvisionTeamHelp')
              }
              checked={autoProvisionTeam}
              onCheckedChange={setAutoProvisionTeam}
              disabled={isSubmitting || isLoadingConfig}
            />

            {autoProvisionTeam && (
              <Input
                id="sso-exclude-groups"
                label={t('integrations.sso.excludeGroupsLabel')}
                description={
                  isGeneric
                    ? t('integrations.sso.excludeGroupsHelpGeneric')
                    : t('integrations.sso.excludeGroupsHelp')
                }
                placeholder="All-Employees, Domain-Users"
                value={excludeGroups}
                onChange={(e) => setExcludeGroups(e.target.value)}
                disabled={isSubmitting || isLoadingConfig}
              />
            )}

            <Switch
              id="auto-provision-role-toggle"
              label={t('integrations.sso.autoProvisionRoleLabel')}
              description={
                isGeneric
                  ? t('integrations.sso.autoProvisionRoleHelpGeneric')
                  : t('integrations.sso.autoProvisionRoleHelp')
              }
              checked={autoProvisionRole}
              onCheckedChange={setAutoProvisionRole}
              disabled={isSubmitting || isLoadingConfig}
            />

            {autoProvisionRole && (
              <RoleMappingSection
                rules={roleMappingRules}
                platformRoles={platformRoles}
                providerType={providerType}
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

      <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
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
