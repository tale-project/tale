#!/usr/bin/env bun

/**
 * Reset owner credentials via admin-authenticated Convex HTTP client.
 *
 * Reads ADMIN_KEY, CONVEX_URL, RESET_EMAIL, RESET_PASSWORD from env.
 * Outputs JSON result to stdout for the CLI to parse.
 */

import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

const adminKey = process.env.ADMIN_KEY;
const convexUrl = process.env.CONVEX_URL;

if (!adminKey || !convexUrl) {
  console.error('Missing ADMIN_KEY or CONVEX_URL environment variables');
  process.exit(1);
}

const newEmail = process.env.RESET_EMAIL || undefined;
const newPassword = process.env.RESET_PASSWORD || undefined;

if (!newEmail && !newPassword) {
  console.error('At least one of RESET_EMAIL or RESET_PASSWORD must be set');
  process.exit(1);
}

// setAdminAuth exists at runtime but is @internal (not in public types).
// We need it to send the `Convex <adminKey>` auth header for internal functions.
const client = new ConvexHttpClient(convexUrl);
// oxlint-disable-next-line no-unsafe-type-assertion
const setAdminAuth = Reflect.get(client, 'setAdminAuth') as (
  token: string,
) => void;
setAdminAuth.call(client, adminKey);

try {
  const result = await client.mutation(
    anyApi.users.internal_mutations.resetOwner,
    {
      newEmail,
      newPassword,
    },
  );
  console.log(JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
