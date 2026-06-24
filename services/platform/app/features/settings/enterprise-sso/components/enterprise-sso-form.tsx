'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { Check, Copy, Loader2 } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type {
  PlatformRole,
  SsoConnectionView,
} from '@/lib/shared/schemas/enterprise_sso';
import { convexErrorCode, convexErrorMessage } from '@/lib/utils/convex-error';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import {
  useDisableScim,
  useDisableSso,
  useRegenerateScimToken,
  useRemoveSso,
  useRevealOidcClientId,
  useTestSsoConnection,
  useUpsertOidc,
  useUpsertSaml,
} from '../hooks/use-enterprise-sso';

/** The unified connection view as returned by the config query. */
export type EnterpriseSsoConfig = SsoConnectionView;

const FORM_ID = 'enterprise-sso-form';

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

const UI_PROTOCOLS = [
  'entra-id',
  'generic-oidc',
  'oauth2',
  'saml',
] as const satisfies readonly UiProtocol[];

interface Props {
  organizationId: string;
  /** The loaded connection view, or `undefined` while the parent is loading. */
  config: EnterpriseSsoConfig | undefined;
}

const DEFAULT_SCOPES: Record<UiProtocol, string> = {
  'entra-id':
    'openid email profile offline_access https://graph.microsoft.com/GroupMember.Read.All',
  'generic-oidc': 'openid email profile',
  oauth2: 'email profile',
  saml: '',
};

/** Flat form-data shape covering every field across all protocols. */
interface SsoFormData {
  protocol: UiProtocol;
  displayName: string;
  domain: string;
  // OIDC / OAuth2
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  pkce: boolean;
  authzEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  domainHint: string;
  // SAML
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  // Provisioning
  defaultRole: PlatformRole;
  autoRole: boolean;
  autoTeam: boolean;
  excludeGroups: string;
}

const isOidcProtocol = (p: UiProtocol): p is Exclude<UiProtocol, 'saml'> =>
  p !== 'saml';

/** Loose URL check — accepts http(s) URLs (and bare hosts the IdP may use). */
function looksLikeUrl(value: string): boolean {
  try {
    // Accept values with an explicit scheme; reject anything else.
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

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
  const ability = useAbility();

  const upsertOidc = useUpsertOidc();
  const upsertSaml = useUpsertSaml();
  const testConn = useTestSsoConnection();
  const disableSso = useDisableSso();
  const removeSso = useRemoveSso();
  const regenScim = useRegenerateScimToken();
  const disableScim = useDisableScim();
  const revealClientId = useRevealOidcClientId();

  const [scimToken, setScimToken] = useState<string | null>(null);
  // The stored client id, revealed on demand (the read view omits it). Held in
  // state — not just pushed via `setValue` — so it is part of the seeded `data`
  // and survives a `useFormEditor` reset triggered by a reactive server update.
  const [revealedClientId, setRevealedClientId] = useState<string | null>(null);

  const connected = !!config?.enabled;
  const cannotManage = ability.cannot('write', 'orgSettings');
  const canEdit = !cannotManage;

  // -------------------------------------------------------------------------
  // Validation schema (memoized on `t` and whether an OIDC secret is stored).
  // The protocol Select drives which fields are required; `clientSecret` is
  // required whenever no OIDC client secret is already stored — i.e. a new
  // connection OR a switch to OIDC from a SAML-only connection. An existing
  // OIDC connection keeps its stored secret when the field is left blank.
  // -------------------------------------------------------------------------
  const hasStoredOidcSecret = !!config?.oidc;
  const schema = useMemo(() => {
    const requiredMsg = t('integrations.enterpriseSso.validation.required');
    const urlMsg = t('integrations.enterpriseSso.validation.url');

    return z
      .object({
        protocol: z.enum(UI_PROTOCOLS),
        displayName: z.string(),
        domain: z.string(),
        issuer: z.string(),
        clientId: z.string(),
        clientSecret: z.string(),
        scopes: z.string(),
        pkce: z.boolean(),
        authzEndpoint: z.string(),
        tokenEndpoint: z.string(),
        userinfoEndpoint: z.string(),
        domainHint: z.string(),
        idpEntityId: z.string(),
        idpSsoUrl: z.string(),
        idpCertificate: z.string(),
        defaultRole: z.enum([
          'admin',
          'developer',
          'editor',
          'member',
          'disabled',
        ]),
        autoRole: z.boolean(),
        autoTeam: z.boolean(),
        excludeGroups: z.string(),
      })
      .superRefine((data, ctx) => {
        const req = (field: keyof SsoFormData) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: requiredMsg,
          });
        };
        const url = (field: keyof SsoFormData) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: urlMsg,
          });
        };

        // All protocols
        if (!data.displayName.trim()) req('displayName');

        if (isOidcProtocol(data.protocol)) {
          if (!data.issuer.trim()) req('issuer');
          else if (!looksLikeUrl(data.issuer.trim())) url('issuer');
          if (!data.clientId.trim()) req('clientId');
          // Required unless an OIDC secret is already stored. A blank secret on
          // an existing OIDC connection means "keep the stored one"; switching
          // to OIDC from a SAML-only connection has no stored secret to reuse.
          if (!hasStoredOidcSecret && !data.clientSecret.trim()) {
            req('clientSecret');
          }

          if (data.protocol === 'oauth2') {
            for (const field of [
              'authzEndpoint',
              'tokenEndpoint',
              'userinfoEndpoint',
            ] as const) {
              const value = data[field].trim();
              if (!value) req(field);
              else if (!looksLikeUrl(value)) url(field);
            }
          }
        } else {
          // SAML
          if (!data.idpEntityId.trim()) req('idpEntityId');
          if (!data.idpSsoUrl.trim()) req('idpSsoUrl');
          else if (!looksLikeUrl(data.idpSsoUrl.trim())) url('idpSsoUrl');
          if (!data.idpCertificate.trim()) req('idpCertificate');
        }
      });
  }, [t, hasStoredOidcSecret]);

  // -------------------------------------------------------------------------
  // Seed the form once the stored connection loads. `data` is `undefined`
  // while the parent is still loading (config is `null` only briefly during
  // load, then either a real connection or an unconfigured default), so the
  // editor shows its loading/disabled state in that window.
  // -------------------------------------------------------------------------
  const data = useMemo<SsoFormData | undefined>(() => {
    if (config === undefined) return undefined;

    let protocol: UiProtocol = 'entra-id';
    let issuer = '';
    let scopes = DEFAULT_SCOPES['entra-id'];
    let pkce = true;
    let domainHint = '';
    let authzEndpoint = '';
    let tokenEndpoint = '';
    let userinfoEndpoint = '';
    let idpEntityId = '';
    let idpSsoUrl = '';
    let idpCertificate = '';

    if (config.protocol === 'saml' && config.saml) {
      protocol = 'saml';
      idpEntityId = config.saml.idpEntityId;
      idpSsoUrl = config.saml.idpSsoUrl;
      idpCertificate = config.saml.idpCertificate;
      scopes = '';
    } else if (config.oidc) {
      const pid = config.oidc.providerId;
      protocol =
        config.protocol === 'oauth2' ? 'oauth2' : (pid ?? 'generic-oidc');
      issuer = config.oidc.issuer;
      scopes = config.oidc.scopes.join(' ');
      pkce = config.oidc.pkce ?? true;
      domainHint = config.oidc.domainHint ?? '';
      // Explicit OAuth2 endpoints (and any discovery override) are part of the
      // read view now — round-trip them so editing a stored OAuth2 connection
      // doesn't blank its required endpoints on the next save.
      authzEndpoint = config.oidc.authorizationEndpoint ?? '';
      tokenEndpoint = config.oidc.tokenEndpoint ?? '';
      userinfoEndpoint = config.oidc.userinfoEndpoint ?? '';
    }

    return {
      protocol,
      displayName: config.displayName ?? 'Enterprise SSO',
      domain: config.domain ?? '',
      issuer,
      // clientId is no longer in the read view; revealed lazily (see effect
      // below) and seeded from state so a reset preserves it.
      clientId: revealedClientId ?? '',
      clientSecret: '',
      scopes,
      pkce,
      authzEndpoint,
      tokenEndpoint,
      userinfoEndpoint,
      domainHint,
      idpEntityId,
      idpSsoUrl,
      idpCertificate,
      defaultRole: config.provisioning.defaultRole,
      autoRole: config.provisioning.autoProvisionRole,
      autoTeam: config.provisioning.autoProvisionTeam,
      excludeGroups: config.provisioning.excludeGroups.join(', '),
    };
  }, [config, revealedClientId]);

  const save = useCallback(
    async (values: SsoFormData) => {
      const provisioning = {
        autoProvisionRole: values.autoRole,
        defaultRole: values.defaultRole,
        roleMappingRules: config?.provisioning.roleMappingRules ?? [],
        autoProvisionTeam: values.autoTeam,
        excludeGroups: values.excludeGroups
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      };
      const scopeList = values.scopes.split(/\s+/).filter(Boolean);

      try {
        if (isOidcProtocol(values.protocol)) {
          await upsertOidc.mutateAsync({
            organizationId,
            displayName: values.displayName,
            domain: values.domain || undefined,
            providerId: values.protocol,
            issuer: values.issuer,
            authorizationEndpoint:
              values.protocol === 'oauth2' ? values.authzEndpoint : undefined,
            tokenEndpoint:
              values.protocol === 'oauth2' ? values.tokenEndpoint : undefined,
            userinfoEndpoint:
              values.protocol === 'oauth2'
                ? values.userinfoEndpoint
                : undefined,
            clientId: values.clientId,
            clientSecret: values.clientSecret || undefined,
            scopes: scopeList,
            pkce: values.pkce,
            domainHint: values.domainHint || undefined,
            // No UI toggle for this yet, so preserve whatever is stored (the
            // cutover migration can set it for Entra orgs) rather than silently
            // clearing it on every re-save.
            enableOneDriveAccess: config?.oidc?.enableOneDriveAccess,
            ...provisioning,
          });
        } else {
          await upsertSaml.mutateAsync({
            organizationId,
            displayName: values.displayName,
            domain: values.domain || undefined,
            idpEntityId: values.idpEntityId,
            idpSsoUrl: values.idpSsoUrl,
            idpCertificate: values.idpCertificate,
            // The SP keypair + assertion/attribute options have no form inputs
            // yet, so preserve whatever is stored rather than clearing it on
            // every re-save. (Dropping spCertificate here would also flip the
            // backend-derived `hasSpKeypair` off.) The SP private key is a
            // secret and is reused-on-omit by the backend.
            spCertificate: config?.saml?.spCertificate,
            wantAssertionsSigned: config?.saml?.wantAssertionsSigned,
            wantAssertionsEncrypted: config?.saml?.wantAssertionsEncrypted,
            attributeMappings: config?.saml?.attributeMappings,
            ...provisioning,
          });
        }
        toast({
          title: t('integrations.enterpriseSso.saved'),
          variant: 'success',
        });
      } catch (error) {
        const fallback = t('integrations.enterpriseSso.saveFailed');
        toast({
          title:
            convexErrorCode(error) === 'sso_client_secret_required'
              ? t('integrations.enterpriseSso.validation.clientSecretRequired')
              : convexErrorMessage(error, fallback),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [config, organizationId, t, toast, upsertOidc, upsertSaml],
  );

  const editor = useFormEditor<SsoFormData>({ data, schema, save });

  useRegisterActiveEditor(editor);

  const {
    control,
    register,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = editor.form;

  const protocol = watch('protocol') ?? 'entra-id';
  const isOidcLike = isOidcProtocol(protocol);

  // -------------------------------------------------------------------------
  // Prefill clientId once for an existing OIDC connection (the read view no
  // longer exposes it, so reveal it via the admin-only action). Runs once.
  // -------------------------------------------------------------------------
  const revealedRef = useRef(false);
  useEffect(() => {
    if (revealedRef.current) return;
    if (!config?.configured || !config.oidc) return;
    revealedRef.current = true;
    revealClientId
      .mutateAsync({ organizationId })
      .then((value) => {
        if (value) {
          // Seed (survives resets) + push to the live field (covers the case
          // where the form is already dirty, so a reset wouldn't re-apply it).
          setRevealedClientId(value);
          setValue('clientId', value, { shouldDirty: false });
        }
      })
      .catch((err) => {
        // Non-fatal: the admin can retype the client id. Surface, don't swallow.
        console.warn('[sso] reveal clientId failed', err);
      });
  }, [config, organizationId, revealClientId, setValue]);

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

  async function handleTest() {
    // Validate only the fields a connection test depends on before calling the
    // backend. Invalid → surface inline errors + a localized toast, no request.
    const fieldsToCheck: Array<keyof SsoFormData> =
      protocol === 'oauth2'
        ? [
            'issuer',
            'clientId',
            'authzEndpoint',
            'tokenEndpoint',
            'userinfoEndpoint',
          ]
        : ['issuer', 'clientId'];
    const ok = await trigger(fieldsToCheck);
    if (!ok) {
      toast({
        title: t('integrations.enterpriseSso.testMissingFields'),
        variant: 'destructive',
      });
      return;
    }

    const values = editor.form.getValues();
    try {
      const result = await testConn.mutateAsync({
        organizationId,
        providerId: oidcProviderId(),
        issuer: values.issuer,
        authorizationEndpoint:
          protocol === 'oauth2' ? values.authzEndpoint : undefined,
        tokenEndpoint: protocol === 'oauth2' ? values.tokenEndpoint : undefined,
        userinfoEndpoint:
          protocol === 'oauth2' ? values.userinfoEndpoint : undefined,
        clientId: values.clientId,
        scopes: values.scopes.split(/\s+/).filter(Boolean),
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
    <form id={FORM_ID} onSubmit={editor.form.handleSubmit(save)}>
      <fieldset disabled={!canEdit || editor.isLoading} className="contents">
        <Stack gap={5}>
          {connected && (
            <StatusIndicator variant="success">
              {t('integrations.enterpriseSso.connected')}
            </StatusIndicator>
          )}

          <Text variant="muted" className="text-sm">
            {t('integrations.enterpriseSso.formHint')}
          </Text>

          <Section>
            <Controller
              control={control}
              name="protocol"
              render={({ field }) => (
                <Select
                  id="sso-protocol"
                  label={t('integrations.enterpriseSso.protocolLabel')}
                  description={t('integrations.enterpriseSso.protocolHelp')}
                  value={field.value ?? 'entra-id'}
                  onValueChange={(value) => {
                    const next = narrowStringUnion<UiProtocol>(
                      value,
                      UI_PROTOCOLS,
                    );
                    if (next) {
                      field.onChange(next);
                      setValue('scopes', DEFAULT_SCOPES[next], {
                        shouldDirty: true,
                      });
                    }
                  }}
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
              )}
            />
            <Input
              id="sso-display-name"
              label={t('integrations.enterpriseSso.displayNameLabel')}
              errorMessage={errors.displayName?.message}
              {...register('displayName')}
            />
            <Input
              id="sso-domain"
              label={t('integrations.enterpriseSso.domainLabel')}
              description={t('integrations.enterpriseSso.domainHelp')}
              placeholder="example.com"
              {...register('domain')}
            />
          </Section>

          {isOidcLike ? (
            <Section title={t('integrations.enterpriseSso.signInSection')}>
              <Input
                id="sso-issuer"
                label={t('integrations.enterpriseSso.issuerLabel')}
                placeholder="https://idp.example.com"
                errorMessage={errors.issuer?.message}
                {...register('issuer')}
              />
              {protocol === 'oauth2' && (
                <>
                  <Input
                    id="sso-authz"
                    label={t('integrations.enterpriseSso.authzEndpointLabel')}
                    errorMessage={errors.authzEndpoint?.message}
                    {...register('authzEndpoint')}
                  />
                  <Input
                    id="sso-token-ep"
                    label={t('integrations.enterpriseSso.tokenEndpointLabel')}
                    errorMessage={errors.tokenEndpoint?.message}
                    {...register('tokenEndpoint')}
                  />
                  <Input
                    id="sso-userinfo"
                    label={t(
                      'integrations.enterpriseSso.userinfoEndpointLabel',
                    )}
                    errorMessage={errors.userinfoEndpoint?.message}
                    {...register('userinfoEndpoint')}
                  />
                </>
              )}
              <Input
                id="sso-client-id"
                label={t('integrations.enterpriseSso.clientIdLabel')}
                errorMessage={errors.clientId?.message}
                {...register('clientId')}
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
                errorMessage={errors.clientSecret?.message}
                {...register('clientSecret')}
              />
              <Input
                id="sso-scopes"
                label={t('integrations.enterpriseSso.scopesLabel')}
                {...register('scopes')}
              />
              <Controller
                control={control}
                name="pkce"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    label={t('integrations.enterpriseSso.pkceLabel')}
                  />
                )}
              />
            </Section>
          ) : (
            <Section title={t('integrations.enterpriseSso.signInSection')}>
              <Input
                id="saml-entity"
                label={t('integrations.enterpriseSso.idpEntityIdLabel')}
                errorMessage={errors.idpEntityId?.message}
                {...register('idpEntityId')}
              />
              <Input
                id="saml-sso-url"
                label={t('integrations.enterpriseSso.idpSsoUrlLabel')}
                errorMessage={errors.idpSsoUrl?.message}
                {...register('idpSsoUrl')}
              />
              <Textarea
                id="saml-cert"
                label={t('integrations.enterpriseSso.idpCertLabel')}
                description={t('integrations.enterpriseSso.idpCertHelp')}
                rows={4}
                errorMessage={errors.idpCertificate?.message}
                {...register('idpCertificate')}
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
            <Controller
              control={control}
              name="defaultRole"
              render={({ field }) => (
                <Select
                  id="sso-default-role"
                  label={t('integrations.enterpriseSso.defaultRoleLabel')}
                  value={field.value ?? 'member'}
                  onValueChange={(value) => {
                    const r = narrowStringUnion<PlatformRole>(value, [
                      'admin',
                      'developer',
                      'editor',
                      'member',
                    ] as const);
                    if (r) field.onChange(r);
                  }}
                  options={roleOptions}
                />
              )}
            />
            <Controller
              control={control}
              name="autoRole"
              render={({ field }) => (
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                  label={t('integrations.enterpriseSso.autoRoleLabel')}
                />
              )}
            />
            <Controller
              control={control}
              name="autoTeam"
              render={({ field }) => (
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                  label={t('integrations.enterpriseSso.autoTeamLabel')}
                />
              )}
            />
            <Input
              id="sso-exclude-groups"
              label={t('integrations.enterpriseSso.excludeGroupsLabel')}
              description={t('integrations.enterpriseSso.excludeGroupsHelp')}
              {...register('excludeGroups')}
            />
          </Section>

          {/* SCIM stays inline (its own generate/regenerate/disable lifecycle,
              independent of the SSO config Save). */}
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
                  type="button"
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
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleGenerateScimToken}
                  disabled={!canEdit || regenScim.isPending}
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
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canEdit}
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

          {/* Inline actions: Disable / Remove (left) + Test (right). Save and
              Discard live in the settings page header (via the active editor). */}
          <HStack justify="between" align="center" className="pt-2">
            <HStack gap={2}>
              {connected && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => disableSso.mutateAsync({ organizationId })}
                >
                  {t('integrations.enterpriseSso.disable')}
                </Button>
              )}
              {config?.configured && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit}
                  onClick={async () => {
                    await removeSso.mutateAsync({ organizationId });
                    revealedRef.current = false;
                  }}
                >
                  {t('integrations.enterpriseSso.remove')}
                </Button>
              )}
            </HStack>
            {isOidcLike && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleTest}
                disabled={!canEdit || testConn.isPending}
              >
                {testConn.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {t('integrations.enterpriseSso.test')}
              </Button>
            )}
          </HStack>
        </Stack>
      </fieldset>
    </form>
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
          type="button"
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
