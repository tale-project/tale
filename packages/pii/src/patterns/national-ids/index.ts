/**
 * National-identity-number detection — one pattern per locale per ID spec.
 *
 * Detection strategy
 *   - Each enabled locale's JSON declares zero or more `NationalIdSpec`
 *     entries (German Personalausweis, French NIR, Italian Codice
 *     Fiscale, Brazilian CPF, etc.). The factory walks every enabled
 *     locale, compiles each spec's regex, and wires the named `checksum`
 *     to its implementation in `builders.ts`.
 *   - Returning an explicit list (not a single composed regex) is
 *     intentional: each spec has its own validator and replacement
 *     token. Composing them into a single alternation would lose the
 *     ability to apply the right checksum to the right match.
 *
 * Locale awareness
 *   - Fully data-driven. Adding a new national ID = adding a JSON entry
 *     and (if a new algorithm is needed) a new function in `builders.ts`.
 */

import type { PiiPattern, PiiPatternFactory } from '../../core/types';
import type { NationalIdSpec } from '../../locales/types';
import {
  arCuilCheck,
  auTfnCheck,
  beNrnCheck,
  brCpfCheck,
  deSteuerIdCheck,
  ean13Check,
  esDniCheck,
  esNieCheck,
  hkHkidCheck,
  icao9303Check,
  ieMod23Check,
  ilTeudatZehutCheck,
  luhnCheck,
  mxCurpCheck,
  nlBsnCheck,
  nzIrdCheck,
  peselMod10Check,
  roCnpCheck,
  sePersonnummerCheck,
  trTcknCheck,
  verhoeffCheck,
  zhResidentIdCheck,
} from './builders';

/**
 * Resolve a checksum name into a `(matchedText) => boolean` validator.
 *
 * Returns `undefined` when the spec declares no checksum — the regex
 * match is then accepted as-is. Returns a function that always returns
 * `false` (i.e. rejects every match) when the checksum name is unknown,
 * with a debug log so a JSON typo is loud at first use.
 */
function resolveValidator(
  spec: NationalIdSpec,
): ((m: string) => boolean) | undefined {
  if (!spec.checksum) return undefined;
  switch (spec.checksum) {
    case 'icao9303': {
      const len = spec.checksumLength ?? 9;
      return (m) => icao9303Check(m, len);
    }
    case 'luhn':
      return (m) => luhnCheck(m.replace(/\D/g, ''));
    case 'mod11-bsn':
      return (m) => nlBsnCheck(m.replace(/\D/g, ''));
    case 'mod11-cpf':
      return (m) => brCpfCheck(m.replace(/\D/g, ''));
    case 'mod11-2-cn':
      return (m) => zhResidentIdCheck(m.toUpperCase());
    case 'verhoeff':
      return (m) => verhoeffCheck(m.replace(/\D/g, ''));
    case 'pesel-mod10':
      return (m) => peselMod10Check(m.replace(/\D/g, ''));
    case 'ie-mod23':
      return (m) => ieMod23Check(m.toUpperCase());
    case 'ean13':
      return (m) => ean13Check(m.replace(/\D/g, ''));
    case 'es-dni':
      return (m) => esDniCheck(m.replace(/[^\dA-Z]/gi, '').toUpperCase());
    case 'es-nie':
      return (m) => esNieCheck(m.replace(/[^\dA-Z]/gi, '').toUpperCase());
    case 'be-nrn':
      return (m) => beNrnCheck(m.replace(/\D/g, ''));
    case 'au-tfn':
      return (m) => auTfnCheck(m.replace(/\D/g, ''));
    case 'nz-ird':
      return (m) => nzIrdCheck(m.replace(/\D/g, ''));
    case 'ar-cuil':
      return (m) => arCuilCheck(m.replace(/\D/g, ''));
    case 'hk-hkid':
      return (m) => hkHkidCheck(m.replace(/[^A-Z\d]/gi, '').toUpperCase());
    case 'mx-curp':
      return (m) => mxCurpCheck(m.replace(/\s/g, '').toUpperCase());
    case 'de-steuer-id':
      return (m) => deSteuerIdCheck(m.replace(/\D/g, ''));
    case 'ro-cnp':
      return (m) => roCnpCheck(m.replace(/\D/g, ''));
    case 'tr-tckn':
      return (m) => trTcknCheck(m.replace(/\D/g, ''));
    case 'se-personnummer':
      return (m) => sePersonnummerCheck(m.replace(/\D/g, ''));
    case 'il-teudat-zehut':
      return (m) => ilTeudatZehutCheck(m.replace(/\D/g, ''));
    default: {
      // Exhaustive-check sentinel — if a new checksum is added to the
      // Zod enum without a handler here, the compiler error catches it.
      const _exhaustive: never = spec.checksum;
      console.debug(
        `[pii] unknown national-id checksum ${String(_exhaustive)} on spec ${spec.id}`,
      );
      return () => false;
    }
  }
}

function specToPattern(spec: NationalIdSpec): PiiPattern {
  return {
    name: spec.id,
    regex: new RegExp(spec.pattern, 'g'),
    validate: resolveValidator(spec),
    replacement: spec.replacement,
  };
}

export const nationalIdFactory: PiiPatternFactory = (locales) => {
  const out: PiiPattern[] = [];
  for (const locale of locales) {
    for (const spec of locale.nationalIds) {
      out.push(specToPattern(spec));
    }
  }
  return out;
};
