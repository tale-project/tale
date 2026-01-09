'use server';

import { revalidateTag } from 'next/cache';

/**
 * Revalidate the users cache after a new user is created.
 * This ensures the hasAnyUsers check returns the correct value
 * and prevents redirecting to sign-up when users already exist.
 */
export async function revalidateUsersCache() {
  revalidateTag('users', 'max');
}
