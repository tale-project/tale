/**
 * National-ID pattern factory — one runtime pattern per locale spec.
 *
 * Each enabled locale dataset declares its ID specs (regex source,
 * optional checksum name, replacement token). The factory compiles each
 * spec with the `g` flag and wires the named checksum — including its
 * input normalization (which characters to strip, whether to uppercase)
 * — through one exhaustive switch. An explicit per-spec pattern list is
 * deliberate: folding the specs into one alternation would lose the
 * ability to run the right checksum on the right match.
 *
 * Spec regex sources were already vetted (compile + static safety) when
 * the registry ingested the locale data, so compiling here cannot throw.
 */

import type { PiiPattern } from '../../core/types';
import type { NationalIdSpec } from '../../schema';
import type { NativePatternBuilder } from '../native';
import {
  arCuilCheck,
  auTfnCheck,
  beNrnCheck,
  brCnpjCheck,
  brCpfCheck,
  czRcCheck,
  deSteuerIdCheck,
  dkCprCheck,
  ean13Check,
  esDniCheck,
  esNieCheck,
  frNirCheck,
  hkHkidCheck,
  icao9303Check,
  ieMod23Check,
  ilTeudatZehutCheck,
  itCodiceFiscaleCheck,
  jpMyNumberCheck,
  krRrnCheck,
  luhnCheck,
  mxCurpCheck,
  myMykadCheck,
  nlBsnCheck,
  nzIrdCheck,
  peselMod10Check,
  ptNifCheck,
  roCnpCheck,
  ruInn12Check,
  sePersonnummerCheck,
  sgNricCheck,
  trTcknCheck,
  verhoeffCheck,
  zhResidentIdCheck,
} from './checksums';

/**
 * Map a spec's checksum name to a match validator, or undefined when the
 * spec declares none (regex-only acceptance — reserved for forms with
 * very low regex-only false-positive risk).
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
    case 'br-cnpj':
      return (m) => brCnpjCheck(m.replace(/\D/g, ''));
    case 'fr-nir':
      return (m) => frNirCheck(m.replace(/[^\dA-Z]/gi, '').toUpperCase());
    case 'it-codice-fiscale':
      return (m) =>
        itCodiceFiscaleCheck(m.replace(/[^\dA-Z]/gi, '').toUpperCase());
    case 'jp-mynumber':
      return (m) => jpMyNumberCheck(m.replace(/\D/g, ''));
    case 'kr-rrn':
      return (m) => krRrnCheck(m.replace(/\D/g, ''));
    case 'ru-inn-12':
      return (m) => ruInn12Check(m.replace(/\D/g, ''));
    case 'pt-nif':
      return (m) => ptNifCheck(m.replace(/\D/g, ''));
    case 'cz-rc':
      return (m) => czRcCheck(m.replace(/\D/g, ''));
    case 'dk-cpr':
      return (m) => dkCprCheck(m.replace(/\D/g, ''));
    case 'my-mykad':
      return (m) => myMykadCheck(m.replace(/\D/g, ''));
    case 'sg-nric':
      return (m) => sgNricCheck(m.replace(/[^A-Z\d]/gi, '').toUpperCase());
    default: {
      // Exhaustiveness sentinel: a checksum added to the schema enum
      // without a case here fails the compile; at runtime an unknown name
      // rejects every match rather than accepting unvalidated ones.
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

export const buildNationalIdPattern: NativePatternBuilder = () => (locales) => {
  const out: PiiPattern[] = [];
  for (const locale of locales) {
    for (const spec of locale.nationalIds) {
      out.push(specToPattern(spec));
    }
  }
  return out;
};
