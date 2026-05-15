/**
 * Per-locale fixture seeds — hand-curated test-data inputs used by the
 * fixture generator only. NOT loaded at runtime: PII detection never
 * needs these and pulling them into the runtime bundle would waste
 * bytes on every consumer.
 *
 * Auto-generated index — keep in sync with the `./<code>.ts` files in
 * this directory.
 */

import type { LocaleFixtureSeeds } from '../../../../lib/pii/locales/types';
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

export const FIXTURE_SEEDS: Readonly<Record<string, LocaleFixtureSeeds>> = {
  ar: ar,
  bg: bg,
  bn: bn,
  ca: ca,
  cs: cs,
  da: da,
  de: de,
  el: el,
  en: en,
  es: es,
  et: et,
  fa: fa,
  fi: fi,
  fr: fr,
  he: he,
  hi: hi,
  hr: hr,
  hu: hu,
  id: id,
  it: it,
  ja: ja,
  ko: ko,
  lt: lt,
  lv: lv,
  ms: ms,
  nb: nb,
  nl: nl,
  pl: pl,
  pt: pt,
  ro: ro,
  ru: ru,
  sk: sk,
  sl: sl,
  sr: sr,
  sv: sv,
  th: th,
  tl: tl,
  tr: tr,
  uk: uk,
  ur: ur,
  vi: vi,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};
