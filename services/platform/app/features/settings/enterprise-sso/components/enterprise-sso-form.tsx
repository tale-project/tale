'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { Check, Copy, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type {
  PlatformRole,
  SsoConnectionView,
} from '@/lib/shared/schemas/enterprise_sso';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import {
  useDisableScim,
  useDisableSso,
  useRegenerateScimToken,
  useRemoveSso,
  useTestSsoConnection,
  useUpsertOidc,
  useUpsertSaml,
} from '../hooks/use-enterprise-sso';

/** The unified connection view as returned by the config query. */
export type EnterpriseSsoConfig = SsoConnectionView;

/** Titled group of form fields (replaces the old FormSection's title prop). */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Stack gap={3}>
      {title && (
        <Text variant="label" className="text-sm font-semibold">
          {title}
        </Text>
      )}
      <Stack gap={4}>{children}</Stack>
    </Stack>
  );
}

/** UI-level protocol/provider choice (maps to backend protocol + providerId). */
type UiProtocol = 'entra-id' | 'generic-oidc' | 'oauth2' | 'saml';

interface Props {
  organizationId: string;
  config: EnterpriseSsoConfig | null;
}

const DEFAULT_SCOPES: Record<UiProtocol, string> = {
  'entra-id':
    'openid email profile offline_access https://graph.microsoft.com/GroupMember.Read.All',
  'generic-oidc': 'openid email profile',
  oauth2: 'email profile',
  saml: '',
};

function useCopy() {
  const { toast } = useToast();
  const { t } = useT('settings');
  return async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: t('integrations.enterpriseSso.copied'),
        variant: 'success',
      });
    } catch {
      // Clipboard can be unavailable (insecure context); fail quietly.
      console.warn('[sso] clipboard write failed');
    }
  };
}

export function EnterpriseSsoForm({ organizationId, config }: Props) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const copy = useCopy();

  const [protocol, setProtocol] = useState<UiProtocol>('entra-id');
  const [displayName, setDisplayName] = useState('Enterprise SSO');
  const [domain, setDomain] = useState('');

  // OIDC / OAuth2
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState(DEFAULT_SCOPES['entra-id']);
  const [pkce, setPkce] = useState(true);
  const [authzEndpoint, setAuthzEndpoint] = useState('');
  const [tokenEndpoint, setTokenEndpoint] = useState('');
  const [userinfoEndpoint, setUserinfoEndpoint] = useState('');
  const [domainHint, setDomainHint] = useState('');

  // SAML
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCertificate, setIdpCertificate] = useState('');

  // Provisioning
  const [defaultRole, setDefaultRole] = useState<PlatformRole>('member');
  const [autoRole, setAutoRole] = useState(false);
  const [autoTeam, setAutoTeam] = useState(false);
  const [excludeGroups, setExcludeGroups] = useState('');

  const [scimToken, setScimToken] = useState<string | null>(null);

  const upsertOidc = useUpsertOidc();
  const upsertSaml = useUpsertSaml();
  const testConn = useTestSsoConnection();
  const disableSso = useDisableSso();
  const removeSso = useRemoveSso();
  const regenScim = useRegenerateScimToken();
  const disableScim = useDisableScim();

  const isSubmitting = upsertOidc.isPending || upsertSaml.isPending;
  const connected = !!config?.enabled;
  const isOidcLike = protocol !== 'saml';

  // Seed the form once, when the stored connection first loads.
  const seeded = useRef(false);
  useEffect(() => {
    if (!config || seeded.current) return;
    seeded.current = true;
    if (config.protocol === 'saml' && config.saml) {
      setProtocol('saml');
      setIdpEntityId(config.saml.idpEntityId);
      setIdpSsoUrl(config.saml.idpSsoUrl);
      setIdpCertificate(config.saml.idpCertificate);
    } else if (config.oidc) {
      const pid = config.oidc.providerId;
      setProtocol(
        config.protocol === 'oauth2' ? 'oauth2' : (pid ?? 'generic-oidc'),
      );
      setIssuer(config.oidc.issuer);
      setScopes(config.oidc.scopes.join(' '));
      setPkce(config.oidc.pkce ?? true);
      setDomainHint(config.oidc.domainHint ?? '');
    }
    setDisplayName(config.displayName ?? 'Enterprise SSO');
    setDomain(config.domain ?? '');
    setDefaultRole(config.provisioning.defaultRole);
    setAutoRole(config.provisioning.autoProvisionRole);
    setAutoTeam(config.provisioning.autoProvisionTeam);
    setExcludeGroups(config.provisioning.excludeGroups.join(', '));
  }, [config]);

  const provisioning = useMemo(
    () => ({
      autoProvisionRole: autoRole,
      defaultRole,
      roleMappingRules: config?.provisioning.roleMappingRules ?? [],
      autoProvisionTeam: autoTeam,
      excludeGroups: excludeGroups
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
    }),
    [autoRole, defaultRole, autoTeam, excludeGroups, config],
  );

  const scopeList = () => scopes.split(/\s+/).filter(Boolean);
  // Narrow the UI protocol to the OIDC/OAuth2 provider ids (SAML never reaches
  // the OIDC code paths, but TS can't infer that from the `isOidcLike` const).
  const oidcProviderId = (): 'entra-id' | 'generic-oidc' | 'oauth2' =>
    protocol === 'saml' ? 'generic-oidc' : protocol;

  // Per-provider setup guide (steps grounded in the official IdP docs).
  const guideKey =
    protocol === 'entra-id'
      ? 'entra'
      : protocol === 'oauth2'
        ? 'oauth2'
        : protocol === 'saml'
          ? 'saml'
          : 'google';
  const guideStepCount: Record<string, number> = {
    entra: 7,
    google: 5,
    oauth2: 4,
    saml: 5,
  };
  const guideSteps = Array.from(
    { length: guideStepCount[guideKey] },
    (_, i) => `s${i + 1}`,
  );

  async function handleSave() {
    try {
      if (isOidcLike) {
        await upsertOidc.mutateAsync({
          organizationId,
          displayName,
          domain: domain || undefined,
          providerId: oidcProviderId(),
          issuer,
          authorizationEndpoint:
            protocol === 'oauth2' ? authzEndpoint : undefined,
          tokenEndpoint: protocol === 'oauth2' ? tokenEndpoint : undefined,
          userinfoEndpoint:
            protocol === 'oauth2' ? userinfoEndpoint : undefined,
          clientId,
          clientSecret: clientSecret || undefined,
          scopes: scopeList(),
          pkce,
          domainHint: domainHint || undefined,
          enableOneDriveAccess: undefined,
          ...provisioning,
        });
      } else {
        await upsertSaml.mutateAsync({
          organizationId,
          displayName,
          domain: domain || undefined,
          idpEntityId,
          idpSsoUrl,
          idpCertificate,
          ...provisioning,
        });
      }
      toast({
        title: t('integrations.enterpriseSso.saved'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error
            ? error.message
            : t('integrations.enterpriseSso.saveFailed'),
        variant: 'destructive',
      });
    }
  }

  async function handleTest() {
    try {
      const result = await testConn.mutateAsync({
        organizationId,
        providerId: oidcProviderId(),
        issuer,
        authorizationEndpoint:
          protocol === 'oauth2' ? authzEndpoint : undefined,
        tokenEndpoint: protocol === 'oauth2' ? tokenEndpoint : undefined,
        userinfoEndpoint: protocol === 'oauth2' ? userinfoEndpoint : undefined,
        clientId,
        scopes: scopeList(),
      });
      toast({
        title: result.valid
          ? t('integrations.enterpriseSso.testOk')
          : (result.error ?? t('integrations.enterpriseSso.testFailed')),
        variant: result.valid ? 'success' : 'destructive',
      });
    } catch {
      toast({
        title: t('integrations.enterpriseSso.testFailed'),
        variant: 'destructive',
      });
    }
  }

  async function handleGenerateScimToken() {
    try {
      const result = await regenScim.mutateAsync({ organizationId });
      setScimToken(result.token);
    } catch {
      toast({
        title: t('integrations.enterpriseSso.scim.tokenFailed'),
        variant: 'destructive',
      });
    }
  }

  const roleOptions = (['admin', 'developer', 'editor', 'member'] as const).map(
    (r) => ({ value: r, label: t(`integrations.enterpriseSso.role.${r}`) }),
  );

  return (
    <Stack gap={5}>
      {connected && (
        <StatusIndicator variant="success">
          {t('integrations.enterpriseSso.connected')}
        </StatusIndicator>
      )}

      <Section>
        <Select
          id="sso-protocol"
          label={t('integrations.enterpriseSso.protocolLabel')}
          description={t('integrations.enterpriseSso.protocolHelp')}
          value={protocol}
          onValueChange={(value) => {
            const next = narrowStringUnion<UiProtocol>(value, [
              'entra-id',
              'generic-oidc',
              'oauth2',
              'saml',
            ] as const);
            if (next) {
              setProtocol(next);
              if (DEFAULT_SCOPES[next]) setScopes(DEFAULT_SCOPES[next]);
            }
          }}
          disabled={isSubmitting}
          options={[
            {
              value: 'entra-id',
              label: t('integrations.enterpriseSso.protocol.entra'),
            },
            {
              value: 'generic-oidc',
              label: t('integrations.enterpriseSso.protocol.oidc'),
            },
            {
              value: 'oauth2',
              label: t('integrations.enterpriseSso.protocol.oauth2'),
            },
            {
              value: 'saml',
              label: t('integrations.enterpriseSso.protocol.saml'),
            },
          ]}
        />
        <Input
          id="sso-display-name"
          label={t('integrations.enterpriseSso.displayNameLabel')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={isSubmitting}
        />
        <Input
          id="sso-domain"
          label={t('integrations.enterpriseSso.domainLabel')}
          description={t('integrations.enterpriseSso.domainHelp')}
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={isSubmitting}
        />
      </Section>

      {isOidcLike ? (
        <Section title={t('integrations.enterpriseSso.signInSection')}>
          <Input
            id="sso-issuer"
            label={t('integrations.enterpriseSso.issuerLabel')}
            placeholder="https://idp.example.com"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            disabled={isSubmitting}
          />
          {protocol === 'oauth2' && (
            <>
              <Input
                id="sso-authz"
                label={t('integrations.enterpriseSso.authzEndpointLabel')}
                value={authzEndpoint}
                onChange={(e) => setAuthzEndpoint(e.target.value)}
                disabled={isSubmitting}
              />
              <Input
                id="sso-token-ep"
                label={t('integrations.enterpriseSso.tokenEndpointLabel')}
                value={tokenEndpoint}
                onChange={(e) => setTokenEndpoint(e.target.value)}
                disabled={isSubmitting}
              />
              <Input
                id="sso-userinfo"
                label={t('integrations.enterpriseSso.userinfoEndpointLabel')}
                value={userinfoEndpoint}
                onChange={(e) => setUserinfoEndpoint(e.target.value)}
                disabled={isSubmitting}
              />
            </>
          )}
          <Input
            id="sso-client-id"
            label={t('integrations.enterpriseSso.clientIdLabel')}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isSubmitting}
          />
          <Input
            id="sso-client-secret"
            type="password"
            label={t('integrations.enterpriseSso.clientSecretLabel')}
            description={
              connected
                ? t('integrations.enterpriseSso.clientSecretKeep')
                : undefined
            }
            placeholder={connected ? '••••••••' : undefined}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={isSubmitting}
          />
          <Input
            id="sso-scopes"
            label={t('integrations.enterpriseSso.scopesLabel')}
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            disabled={isSubmitting}
          />
          <Switch
            checked={pkce}
            onCheckedChange={setPkce}
            label={t('integrations.enterpriseSso.pkceLabel')}
            disabled={isSubmitting}
          />
        </Section>
      ) : (
        <Section title={t('integrations.enterpriseSso.signInSection')}>
          <Input
            id="saml-entity"
            label={t('integrations.enterpriseSso.idpEntityIdLabel')}
            value={idpEntityId}
            onChange={(e) => setIdpEntityId(e.target.value)}
            disabled={isSubmitting}
          />
          <Input
            id="saml-sso-url"
            label={t('integrations.enterpriseSso.idpSsoUrlLabel')}
            value={idpSsoUrl}
            onChange={(e) => setIdpSsoUrl(e.target.value)}
            disabled={isSubmitting}
          />
          <Textarea
            id="saml-cert"
            label={t('integrations.enterpriseSso.idpCertLabel')}
            description={t('integrations.enterpriseSso.idpCertHelp')}
            rows={4}
            value={idpCertificate}
            onChange={(e) => setIdpCertificate(e.target.value)}
            disabled={isSubmitting}
          />
          <ReadOnlyCopy
            label={t('integrations.enterpriseSso.spMetadataLabel')}
            value={config?.samlSpMetadataUrl ?? ''}
            onCopy={copy}
          />
          <ReadOnlyCopy
            label={t('integrations.enterpriseSso.acsUrlLabel')}
            value={config?.samlAcsUrl ?? ''}
            onCopy={copy}
          />
        </Section>
      )}

      <Section title={t('integrations.enterpriseSso.guide.title')}>
        {!isOidcLike ? (
          <Text variant="muted" className="text-sm">
            {t('integrations.enterpriseSso.guide.samlIntro')}
          </Text>
        ) : (
          <ReadOnlyCopy
            label={t('integrations.enterpriseSso.guide.redirectLabel')}
            value={config?.oidcCallbackUrl ?? ''}
            onCopy={copy}
          />
        )}
        <Text variant="muted" className="text-sm">
          {t(`integrations.enterpriseSso.guide.${guideKey}.intro`)}
        </Text>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          {guideSteps.map((s) => (
            <li key={s}>
              {t(`integrations.enterpriseSso.guide.${guideKey}.${s}`)}
            </li>
          ))}
        </ol>
        {protocol === 'generic-oidc' && (
          <Text variant="muted" className="text-sm">
            {t('integrations.enterpriseSso.guide.google.groupsNote')}
          </Text>
        )}
      </Section>

      <Section title={t('integrations.enterpriseSso.provisioningSection')}>
        <Select
          id="sso-default-role"
          label={t('integrations.enterpriseSso.defaultRoleLabel')}
          value={defaultRole}
          onValueChange={(value) => {
            const r = narrowStringUnion<PlatformRole>(value, [
              'admin',
              'developer',
              'editor',
              'member',
            ] as const);
            if (r) setDefaultRole(r);
          }}
          disabled={isSubmitting}
          options={roleOptions}
        />
        <Switch
          checked={autoRole}
          onCheckedChange={setAutoRole}
          label={t('integrations.enterpriseSso.autoRoleLabel')}
          disabled={isSubmitting}
        />
        <Switch
          checked={autoTeam}
          onCheckedChange={setAutoTeam}
          label={t('integrations.enterpriseSso.autoTeamLabel')}
          disabled={isSubmitting}
        />
        <Input
          id="sso-exclude-groups"
          label={t('integrations.enterpriseSso.excludeGroupsLabel')}
          description={t('integrations.enterpriseSso.excludeGroupsHelp')}
          value={excludeGroups}
          onChange={(e) => setExcludeGroups(e.target.value)}
          disabled={isSubmitting}
        />
      </Section>

      <Section title={t('integrations.enterpriseSso.scim.section')}>
        <Text variant="muted" className="text-sm">
          {t('integrations.enterpriseSso.scim.help')}
        </Text>
        {config?.scim.enabled ? (
          <Badge variant="green" dot>
            {t('integrations.enterpriseSso.scim.enabled')}
          </Badge>
        ) : (
          <Badge variant="outline">
            {t('integrations.enterpriseSso.scim.disabled')}
          </Badge>
        )}
        {scimToken ? (
          <Stack gap={2}>
            <Text variant="muted" className="text-sm">
              {t('integrations.enterpriseSso.scim.tokenCreatedHelp')}
            </Text>
            <code className="bg-muted block w-full rounded-md p-3 font-mono text-xs break-all">
              {scimToken}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copy(scimToken)}
            >
              <Copy className="size-4" />
              {t('integrations.enterpriseSso.copy')}
            </Button>
          </Stack>
        ) : (
          <HStack gap={2}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateScimToken}
              disabled={regenScim.isPending}
            >
              {regenScim.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {config?.scim.enabled
                ? t('integrations.enterpriseSso.scim.regenerate')
                : t('integrations.enterpriseSso.scim.generate')}
            </Button>
            {config?.scim.enabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disableScim.mutate({ organizationId })}
              >
                {t('integrations.enterpriseSso.scim.disable')}
              </Button>
            )}
          </HStack>
        )}
        {config?.scim.baseUrl && (
          <ReadOnlyCopy
            label={t('integrations.enterpriseSso.scim.baseUrlLabel')}
            value={config.scim.baseUrl}
            onCopy={copy}
          />
        )}
      </Section>

      <HStack justify="between" align="center" className="pt-2">
        <HStack gap={2}>
          {connected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => disableSso.mutateAsync({ organizationId })}
            >
              {t('integrations.enterpriseSso.disable')}
            </Button>
          )}
          {config?.configured && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await removeSso.mutateAsync({ organizationId });
                seeded.current = false;
              }}
            >
              {t('integrations.enterpriseSso.remove')}
            </Button>
          )}
        </HStack>
        <HStack gap={2}>
          {isOidcLike && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={testConn.isPending}
            >
              {testConn.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {t('integrations.enterpriseSso.test')}
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {t('integrations.enterpriseSso.save')}
          </Button>
        </HStack>
      </HStack>
    </Stack>
  );
}

function ReadOnlyCopy({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack gap={1}>
      <Text variant="label" className="text-sm">
        {label}
      </Text>
      <HStack gap={2} align="center">
        <code className="bg-muted block flex-1 truncate rounded-md p-2 font-mono text-xs">
          {value || '—'}
        </code>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={label}
          disabled={!value}
          onClick={() => {
            onCopy(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </HStack>
    </Stack>
  );
}
