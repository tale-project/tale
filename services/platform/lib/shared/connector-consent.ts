/**
 * What a connector OAuth consent is FOR, from the click that starts it to the
 * callback that stores it:
 *
 *   `add`        Add credential > <connector> > Connect: store a NEW
 *                credential, whatever the organization already holds,
 *                born with the per-credential settings (`config`) the
 *                person entered beside Connect — Outlook's `mailbox`, which
 *                also decides the permissions the consent asks for.
 *   `reconnect`  a credential row's Reconnect: renew exactly `credentialId`,
 *                keeping its name, default flag, settings and references.
 *
 * The start door reads the intent from query parameters — no credential is
 * an Add, so a link that predates the parameter can never overwrite a
 * credential — and the pending authorization carries it server-side; the
 * callback request never names it. The page that writes the parameters and
 * the door that reads them share this module, so the two cannot drift apart
 * into a Reconnect that silently lands as an Add, or settings that silently
 * drop. Layer A — no imports.
 */

/** A credential's per-credential settings, as a consent carries them. */
export type ConsentConfig = Readonly<Record<string, string | number | boolean>>;

export type ConsentIntent =
  | { kind: 'add'; config?: ConsentConfig }
  | { kind: 'reconnect'; credentialId: string };

/** The start door's query parameter naming the credential a Reconnect renews. */
export const RECONNECT_CREDENTIAL_PARAM = 'credentialId';

/** The start door's query parameter carrying an Add's settings, as JSON. */
export const CONSENT_CONFIG_PARAM = 'config';

/** Longer than any settings a connector declares — a probe, not a consent. */
const CONSENT_CONFIG_MAX = 4096;

/** An Add's settings as the start door's query parameter carries them. */
export function encodeConsentConfig(config: ConsentConfig): string {
  return JSON.stringify(config);
}

/**
 * The settings an Add's start link carries, or null when the parameter is
 * not a flat JSON object of strings, numbers and booleans within bounds —
 * a broken or forged link, which the door refuses rather than reading as no
 * settings. Whether the connector takes them is the credential domain's
 * question, asked next.
 */
export function decodeConsentConfig(raw: string): ConsentConfig | null {
  if (raw.length === 0 || raw.length > CONSENT_CONFIG_MAX) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const config: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      return null;
    }
    config[key] = value;
  }
  return config;
}
