import type { ArgsOf } from '@/app/lib/backend/contract';
import { isRecord } from '@/lib/utils/type-utils';

/**
 * Per-language cap on the notice text — the bound on `messages` values in
 * `dataNoticeConfigSchema` (@tale/shared/schemas/governance), so the editor
 * never accepts text the server-side parse would reject.
 */
export const DATA_NOTICE_MAX_CHARS = 280;

/**
 * The policy read behind the notice. The chat route's loader warms this same
 * read, so the footer's first render finds it cached and lands together with
 * the composer instead of pushing it up one round-trip later.
 */
export function dataNoticePolicyArgs(
  organizationId: string,
): ArgsOf<'governance/queries:getPolicy'> {
  return { organizationId, policyType: 'data_classification_notice' };
}

export interface DataNoticeSettings {
  enabled: boolean;
  /** Admin-written text by locale code (`en`, `de`, `fr-CH`, …). */
  messages: Readonly<Record<string, string>>;
}

/**
 * Read a stored `data_classification_notice` config. The notice is opt-in: a
 * missing file, or a config that does not say `enabled: true`, reads off.
 */
export function readDataNoticeSettings(rawConfig: unknown): DataNoticeSettings {
  const config = isRecord(rawConfig) ? rawConfig : {};
  const messages = isRecord(config.messages)
    ? Object.fromEntries(
        Object.entries(config.messages).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  return { enabled: config.enabled === true, messages };
}

/**
 * The text a member reading in `locale` sees: the text written for that
 * locale, else for its language (`de` for `de-CH`), else the English text,
 * else the platform default in their language. The settings editor previews
 * this same chain in each field's placeholder.
 */
export function resolveDataNoticeMessage(
  messages: Readonly<Record<string, string>>,
  locale: string,
  platformDefault: string,
): string {
  const language = locale.split('-')[0] ?? locale;
  return (
    messages[locale] ?? messages[language] ?? messages.en ?? platformDefault
  );
}
