import { expect, type APIRequestContext } from '@playwright/test';

import {
  secretSchema,
  type Secret,
  type SecretCreate,
  type Session,
} from '../../../lib/api/schemas';
import type { AppApi } from './api';

/** Values that must stay out of every place a page does not reveal them. */
export const PASSWORD = 'hunter2-secret';
export const CARD_NUMBER = '4242 4242 4242 4242';
export const CVC = '7391';

// The secrets of a spec are written the way the server words them: the labels
// are its own (`backend/domains/secrets/vault.ts`), whose masking rules decide
// that a password, a card number and a CVC are hidden.

export const CREDENTIALS: SecretCreate = {
  kind: 'credentials',
  title: 'Example shop',
  fields: [
    { label: 'Website', value: 'https://shop.example' },
    { label: 'Username', value: 'ann' },
    { label: 'Password', value: PASSWORD },
  ],
};

export const CARD: SecretCreate = {
  kind: 'card',
  title: 'Visa ending 4242',
  fields: [
    { label: 'Cardholder', value: 'Ann Example' },
    { label: 'Card number', value: CARD_NUMBER },
    { label: 'Expiry', value: '12/30' },
    { label: 'CVC', value: CVC },
  ],
};

export const PERSONAL: SecretCreate = {
  kind: 'personal',
  title: 'My details',
  fields: [
    { label: 'Name', value: 'Ann Example' },
    { label: 'Email', value: 'ann@example.com' },
    { label: 'Phone', value: '+49 30 1234567' },
  ],
};

export const NOTE: SecretCreate = {
  kind: 'note',
  title: 'Notes',
  fields: [{ label: 'Note', value: 'remember the milk' }],
};

/** Sessions with these names, each running with a proxy of its own. */
export async function sessionsNamed(
  api: AppApi,
  ...names: string[]
): Promise<Session[]> {
  await api.addProxies(names.length);
  const sessions: Session[] = [];
  for (const name of names) {
    const created = await api.createSession(name);
    sessions.push(await api.waitForStatus(created.id, 'running'));
  }
  return sessions;
}

/** The whole secret as the backend stores it, hidden values included. */
export async function storedSecret(
  request: APIRequestContext,
  id: number,
): Promise<Secret> {
  const response = await request.get(`/api/secrets/${id}`);
  expect(response.ok(), `GET /api/secrets/${id}`).toBe(true);
  return secretSchema.parse(await response.json());
}
