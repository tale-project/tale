/**
 * When a grant ends, as the grant and edit dialogs offer it: never, or a
 * span from the moment the admin saves. The register stores the instant
 * (`expiresAt`, epoch ms) and refuses one in the past.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const EXPIRY_CHOICES = ['never', '30days', '90days', '1year'] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const EXPIRY_MS: Record<ExpiryChoice, number | null> = {
  never: null,
  '30days': 30 * DAY_MS,
  '90days': 90 * DAY_MS,
  '1year': 365 * DAY_MS,
};

export function isExpiryChoice(value: string): value is ExpiryChoice {
  return (EXPIRY_CHOICES as readonly string[]).includes(value);
}

/** The instant a grant saved at `now` ends; null for no end. */
export function expiresAtFor(choice: ExpiryChoice, now: number): number | null {
  const span = EXPIRY_MS[choice];
  return span === null ? null : now + span;
}

/** The longest evidence the register accepts. */
export const EVIDENCE_MAX = 2000;
