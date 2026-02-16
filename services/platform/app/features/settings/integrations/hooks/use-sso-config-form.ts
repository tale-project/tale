'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

import type {
  PlatformRole,
  RoleMappingRule,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useRemoveSsoProvider,
  useSsoFullConfig,
  useTestExistingSsoConfig,
  useTestSsoConfig,
  useUpsertSsoProvider,
} from './actions';

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

interface UseSsoConfigFormParams {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  existingProvider?: SsoProvider | null;
}

export function useSsoConfigForm({
  open,
  onOpenChange,
  organizationId,
  existingProvider,
}: UseSsoConfigFormParams) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const platformRoles: { value: PlatformRole; label: string }[] = useMemo(
    () => [
      { value: 'admin', label: t('integrations.sso.roleAdmin') },
      { value: 'developer', label: t('integrations.sso.roleDeveloper') },
      { value: 'editor', label: t('integrations.sso.roleEditor') },
      { value: 'member', label: t('integrations.sso.roleMember') },
      { value: 'disabled', label: t('integrations.sso.roleDisabled') },
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

  const { mutateAsync: upsertSSOProvider, isPending: isUpserting } =
    useUpsertSsoProvider();
  const { mutateAsync: removeSSOProvider, isPending: isRemoving } =
    useRemoveSsoProvider();
  const { mutateAsync: getFullConfig, isPending: isLoadingConfig } =
    useSsoFullConfig();
  const { mutateAsync: testSSOConfig, isPending: isTestingNew } =
    useTestSsoConfig();
  const { mutateAsync: testExistingSSOConfig, isPending: isTestingExisting } =
    useTestExistingSsoConfig();

  const isSubmitting = isUpserting || isRemoving;
  const isTesting = isTestingNew || isTestingExisting;
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
      getFullConfig({})
        .then((config) => {
          if (config) {
            const entraFeatures = config.providerFeatures?.entraId;
            const excludeGroupsStr = (entraFeatures?.excludeGroups || []).join(
              ', ',
            );
            const rules =
              config.roleMappingRules.length > 0
                ? config.roleMappingRules.filter(
                    (r: RoleMappingRule) =>
                      r.source === 'jobTitle' || r.source === 'appRole',
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

  const handleSave = useCallback(async () => {
    const requiresSecret = !isConnected;
    if (!issuer || !clientId || (requiresSecret && !clientSecret)) {
      toast({
        title: t('integrations.sso.validationError'),
        description: t('integrations.sso.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

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
    }
  }, [
    isConnected,
    issuer,
    clientId,
    clientSecret,
    organizationId,
    autoProvisionRole,
    roleMappingRules,
    defaultRole,
    enableOneDriveAccess,
    autoProvisionTeam,
    excludeGroups,
    upsertSSOProvider,
    onOpenChange,
    t,
  ]);

  const handleDisconnect = useCallback(async () => {
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
    }
  }, [removeSSOProvider, organizationId, onOpenChange, t]);

  const handleTest = useCallback(async () => {
    const useExistingConfig = isConnected && !clientSecret;

    if (!useExistingConfig && (!issuer || !clientId || !clientSecret)) {
      toast({
        title: t('integrations.sso.validationError'),
        description: t('integrations.sso.allFieldsRequired'),
        variant: 'destructive',
      });
      return;
    }

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
    }
  }, [
    isConnected,
    clientSecret,
    issuer,
    clientId,
    testExistingSSOConfig,
    testSSOConfig,
    t,
  ]);

  const addMappingRule = useCallback(() => {
    setRoleMappingRules((prev) => [
      ...prev,
      { source: 'jobTitle', pattern: '', targetRole: 'member' },
    ]);
  }, []);

  const removeMappingRule = useCallback((index: number) => {
    setRoleMappingRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateMappingRule = useCallback(
    (index: number, updates: Partial<RoleMappingRule>) => {
      setRoleMappingRules((prev) =>
        prev.map((rule, i) => (i === index ? { ...rule, ...updates } : rule)),
      );
    },
    [],
  );

  return {
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
  };
}
