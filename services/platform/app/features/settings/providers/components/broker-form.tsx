'use client';

import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import { formatZodError } from '@/lib/shared/schemas/format-error';
import type { BrokerCredentialData } from '@/lib/shared/schemas/providers';
import {
  BROKER_SECRET_ENV_PREFIX,
  brokerCredentialDataSchema,
} from '@/lib/shared/schemas/providers';

/**
 * Form state and fields of one `subscription-broker` credential document
 * (`brokerCredentialDataSchema`). The stored document is encrypted whole and
 * never read back to the client, so the form always starts blank — also when
 * replacing an existing configuration (the server keeps the stored broker
 * secret when the new payload omits it).
 *
 * Everything is held as strings and only shaped into the schema's document on
 * submit ({@link buildBrokerDocument}): blank optionals are omitted so the
 * schema defaults apply, and the whole result is validated client-side with
 * the same zod schema the server enforces.
 */

export interface BrokerDraft {
  endpoint: string;
  httpMethod: 'GET' | 'POST';
  authMethod: 'none' | 'bearer' | 'header';
  headerName: string;
  authSecret: string;
  /** Suffix under the fixed {@link BROKER_SECRET_ENV_PREFIX}. */
  secretEnvSuffix: string;
  tokensPath: string;
  tokenField: string;
  statusField: string;
  activeValue: string;
  expiresField: string;
  targetEnvVar: string;
  selection: 'random' | 'first' | 'round-robin';
  timeoutMs: string;
  maxResponseBytes: string;
  expirySkewMs: string;
}

export function emptyBrokerDraft(): BrokerDraft {
  return {
    endpoint: '',
    httpMethod: 'GET',
    authMethod: 'none',
    headerName: '',
    authSecret: '',
    secretEnvSuffix: '',
    tokensPath: '',
    tokenField: '',
    statusField: '',
    activeValue: '',
    expiresField: '',
    targetEnvVar: '',
    selection: 'random',
    timeoutMs: '',
    maxResponseBytes: '',
    expirySkewMs: '',
  };
}

/** Coarse completeness gate for the dialog's submit button; the full schema
 * check happens in {@link buildBrokerDocument} on submit. */
export function isBrokerDraftComplete(draft: BrokerDraft): boolean {
  return (
    draft.endpoint.trim().length > 0 &&
    draft.tokensPath.trim().length > 0 &&
    draft.tokenField.trim().length > 0 &&
    draft.targetEnvVar.trim().length > 0 &&
    (draft.authMethod !== 'header' || draft.headerName.trim().length > 0)
  );
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Blank → omitted (schema default applies); non-numeric text is passed
 * through as NaN so the schema names the field in its refusal. */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : undefined;
}

export type BrokerBuildResult =
  | { ok: true; document: BrokerCredentialData }
  | { ok: false; message: string };

/**
 * Shape a draft into a `brokerCredentialDataSchema` document, validating it
 * with the exact schema the server enforces so refusals surface before the
 * round-trip. The returned message names the offending field(s).
 */
export function buildBrokerDocument(draft: BrokerDraft): BrokerBuildResult {
  const secretEnv = optionalTrimmed(draft.secretEnvSuffix);
  const auth =
    draft.authMethod === 'none'
      ? { method: 'none' as const }
      : draft.authMethod === 'bearer'
        ? {
            method: 'bearer' as const,
            ...(secretEnv !== undefined && {
              secretEnv: `${BROKER_SECRET_ENV_PREFIX}${secretEnv}`,
            }),
          }
        : {
            method: 'header' as const,
            headerName: draft.headerName.trim(),
            ...(secretEnv !== undefined && {
              secretEnv: `${BROKER_SECRET_ENV_PREFIX}${secretEnv}`,
            }),
          };

  const statusField = optionalTrimmed(draft.statusField);
  const activeValue = optionalTrimmed(draft.activeValue);
  const expiresField = optionalTrimmed(draft.expiresField);
  const timeoutMs = optionalNumber(draft.timeoutMs);
  const maxResponseBytes = optionalNumber(draft.maxResponseBytes);
  const expirySkewMs = optionalNumber(draft.expirySkewMs);
  const authSecret = optionalTrimmed(draft.authSecret);

  const candidate = {
    endpoint: draft.endpoint.trim(),
    httpMethod: draft.httpMethod,
    auth,
    responseMapping: {
      tokensPath: draft.tokensPath.trim(),
      tokenField: draft.tokenField.trim(),
      ...(statusField !== undefined && { statusField }),
      ...(activeValue !== undefined && { activeValue }),
      ...(expiresField !== undefined && { expiresField }),
    },
    targetEnvVar: draft.targetEnvVar.trim(),
    selection: draft.selection,
    ...(timeoutMs !== undefined && { timeoutMs }),
    ...(maxResponseBytes !== undefined && { maxResponseBytes }),
    ...(expirySkewMs !== undefined && { expirySkewMs }),
    ...(authSecret !== undefined && { authSecret }),
  };

  const parsed = brokerCredentialDataSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) };
  }
  return { ok: true, document: parsed.data };
}

interface BrokerFormFieldsProps {
  value: BrokerDraft;
  onChange: (next: BrokerDraft) => void;
  disabled?: boolean;
}

/**
 * The broker configuration fields, compact: the required coordinates
 * (endpoint, auth, response mapping, target variable, selection) are always
 * visible; the tuning knobs and optional mapping fields sit in a collapsed
 * advanced section.
 */
export function BrokerFormFields({
  value,
  onChange,
  disabled,
}: BrokerFormFieldsProps) {
  const { t } = useT('settings');
  const set = (patch: Partial<BrokerDraft>) => onChange({ ...value, ...patch });
  const showSecretFields = value.authMethod !== 'none';

  return (
    <Stack gap={4}>
      <Text as="p" variant="muted" className="text-sm">
        {t('providers.broker.explainer')}
      </Text>
      <Input
        label={t('providers.broker.endpoint')}
        placeholder="https://broker.example.com/tokens"
        value={value.endpoint}
        onChange={(e) => set({ endpoint: e.target.value })}
        disabled={disabled}
        required
      />
      <div className="flex flex-col gap-4">
        <Select
          label={t('providers.broker.httpMethod')}
          value={value.httpMethod}
          onValueChange={(next) =>
            set({ httpMethod: next === 'POST' ? 'POST' : 'GET' })
          }
          options={[
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
          ]}
          disabled={disabled}
        />
        <Select
          label={t('providers.broker.auth')}
          value={value.authMethod}
          onValueChange={(next) =>
            set({
              authMethod:
                next === 'bearer' || next === 'header' ? next : 'none',
            })
          }
          options={[
            { value: 'none', label: t('providers.broker.authNone') },
            { value: 'bearer', label: t('providers.broker.authBearer') },
            { value: 'header', label: t('providers.broker.authHeader') },
          ]}
          disabled={disabled}
        />
      </div>
      {value.authMethod === 'header' && (
        <Input
          label={t('providers.broker.headerName')}
          placeholder="X-Broker-Token"
          value={value.headerName}
          onChange={(e) => set({ headerName: e.target.value })}
          disabled={disabled}
          required
        />
      )}
      {showSecretFields && (
        <>
          <Input
            label={t('providers.broker.authSecret')}
            type="password"
            value={value.authSecret}
            onChange={(e) => set({ authSecret: e.target.value })}
            description={t('providers.broker.authSecretHelp')}
            disabled={disabled}
          />
          <Input
            label={t('providers.broker.secretEnv')}
            prefix={BROKER_SECRET_ENV_PREFIX}
            value={value.secretEnvSuffix}
            onChange={(e) => set({ secretEnvSuffix: e.target.value })}
            description={t('providers.broker.secretEnvHelp')}
            disabled={disabled}
          />
        </>
      )}
      <div className="flex flex-col gap-4">
        <Input
          label={t('providers.broker.tokensPath')}
          placeholder="$.tokens"
          value={value.tokensPath}
          onChange={(e) => set({ tokensPath: e.target.value })}
          disabled={disabled}
          required
        />
        <Input
          label={t('providers.broker.tokenField')}
          placeholder="access_token"
          value={value.tokenField}
          onChange={(e) => set({ tokenField: e.target.value })}
          disabled={disabled}
          required
        />
      </div>
      <div className="flex flex-col gap-4">
        <Input
          label={t('providers.broker.targetEnvVar')}
          placeholder="CLAUDE_CODE_OAUTH_TOKEN"
          value={value.targetEnvVar}
          onChange={(e) => set({ targetEnvVar: e.target.value })}
          description={t('providers.broker.targetEnvVarHelp')}
          disabled={disabled}
          required
        />
        <Select
          label={t('providers.broker.selection')}
          value={value.selection}
          onValueChange={(next) =>
            set({
              selection:
                next === 'first' || next === 'round-robin' ? next : 'random',
            })
          }
          options={[
            { value: 'random', label: t('providers.broker.selectionRandom') },
            { value: 'first', label: t('providers.broker.selectionFirst') },
            {
              value: 'round-robin',
              label: t('providers.broker.selectionRoundRobin'),
            },
          ]}
          disabled={disabled}
        />
      </div>
      <CollapsibleDetails summary={t('providers.broker.advanced')}>
        <Stack gap={4} className="pt-3 pl-5">
          <div className="flex flex-col gap-4">
            <Input
              label={t('providers.broker.statusField')}
              placeholder="status"
              value={value.statusField}
              onChange={(e) => set({ statusField: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('providers.broker.activeValue')}
              placeholder="active"
              value={value.activeValue}
              onChange={(e) => set({ activeValue: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('providers.broker.expiresField')}
              placeholder="expires_at"
              value={value.expiresField}
              onChange={(e) => set({ expiresField: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('providers.broker.timeoutMs')}
              type="number"
              inputMode="numeric"
              placeholder="10000"
              value={value.timeoutMs}
              onChange={(e) => set({ timeoutMs: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('providers.broker.maxResponseBytes')}
              type="number"
              inputMode="numeric"
              placeholder="262144"
              value={value.maxResponseBytes}
              onChange={(e) => set({ maxResponseBytes: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('providers.broker.expirySkewMs')}
              type="number"
              inputMode="numeric"
              placeholder="300000"
              value={value.expirySkewMs}
              onChange={(e) => set({ expirySkewMs: e.target.value })}
              disabled={disabled}
            />
          </div>
        </Stack>
      </CollapsibleDetails>
    </Stack>
  );
}
