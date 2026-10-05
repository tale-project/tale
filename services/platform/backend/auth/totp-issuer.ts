import { z } from 'zod';

/** A deployment label, never an origin or a runtime's Node production mode. */
export const totpEnvironmentSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,31}$/i,
    'TOTP_ENVIRONMENT must be an environment label of 1 to 32 letters, digits, underscores or hyphens',
  )
  .transform((value) => value.toUpperCase())
  .optional();

/** Production retains the familiar name; other deployments identify themselves. */
export function totpIssuer(name: string, environment?: string): string {
  const label = totpEnvironmentSchema.parse(environment);
  return label === undefined || label === 'PR' ? name : `${name} <${label}>`;
}
