'use client';

import { useAction } from 'convex/react';
import { CheckCircle, XCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';

import type {
  PlatformRole,
  RoleMappingRule,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Description } from '@/app/components/ui/forms/description';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface SSOConfigDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  existingProvider?: SsoProvider | null;
}

const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/GroupMember.Read.All',
  'https://graph.microsoft.com/Files.Read',
];

const DEFAULT_MAPPING_RULES: RoleMappingRule[] = [
  { source: 'jobTitle', pattern: '*admin*', targetRole: 'admin' },
  { source: 'jobTitle', pattern: '*manager*', targetRole: 'admin' },
  { source: 'jobTitle', pattern: '*developer*', targetRole: 'developer' },
  { source: 'jobTitle', pattern: '*engineer*', targetRole: 'developer' },
  { source: 'jobTitle', pattern: '*editor*', targetRole: 'editor' },
];

export function SSOConfigDialog({
  open,
  onOpenChange,
  organizationId,
  existingProvider,
}: SSOConfigDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const platformRoles = useMemo(
    () => [
      {
        value: 'admin' as PlatformRole,
        label: t('integrations.sso.roleAdmin'),
      },
      {
        value: 'developer' as PlatformRole,
        label: t('integrations.sso.roleDeveloper'),
      },
      {
        value: 'editor' as PlatformRole,
        label: t('integrations.sso.roleEditor'),
      },
      {
        value: 'member' as PlatformRole,
        label: t('integrations.sso.roleMember'),
      },
      {
        value: 'disabled' as PlatformRole,
        label: t('integrations.sso.roleDisabled'),
      },
    ],
    [t],
  );

  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoProvisionTeam, setAutoProvisionTeam] = useState(true);
  const [excludeGroups, setExcludeGroups] = useState('');
  const [autoProvisionRole, setAutoProvisionRole] = useState(true);
  const [roleMappingRules, setRoleMappingRules] = useState<RoleMappingRule[]>(
    DEFAULT_MAPPING_RULES,
  );
  const [defaultRole, setDefaultRole] = useState<PlatformRole>('member');
  const [enableOneDriveAccess, setEnableOneDriveAccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  const originalConfigRef = useRef<{
    issuer: string;
    clientId: string;
    autoProvisionTeam: boolean;
    excludeGroups: string;
    autoProvisionRole: boolean;
    roleMappingRules: RoleMappingRule[];
    defaultRole: PlatformRole;
    enableOneDriveAccess: boolean;
  } | null>(null);

  const upsertSSOProvider = useAction(api.sso_providers.actions.upsert);
  const removeSSOProvider = useAction(api.sso_providers.actions.remove);
  const getFullConfig = useAction(api.sso_providers.actions.getWithClientId);
  const testSSOConfig = useAction(api.sso_providers.actions.testConfig);
  const testExistingSSOConfig = useAction(
    api.sso_providers.actions.testExistingConfig,
  );

  const isConnected = !!existingProvider;

  const hasChanges = useMemo(() => {
    if (clientSecret) return true;
    if (!originalConfigRef.current) return false;

    const orig = originalConfigRef.current;
    const basicFieldsChanged =
      issuer !== orig.issuer ||
      clientId !== orig.clientId ||
      autoProvisionTeam !== orig.autoProvisionTeam ||
      excludeGroups !== orig.excludeGroups ||
      autoProvisionRole !== orig.autoProvisionRole ||
      defaultRole !== orig.defaultRole ||
      enableOneDriveAccess !== orig.enableOneDriveAccess;

    if (basicFieldsChanged) return true;
    if (roleMappingRules.length !== orig.roleMappingRules.length) return true;

    return roleMappingRules.some((curr, i) => {
      const origRule = orig.roleMappingRules[i];
      return (
        curr.source !== origRule.source ||
        curr.pattern !== origRule.pattern ||
        curr.targetRole !== origRule.targetRole
      );
    });
  }, [
    issuer,
    clientId,
    clientSecret,
    autoProvisionTeam,
    excludeGroups,
    autoProvisionRole,
    roleMappingRules,
    defaultRole,
    enableOneDriveAccess,
  ]);

  useEffect(() => {
    if (open && existingProvider) {
      setIsLoadingConfig(true);
      getFullConfig({})
        .then((config) => {
          if (config) {
            const entraFeatures = config.providerFeatures?.entraId;
            const excludeGroupsStr = (entraFeatures?.excludeGroups || []).join(
              ', ',
            );
            const rules =
              config.roleMappingRules.length > 0
                ? (config.roleMappingRules as RoleMappingRule[]).filter(
                    (r) => r.source === 'jobTitle' || r.source === 'appRole',
                  )
                : DEFAULT_MAPPING_RULES;
            setIssuer(config.issuer);
            setClientId(config.clientId);
            setAutoProvisionTeam(entraFeatures?.autoProvisionTeam ?? false);
            setExcludeGroups(excludeGroupsStr);
            setAutoProvisionRole(config.autoProvisionRole);
            setRoleMappingRules(rules);
            setDefaultRole(config.defaultRole);
            setEnableOneDriveAccess(
              entraFeatures?.enableOneDriveAccess ?? false,
            );
            originalConfigRef.current = {
              issuer: config.issuer,
              clientId: config.clientId,
              autoProvisionTeam: entraFeatures?.autoProvisionTeam ?? false,
              excludeGroups: excludeGroupsStr,
              autoProvisionRole: config.autoProvisionRole,
              roleMappingRules: rules,
              defaultRole: config.defaultRole,
              enableOneDriveAccess:
                entraFeatures?.enableOneDriveAccess ?? false,
            };
          }
          setClientSecret('');
        })
        .catch((error) => {
          console.error('Failed to load SSO config:', error);
          toast({
            title: t('integrations.sso.configureFailed'),
            description: t('integrations.sso.configureError'),
            variant: 'destructive',
          });
        })
        .finally(() => {
          setIsLoadingConfig(false);
        });
    } else if (!existingProvider) {
      setIssuer('');
      setClientId('');
      setClientSecret('');
      setAutoProvisionTeam(true);
      setExcludeGroups('');
      setAutoProvisionRole(true);
      setRoleMappingRules(DEFAULT_MAPPING_RULES);
      setDefaultRole('member');
      setEnableOneDriveAccess(false);
    }
    setTestResult(null);
  }, [existingProvider, open, getFullConfig, t]);

  const handleSave = async () => {
    const requiresSecret = !isConnected;
    if (!issuer || !clientId || (requiresSecret && !clientSecret)) {
      toast({
        title: t('integrations.sso.validationError'),
        description: t('integrations.sso.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await upsertSSOProvider({
        organizationId,
        providerId: 'entra-id',
        issuer,
        clientId,
        clientSecret,
        scopes: DEFAULT_SCOPES,
        autoProvisionRole,
        roleMappingRules,
        defaultRole,
        providerFeatures: {
          entraId: {
            enableOneDriveAccess,
            autoProvisionTeam,
            excludeGroups: excludeGroups
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean),
          },
        },
      });

      toast({
        title: isConnected
          ? t('integrations.sso.updateSuccessful')
          : t('integrations.sso.configureSuccessful'),
        description: t('integrations.sso.ssoConfigured'),
        variant: 'success',
      });

      onOpenChange?.(false);
    } catch (error) {
      toast({
        title: t('integrations.sso.configureFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.sso.configureError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSubmitting(true);
    try {
      await removeSSOProvider({ organizationId });

      toast({
        title: t('integrations.sso.disconnected'),
        description: t('integrations.sso.ssoDisconnected'),
      });

      onOpenChange?.(false);
    } catch (error) {
      toast({
        title: t('integrations.sso.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.sso.disconnectError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTest = async () => {
    const useExistingConfig = isConnected && !clientSecret;

    if (!useExistingConfig && (!issuer || !clientId || !clientSecret)) {
      toast({
        title: t('integrations.sso.validationError'),
        description: t('integrations.sso.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = useExistingConfig
        ? await testExistingSSOConfig({})
        : await testSSOConfig({
            issuer,
            clientId,
            clientSecret,
          });

      setTestResult(result);

      if (result.valid) {
        toast({
          title: t('integrations.sso.testSuccessful'),
          description: t('integrations.sso.testSuccessfulDescription'),
          variant: 'success',
        });
      } else {
        toast({
          title: t('integrations.sso.testFailed'),
          description:
            result.error || t('integrations.sso.testFailedDescription'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      setTestResult({
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : t('integrations.sso.testError'),
      });
      toast({
        title: t('integrations.sso.testFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.sso.testError'),
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const addMappingRule = () => {
    setRoleMappingRules([
      ...roleMappingRules,
      { source: 'jobTitle', pattern: '', targetRole: 'member' },
    ]);
  };

  const removeMappingRule = (index: number) => {
    setRoleMappingRules(roleMappingRules.filter((_, i) => i !== index));
  };

  const updateMappingRule = (
    index: number,
    updates: Partial<RoleMappingRule>,
  ) => {
    setRoleMappingRules(
      roleMappingRules.map((rule, i) =>
        i === index ? { ...rule, ...updates } : rule,
      ),
    );
  };

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
        variant="outline"
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

        <Stack gap={3}>
          <Input
            id="sso-issuer"
            label={t('integrations.sso.issuerLabel')}
            placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={isSubmitting || isLoadingConfig}
          />
          <Description className="text-xs">
            {t('integrations.sso.issuerHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <Input
            id="sso-client-id"
            label={t('integrations.sso.clientIdLabel')}
            placeholder={
              isLoadingConfig
                ? tCommon('actions.loading')
                : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
            }
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isSubmitting || isLoadingConfig}
          />
          <Description className="text-xs">
            {t('integrations.sso.clientIdHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <Input
            id="sso-client-secret"
            type="password"
            label={t('integrations.sso.clientSecretLabel')}
            placeholder={isConnected ? '••••••••••••••••' : ''}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={isSubmitting || isLoadingConfig}
          />
          <Description className="text-xs">
            {t('integrations.sso.clientSecretHelp')}
          </Description>
        </Stack>

        <HStack gap={3} align="center">
          <Button
            type="button"
            variant="outline"
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

        <Stack gap={3}>
          <HStack justify="between" className="py-2">
            <Label htmlFor="onedrive-access-toggle">
              {t('integrations.sso.oneDriveAccessLabel')}
            </Label>
            <Switch
              id="onedrive-access-toggle"
              checked={enableOneDriveAccess}
              onCheckedChange={setEnableOneDriveAccess}
              disabled={isSubmitting || isLoadingConfig}
            />
          </HStack>
          <Description className="text-xs">
            {t('integrations.sso.oneDriveAccessHelp')}
          </Description>
        </Stack>

        <Stack gap={3}>
          <HStack justify="between" className="py-2">
            <Label htmlFor="auto-provision-team-toggle">
              {t('integrations.sso.autoProvisionTeamLabel')}
            </Label>
            <Switch
              id="auto-provision-team-toggle"
              checked={autoProvisionTeam}
              onCheckedChange={setAutoProvisionTeam}
              disabled={isSubmitting || isLoadingConfig}
            />
          </HStack>
          <Description className="text-xs">
            {t('integrations.sso.autoProvisionTeamHelp')}
          </Description>
        </Stack>

        {autoProvisionTeam && (
          <Stack gap={3}>
            <Input
              id="sso-exclude-groups"
              label={t('integrations.sso.excludeGroupsLabel')}
              placeholder="All-Employees, Domain-Users"
              value={excludeGroups}
              onChange={(e) => setExcludeGroups(e.target.value)}
              disabled={isSubmitting || isLoadingConfig}
            />
            <Description className="text-xs">
              {t('integrations.sso.excludeGroupsHelp')}
            </Description>
          </Stack>
        )}

        <Stack gap={3}>
          <HStack justify="between" className="py-2">
            <Label htmlFor="auto-provision-role-toggle">
              {t('integrations.sso.autoProvisionRoleLabel')}
            </Label>
            <Switch
              id="auto-provision-role-toggle"
              checked={autoProvisionRole}
              onCheckedChange={setAutoProvisionRole}
              disabled={isSubmitting || isLoadingConfig}
            />
          </HStack>
          <Description className="text-xs">
            {t('integrations.sso.autoProvisionRoleHelp')}
          </Description>
        </Stack>

        {autoProvisionRole && (
          <Stack gap={3}>
            <Label>{t('integrations.sso.roleMappingRulesLabel')}</Label>
            <Description className="text-xs">
              {t('integrations.sso.roleMappingRulesHelp')}
            </Description>

            <Stack gap={0} className="divide-border divide-y">
              {roleMappingRules.map((rule, index) => (
                <HStack
                  key={index}
                  gap={2}
                  align="center"
                  className="flex-wrap py-3 first:pt-0 last:pb-0"
                >
                  <Select
                    value={rule.source}
                    onValueChange={(value) =>
                      updateMappingRule(index, {
                        source: value as 'jobTitle' | 'appRole',
                      })
                    }
                    disabled={isSubmitting || isLoadingConfig}
                    className="w-28 shrink-0"
                    options={[
                      {
                        value: 'jobTitle',
                        label: t('integrations.sso.sourceJobTitle'),
                      },
                      {
                        value: 'appRole',
                        label: t('integrations.sso.sourceAppRole'),
                      },
                    ]}
                  />

                  <Input
                    placeholder="*developer*"
                    value={rule.pattern}
                    onChange={(e) =>
                      updateMappingRule(index, { pattern: e.target.value })
                    }
                    disabled={isSubmitting || isLoadingConfig}
                    className="min-w-32 flex-1"
                  />

                  <Select
                    value={rule.targetRole}
                    onValueChange={(value) =>
                      updateMappingRule(index, {
                        targetRole: value as PlatformRole,
                      })
                    }
                    disabled={isSubmitting || isLoadingConfig}
                    className="w-28 shrink-0"
                    options={platformRoles}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMappingRule(index)}
                    disabled={isSubmitting || isLoadingConfig}
                    className="shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </HStack>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addMappingRule}
                disabled={isSubmitting || isLoadingConfig}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('integrations.sso.addRule')}
              </Button>
            </Stack>
          </Stack>
        )}

        <Stack gap={3}>
          <Label htmlFor="default-role-select">
            {t('integrations.sso.defaultRoleLabel')}
          </Label>
          <Select
            value={defaultRole}
            onValueChange={(value) => setDefaultRole(value as PlatformRole)}
            disabled={isSubmitting || isLoadingConfig}
            id="default-role-select"
            className="w-48"
            options={platformRoles}
          />
          <Description className="text-xs">
            {autoProvisionRole
              ? t('integrations.sso.defaultRoleHelp')
              : t('integrations.sso.defaultRoleHelpNoAutoProvision')}
          </Description>
        </Stack>
      </Stack>
    </FormDialog>
  );
}
