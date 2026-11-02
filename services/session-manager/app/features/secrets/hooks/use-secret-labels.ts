import { useMemo } from 'react';

import type { SecretKind, SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

export interface SecretLabels {
  /** "Credit card": the name of a kind of secret. */
  kind: (kind: SecretKind) => string;
  /** One line on what a kind of secret holds. */
  kindHint: (kind: SecretKind) => string;
  /** A made-up title of a kind, as the title field's placeholder. */
  titleExample: (kind: SecretKind) => string;
  /**
   * A field's label as the person reads it. The server words the starting
   * fields of each kind in English; those it knows by name (whatever their
   * case) are translated, and any other label stays as it was typed.
   */
  field: (label: string) => string;
  /** "Credentials · Every session", or "Note · Session 0003": what a secret is and who it is for. */
  summary: (secret: Pick<SecretSummary, 'kind' | 'session'>) => string;
}

/**
 * The words of the kinds and of their starting fields in the person's
 * language. The server names both in English only, and what a secret stores is
 * the text typed: a label no catalog knows is shown as it is.
 */
export function useSecretLabels(): SecretLabels {
  const { t } = useT('secrets');
  return useMemo(() => {
    const kinds: Record<SecretKind, string> = {
      personal: t('kinds.personal'),
      credentials: t('kinds.credentials'),
      card: t('kinds.card'),
      note: t('kinds.note'),
    };
    const hints: Record<SecretKind, string> = {
      personal: t('kindHints.personal'),
      credentials: t('kindHints.credentials'),
      card: t('kindHints.card'),
      note: t('kindHints.note'),
    };
    const examples: Record<SecretKind, string> = {
      personal: t('titleExamples.personal'),
      credentials: t('titleExamples.credentials'),
      card: t('titleExamples.card'),
      note: t('titleExamples.note'),
    };
    const fields = new Map<string, string>([
      ['name', t('fields.name')],
      ['email', t('fields.email')],
      ['phone', t('fields.phone')],
      ['address', t('fields.address')],
      ['company', t('fields.company')],
      ['company address', t('fields.companyAddress')],
      ['website', t('fields.website')],
      ['username', t('fields.username')],
      ['password', t('fields.password')],
      ['cardholder', t('fields.cardholder')],
      ['card number', t('fields.cardNumber')],
      ['expiry', t('fields.expiry')],
      ['cvc', t('fields.cvc')],
      ['note', t('fields.note')],
    ]);
    const scope = ({ session }: Pick<SecretSummary, 'session'>) =>
      session === null
        ? t('scope.everySession')
        : t('scope.session', { name: session.name });
    return {
      kind: (kind) => kinds[kind],
      kindHint: (kind) => hints[kind],
      titleExample: (kind) => examples[kind],
      field: (label) => fields.get(label.trim().toLowerCase()) ?? label,
      summary: (secret) =>
        t('summary', { kind: kinds[secret.kind], scope: scope(secret) }),
    };
  }, [t]);
}
