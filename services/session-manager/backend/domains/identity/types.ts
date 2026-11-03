// The identity of a session: what its browser says it is. An identity is drawn
// once, at session creation, and stored. Camoufox draws a few more values at
// random on every launch (fonts spacing, audio and canvas seeds, the WebGL
// pair, the history length): they are pinned here so that every start of the
// session looks the same. `fingerprints.ts` draws identities.

import type { Fingerprint } from 'fingerprint-generator';
import { z } from 'zod';

import { isRecord } from '../../../lib/is-record.ts';

export const IDENTITY_SCHEMA = 1;

export const identitySchema = z.object({
  schema: z.literal(IDENTITY_SCHEMA),
  os: z.enum(['windows', 'macos', 'linux']),
  /** The fingerprint as drawn (the parts Camoufox maps into its config). */
  fingerprint: z.custom<Fingerprint>(isRecord),
  /**
   * Camoufox config values that `camoufox-js` would draw at random on every
   * launch, pinned: `audio:seed`, `canvas:seed`, `fonts:spacing_seed`,
   * `window.history.length`, `canvas:aaOffset`.
   */
  pinned: z.record(z.string(), z.union([z.number(), z.boolean()])),
  /** The WebGL vendor and renderer pair. */
  webgl: z.tuple([z.string(), z.string()]),
  /** The largest screen the fingerprint was drawn for. */
  maxScreen: z.tuple([z.number(), z.number()]),
  /** The language, e.g. `de-CH`; null: drawn at the next start. */
  locale: z.string().nullable(),
});
export type Identity = z.infer<typeof identitySchema>;
export type IdentityOs = Identity['os'];

export function identityToJson(identity: Identity): string {
  return JSON.stringify(identity);
}

/** Throws for a stored identity of a shape this release does not know. */
export function identityFromJson(text: string): Identity {
  return identitySchema.parse(JSON.parse(text));
}

/** What lists and the UI show of an identity. */
export interface Summary {
  userAgent: string | null;
  platform: string | null;
  /** "WIDTHxHEIGHT" */
  screen: string | null;
  /** The spoofed WebGL unmasked renderer. */
  gpu: string | null;
}

export interface GeneratedIdentity {
  identity: Identity;
  /** Signature of the attributes a page can see; unique across sessions. */
  visibleSignature: string;
  /** The same plus the noise seeds; unique across sessions. */
  fullSignature: string;
  summary: Summary;
}

/** No suitable identity could be drawn. The message is for the person using the app. */
export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** The geo data of an IP, from the local GeoIP database. */
export interface GeoInfo {
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  /** A RANDOM pick for the country (see `pickLocale`): resolve once and pin it. */
  locale: string;
  timezone: string;
  latitude: number;
  longitude: number;
}

export class GeoLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoLookupError';
  }
}

/**
 * Where a session says it is: its timezone and geolocation, those of the exit
 * IP it started with. It is kept as it was derived (even if the GeoIP database
 * changes its mind) for as long as that is the session's exit IP, so that the
 * same session with the same IP always reports the same place.
 */
export interface Location {
  ip: string;
  country: string | null;
  timezone: string;
  latitude: number;
  longitude: number;
}

export function locationOf(ip: string, info: GeoInfo): Location {
  return {
    ip,
    country: info.country,
    timezone: info.timezone,
    latitude: info.latitude,
    longitude: info.longitude,
  };
}

const locationSchema = z.object({
  ip: z.string(),
  country: z.string().nullable(),
  timezone: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export function locationToJson(location: Location): string {
  return JSON.stringify(location);
}

export function locationFromJson(text: string): Location {
  return locationSchema.parse(JSON.parse(text));
}
