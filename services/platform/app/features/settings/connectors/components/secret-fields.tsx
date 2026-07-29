'use client';

import { Input } from '@/app/components/ui/forms/input';
import { useT } from '@/lib/i18n/client';
import type { ConnectorAuthMethodName } from '@/lib/shared/schemas/connectors';

/**
 * Form state and fields of the secret half of one credential, shared by the
 * "add credential" and "replace secret" dialogs.
 *
 * Every method's material is held here as strings and shaped into the call's
 * arguments on submit ({@link buildSecretArgs}): `api-key` and `bearer` carry
 * one token, `basic` carries a username and password. `oauth2` has no fields
 * at all — its tokens come back from the consent flow, never from a form, so
 * the group renders nothing for it. Stored secrets are never read back, so the
 * fields always start blank, including when replacing an existing secret.
 */

export interface SecretDraft {
  token: string;
  username: string;
  password: string;
}

export function emptySecretDraft(): SecretDraft {
  return { token: '', username: '', password: '' };
}

/** Whether the method's required fields are filled — the dialogs' submit gate.
 * `oauth2` is complete by construction: there is nothing to fill in. */
export function isSecretDraftComplete(
  method: ConnectorAuthMethodName,
  draft: SecretDraft,
): boolean {
  if (method === 'basic') {
    return draft.username.trim().length > 0 && draft.password.trim().length > 0;
  }
  return method === 'oauth2' || draft.token.trim().length > 0;
}

/** The method's secret arguments, trimmed. Fields the method doesn't use are
 * omitted rather than sent empty, so the server validates one clean shape. */
export function buildSecretArgs(
  method: ConnectorAuthMethodName,
  draft: SecretDraft,
): { token?: string; username?: string; password?: string } {
  if (method === 'basic') {
    return {
      username: draft.username.trim(),
      password: draft.password.trim(),
    };
  }
  if (method === 'oauth2') return {};
  return { token: draft.token.trim() };
}

interface SecretFieldsProps {
  method: ConnectorAuthMethodName;
  value: SecretDraft;
  onChange: (next: SecretDraft) => void;
  disabled?: boolean;
}

export function SecretFields({
  method,
  value,
  onChange,
  disabled,
}: SecretFieldsProps) {
  const { t } = useT('settings');

  if (method === 'oauth2') return null;

  if (method === 'basic') {
    return (
      <>
        <Input
          label={t('connectors.dialog.username')}
          value={value.username}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
          autoComplete="off"
          sensitive
          disabled={disabled}
          required
        />
        <Input
          label={t('connectors.dialog.password')}
          type="password"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
          disabled={disabled}
          required
        />
      </>
    );
  }

  return (
    <Input
      label={
        method === 'api-key'
          ? t('connectors.dialog.apiKey')
          : t('connectors.dialog.token')
      }
      type="password"
      value={value.token}
      onChange={(e) => onChange({ ...value, token: e.target.value })}
      description={
        method === 'bearer' ? t('connectors.dialog.tokenHelp') : undefined
      }
      disabled={disabled}
      required
    />
  );
}
