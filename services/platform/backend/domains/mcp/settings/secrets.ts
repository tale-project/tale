/**
 * No secret crosses MCP, in or out. A secret a resource stores reads as a
 * masked value wherever a settings tool answers it, and so does any string
 * the credential detector recognises elsewhere in a stored config — a key
 * someone pasted into an instruction in Tale. A change may carry a masked
 * value back unchanged, which keeps what is stored there, and nothing else
 * in a secret's place; every string a change carries also goes through the
 * credential detector, so a key pasted into a description is refused the
 * same way. A refusal names where a secret was found and what it looked
 * like, never the value.
 */

import { findSecrets } from '../../../../lib/shared/secret-scan.ts';
import { isRecord } from '../../../../lib/utils/type-utils.ts';
import { maskSecret } from '../../../core/provider_credentials/masking.ts';
import type { McpRefusal } from '../refusals.ts';

/** What a secret reads as. Sent back unchanged inside a change, it keeps
 * the value that is stored. */
export interface MaskedSecret {
  readonly masked: true;
  /** A short excerpt Tale shows for the secret, when it has one. */
  readonly preview?: string;
}

export function isMaskedSecret(value: unknown): value is MaskedSecret {
  return (
    isRecord(value) &&
    value.masked === true &&
    Object.keys(value).every((key) => key === 'masked' || key === 'preview') &&
    (value.preview === undefined || typeof value.preview === 'string')
  );
}

/** The masked form of a stored value: an excerpt of a string, nothing of
 * anything else. */
function maskedOf(value: unknown): MaskedSecret {
  if (isMaskedSecret(value)) return value;
  return typeof value === 'string'
    ? { masked: true, preview: maskSecret(value) }
    : { masked: true };
}

// ------------------------------------------------------------ pointers

function escapeToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

const INDEX = /^(?:0|[1-9]\d*)$/;

/** The value at a concrete pointer, if one is there. */
function valueAt(
  root: unknown,
  pointer: string,
): { found: true; value: unknown } | { found: false } {
  let current: unknown = root;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      if (!INDEX.test(token) || Number(token) >= current.length) {
        return { found: false };
      }
      current = current[Number(token)];
    } else if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/** Replace the value at a concrete pointer below the root, in place. */
function replaceAt(root: unknown, pointer: string, next: unknown): void {
  const tokens = pointerTokens(pointer);
  const last = tokens.pop();
  if (last === undefined) return;
  const parent = valueAt(
    root,
    tokens.map((t) => `/${escapeToken(t)}`).join(''),
  );
  if (!parent.found) return;
  if (Array.isArray(parent.value) && INDEX.test(last)) {
    parent.value[Number(last)] = next;
  } else if (isRecord(parent.value)) {
    parent.value[last] = next;
  }
}

/**
 * Every place in `value` a secret path names, as concrete pointers: a `*`
 * token stands for each member or index there. Only places that hold
 * something are named.
 */
export function secretPlaces(
  value: unknown,
  secretPaths: readonly string[],
): string[] {
  const places = new Set<string>();
  const walk = (node: unknown, rest: readonly string[], at: string): void => {
    const [head, ...tail] = rest;
    if (head === undefined) {
      places.add(at);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (head === '*' || head === String(index)) {
          walk(item, tail, `${at}/${index}`);
        }
      });
    } else if (isRecord(node)) {
      for (const [name, item] of Object.entries(node)) {
        if (head === '*' || head === name) {
          walk(item, tail, `${at}/${escapeToken(name)}`);
        }
      }
    }
  };
  for (const path of secretPaths) walk(value, pointerTokens(path), '');
  return [...places];
}

/**
 * Every place a settings tool masks in a stored config: each place a
 * secret path names, and every string the credential detector recognises
 * wherever it sits — a key someone pasted into a description or a header
 * in Tale is masked on the way out, as it is refused on the way in.
 */
export function maskedPlaces(
  value: unknown,
  secretPaths: readonly string[],
): string[] {
  const places = new Set(secretPlaces(value, secretPaths));
  for (const hit of findSecrets(value)) {
    if (hit.pointer !== '') places.add(hit.pointer);
  }
  return [...places];
}

/** A config with every secret it holds masked — what a settings tool
 * answers in place of what is stored. */
export function maskSecrets(
  config: unknown,
  secretPaths: readonly string[],
): unknown {
  const places = maskedPlaces(config, secretPaths);
  if (places.length === 0) return config;
  const masked = structuredClone(config);
  for (const place of places) {
    const stored = valueAt(masked, place);
    if (stored.found) replaceAt(masked, place, maskedOf(stored.value));
  }
  return masked;
}

// ------------------------------------------------------------ refusals

/** One place a change carries a secret: where, and what it looked like. */
interface SecretPlace {
  readonly pointer: string;
  readonly kind: string;
}

/** How many places one refusal names — enough to fix a change, never a
 * hostile one echoed back at length. */
const MAX_PLACES = 20;

function secretRefusal(places: readonly SecretPlace[]): McpRefusal {
  const [first] = places;
  const where = first === undefined ? 'the change' : first.pointer;
  const what = first === undefined ? 'a secret' : first.kind;
  const more = places.length > 1 ? ` (and ${places.length - 1} more)` : '';
  return {
    error: `${what} at ${where}${more}: no secret travels through MCP`,
    code: 'SECRET_ARGUMENT_REFUSED',
    hint: 'leave it out — send back the masked value get_settings answered to keep a stored secret; a person enters a new one in Tale',
    data: { places: places.slice(0, MAX_PLACES) },
  };
}

/**
 * The refusal of a change that carries a secret — anything but the masked
 * value at a secret's place, or a credential anywhere in what it sends —
 * or null when it carries none.
 */
export function secretArgumentRefusal(
  change: { readonly config?: unknown; readonly args?: unknown },
  secretPaths: readonly string[],
): McpRefusal | null {
  const places = new Map<string, SecretPlace>();
  if (change.config !== undefined) {
    for (const place of secretPlaces(change.config, secretPaths)) {
      const sent = valueAt(change.config, place);
      if (sent.found && !isMaskedSecret(sent.value)) {
        const pointer = `/config${place}`;
        places.set(pointer, { pointer, kind: 'a secret value' });
      }
    }
  }
  for (const hit of findSecrets({ config: change.config, args: change.args })) {
    if (!places.has(hit.pointer)) {
      places.set(hit.pointer, { pointer: hit.pointer, kind: hit.label });
    }
  }
  return places.size === 0 ? null : secretRefusal([...places.values()]);
}

/** Every place in a value that holds a masked value. */
function maskedValuePlaces(value: unknown): string[] {
  const places: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (isMaskedSecret(node)) {
      places.push(at);
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}/${index}`));
    } else if (isRecord(node)) {
      for (const [name, item] of Object.entries(node)) {
        walk(item, `${at}/${escapeToken(name)}`);
      }
    }
  };
  walk(value, '');
  return places.filter((place) => place !== '');
}

/**
 * The config a change asks for, with every masked value put back to what
 * is stored at the same place, so the native writer keeps it — at a
 * secret's place and wherever else a read masked a credential. Where the
 * native read itself answers only a mask, the masked value stays for the
 * writer, which keeps its stored secret; a masked value where nothing
 * masked is stored keeps nothing, and is refused.
 */
export function restoreMaskedSecrets(
  config: unknown,
  stored: unknown,
  secretPaths: readonly string[],
): { readonly config: unknown } | { readonly refusal: McpRefusal } {
  const places = maskedValuePlaces(config);
  if (places.length === 0) return { config };
  const kept = new Set(maskedPlaces(stored, secretPaths));
  const restored = structuredClone(config);
  const missing: SecretPlace[] = [];
  for (const place of places) {
    const value = valueAt(stored, place);
    if (!kept.has(place) || !value.found || value.value === null) {
      missing.push({
        pointer: `/config${place}`,
        kind: 'nothing stored to keep',
      });
    } else if (!isMaskedSecret(value.value)) {
      replaceAt(restored, place, value.value);
    }
  }
  if (missing.length > 0) {
    const [first] = missing;
    return {
      refusal: {
        error: `a masked value at ${first?.pointer ?? 'the change'} keeps nothing: no secret is stored there`,
        code: 'SECRET_ARGUMENT_REFUSED',
        hint: 'a new secret is entered in Tale, never sent through MCP; leave the field out',
        data: { places: missing.slice(0, MAX_PLACES) },
      },
    };
  }
  return { config: restored };
}
