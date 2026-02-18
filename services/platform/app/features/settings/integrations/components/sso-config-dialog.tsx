'use client';

import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

import type {
  PlatformRole,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
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
    hasChanges,
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

  const footer = isConnected ? (
    <>
      <Button
        variant="destructive"
        onClick={handleDisconnect}
        disabled={isSubmitting}
        className="flex-1"
      >
        {isSubmitting
          ? t('integrations.disconnecting')
          : t('integrations.disconnect')}
      </Button>
      <Button
        onClick={handleSave}
        disabled={isSubmitting || !issuer || !clientId || !hasChanges}
        className="flex-1"
      >
        {isSubmitting
          ? t('integrations.sso.updating')
          : t('integrations.sso.update')}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="secondary"
        className="flex-1"
        onClick={() => onOpenChange?.(false)}
      >
        {tCommon('actions.cancel')}
      </Button>
      <Button
        onClick={handleSave}
        className="flex-1"
        disabled={isSubmitting || !issuer || !clientId || !clientSecret}
      >
        {isSubmitting
          ? t('integrations.sso.configuring')
          : t('integrations.sso.configure')}
      </Button>
    </>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('integrations.sso.title')}
      customFooter={footer}
      isSubmitting={isSubmitting}
      large
    >
      {isConnected && (
        <StatusIndicator variant="success">
          {t('integrations.sso.connectedToEntra')}
        </StatusIndicator>
      )}

      <Stack gap={4}>
        <HStack gap={2} align="center" className="bg-muted rounded-md p-3">
          <MicrosoftIcon />
          <span className="text-sm font-medium">Microsoft Entra ID</span>
        </HStack>

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

        <HStack gap={3} align="center">
          <Button
            type="button"
            variant="secondary"
            onClick={handleTest}
            disabled={
              isTesting ||
              isSubmitting ||
              isLoadingConfig ||
              (isConnected ? false : !issuer || !clientId || !clientSecret)
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
        </HStack>

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
      </Stack>
    </FormDialog>
  );
}
