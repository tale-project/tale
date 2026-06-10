import { readFileSync } from 'node:fs';

/**
 * Resolve UI labels from `messages/en.json` so locators never hardcode
 * English literals (AGENTS.md i18n rule — the Playwright context pins
 * `locale: 'en-US'`, so the app renders the `en` catalog).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const messagesUrl = new URL('../../messages/en.json', import.meta.url);
const parsed: unknown = JSON.parse(readFileSync(messagesUrl, 'utf8'));
if (!isRecord(parsed)) {
  throw new Error('messages/en.json did not parse to an object');
}
const messages: Record<string, unknown> = parsed;

/** Look up a dot-path key (e.g. `chat.send`) in the English catalog. */
export function t(key: string): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (!isRecord(node)) {
      throw new Error(`Missing en.json key: ${key} (failed at "${part}")`);
    }
    node = node[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`en.json key is not a string: ${key}`);
  }
  return node;
}
