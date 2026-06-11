'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type {
  PlatformRole,
  RoleMappingRule,
  SsoProvider,
} from '@/lib/shared/schemas/sso_providers';

import {
  useRemoveSsoProvider,
  useSsoFullConfig,
  useTestExistingSsoConfig,
  useTestSsoConfig,
  useUpsertSsoProvider,
} from './actions';

const ENTRA_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/GroupMember.Read.All',
  'https://graph.microsoft.com/Files.Read',
];

// Generic OIDC: the adapter always forces `openid`; request the standard
// identity scopes so the userinfo endpoint returns the email/profile claims
// that role mapping reads.
const GENERIC_OIDC_SCOPES = ['openid', 'email', 'profile'];

export type SsoProviderType = 'entra-id' | 'generic-oidc';

function scopesForProvider(type: SsoProviderType): string[] {
  return type === 'generic-oidc' ? GENERIC_OIDC_SCOPES : ENTRA_SCOPES;
}

const DEFAULT_MAPPING_RULES: RoleMappingRule[] = [
  { source: 'jobTitle', pattern: '*admin*', targetRole: 'admin' },
  { source: 'jobTitle', pattern: '*manager*', targetRole: 'admin' },
  { source: 'jobTitle', pattern: '*developer*', targetRole: 'developer' },
  { source: 'jobTitle', pattern: '*engineer*', targetRole: 'developer' },
  { source: 'jobTitle', pattern: '*editor*', targetRole: 'editor' },
];

// Generic OIDC has no jobTitle/appRole claims — groups are the practical
// rule source (Keycloak, Auth0, Okta all emit them).
const GENERIC_DEFAULT_MAPPING_RULES: RoleMappingRule[] = [
  { source: 'group', pattern: '*admin*', targetRole: 'admin' },
];

function defaultMappingRulesFor(type: SsoProviderType): RoleMappingRule[] {
  return type === 'generic-oidc'
    ? GENERIC_DEFAULT_MAPPING_RULES
    : DEFAULT_MAPPING_RULES;
}

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

  const [providerType, setProviderTypeState] =
    useState<SsoProviderType>('entra-id');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoProvisionTeam, setAutoProvisionTeam] = useState(true);
  const [excludeGroups, setExcludeGroups] = useState('');
  const [autoProvisionRole, setAutoProvisionRole] = useState(true);
  const [roleMappingRules, setRoleMappingRules] = useState(
    DEFAULT_MAPPING_RULES,
  );
  const [defaultRole, setDefaultRole] = useState<PlatformRole>('member');
  const [enableOneDriveAccess, setEnableOneDriveAccess] = useState(false);
  const [emailClaim, setEmailClaim] = useState('');
  const [nameClaim, setNameClaim] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('');
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  const originalConfigRef = useRef<{
    providerType: SsoProviderType;
    issuer: string;
    clientId: string;
    autoProvisionTeam: boolean;
    excludeGroups: string;
    autoProvisionRole: boolean;
    roleMappingRules: RoleMappingRule[];
    defaultRole: PlatformRole;
    enableOneDriveAccess: boolean;
    emailClaim: string;
    nameClaim: string;
    groupsClaim: string;
  } | null>(null);

  // Switching the provider type (only possible before the first save) swaps
  // the rule defaults: jobTitle/appRole sources don't exist on generic OIDC.
  const setProviderType = useCallback(
    (type: SsoProviderType) => {
      setProviderTypeState(type);
      if (!existingProvider) {
        setRoleMappingRules(defaultMappingRulesFor(type));
      }
    },
    [existingProvider],
  );

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
      providerType !== orig.providerType ||
      issuer !== orig.issuer ||
      clientId !== orig.clientId ||
      autoProvisionTeam !== orig.autoProvisionTeam ||
      excludeGroups !== orig.excludeGroups ||
      autoProvisionRole !== orig.autoProvisionRole ||
      defaultRole !== orig.defaultRole ||
      enableOneDriveAccess !== orig.enableOneDriveAccess ||
      emailClaim !== orig.emailClaim ||
      nameClaim !== orig.nameClaim ||
      groupsClaim !== orig.groupsClaim;

    if (basicFieldsChanged) return true;
    if (roleMappingRules.length !== orig.roleMappingRules.length) return true;

    return roleMappingRules.some((curr, i) => {
      const origRule = orig.roleMappingRules[i];
      return (
        curr.source !== origRule.source ||
        curr.pattern !== origRule.pattern ||
        curr.targetRole !== origRule.targetRole ||
        curr.claim !== origRule.claim
      );
    });
  }, [
    providerType,
    issuer,
    clientId,
    clientSecret,
    autoProvisionTeam,
    excludeGroups,
    autoProvisionRole,
    roleMappingRules,
    defaultRole,
    enableOneDriveAccess,
    emailClaim,
    nameClaim,
    groupsClaim,
  ]);

  useEffect(() => {
    if (open && existingProvider) {
      getFullConfig({})
        .then((config) => {
          if (config) {
            const loadedType: SsoProviderType =
              config.providerId === 'generic-oidc'
                ? 'generic-oidc'
                : 'entra-id';
            const entraFeatures = config.providerFeatures?.entraId;
            const genericFeatures = config.providerFeatures?.genericOidc;
            const features =
              loadedType === 'generic-oidc' ? genericFeatures : entraFeatures;
            const excludeGroupsStr = (features?.excludeGroups || []).join(', ');
            const rules =
              config.roleMappingRules.length > 0
                ? config.roleMappingRules
                : defaultMappingRulesFor(loadedType);
            setProviderTypeState(loadedType);
            setIssuer(config.issuer);
            setClientId(config.clientId);
            setAutoProvisionTeam(features?.autoProvisionTeam ?? false);
            setExcludeGroups(excludeGroupsStr);
            setAutoProvisionRole(config.autoProvisionRole);
            setRoleMappingRules(rules);
            setDefaultRole(config.defaultRole);
            setEnableOneDriveAccess(
              entraFeatures?.enableOneDriveAccess ?? false,
            );
            setEmailClaim(genericFeatures?.emailClaim ?? '');
            setNameClaim(genericFeatures?.nameClaim ?? '');
            setGroupsClaim(genericFeatures?.groupsClaim ?? '');
            originalConfigRef.current = {
              providerType: loadedType,
              issuer: config.issuer,
              clientId: config.clientId,
              autoProvisionTeam: features?.autoProvisionTeam ?? false,
              excludeGroups: excludeGroupsStr,
              autoProvisionRole: config.autoProvisionRole,
              roleMappingRules: rules,
              defaultRole: config.defaultRole,
              enableOneDriveAccess:
                entraFeatures?.enableOneDriveAccess ?? false,
              emailClaim: genericFeatures?.emailClaim ?? '',
              nameClaim: genericFeatures?.nameClaim ?? '',
              groupsClaim: genericFeatures?.groupsClaim ?? '',
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
      setProviderTypeState('entra-id');
      setIssuer('');
      setClientId('');
      setClientSecret('');
      setAutoProvisionTeam(true);
      setExcludeGroups('');
      setAutoProvisionRole(true);
      setRoleMappingRules(DEFAULT_MAPPING_RULES);
      setDefaultRole('member');
      setEnableOneDriveAccess(false);
      setEmailClaim('');
      setNameClaim('');
      setGroupsClaim('');
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

    const isGeneric = providerType === 'generic-oidc';
    const excludeGroupsList = excludeGroups
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    try {
      await upsertSSOProvider({
        organizationId,
        providerId: providerType,
        issuer,
        clientId,
        clientSecret,
        scopes: scopesForProvider(providerType),
        autoProvisionRole,
        roleMappingRules,
        defaultRole,
        // OneDrive and Graph-based team sync are Entra-only; generic OIDC
        // persists claim mappings and userinfo-based team sync instead.
        providerFeatures: isGeneric
          ? {
              genericOidc: {
                emailClaim: emailClaim.trim() || undefined,
                nameClaim: nameClaim.trim() || undefined,
                groupsClaim: groupsClaim.trim() || undefined,
                autoProvisionTeam,
                excludeGroups: excludeGroupsList,
              },
            }
          : {
              entraId: {
                enableOneDriveAccess,
                autoProvisionTeam,
                excludeGroups: excludeGroupsList,
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
    providerType,
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
    emailClaim,
    nameClaim,
    groupsClaim,
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
            providerId: providerType,
            scopes: scopesForProvider(providerType),
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
    providerType,
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
      {
        source: providerType === 'generic-oidc' ? 'group' : 'jobTitle',
        pattern: '',
        targetRole: 'member',
      },
    ]);
  }, [providerType]);

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
    hasChanges,
    handleSave,
    handleDisconnect,
    handleTest,
    addMappingRule,
    removeMappingRule,
    updateMappingRule,
  };
}
