/**
 * What the mock model says.
 *
 * Replies read like a model's: an opening paragraph, then a mix of
 * headings, bullet lists, numbered steps, fenced code and small tables, in
 * the language the user wrote in (English, German or French, guessed from
 * the prompt). The vocabulary is faker's word, city, name and product data
 * plus a short work-flavoured noun list per language, drawn with the
 * request's own seeded `Random` — never faker's shared generator, so the
 * mock neither reseeds a module other code may use nor pays faker's
 * per-call overhead on a hot path.
 */

import { faker as fakerDe } from '@faker-js/faker/locale/de';
import { faker as fakerEn } from '@faker-js/faker/locale/en';
import { faker as fakerFr } from '@faker-js/faker/locale/fr';

import { chance, pick, randomInt, type Random } from './random.ts';
import { estimateTokens } from './tokens.ts';

export type ContentLocale = 'en' | 'de' | 'fr';

/** The faker locale instance a language draws its word lists from. */
type FakerLocale = typeof fakerEn;

interface Vocabulary {
  readonly curatedNouns: readonly string[];
  readonly nouns: readonly string[];
  readonly adjectives: readonly string[];
  readonly verbs: readonly string[];
  readonly adverbs: readonly string[];
  readonly cities: readonly string[];
  readonly firstNames: readonly string[];
  readonly lastNames: readonly string[];
  readonly productAdjectives: readonly string[];
  readonly productMaterials: readonly string[];
  readonly products: readonly string[];
  readonly legalForms: readonly string[];
}

/** Nouns a work assistant talks about; they keep replies on topic. */
const CURATED_NOUNS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: [
    'report',
    'budget',
    'deadline',
    'invoice',
    'contract',
    'meeting',
    'project',
    'task',
    'workflow',
    'customer',
    'proposal',
    'roadmap',
    'release',
    'document',
    'policy',
    'review',
    'schedule',
    'template',
    'dashboard',
    'checklist',
    'forecast',
    'milestone',
    'onboarding',
    'request',
    'feedback',
    'summary',
    'account',
    'supplier',
    'audit',
    'backlog',
  ],
  de: [
    'Bericht',
    'Budget',
    'Termin',
    'Rechnung',
    'Vertrag',
    'Besprechung',
    'Projekt',
    'Aufgabe',
    'Ablauf',
    'Kunde',
    'Angebot',
    'Fahrplan',
    'Freigabe',
    'Dokument',
    'Richtlinie',
    'Prüfung',
    'Zeitplan',
    'Vorlage',
    'Übersicht',
    'Checkliste',
    'Prognose',
    'Meilenstein',
    'Einarbeitung',
    'Anfrage',
    'Rückmeldung',
    'Zusammenfassung',
    'Lieferant',
    'Revision',
    'Planung',
    'Auswertung',
  ],
  fr: [
    'rapport',
    'budget',
    'échéance',
    'facture',
    'contrat',
    'réunion',
    'projet',
    'tâche',
    'processus',
    'client',
    'proposition',
    'feuille de route',
    'livraison',
    'document',
    'politique',
    'revue',
    'calendrier',
    'modèle',
    'tableau de bord',
    'liste de contrôle',
    'prévision',
    'jalon',
    'intégration',
    'demande',
    'retour',
    'synthèse',
    'fournisseur',
    'audit',
    'planning',
    'analyse',
  ],
};

/** Company suffixes, so a German reply names a GmbH and not an Inc. */
const LEGAL_FORMS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: ['Inc.', 'Ltd', 'LLC'],
  de: ['GmbH', 'AG'],
  fr: ['SA', 'SARL'],
};

const FAKERS: Readonly<Record<ContentLocale, FakerLocale>> = {
  en: fakerEn,
  de: fakerDe,
  fr: fakerFr,
};

const vocabularies = new Map<ContentLocale, Vocabulary>();

/** Copy one faker list out of its definitions proxy, or [] when absent. */
function fakerList(read: () => readonly string[] | undefined): string[] {
  try {
    return [...(read() ?? [])];
  } catch (error) {
    // A locale without the list: the curated words carry the reply.
    console.warn('[mock] faker list unavailable:', error);
    return [];
  }
}

function vocabulary(locale: ContentLocale): Vocabulary {
  const cached = vocabularies.get(locale);
  if (cached) return cached;
  const d = FAKERS[locale].definitions;
  const built: Vocabulary = {
    curatedNouns: CURATED_NOUNS[locale],
    nouns: fakerList(() => d.word.noun).filter((noun) => noun.length <= 18),
    adjectives: fakerList(() => d.word.adjective),
    verbs: fakerList(() => d.word.verb),
    adverbs: fakerList(() => d.word.adverb),
    cities: fakerList(() => d.location.city_name),
    firstNames: fakerList(() => d.person.first_name.generic),
    lastNames: fakerList(() => d.person.last_name.generic),
    productAdjectives: fakerList(() => d.commerce.product_name.adjective),
    productMaterials: fakerList(() => d.commerce.product_name.material),
    products: fakerList(() => d.commerce.product_name.product),
    legalForms: LEGAL_FORMS[locale],
  };
  vocabularies.set(locale, built);
  return built;
}

/** Identifier-safe English words for code samples. */
let identifierNouns: readonly string[] | null = null;
let identifierVerbs: readonly string[] | null = null;

function identifiers(): {
  nouns: readonly string[];
  verbs: readonly string[];
} {
  if (identifierNouns === null || identifierVerbs === null) {
    const en = vocabulary('en');
    const safe = (word: string): boolean => /^[a-z]{3,12}$/.test(word);
    identifierNouns = [...CURATED_NOUNS.en, ...en.nouns.filter(safe)];
    identifierVerbs = [
      'load',
      'sync',
      'build',
      'fetch',
      'merge',
      ...en.verbs.filter(safe),
    ];
  }
  return { nouns: identifierNouns, verbs: identifierVerbs };
}

function capitalize(word: string): string {
  return word.length === 0
    ? word
    : word.charAt(0).toUpperCase() + word.slice(1);
}

/** Pick from `primary`, falling back to `fallback` when it is empty. */
function pickOr(
  random: Random,
  primary: readonly string[],
  fallback: string,
): string {
  return primary.length > 0 ? pick(random, primary) : fallback;
}

/** The word slots templates fill, bound to one reply's `Random`. */
class Words {
  readonly random: Random;
  readonly vocab: Vocabulary;

  constructor(random: Random, vocab: Vocabulary) {
    this.random = random;
    this.vocab = vocab;
  }

  /** Mostly a work noun, sometimes one of faker's for variety. */
  noun(): string {
    return chance(this.random, 0.75) || this.vocab.nouns.length === 0
      ? pick(this.random, this.vocab.curatedNouns)
      : pick(this.random, this.vocab.nouns);
  }

  adj(): string {
    return pickOr(this.random, this.vocab.adjectives, 'clear');
  }

  verb(): string {
    return pickOr(this.random, this.vocab.verbs, 'review');
  }

  adv(): string {
    return pickOr(this.random, this.vocab.adverbs, 'carefully');
  }

  city(): string {
    return pickOr(this.random, this.vocab.cities, 'Bern');
  }

  person(): string {
    const first = pickOr(this.random, this.vocab.firstNames, 'Alex');
    const last = pickOr(this.random, this.vocab.lastNames, 'Meier');
    return `${first} ${last}`;
  }

  company(): string {
    const last = pickOr(this.random, this.vocab.lastNames, 'Meier');
    return `${last} ${pick(this.random, this.vocab.legalForms)}`;
  }

  product(): string {
    return [
      pickOr(this.random, this.vocab.productAdjectives, 'Smart'),
      pickOr(this.random, this.vocab.productMaterials, 'Steel'),
      pickOr(this.random, this.vocab.products, 'Chair'),
    ].join(' ');
  }

  int(min: number, max: number): number {
    return randomInt(this.random, min, max);
  }

  identNoun(): string {
    return pick(this.random, identifiers().nouns);
  }

  identVerb(): string {
    return pick(this.random, identifiers().verbs);
  }
}

type Template = (w: Words) => string;

const SENTENCES: Readonly<Record<ContentLocale, readonly Template[]>> = {
  en: [
    (w) => `The ${w.adj()} ${w.noun()} is usually the first thing to check.`,
    (w) =>
      `You can ${w.verb()} the ${w.noun()} ${w.adv()} once the ${w.noun()} is in place.`,
    (w) =>
      `Most teams ${w.verb()} their ${w.noun()} once a week and review the ${w.adj()} cases separately.`,
    (w) =>
      `${w.person()} from ${w.company()} suggested keeping the ${w.noun()} ${w.adj()} and easy to ${w.verb()}.`,
    (w) =>
      `In ${w.city()}, roughly ${w.int(5, 95)} percent of the cases are handled this way.`,
    (w) =>
      `It helps to write down why the ${w.noun()} matters before you ${w.verb()} anything.`,
    (w) =>
      `A ${w.adj()} ${w.noun()} saves time later, especially when the ${w.noun()} changes.`,
    (w) =>
      `If the ${w.noun()} looks ${w.adj()}, compare it with the previous ${w.noun()} first.`,
    (w) => `The ${w.product()} is a good example of a ${w.adj()} approach.`,
    (w) =>
      `Keep the ${w.noun()} small: one owner, one deadline and a clear goal.`,
    (w) =>
      `This way the result stays ${w.adj()} and nobody has to ${w.verb()} it twice.`,
    (w) =>
      `Plan for about ${w.int(2, 12)} items per week; more than that usually means the scope is too broad.`,
    (w) =>
      `Before you ${w.verb()} the ${w.noun()}, make sure the ${w.noun()} is up to date.`,
    (w) =>
      `That is why someone outside the team should look at the ${w.noun()} as well.`,
  ],
  de: [
    (w) =>
      `Beim Thema ${capitalize(w.noun())} lohnt es sich, die Details genau zu prüfen.`,
    (w) =>
      `Im Bereich ${capitalize(w.noun())} wirkt das Vorgehen ${w.adj()} und nachvollziehbar.`,
    (w) =>
      `${w.person()} von ${w.company()} empfiehlt, zuerst den Punkt ${capitalize(w.noun())} zu klären.`,
    (w) =>
      `Viele Teams ${w.verb()} das ${w.adv()}, bevor sie den nächsten Schritt planen.`,
    (w) =>
      `In ${w.city()} werden rund ${w.int(5, 95)} Prozent der Fälle so bearbeitet.`,
    (w) =>
      `Wichtig ist, dass ${capitalize(w.noun())} und ${capitalize(w.noun())} sauber zusammenspielen.`,
    (w) =>
      `Das Stichwort ${capitalize(w.noun())} taucht dabei immer wieder auf.`,
    (w) =>
      `Sobald der Punkt ${capitalize(w.noun())} feststeht, kannst du den Rest ${w.adv()} angehen.`,
    (w) =>
      `Ein gutes Beispiel ist ${w.product()}: ${w.adj()} und trotzdem einfach.`,
    () =>
      'Halte den Umfang klein: eine verantwortliche Person, ein Termin und ein klares Ziel.',
    (w) =>
      `So bleibt das Ergebnis ${w.adj()}, und niemand muss etwas doppelt ${w.verb()}.`,
    (w) =>
      `Plane etwa ${w.int(2, 12)} Punkte pro Woche ein, sonst wird der Bereich ${capitalize(w.noun())} schnell unübersichtlich.`,
    (w) =>
      `Bevor du loslegst, prüfe kurz, ob der Stand zu ${capitalize(w.noun())} noch aktuell ist.`,
    (w) =>
      `Deshalb sollte jemand außerhalb des Teams einen Blick auf ${capitalize(w.noun())} werfen.`,
  ],
  fr: [
    (w) =>
      `Pour le sujet « ${w.noun()} », il vaut mieux avancer étape par étape.`,
    (w) =>
      `Tu peux ${w.verb()} cela ${w.adv()} si le point « ${w.noun()} » est déjà réglé.`,
    (w) =>
      `${w.person()}, de ${w.company()}, conseille de commencer par le volet ${w.noun()}.`,
    (w) =>
      `À ${w.city()}, environ ${w.int(5, 95)} % des dossiers sont traités de cette façon.`,
    (w) =>
      `Le résultat reste ${w.adj()}, surtout pour le thème « ${w.noun()} ».`,
    (w) =>
      `Il est utile de noter pourquoi le sujet « ${w.noun()} » compte avant de ${w.verb()} quoi que ce soit.`,
    (w) => `Un bon exemple est le produit ${w.product()}.`,
    () =>
      'Garde un périmètre réduit : une personne responsable, une échéance et un objectif clair.',
    (w) => `Ainsi, personne ne doit ${w.verb()} la même chose deux fois.`,
    (w) =>
      `Prévois environ ${w.int(2, 12)} points par semaine, sinon le volet ${w.noun()} devient vite confus.`,
    (w) =>
      `Avant de commencer, vérifie que le point « ${w.noun()} » est encore à jour.`,
    (w) =>
      `C'est pourquoi quelqu'un d'extérieur à l'équipe devrait relire le volet ${w.noun()}.`,
    (w) => `La plupart des équipes préfèrent ${w.verb()} ce point ${w.adv()}.`,
  ],
};

const HEADINGS: Readonly<Record<ContentLocale, readonly Template[]>> = {
  en: [
    () => 'Overview',
    () => 'Key points',
    () => 'Next steps',
    () => 'Details',
    () => 'Things to watch',
    (w) => `About the ${w.noun()}`,
    (w) => `How to ${w.verb()} the ${w.noun()}`,
  ],
  de: [
    () => 'Überblick',
    () => 'Wichtige Punkte',
    () => 'Nächste Schritte',
    () => 'Details',
    () => 'Worauf du achten solltest',
    (w) => `Zum Thema ${capitalize(w.noun())}`,
  ],
  fr: [
    () => 'Vue d’ensemble',
    () => 'Points clés',
    () => 'Prochaines étapes',
    () => 'Détails',
    () => 'Points d’attention',
    (w) => `À propos de « ${w.noun()} »`,
  ],
};

const STEPS: Readonly<Record<ContentLocale, readonly Template[]>> = {
  en: [
    (w) => `${capitalize(w.verb())} the ${w.noun()}.`,
    (w) => `Check the ${w.adj()} ${w.noun()} against the ${w.noun()}.`,
    (w) => `Share the result with ${w.person()}.`,
    (w) => `Write down the ${w.noun()} and its owner.`,
    (w) => `Schedule a short review in ${w.city()}.`,
  ],
  de: [
    (w) => `${capitalize(w.noun())} prüfen und dokumentieren.`,
    (w) => `Mit ${w.person()} den Punkt ${capitalize(w.noun())} abstimmen.`,
    (w) => `Ergebnis ${w.adv()} ${w.verb()}.`,
    () => 'Termin für die Durchsicht festlegen.',
    (w) => `Offene Fragen zu ${capitalize(w.noun())} sammeln.`,
  ],
  fr: [
    (w) => `Vérifier le point « ${w.noun()} ».`,
    (w) => `${capitalize(w.verb())} les éléments concernés.`,
    (w) => `Valider le résultat avec ${w.person()}.`,
    () => 'Planifier une courte revue.',
    (w) => `Noter les questions ouvertes sur le volet ${w.noun()}.`,
  ],
};

const TABLE_HEADERS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: ['Item', 'Owner', 'Effort (days)', 'Status'],
  de: ['Punkt', 'Verantwortlich', 'Aufwand (Tage)', 'Status'],
  fr: ['Élément', 'Responsable', 'Effort (jours)', 'Statut'],
};

const STATUSES: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: ['open', 'in progress', 'done', 'blocked'],
  de: ['offen', 'in Arbeit', 'erledigt', 'blockiert'],
  fr: ['ouvert', 'en cours', 'terminé', 'bloqué'],
};

const CLOSINGS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: [
    'Let me know if you want more detail on any of these points.',
    'If it helps, I can turn this into a checklist.',
  ],
  de: [
    'Sag Bescheid, wenn du zu einem Punkt mehr wissen willst.',
    'Wenn es hilft, mache ich daraus gern eine Checkliste.',
  ],
  fr: [
    'Dis-moi si tu veux approfondir un de ces points.',
    'Si cela t’aide, je peux en faire une liste de contrôle.',
  ],
};

const TOOL_INTROS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: [
    'Let me look that up.',
    'I will check the knowledge base for that.',
    'One moment, I am searching for the relevant information.',
  ],
  de: [
    'Ich schaue kurz nach.',
    'Einen Moment, ich suche die passenden Informationen.',
    'Ich prüfe das in der Wissensdatenbank.',
  ],
  fr: [
    'Je vérifie cela tout de suite.',
    'Un instant, je cherche les informations pertinentes.',
    'Je consulte la base de connaissances.',
  ],
};

const REASONING: readonly Template[] = [
  (w) =>
    `I should check the ${w.noun()} first and then explain the ${w.adj()} parts.`,
  (w) =>
    `Let me think about whether the ${w.noun()} depends on the ${w.noun()}.`,
  () => 'A short structured answer with a list will probably work best here.',
  (w) =>
    `There might be an edge case around the ${w.noun()}; I will mention it briefly.`,
  (w) => `I need to keep the answer ${w.adj()} but complete.`,
  (w) => `Maybe an example with ${w.int(2, 9)} items makes it clearer.`,
  (w) =>
    `Wait, the ${w.noun()} could also mean the ${w.noun()}, so I should cover both.`,
  (w) =>
    `The user probably wants to ${w.verb()} something concrete, not a definition.`,
];

/** Code samples; identifiers are English whatever the reply's language. */
const CODE_BLOCKS: readonly Template[] = [
  (w) => {
    const noun = w.identNoun();
    const type = capitalize(noun);
    return [
      '```ts',
      `export async function ${w.identVerb()}${type}(id: string): Promise<${type}> {`,
      `  const ${noun} = await store.${noun}s.get(id);`,
      `  if (!${noun}) throw new Error('${noun} ${w.int(100, 999)} not found');`,
      `  return { ...${noun}, updatedAt: new Date().toISOString() };`,
      '}',
      '```',
    ].join('\n');
  },
  (w) => {
    const noun = w.identNoun();
    return [
      '```python',
      `def ${w.identVerb()}_${noun}(items: list[dict]) -> list[dict]:`,
      `    """Keep the ${noun} entries that carry a ${w.identNoun()}."""`,
      `    return [item for item in items if item.get("${w.identNoun()}") is not None]`,
      '```',
    ].join('\n');
  },
  (w) =>
    [
      '```bash',
      `curl -s "https://api.example.com/v1/${w.identNoun()}s?limit=${w.int(10, 100)}" \\`,
      `  -H "Authorization: Bearer $TOKEN" | jq '.data[] | .${w.identNoun()}'`,
      '```',
    ].join('\n'),
  (w) => {
    const noun = w.identNoun();
    const other = w.identNoun();
    return [
      '```sql',
      `SELECT ${noun}_id, COUNT(*) AS ${other}_count`,
      `FROM ${noun}s`,
      `WHERE created_at > now() - interval '${w.int(7, 90)} days'`,
      `GROUP BY ${noun}_id`,
      `ORDER BY ${other}_count DESC;`,
      '```',
    ].join('\n');
  },
  (w) =>
    [
      '```json',
      '{',
      `  "${w.identNoun()}": "${w.identVerb()}",`,
      `  "${w.identNoun()}": ${w.int(1, 500)},`,
      '  "enabled": true',
      '}',
      '```',
    ].join('\n'),
];

/** Function words of the three languages, for guessing and for keywords. */
const STOPWORDS: Readonly<Record<ContentLocale, readonly string[]>> = {
  en: [
    'the',
    'and',
    'is',
    'are',
    'to',
    'of',
    'what',
    'how',
    'please',
    'can',
    'you',
    'with',
    'for',
    'this',
    'that',
    'my',
    'do',
    'it',
    'in',
    'on',
    'me',
    'about',
    'from',
    'why',
    'which',
    'would',
    'could',
    'should',
    'have',
    'does',
    'an',
    'be',
    'we',
    'our',
    'your',
    'tell',
    'give',
    'need',
    'want',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'ist',
    'nicht',
    'ich',
    'wie',
    'mit',
    'für',
    'ein',
    'eine',
    'zu',
    'auf',
    'bitte',
    'kannst',
    'du',
    'sie',
    'was',
    'den',
    'dem',
    'auch',
    'wir',
    'mir',
    'mich',
    'uns',
    'einen',
    'einer',
    'sind',
    'warum',
    'welche',
    'gibt',
    'habe',
    'hast',
    'kann',
    'wird',
    'oder',
    'aber',
  ],
  fr: [
    'le',
    'la',
    'les',
    'et',
    'est',
    'pas',
    'je',
    'vous',
    'une',
    'des',
    'pour',
    'avec',
    'que',
    'qui',
    'dans',
    'sur',
    'du',
    'un',
    'bonjour',
    'merci',
    'comment',
    'peux',
    'tu',
    'pourquoi',
    'quels',
    'quelle',
    'mon',
    'mes',
    'ton',
    'nous',
    'faire',
    'sont',
    'il',
    'elle',
    'au',
    'aux',
    'ce',
  ],
};

const STOPWORD_SETS: Readonly<Record<ContentLocale, ReadonlySet<string>>> = {
  en: new Set(STOPWORDS.en),
  de: new Set(STOPWORDS.de),
  fr: new Set(STOPWORDS.fr),
};

const ALL_STOPWORDS: ReadonlySet<string> = new Set([
  ...STOPWORDS.en,
  ...STOPWORDS.de,
  ...STOPWORDS.fr,
]);

/** How much of a prompt the language guess reads. */
const LOCALE_SAMPLE_CHARS = 2000;

const WORD_PATTERN = /[\p{L}][\p{L}'’-]*/gu;

/**
 * Guess the language of `text`: function-word hits, plus the letters only
 * German (ß, umlauts) or French (accents, ç, œ) use. English wins ties.
 */
export function detectLocale(text: string): ContentLocale {
  const sample = text.slice(0, LOCALE_SAMPLE_CHARS).toLowerCase();
  const score: Record<ContentLocale, number> = { en: 0, de: 0, fr: 0 };
  for (const match of sample.matchAll(WORD_PATTERN)) {
    const word = match[0];
    if (STOPWORD_SETS.en.has(word)) score.en += 1;
    if (STOPWORD_SETS.de.has(word)) score.de += 1;
    if (STOPWORD_SETS.fr.has(word)) score.fr += 1;
  }
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charAt(i);
    if (c === 'ß' || c === 'ä' || c === 'ö' || c === 'ü') score.de += 2;
    else if ('éèêàçœâîôûù'.includes(c)) score.fr += 2;
  }
  if (score.de > score.en && score.de >= score.fr) return 'de';
  if (score.fr > score.en && score.fr > score.de) return 'fr';
  return 'en';
}

/**
 * The distinctive words of `text` in order of appearance: no function
 * words, nothing shorter than three letters, no repeats.
 */
export function keywordsOf(text: string, max: number): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WORD_PATTERN)) {
    if (words.length >= max) break;
    const word = match[0].replace(/['’-]+$/, '');
    const lower = word.toLowerCase();
    if (word.length < 3 || ALL_STOPWORDS.has(lower) || seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    words.push(word);
  }
  return words;
}

/** One sentence in `locale`. */
export function generateSentence(
  random: Random,
  locale: ContentLocale,
): string {
  const w = new Words(random, vocabulary(locale));
  return pick(random, SENTENCES[locale])(w);
}

function paragraph(w: Words, locale: ContentLocale, sentences: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sentences; i++) {
    parts.push(pick(w.random, SENTENCES[locale])(w));
  }
  return parts.join(' ');
}

function bulletList(w: Words, locale: ContentLocale): string {
  const items = randomInt(w.random, 3, 6);
  const lines: string[] = [];
  for (let i = 0; i < items; i++) {
    const sentence = pick(w.random, SENTENCES[locale])(w);
    lines.push(
      chance(w.random, 0.5)
        ? `- **${capitalize(w.noun())}**: ${sentence}`
        : `- ${sentence}`,
    );
  }
  return lines.join('\n');
}

function numberedSteps(w: Words, locale: ContentLocale): string {
  const steps = randomInt(w.random, 3, 6);
  const lines: string[] = [];
  for (let i = 0; i < steps; i++) {
    lines.push(`${i + 1}. ${pick(w.random, STEPS[locale])(w)}`);
  }
  return lines.join('\n');
}

function table(w: Words, locale: ContentLocale): string {
  const header = TABLE_HEADERS[locale];
  const rows = randomInt(w.random, 2, 5);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (let i = 0; i < rows; i++) {
    lines.push(
      `| ${capitalize(w.noun())} | ${w.person()} | ${w.int(1, 15)} | ${pick(w.random, STATUSES[locale])} |`,
    );
  }
  return lines.join('\n');
}

function heading(w: Words, locale: ContentLocale): string {
  return `## ${pick(w.random, HEADINGS[locale])(w)}`;
}

type BlockKind = 'paragraph' | 'list' | 'steps' | 'section' | 'code' | 'table';

/** The next block of a reply; code and tables only where they still fit. */
function pickBlockKind(random: Random, remaining: number): BlockKind {
  const roll = random();
  if (roll < 0.3) return 'paragraph';
  if (roll < 0.5) return 'list';
  if (roll < 0.65) return 'steps';
  if (roll < 0.78) return 'section';
  if (roll < 0.9 && remaining > 90) return 'code';
  if (remaining > 70) return 'table';
  return 'paragraph';
}

export interface ReplyShape {
  readonly locale: ContentLocale;
  /** The reply runs until it holds at least this many tokens. */
  readonly targetTokens: number;
  /** A paragraph that opens the reply (a tool result's summary). */
  readonly lead?: string;
}

/**
 * A markdown reply of at least `targetTokens` tokens, ending on a whole
 * sentence or block — so it overshoots the target by at most a sentence or
 * one small block. The caller truncates when a hard cap applies.
 */
export function generateReply(random: Random, shape: ReplyShape): string {
  const { locale, targetTokens } = shape;
  const w = new Words(random, vocabulary(locale));
  const blocks: string[] = [];
  let tokens = 0;
  const push = (block: string): void => {
    blocks.push(block);
    // The blank line between blocks is one token of its own.
    tokens += estimateTokens(block) + 1;
  };

  if (shape.lead !== undefined && shape.lead.length > 0) push(shape.lead);
  if (tokens < targetTokens) {
    push(paragraph(w, locale, targetTokens < 40 ? 1 : randomInt(random, 2, 3)));
  }
  let previous: BlockKind = 'paragraph';
  while (tokens < targetTokens) {
    const remaining = targetTokens - tokens;
    if (remaining < 45) {
      // Close with sentences rather than a block that would overshoot.
      const last = blocks.length - 1;
      const tail = blocks[last] ?? '';
      const sentence = pick(random, SENTENCES[locale])(w);
      if (/[.!?]$/.test(tail) && !tail.startsWith('#')) {
        blocks[last] = `${tail} ${sentence}`;
        tokens += estimateTokens(sentence);
      } else {
        push(sentence);
      }
      continue;
    }
    // Two blocks of one kind in a row read like a glitch; draw again.
    let kind = pickBlockKind(random, remaining);
    if (kind === previous) kind = pickBlockKind(random, remaining);
    previous = kind;
    switch (kind) {
      case 'list':
        push(bulletList(w, locale));
        break;
      case 'steps':
        push(numberedSteps(w, locale));
        break;
      case 'section':
        push(heading(w, locale));
        push(paragraph(w, locale, randomInt(random, 1, 3)));
        break;
      case 'code':
        push(pick(random, CODE_BLOCKS)(w));
        break;
      case 'table':
        push(table(w, locale));
        break;
      default:
        push(paragraph(w, locale, randomInt(random, 2, 4)));
    }
  }
  if (targetTokens > 150 && chance(random, 0.4)) {
    blocks.push(pick(random, CLOSINGS[locale]));
  }
  return blocks.join('\n\n');
}

/**
 * Reasoning text of at least `targetTokens` tokens. Models think in
 * English whatever the user writes, so the mock does too.
 */
export function generateReasoning(
  random: Random,
  topic: string,
  targetTokens: number,
): string {
  const w = new Words(random, vocabulary('en'));
  const parts = [
    topic.length > 0
      ? `The user is asking about ${topic}.`
      : 'The user wants a practical answer.',
  ];
  let tokens = estimateTokens(parts[0] ?? '');
  while (tokens < targetTokens) {
    const sentence = pick(random, REASONING)(w);
    parts.push(sentence);
    tokens += estimateTokens(sentence) + 1;
  }
  return parts.join(' ');
}

/** The short sentence a model says before it calls a tool. */
export function toolIntro(random: Random, locale: ContentLocale): string {
  return pick(random, TOOL_INTROS[locale]);
}

/**
 * The prose inside a tool result: the string values of a JSON result (the
 * titles and snippets a model would read), else the text itself.
 */
function readableText(result: string): string {
  const trimmed = result.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    // Not JSON after all: quote it as text.
    console.warn('[mock] tool result is not JSON:', error);
    return result;
  }
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (strings.length >= 4) return;
    if (typeof value === 'string') {
      if (value.length > 3) strings.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(parsed);
  return strings.join('; ');
}

/** How long a tool result's quoted excerpt may run. */
const EXCERPT_CHARS = 80;

/**
 * The opening of a reply that follows a tool result: it names the tool and
 * quotes the start of what it returned, the way a model grounds its answer.
 */
export function toolResultLead(
  locale: ContentLocale,
  toolName: string,
  result: string,
): string {
  const flat = readableText(result)
    .replace(/[`"„“”«»<>{}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length === 0) {
    switch (locale) {
      case 'de':
        return `Der Aufruf von \`${toolName}\` hat nichts Brauchbares geliefert, darum hier, was ich weiß.`;
      case 'fr':
        return `L’appel à \`${toolName}\` n’a rien donné d’utile, voici donc ce que je sais.`;
      default:
        return `The \`${toolName}\` call returned nothing useful, so here is what I know.`;
    }
  }
  let excerpt = flat.slice(0, EXCERPT_CHARS);
  if (flat.length > EXCERPT_CHARS) {
    const space = excerpt.lastIndexOf(' ');
    excerpt = `${space > 20 ? excerpt.slice(0, space) : excerpt}…`;
  }
  switch (locale) {
    case 'de':
      return `Laut \`${toolName}\` beginnt das Ergebnis mit „${excerpt}“.`;
    case 'fr':
      return `D’après \`${toolName}\`, le résultat commence par « ${excerpt} ».`;
    default:
      return `According to \`${toolName}\`, the result starts with "${excerpt}".`;
  }
}

/** A title never runs past this many characters. */
const TITLE_MAX_CHARS = 60;

/**
 * A 3-7 word title for a conversation that opened with `userText`: its
 * distinctive words in order, topped up with nouns of its language when it
 * has too few, cased the way the language cases titles.
 */
export function generateTitle(
  random: Random,
  userText: string,
  locale: ContentLocale,
): string {
  const wanted = randomInt(random, 3, 7);
  const words = keywordsOf(userText, wanted);
  const w = new Words(random, vocabulary(locale));
  while (words.length < 3) words.push(w.noun());
  const cased = words.map((word, index) => {
    if (locale === 'en') return capitalize(word);
    return index === 0 ? capitalize(word) : word;
  });
  let title = '';
  for (const word of cased) {
    const next = title.length === 0 ? word : `${title} ${word}`;
    if (next.length > TITLE_MAX_CHARS && title.length > 0) break;
    title = next.slice(0, TITLE_MAX_CHARS);
  }
  return title;
}
