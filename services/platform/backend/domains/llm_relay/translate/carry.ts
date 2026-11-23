import type { SharedV4ProviderOptions } from '@ai-sdk/provider';

import { isRecord } from '../../../../lib/utils/type-utils.ts';

/**
 * What a provider asks to have back with a part of its answer, carried
 * through a client that cannot know it (tale-project/tale#4942).
 *
 * A thinking model's answer comes with a proof of its thinking: Anthropic
 * signs each thinking block, and refuses a later turn of a tool loop whose
 * thinking comes back without its signature; Google signs a call with a
 * thought signature it wants on the call when it comes back. A client on
 * another wire has no field for either — but each keeps one opaque field it
 * sends back as it got it: the Responses API's `encrypted_content`, GenAI's
 * `thoughtSignature`, Anthropic's thinking `signature`, and the
 * `reasoning_details` an OpenAI-compatible client repeats. The relay seals
 * what the provider asked for into that field, and unseals it when the
 * client sends the turn back.
 *
 * Only the fields below are ever unsealed: a client that writes its own
 * value into the carrier reaches nothing else of the provider's options.
 * Its own value is only ever proof of thinking, which the provider checks.
 */

/** The provider fields a carrier may hold, by provider. */
const CARRIED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['signature', 'redactedData'],
  google: ['thoughtSignature'],
};

/**
 * Where a provider package reports a carried field under another name than
 * the one it reads it back from. The OpenAI-compatible package reports
 * Google's thought signature under the provider's own name — the relay names
 * it `upstream` (`upstream.ts`) — but reads it back from `google`.
 */
const REPORTED_AS: Readonly<Record<string, string>> = {
  upstream: 'google',
};

/** The most a carried field may hold. A thinking signature is a few
 * kilobytes. */
const MAX_FIELD_LENGTH = 64 * 1024;

const SEALED = 'tale-relay.v1:';

/** A provider's carryable fields, by provider. */
export type CarriedOptions = Record<string, Record<string, string>>;

/**
 * What the relay carries for one stretch of an answer: what the provider
 * asked to have back with a thinking part, with the text it was signed
 * with, and with each call that followed it, by the call's id on the
 * client's wire. A wire with a field on the thinking part alone carries a
 * call's fields there too (Google signs calls, not thoughts).
 */
export interface Carried {
  /** For the thinking part. */
  options?: CarriedOptions;
  /** The reasoning text as the provider wrote it: a signature holds only
   * for that text, so the relay restores it rather than trust the
   * client's copy. */
  text?: string;
  /** For the calls that followed, by call id. */
  calls?: Record<string, CarriedOptions>;
}

/** The carryable fields of a provider's metadata, or undefined when it
 * asks for nothing back. */
export function carriedOptions(metadata: unknown): CarriedOptions | undefined {
  if (!isRecord(metadata)) return undefined;
  const options: CarriedOptions = {};
  const sources = [
    ...Object.keys(CARRIED_FIELDS).map((provider) => [provider, provider]),
    ...Object.entries(REPORTED_AS),
  ];
  for (const [source = '', provider = ''] of sources) {
    const given = metadata[source];
    const fields = CARRIED_FIELDS[provider] ?? [];
    if (!isRecord(given)) continue;
    for (const field of fields) {
      const value = given[field];
      if (typeof value !== 'string' || value === '') continue;
      if (value.length > MAX_FIELD_LENGTH) {
        console.warn(
          `[llm-relay] a provider's ${provider}.${field} is over ${MAX_FIELD_LENGTH} characters; not carried`,
        );
        continue;
      }
      options[provider] = { ...options[provider], [field]: value };
    }
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

/** Merge what two parts of one turn carry (a thinking block's start and
 * its end can each say part of it). */
export function mergeCarried(
  into: CarriedOptions | undefined,
  more: CarriedOptions | undefined,
): CarriedOptions | undefined {
  if (more === undefined) return into;
  const merged: CarriedOptions = { ...into };
  for (const [provider, fields] of Object.entries(more)) {
    merged[provider] = { ...merged[provider], ...fields };
  }
  return merged;
}

/** The carrier's value: the relay's mark and the carried facts, base64url
 * JSON. Undefined when there is nothing to carry. */
export function seal(carried: Carried | undefined): string | undefined {
  if (carried === undefined) return undefined;
  const calls = Object.entries(carried.calls ?? {}).filter(
    ([, options]) => Object.keys(options).length > 0,
  );
  if (carried.options === undefined && calls.length === 0) return undefined;
  const payload: Record<string, unknown> = {};
  if (carried.options !== undefined) payload.o = carried.options;
  if (carried.text !== undefined) payload.t = carried.text;
  if (calls.length > 0) payload.c = Object.fromEntries(calls);
  return `${SEALED}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

/** Whether a carrier's value is the relay's own. */
export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SEALED);
}

/**
 * What a carrier's value gives back, or undefined when it is not the
 * relay's (a vendor's own value, which means nothing to another provider)
 * or does not read.
 */
export function unseal(value: unknown): Carried | undefined {
  if (!isSealed(value)) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(value.slice(SEALED.length), 'base64url').toString('utf8'),
    );
  } catch (error) {
    // The parser's message would quote what the client sent: say only
    // that it did not read.
    console.warn(
      `[llm-relay] a carried value does not read (${error instanceof SyntaxError ? 'not JSON' : 'not base64url'}); dropped`,
    );
    return undefined;
  }
  if (!isRecord(payload)) return undefined;
  const carried: Carried = {};
  const options = carriedOptions(payload.o);
  if (options !== undefined) carried.options = options;
  if (options !== undefined && typeof payload.t === 'string') {
    carried.text = payload.t;
  }
  if (isRecord(payload.c)) {
    const calls: Record<string, CarriedOptions> = {};
    for (const [id, given] of Object.entries(payload.c)) {
      const callOptions = carriedOptions(given);
      if (callOptions !== undefined && id !== '__proto__') {
        calls[id] = callOptions;
      }
    }
    if (Object.keys(calls).length > 0) carried.calls = calls;
  }
  return carried.options === undefined && carried.calls === undefined
    ? undefined
    : carried;
}

/** The SDK's provider options for the thinking part that carried
 * `carried`, or for one of the calls it carried. */
export function providerOptionsOf(
  carried: Carried | undefined,
  callId?: string,
): SharedV4ProviderOptions | undefined {
  if (carried === undefined) return undefined;
  if (callId === undefined) return carried.options;
  // An own key only: a call id such as `constructor` names nothing here.
  return carried.calls !== undefined && Object.hasOwn(carried.calls, callId)
    ? carried.calls[callId]
    : undefined;
}
