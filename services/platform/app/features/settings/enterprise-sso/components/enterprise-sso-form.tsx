'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Controller,
  type Control,
  useFieldArray,
  useWatch,
} from 'react-hook-form';
import { z } from 'zod';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type {
  PlatformRole,
  RoleMappingRule,
  SsoConnectionView,
} from '@/lib/shared/schemas/enterprise_sso';
import { convexErrorCode, convexErrorMessage } from '@/lib/utils/convex-error';
import { narrowStringUnion } from '@/lib/utils/type-utils';
import { isHttpUrl } from '@/lib/utils/url';

import {
  useDisableScim,
  useDisableSso,
  useParseSamlMetadata,
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
  // Files.Read + Sites.Read.All make OneDrive/SharePoint document sync work
  // out of the box for Entra orgs (the SSO token doubles as the Graph token).
  // Orgs that only want sign-in delete the two scopes here — the documents
  // menu hides its Microsoft 365 entry when the granted scopes lack Files.Read.
  'entra-id':
    'openid email profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/GroupMember.Read.All https://graph.microsoft.com/Files.Read https://graph.microsoft.com/Sites.Read.All',
  'generic-oidc': 'openid email profile',
  oauth2: 'email profile',
  saml: '',
};

/** Flat form-data shape covering every field across all protocols. */
interface SsoFormData {
  protocol: UiProtocol;
  displayName: string;
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
  roleMappingRules: RoleMappingRule[];
  autoTeam: boolean;
  excludeGroups: string;
}

const ROLE_RULE_SOURCES = [
  'group',
  'appRole',
  'jobTitle',
  'claim',
] as const satisfies readonly RoleMappingRule['source'][];
type RoleRuleSource = (typeof ROLE_RULE_SOURCES)[number];

const ROLE_RULE_TARGETS = [
  'admin',
  'developer',
  'editor',
  'member',
] as const satisfies readonly PlatformRole[];

/**
 * Fully-defined empty form state used as RHF's initial `defaultValues` while
 * the connection config is still loading. Every field is defined (empty
 * strings for text/Selects, booleans for Switches) so the controlled Select
 * and Switch inputs are controlled from the first render — without this they
 * would mount with `undefined` and log React's uncontrolled→controlled warning
 * once the seeded `data` resolves.
 */
const EMPTY_FORM_DATA: SsoFormData = {
  protocol: 'entra-id',
  displayName: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  scopes: '',
  pkce: true,
  authzEndpoint: '',
  tokenEndpoint: '',
  userinfoEndpoint: '',
  domainHint: '',
  idpEntityId: '',
  idpSsoUrl: '',
  idpCertificate: '',
  defaultRole: 'member',
  autoRole: false,
  roleMappingRules: [],
  autoTeam: false,
  excludeGroups: '',
};

const isOidcProtocol = (p: UiProtocol): p is Exclude<UiProtocol, 'saml'> =>
  p !== 'saml';

/**
 * Client-side pre-check for an uploaded metadata file. Mirrors the server's
 * authoritative `MAX_SAML_METADATA_BYTES` cap (convex/enterprise_sso/saml/
 * parse_metadata.ts) so an oversized file fails fast without an upload —
 * duplicated as a value because the parser module is `'use node'` and must not
 * be pulled into the client bundle.
 */
const MAX_METADATA_UPLOAD_BYTES = 1_048_576;

/** The legacy one-size-fits-all default, still stored on older connections —
 * treated as "not customized" when the protocol switch re-derives the name. */
const LEGACY_DEFAULT_DISPLAY_NAME = 'Enterprise SSO';

export function EnterpriseSsoForm({ organizationId, config }: Props) {
  const { t } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { toast } = useToast();
  const ability = useAbility();

  const upsertOidc = useUpsertOidc();
  const upsertSaml = useUpsertSaml();
  const parseMetadata = useParseSamlMetadata();
  const testConn = useTestSsoConnection();
  const disableSso = useDisableSso();
  const removeSso = useRemoveSso();
  const regenScim = useRegenerateScimToken();
  const disableScim = useDisableScim();
  const revealClientId = useRevealOidcClientId();

  // Disable/Remove are destructive (org-wide sign-in impact) — both confirm
  // through a dialog before firing; this holds which one is pending.
  const [pendingAction, setPendingAction] = useState<
    'disable' | 'remove' | null
  >(null);

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
    const requiredMsg = t('enterpriseSso.validation.required');
    const urlMsg = t('enterpriseSso.validation.url');

    return z
      .object({
        protocol: z.enum(UI_PROTOCOLS),
        displayName: z.string(),
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
        roleMappingRules: z.array(
          z.object({
            source: z.enum(ROLE_RULE_SOURCES),
            pattern: z.string(),
            targetRole: z.enum([
              'admin',
              'developer',
              'editor',
              'member',
              'disabled',
            ]),
            claim: z.string().optional(),
          }),
        ),
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
          else if (!isHttpUrl(data.issuer.trim())) url('issuer');
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
              else if (!isHttpUrl(value)) url(field);
            }
          }
        } else {
          // SAML
          if (!data.idpEntityId.trim()) req('idpEntityId');
          if (!data.idpSsoUrl.trim()) req('idpSsoUrl');
          else if (!isHttpUrl(data.idpSsoUrl.trim())) url('idpSsoUrl');
          if (!data.idpCertificate.trim()) req('idpCertificate');
        }
      });
  }, [t, hasStoredOidcSecret]);

  // Per-protocol default connection names (#2652) — a generic "Enterprise SSO"
  // never told users which IdP the button leads to. Only a default: the field
  // stays editable, and a stored custom name always wins.
  const defaultDisplayNames = useMemo<Record<UiProtocol, string>>(
    () => ({
      'entra-id': t('enterpriseSso.defaultDisplayName.entra'),
      'generic-oidc': t('enterpriseSso.defaultDisplayName.oidc'),
      oauth2: t('enterpriseSso.defaultDisplayName.oauth2'),
      saml: t('enterpriseSso.defaultDisplayName.saml'),
    }),
    [t],
  );

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
      displayName: config.displayName ?? defaultDisplayNames[protocol],
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
      roleMappingRules: config.provisioning.roleMappingRules,
      autoTeam: config.provisioning.autoProvisionTeam,
      excludeGroups: config.provisioning.excludeGroups.join(', '),
    };
  }, [config, defaultDisplayNames, revealedClientId]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. The connection test, the metadata import and the SCIM token
  // actions below are instant actions and keep their own toasts.
  const save = useCallback(
    async (values: SsoFormData) => {
      const provisioning = {
        autoProvisionRole: values.autoRole,
        defaultRole: values.defaultRole,
        roleMappingRules: values.roleMappingRules.filter((r) =>
          r.pattern.trim(),
        ),
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
      } catch (error) {
        // A missing client secret belongs under its own input — rethrow it
        // untouched so `mapServerError` can pin it there. Everything else
        // becomes the translated line the cluster shows in one toast.
        if (convexErrorCode(error) === 'sso_client_secret_required')
          throw error;
        console.error('[sso] save failed', error);
        throw new Error(
          convexErrorMessage(error, t('enterpriseSso.saveFailed')),
          { cause: error },
        );
      }
    },
    [config, organizationId, t, upsertOidc, upsertSaml],
  );

  const mapServerError = useCallback(
    (error: unknown) => {
      if (convexErrorCode(error) === 'sso_client_secret_required') {
        return [
          {
            path: 'clientSecret',
            message: t('enterpriseSso.validation.clientSecretRequired'),
          },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<SsoFormData>({
    data,
    defaultValues: EMPTY_FORM_DATA,
    schema,
    save,
    mapServerError,
  });

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
  const autoRole = watch('autoRole') ?? false;

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
    entra: 8,
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
        title: t('enterpriseSso.testMissingFields'),
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
          ? t('enterpriseSso.testOk')
          : (result.error ?? t('enterpriseSso.testFailed')),
        variant: result.valid ? 'success' : 'destructive',
      });
    } catch {
      toast({
        title: t('enterpriseSso.testFailed'),
        variant: 'destructive',
      });
    }
  }

  // -------------------------------------------------------------------------
  // IdP metadata import (#2652). Every IdP publishes entity ID + SSO URL +
  // signing certificate as federation-metadata XML; parsing it server-side
  // (size/schema-validated, SSRF-guarded) fills the three SAML fields below.
  // The fields stay visible and editable — importing is the draft, saving is
  // the review step.
  // -------------------------------------------------------------------------
  const [metadataUrl, setMetadataUrl] = useState('');
  const metadataFileRef = useRef<HTMLInputElement>(null);

  async function importMetadata(input: { url?: string; xml?: string }) {
    try {
      const parsed = await parseMetadata.mutateAsync({
        organizationId,
        ...input,
      });
      for (const [field, value] of [
        ['idpEntityId', parsed.idpEntityId],
        ['idpSsoUrl', parsed.idpSsoUrl],
        ['idpCertificate', parsed.idpCertificate],
      ] as const) {
        setValue(field, value, { shouldDirty: true, shouldValidate: true });
      }
      toast({
        title: t('enterpriseSso.metadata.imported'),
        variant: 'success',
      });
    } catch (error) {
      const errorByCode: Record<string, string> = {
        sso_metadata_too_large: t('enterpriseSso.metadata.errorTooLarge'),
        sso_metadata_invalid: t('enterpriseSso.metadata.errorInvalid'),
        sso_metadata_not_idp: t('enterpriseSso.metadata.errorNotIdp'),
        sso_metadata_incomplete: t('enterpriseSso.metadata.errorIncomplete'),
        sso_metadata_fetch_failed: t('enterpriseSso.metadata.errorFetchFailed'),
      };
      const code = convexErrorCode(error);
      toast({
        title:
          (code !== undefined ? errorByCode[code] : undefined) ??
          t('enterpriseSso.metadata.importFailed'),
        variant: 'destructive',
      });
    }
  }

  async function handleMetadataFile(file: File) {
    // Fast client-side cap; the server re-checks authoritatively.
    if (file.size > MAX_METADATA_UPLOAD_BYTES) {
      toast({
        title: t('enterpriseSso.metadata.errorTooLarge'),
        variant: 'destructive',
      });
      return;
    }
    await importMetadata({ xml: await file.text() });
  }

  async function handleGenerateScimToken() {
    try {
      const result = await regenScim.mutateAsync({ organizationId });
      setScimToken(result.token);
    } catch {
      toast({
        title: t('enterpriseSso.scim.tokenFailed'),
        variant: 'destructive',
      });
    }
  }

  const roleOptions = (['admin', 'developer', 'editor', 'member'] as const).map(
    (r) => ({ value: r, label: t(`enterpriseSso.role.${r}`) }),
  );

  return (
    <form id={FORM_ID} onSubmit={editor.submit}>
      <fieldset disabled={!canEdit || editor.isLoading} className="contents">
        {/* Section dividers come from `SettingsPage`'s shared rule (keyed on
            the `data-settings-section` marker) — never hand-rolled here. */}
        <Stack gap={8}>
          {/* Deployment prerequisites — a missing SITE_URL/secret yields an
              empty callback URL and a raw 500 at sign-in (the exact hard-to-
              debug failure this addresses). `deployment` is server-read (the
              client cannot see BETTER_AUTH_SECRET); the empty-callback signal
              also holds when the flag is absent. Rendered above the sections:
              it concerns the whole deployment, and the Alert's own heading
              must not sit under a section heading (axe heading-order). */}
          {(() => {
            const dep = config?.deployment;
            const callbackMissing =
              config?.oidcCallbackUrl === null || dep?.siteUrlSet === false;
            const authSecretMissing = dep?.authSecretSet === false;
            if (!callbackMissing && !authSecretMissing) return null;
            return (
              <Alert
                variant="warning"
                icon={AlertTriangle}
                live="assertive"
                title={t('enterpriseSso.deploymentWarning.title')}
                description={
                  <ul className="list-disc space-y-1 pl-4">
                    {callbackMissing && (
                      <li>
                        {t('enterpriseSso.deploymentWarning.callbackMissing')}
                      </li>
                    )}
                    {authSecretMissing && (
                      <li>
                        {t('enterpriseSso.deploymentWarning.authSecretMissing')}
                      </li>
                    )}
                  </ul>
                }
              />
            );
          })()}

          <SettingsSection title={tNav('enterpriseSso')}>
            {connected && (
              <StatusIndicator variant="success">
                {t('enterpriseSso.connected')}
              </StatusIndicator>
            )}

            <Text variant="muted" className="text-sm">
              {t('enterpriseSso.formHint')}
            </Text>

            <SettingsFieldList>
              <SettingsFieldRow
                label={t('enterpriseSso.protocolLabel')}
                description={t('enterpriseSso.protocolHelp')}
              >
                <Controller
                  control={control}
                  name="protocol"
                  render={({ field }) => (
                    <Select
                      id="sso-protocol"
                      aria-label={t('enterpriseSso.protocolLabel')}
                      // Default to a defined value so the Select is controlled from
                      // the first render — `field.value` is undefined while `data`
                      // is still loading (avoids the uncontrolled→controlled warning).
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
                          // Re-derive the display name unless the admin
                          // customized it — a still-default (or legacy-default,
                          // or empty) name follows the protocol choice (#2652).
                          const currentName = editor.form
                            .getValues('displayName')
                            .trim();
                          if (
                            !currentName ||
                            currentName === LEGACY_DEFAULT_DISPLAY_NAME ||
                            Object.values(defaultDisplayNames).includes(
                              currentName,
                            )
                          ) {
                            setValue('displayName', defaultDisplayNames[next], {
                              shouldDirty: true,
                            });
                          }
                        }
                      }}
                      options={[
                        {
                          value: 'entra-id',
                          label: t('enterpriseSso.protocol.entra'),
                        },
                        {
                          value: 'generic-oidc',
                          label: t('enterpriseSso.protocol.oidc'),
                        },
                        {
                          value: 'oauth2',
                          label: t('enterpriseSso.protocol.oauth2'),
                        },
                        {
                          value: 'saml',
                          label: t('enterpriseSso.protocol.saml'),
                        },
                      ]}
                    />
                  )}
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('enterpriseSso.displayNameLabel')}>
                <Input
                  id="sso-display-name"
                  aria-label={t('enterpriseSso.displayNameLabel')}
                  errorMessage={errors.displayName?.message}
                  {...register('displayName')}
                  wrapperClassName="w-full"
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          </SettingsSection>

          <SettingsSection title={t('enterpriseSso.signInSection')}>
            {isOidcLike ? (
              <>
                <SettingsFieldList>
                  {/* The redirect URL to register in the IdP, shown up-front (not
                    buried in the guide) — a mismatch here is the top cause of a
                    failed sign-in (AADSTS50011). */}
                  <ReadOnlyCopy
                    label={t('enterpriseSso.redirectUrlLabel')}
                    value={config?.oidcCallbackUrl ?? ''}
                    helpText={t('enterpriseSso.redirectUrlHelp')}
                  />
                  <SettingsFieldRow label={t('enterpriseSso.issuerLabel')}>
                    <Input
                      id="sso-issuer"
                      aria-label={t('enterpriseSso.issuerLabel')}
                      placeholder="https://idp.example.com"
                      errorMessage={errors.issuer?.message}
                      {...register('issuer')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  {protocol === 'oauth2' && (
                    <>
                      <SettingsFieldRow
                        label={t('enterpriseSso.authzEndpointLabel')}
                      >
                        <Input
                          id="sso-authz"
                          aria-label={t('enterpriseSso.authzEndpointLabel')}
                          errorMessage={errors.authzEndpoint?.message}
                          {...register('authzEndpoint')}
                          wrapperClassName="w-full"
                        />
                      </SettingsFieldRow>
                      <SettingsFieldRow
                        label={t('enterpriseSso.tokenEndpointLabel')}
                      >
                        <Input
                          id="sso-token-ep"
                          aria-label={t('enterpriseSso.tokenEndpointLabel')}
                          errorMessage={errors.tokenEndpoint?.message}
                          {...register('tokenEndpoint')}
                          wrapperClassName="w-full"
                        />
                      </SettingsFieldRow>
                      <SettingsFieldRow
                        label={t('enterpriseSso.userinfoEndpointLabel')}
                      >
                        <Input
                          id="sso-userinfo"
                          aria-label={t('enterpriseSso.userinfoEndpointLabel')}
                          errorMessage={errors.userinfoEndpoint?.message}
                          {...register('userinfoEndpoint')}
                          wrapperClassName="w-full"
                        />
                      </SettingsFieldRow>
                    </>
                  )}
                  <SettingsFieldRow label={t('enterpriseSso.clientIdLabel')}>
                    <Input
                      id="sso-client-id"
                      aria-label={t('enterpriseSso.clientIdLabel')}
                      errorMessage={errors.clientId?.message}
                      {...register('clientId')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  <SettingsFieldRow
                    label={t('enterpriseSso.clientSecretLabel')}
                    {...(connected
                      ? {
                          description: t('enterpriseSso.clientSecretKeep'),
                        }
                      : {})}
                  >
                    <Input
                      id="sso-client-secret"
                      type="password"
                      aria-label={t('enterpriseSso.clientSecretLabel')}
                      placeholder={connected ? '••••••••' : undefined}
                      errorMessage={errors.clientSecret?.message}
                      {...register('clientSecret')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  <SettingsFieldRow label={t('enterpriseSso.scopesLabel')}>
                    <Input
                      id="sso-scopes"
                      aria-label={t('enterpriseSso.scopesLabel')}
                      {...register('scopes')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                </SettingsFieldList>
                {/* PKCE has one sensible value (on) — a top-level switch
                      invited turning off a security feature, so it lives under
                      Advanced now (#2653). Default unchanged. */}
                <CollapsibleDetails summary={t('enterpriseSso.advanced')}>
                  <Stack gap={4} className="pt-3 pl-5">
                    <Controller
                      control={control}
                      name="pkce"
                      render={({ field }) => (
                        <SettingsToggleRow
                          label={t('enterpriseSso.pkceLabel')}
                          description={t('enterpriseSso.pkceDescription')}
                          // `false` until `data` loads so the Switch stays controlled
                          // from the first render (no uncontrolled→controlled warning).
                          checked={field.value ?? false}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </Stack>
                </CollapsibleDetails>
              </>
            ) : (
              <>
                {/* Import IdP metadata (#2652): parse the federation-metadata
                      XML (by URL or upload) server-side and prefill the three
                      fields below — they stay editable as the review step. */}
                <Card padding="sm">
                  <Stack gap={3}>
                    <Stack gap={1}>
                      <Text variant="label" className="text-sm">
                        {t('enterpriseSso.metadata.title')}
                      </Text>
                      <Text variant="muted" className="text-xs">
                        {t('enterpriseSso.metadata.help')}
                      </Text>
                    </Stack>
                    <Row gap={2} align="end" wrap>
                      <Input
                        id="saml-metadata-url"
                        label={t('enterpriseSso.metadata.urlLabel')}
                        placeholder="https://idp.example.com/federationmetadata.xml"
                        value={metadataUrl}
                        onChange={(e) => setMetadataUrl(e.target.value)}
                        wrapperClassName="min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={
                          !isHttpUrl(metadataUrl.trim()) ||
                          parseMetadata.isPending
                        }
                        onClick={() =>
                          void importMetadata({ url: metadataUrl.trim() })
                        }
                      >
                        {parseMetadata.isPending && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {t('enterpriseSso.metadata.importUrl')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={parseMetadata.isPending}
                        onClick={() => metadataFileRef.current?.click()}
                      >
                        {t('enterpriseSso.metadata.uploadXml')}
                      </Button>
                      {/* Hidden picker; the visible button above carries the
                          accessible name. */}
                      <input
                        ref={metadataFileRef}
                        type="file"
                        accept=".xml,text/xml,application/samlmetadata+xml"
                        className="hidden"
                        tabIndex={-1}
                        aria-hidden="true"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          // Allow re-selecting the same file after a fix.
                          e.target.value = '';
                          if (file) void handleMetadataFile(file);
                        }}
                      />
                    </Row>
                  </Stack>
                </Card>
                <SettingsFieldList>
                  <SettingsFieldRow label={t('enterpriseSso.idpEntityIdLabel')}>
                    <Input
                      id="saml-entity"
                      aria-label={t('enterpriseSso.idpEntityIdLabel')}
                      errorMessage={errors.idpEntityId?.message}
                      {...register('idpEntityId')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  <SettingsFieldRow label={t('enterpriseSso.idpSsoUrlLabel')}>
                    <Input
                      id="saml-sso-url"
                      aria-label={t('enterpriseSso.idpSsoUrlLabel')}
                      errorMessage={errors.idpSsoUrl?.message}
                      {...register('idpSsoUrl')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  <SettingsFieldRow
                    label={t('enterpriseSso.idpCertLabel')}
                    description={t('enterpriseSso.idpCertHelp')}
                  >
                    <Textarea
                      id="saml-cert"
                      aria-label={t('enterpriseSso.idpCertLabel')}
                      rows={4}
                      errorMessage={errors.idpCertificate?.message}
                      {...register('idpCertificate')}
                      wrapperClassName="w-full"
                    />
                  </SettingsFieldRow>
                  <ReadOnlyCopy
                    label={t('enterpriseSso.spMetadataLabel')}
                    value={config?.samlSpMetadataUrl ?? ''}
                  />
                  <ReadOnlyCopy
                    label={t('enterpriseSso.acsUrlLabel')}
                    value={config?.samlAcsUrl ?? ''}
                  />
                </SettingsFieldList>
              </>
            )}

            {/* Per-provider setup guide — collapsed by default so the walkthrough
              prose doesn't dominate the section (the redirect/metadata URLs it
              references are shown up-front above). */}
            <CollapsibleDetails summary={t('enterpriseSso.guide.title')}>
              <Stack gap={3} className="pt-3 pl-5">
                {!isOidcLike ? (
                  <Text variant="muted" className="text-sm">
                    {t('enterpriseSso.guide.samlIntro')}
                  </Text>
                ) : (
                  <ReadOnlyCopy
                    label={t('enterpriseSso.guide.redirectLabel')}
                    value={config?.oidcCallbackUrl ?? ''}
                  />
                )}
                <Text variant="muted" className="text-sm">
                  {t(`enterpriseSso.guide.${guideKey}.intro`)}
                </Text>
                <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
                  {guideSteps.map((s) => (
                    <li key={s}>{t(`enterpriseSso.guide.${guideKey}.${s}`)}</li>
                  ))}
                </ol>
                {protocol === 'generic-oidc' && (
                  <Text variant="muted" className="text-sm">
                    {t('enterpriseSso.guide.google.groupsNote')}
                  </Text>
                )}
              </Stack>
            </CollapsibleDetails>
          </SettingsSection>

          <SettingsSection title={t('enterpriseSso.provisioningSection')}>
            <SettingsFieldList>
              <SettingsFieldRow label={t('enterpriseSso.defaultRoleLabel')}>
                <Controller
                  control={control}
                  name="defaultRole"
                  render={({ field }) => (
                    <Select
                      id="sso-default-role"
                      aria-label={t('enterpriseSso.defaultRoleLabel')}
                      // Default to a defined value so the Select is controlled from
                      // the first render — `field.value` is undefined while `data`
                      // is still loading (avoids the uncontrolled→controlled warning).
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
              </SettingsFieldRow>
              {/* A toggle row is already a settings row — it joins the list so
                  it shares the same divider and vertical rhythm. */}
              <Controller
                control={control}
                name="autoRole"
                render={({ field }) => (
                  <SettingsToggleRow
                    className="py-5"
                    label={t('enterpriseSso.autoRoleLabel')}
                    description={t('enterpriseSso.autoRoleDescription')}
                    // `false` until `data` loads so the Switch stays controlled
                    // from the first render (no uncontrolled→controlled warning).
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              {autoRole && (
                <div className="py-5">
                  <RoleMappingRulesEditor control={control} />
                </div>
              )}
              <Controller
                control={control}
                name="autoTeam"
                render={({ field }) => (
                  <SettingsToggleRow
                    className="py-5"
                    label={t('enterpriseSso.autoTeamLabel')}
                    description={t('enterpriseSso.autoTeamDescription')}
                    // `false` until `data` loads so the Switch stays controlled
                    // from the first render (no uncontrolled→controlled warning).
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <SettingsFieldRow
                label={t('enterpriseSso.excludeGroupsLabel')}
                description={t('enterpriseSso.excludeGroupsHelp')}
              >
                <Input
                  id="sso-exclude-groups"
                  aria-label={t('enterpriseSso.excludeGroupsLabel')}
                  {...register('excludeGroups')}
                  wrapperClassName="w-full"
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          </SettingsSection>

          {/* SCIM stays inline (its own generate/regenerate/disable lifecycle,
              independent of the SSO config Save). Status sits on the title row
              so it scans with the feature name — the far-right `action` slot
              is for a control cluster (see deployment stores), not a lone pill
              while the enable action lives below. */}
          <SettingsSection
            title={
              <HStack gap={2} align="center" wrap>
                {t('enterpriseSso.scim.section')}
                {config?.scim.enabled ? (
                  <Badge variant="green" dot>
                    {t('enterpriseSso.scim.enabled')}
                  </Badge>
                ) : (
                  <Badge variant="slate" dot>
                    {t('enterpriseSso.scim.disabled')}
                  </Badge>
                )}
              </HStack>
            }
            description={t('enterpriseSso.scim.help')}
          >
            <Stack gap={4}>
              {scimToken ? (
                <CopyableField
                  value={scimToken}
                  mono
                  copyAriaLabel={t('enterpriseSso.copy')}
                  description={t('enterpriseSso.scim.tokenCreatedHelp')}
                />
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
                      ? t('enterpriseSso.scim.regenerate')
                      : t('enterpriseSso.scim.generate')}
                  </Button>
                  {config?.scim.enabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() => disableScim.mutate({ organizationId })}
                    >
                      {t('enterpriseSso.scim.disable')}
                    </Button>
                  )}
                </HStack>
              )}
              {config?.scim.baseUrl && (
                <ReadOnlyCopy
                  label={t('enterpriseSso.scim.baseUrlLabel')}
                  value={config.scim.baseUrl}
                />
              )}
            </Stack>
          </SettingsSection>

          {/* Inline actions: Disable / Remove (left) + Test (right). Save and
              Discard live in the settings page header (via the active editor).
              Both left actions are destructive-weight and confirm first —
              Disable turns SSO sign-in off org-wide; Remove wipes the
              connection entirely. */}
          <HStack justify="between" align="center" className="pt-2">
            <HStack gap={2}>
              {connected && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setPendingAction('disable')}
                >
                  {t('enterpriseSso.disable')}
                </Button>
              )}
              {config?.configured && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setPendingAction('remove')}
                >
                  {t('enterpriseSso.remove')}
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
                {t('enterpriseSso.test')}
              </Button>
            )}
          </HStack>
        </Stack>
      </fieldset>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        variant="destructive"
        title={
          pendingAction === 'remove'
            ? t('enterpriseSso.removeConfirmTitle')
            : t('enterpriseSso.disableConfirmTitle')
        }
        description={
          pendingAction === 'remove'
            ? t('enterpriseSso.removeConfirmDescription')
            : t('enterpriseSso.disableConfirmDescription')
        }
        confirmText={
          pendingAction === 'remove'
            ? t('enterpriseSso.remove')
            : t('enterpriseSso.disable')
        }
        isLoading={disableSso.isPending || removeSso.isPending}
        onConfirm={async () => {
          if (pendingAction === 'remove') {
            await removeSso.mutateAsync({ organizationId });
            revealedRef.current = false;
          } else if (pendingAction === 'disable') {
            await disableSso.mutateAsync({ organizationId });
          }
          setPendingAction(null);
        }}
      />
    </form>
  );
}

function ReadOnlyCopy({
  label,
  value,
  helpText,
}: {
  label: string;
  value: string;
  helpText?: string;
}) {
  // A settings field like any other: label + help on the left, the value
  // pinned right in the shared control column — as the standard copyable
  // pill (full value on hover, inline copied feedback), not a hand-rolled
  // code block + button.
  return (
    <SettingsFieldRow
      label={label}
      {...(helpText !== undefined ? { description: helpText } : {})}
    >
      {value ? (
        <CopyableField value={value} copyAriaLabel={label} />
      ) : (
        <Text as="span" variant="muted">
          —
        </Text>
      )}
    </SettingsFieldRow>
  );
}

/**
 * Editor for the IdP → platform role-mapping rules (drives the "auto-assign
 * roles from the IdP" toggle, which is otherwise inert without rules). The
 * first matching rule wins; a user who matches none gets the default role.
 */
function RoleMappingRulesEditor({
  control,
}: {
  control: Control<SsoFormData>;
}) {
  const { t } = useT('settings');
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'roleMappingRules',
  });
  const sourceOptions = ROLE_RULE_SOURCES.map((s) => ({
    value: s,
    label: t(`enterpriseSso.roleMapping.source.${s}`),
  }));
  const roleOptions = ROLE_RULE_TARGETS.map((r) => ({
    value: r,
    label: t(`enterpriseSso.role.${r}`),
  }));

  return (
    <Card padding="sm">
      <Stack gap={3}>
        <Text variant="muted" className="text-sm">
          {t('enterpriseSso.roleMapping.help')}
        </Text>
        {fields.length === 0 ? (
          <Text variant="muted" className="text-sm">
            {t('enterpriseSso.roleMapping.empty')}
          </Text>
        ) : (
          <Stack gap={3}>
            {fields.map((field, index) => (
              <RoleMappingRuleRow
                key={field.id}
                control={control}
                index={index}
                sourceOptions={sourceOptions}
                roleOptions={roleOptions}
                onRemove={() => remove(index)}
              />
            ))}
          </Stack>
        )}
        <HStack>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              append({ source: 'group', pattern: '', targetRole: 'member' })
            }
          >
            {t('enterpriseSso.roleMapping.addRule')}
          </Button>
        </HStack>
      </Stack>
    </Card>
  );
}

function RoleMappingRuleRow({
  control,
  index,
  sourceOptions,
  roleOptions,
  onRemove,
}: {
  control: Control<SsoFormData>;
  index: number;
  sourceOptions: { value: string; label: string }[];
  roleOptions: { value: string; label: string }[];
  onRemove: () => void;
}) {
  const { t } = useT('settings');
  const source = useWatch({
    control,
    name: `roleMappingRules.${index}.source`,
  });

  return (
    <Card padding="sm">
      <Stack gap={2}>
        <Row gap={2} align="end" wrap>
          <Controller
            control={control}
            name={`roleMappingRules.${index}.source`}
            render={({ field }) => (
              <Select
                id={`role-rule-source-${index}`}
                label={t('enterpriseSso.roleMapping.sourceLabel')}
                value={field.value ?? 'group'}
                onValueChange={(value) => {
                  const next = narrowStringUnion<RoleRuleSource>(
                    value,
                    ROLE_RULE_SOURCES,
                  );
                  if (next) field.onChange(next);
                }}
                options={sourceOptions}
              />
            )}
          />
          <Controller
            control={control}
            name={`roleMappingRules.${index}.pattern`}
            render={({ field }) => (
              <Input
                id={`role-rule-pattern-${index}`}
                label={t('enterpriseSso.roleMapping.patternLabel')}
                name={field.name}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <Controller
            control={control}
            name={`roleMappingRules.${index}.targetRole`}
            render={({ field }) => (
              <Select
                id={`role-rule-target-${index}`}
                label={t('enterpriseSso.roleMapping.targetRoleLabel')}
                value={field.value ?? 'member'}
                onValueChange={(value) => {
                  const next = narrowStringUnion<PlatformRole>(
                    value,
                    ROLE_RULE_TARGETS,
                  );
                  if (next) field.onChange(next);
                }}
                options={roleOptions}
              />
            )}
          />
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('enterpriseSso.roleMapping.removeRule')}
          </Button>
        </Row>
        {source === 'claim' && (
          <Controller
            control={control}
            name={`roleMappingRules.${index}.claim`}
            render={({ field }) => (
              <Input
                id={`role-rule-claim-${index}`}
                label={t('enterpriseSso.roleMapping.claimLabel')}
                description={t('enterpriseSso.roleMapping.claimHelp')}
                name={field.name}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        )}
      </Stack>
    </Card>
  );
}
