/**
 * Locale data registry — every locale config the library ships.
 *
 * One typed const per locale lives in this directory. Adding a new
 * locale: create `./<code>.ts` exporting `const <code>: LocaleConfig`,
 * then add the import + the array entry below. TypeScript catches any
 * field drift at compile time, so the previous Zod parse pass at module
 * load is no longer needed for shape validation.
 *
 * Auto-generated import order — keep the array stable so the locale
 * registry's iteration order doesn't shift between deploys.
 */

import type { LocaleConfig } from '../types';
import { ar } from './ar';
import { bg } from './bg';
import { bn } from './bn';
import { ca } from './ca';
import { cs } from './cs';
import { da } from './da';
import { de } from './de';
import { el } from './el';
import { en } from './en';
import { es } from './es';
import { et } from './et';
import { fa } from './fa';
import { fi } from './fi';
import { fr } from './fr';
import { he } from './he';
import { hi } from './hi';
import { hr } from './hr';
import { hu } from './hu';
import { id } from './id';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { lt } from './lt';
import { lv } from './lv';
import { ms } from './ms';
import { nb } from './nb';
import { nl } from './nl';
import { pl } from './pl';
import { pt } from './pt';
import { ro } from './ro';
import { ru } from './ru';
import { sk } from './sk';
import { sl } from './sl';
import { sr } from './sr';
import { sv } from './sv';
import { th } from './th';
import { tl } from './tl';
import { tr } from './tr';
import { uk } from './uk';
import { ur } from './ur';
import { vi } from './vi';
import { zhHans } from './zh-hans';
import { zhHant } from './zh-hant';

export const ALL_LOCALES: readonly LocaleConfig[] = [
  ar,
  bg,
  bn,
  ca,
  cs,
  da,
  de,
  el,
  en,
  es,
  et,
  fa,
  fi,
  fr,
  he,
  hi,
  hr,
  hu,
  id,
  it,
  ja,
  ko,
  lt,
  lv,
  ms,
  nb,
  nl,
  pl,
  pt,
  ro,
  ru,
  sk,
  sl,
  sr,
  sv,
  th,
  tl,
  tr,
  uk,
  ur,
  vi,
  zhHans,
  zhHant,
];
