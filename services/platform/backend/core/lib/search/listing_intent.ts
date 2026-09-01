/**
 * Listing-intent residue detector for chat `rag_search`.
 *
 * A search whose query is PURE browsing language — "list all in-review
 * tasks" — matches nothing by construction (no task title contains the word
 * "tasks"), so the executor steers it to `action: 'list'` instead of running
 * legs that can only fail. The steer must never fire on a real information
 * need, so the rule is conservative in one direction:
 *
 *   strip function words, listing verbs, kind nouns, and status words; if
 *   ANY token survives, the query names a thing and the search is honored.
 *   Only an empty residue with at least two listing signals (and an
 *   inferrable kind) reads as a stuffed listing.
 *
 * False negatives are safe — the search still runs, and the tasks/projects
 * legs fall back to their own bounded listing when nothing matches. False
 * positives are the failure mode this shape exists to avoid.
 *
 * en/de/fr, mirroring {@link STOPWORDS}: a browse question arrives in the
 * reader's language. The detector splits on punctuation (unlike search
 * tokenization, which is whitespace-only) so "in-review" reads as the status
 * it names.
 */

import type {
  RagSearchKind,
  RagSearchStatus,
} from '../../../../lib/chat/tools';
import { STOPWORDS } from './relevance';

export interface ListingIntent {
  readonly kind: RagSearchKind;
  readonly status?: RagSearchStatus;
}

/** Browsing markers: list verbs, quantifiers, and the interrogatives that
 * open a board question. Some double as search stopwords ("all", "welche");
 * they are classified as signals FIRST so they count toward the threshold. */
const LIST_SIGNALS: ReadonlySet<string> = new Set([
  // en — interrogatives included: "what is open?" carries its browse intent
  // in the question word, and the residue guard keeps "what's our refund
  // policy" a search regardless.
  'list',
  'lists',
  'listing',
  'show',
  'display',
  'browse',
  'enumerate',
  'view',
  'overview',
  'all',
  'every',
  'everything',
  'current',
  'currently',
  'what',
  'which',
  // de
  'zeige',
  'zeig',
  'zeigen',
  'anzeigen',
  'auflisten',
  'liste',
  'listen',
  'übersicht',
  'alle',
  'welche',
  'welcher',
  'welches',
  'was',
  'aktuelle',
  'aktuellen',
  // fr
  'lister',
  'listes',
  'montre',
  'montrer',
  'montrez',
  'affiche',
  'afficher',
  'affichez',
  'aperçu',
  'tous',
  'toutes',
  'quel',
  'quels',
  'quelle',
  'quelles',
  'actuels',
  'actuelles',
]);

/** Kind nouns → the `kind` a listing of them means. Plurals and the de/fr
 * words a browse question would use. `web-page` nouns are mapped so they
 * strip as signals, but the detector never PROPOSES that kind — pages have
 * no listable catalog, and a steer must not point at a refusal. */
const KIND_NOUNS: ReadonlyMap<string, RagSearchKind> = new Map([
  ['task', 'task'],
  ['tasks', 'task'],
  ['ticket', 'task'],
  ['tickets', 'task'],
  ['aufgabe', 'task'],
  ['aufgaben', 'task'],
  ['tâche', 'task'],
  ['tâches', 'task'],
  ['project', 'project'],
  ['projects', 'project'],
  ['projekt', 'project'],
  ['projekte', 'project'],
  ['projekten', 'project'],
  ['projet', 'project'],
  ['projets', 'project'],
  ['contact', 'contact'],
  ['contacts', 'contact'],
  ['kontakt', 'contact'],
  ['kontakte', 'contact'],
  ['kontakten', 'contact'],
  ['customer', 'contact'],
  ['customers', 'contact'],
  ['kunde', 'contact'],
  ['kunden', 'contact'],
  ['client', 'contact'],
  ['clients', 'contact'],
  ['product', 'product'],
  ['products', 'product'],
  ['produkt', 'product'],
  ['produkte', 'product'],
  ['produkten', 'product'],
  ['produit', 'product'],
  ['produits', 'product'],
  ['document', 'document'],
  ['documents', 'document'],
  ['dokument', 'document'],
  ['dokumente', 'document'],
  ['dokumenten', 'document'],
  ['file', 'document'],
  ['files', 'document'],
  ['datei', 'document'],
  ['dateien', 'document'],
  ['fichier', 'document'],
  ['fichiers', 'document'],
  ['website', 'website'],
  ['websites', 'website'],
  ['webseite', 'website'],
  ['webseiten', 'website'],
  ['site', 'website'],
  ['sites', 'website'],
  ['domain', 'website'],
  ['domains', 'website'],
  ['conversation', 'conversation'],
  ['conversations', 'conversation'],
  ['unterhaltung', 'conversation'],
  ['unterhaltungen', 'conversation'],
  ['gespräch', 'conversation'],
  ['gespräche', 'conversation'],
  ['inbox', 'conversation'],
  ['email', 'conversation'],
  ['emails', 'conversation'],
  ['mail', 'conversation'],
  ['mails', 'conversation'],
  ['entry', 'knowledge-entry'],
  ['entries', 'knowledge-entry'],
  ['eintrag', 'knowledge-entry'],
  ['einträge', 'knowledge-entry'],
  ['entrée', 'knowledge-entry'],
  ['entrées', 'knowledge-entry'],
  ['note', 'knowledge-entry'],
  ['notes', 'knowledge-entry'],
  ['notizen', 'knowledge-entry'],
  ['knowledge', 'knowledge-entry'],
  ['page', 'web-page'],
  ['pages', 'web-page'],
  ['seite', 'web-page'],
  ['seiten', 'web-page'],
]);

/** Board-state words → the `status` filter they name. Only what a column is
 * CALLED — never generic adjectives, which belong to the residue. */
const STATUS_WORDS: ReadonlyMap<string, RagSearchStatus> = new Map([
  ['open', 'open'],
  ['offen', 'open'],
  ['offene', 'open'],
  ['offenen', 'open'],
  ['outstanding', 'open'],
  ['unerledigt', 'open'],
  ['ouvert', 'open'],
  ['ouverts', 'open'],
  ['ouverte', 'open'],
  ['ouvertes', 'open'],
  ['backlog', 'backlog'],
  ['todo', 'todo'],
  ['todos', 'todo'],
  ['progress', 'in_progress'],
  ['ongoing', 'in_progress'],
  ['wip', 'in_progress'],
  ['bearbeitung', 'in_progress'],
  ['laufende', 'in_progress'],
  ['laufenden', 'in_progress'],
  ['cours', 'in_progress'],
  ['review', 'in_review'],
  ['reviews', 'in_review'],
  ['prüfung', 'in_review'],
  ['überprüfung', 'in_review'],
  ['revue', 'in_review'],
  ['done', 'done'],
  ['erledigt', 'done'],
  ['erledigte', 'done'],
  ['erledigten', 'done'],
  ['fertig', 'done'],
  ['abgeschlossen', 'done'],
  ['abgeschlossene', 'done'],
  ['completed', 'done'],
  ['finished', 'done'],
  ['terminé', 'done'],
  ['terminés', 'done'],
  ['terminée', 'done'],
  ['terminées', 'done'],
  ['fini', 'done'],
  ['finis', 'done'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
  ['abgebrochen', 'cancelled'],
  ['storniert', 'cancelled'],
  ['annulé', 'cancelled'],
  ['annulés', 'cancelled'],
  ['annulée', 'cancelled'],
  ['annulées', 'cancelled'],
]);

/** Function words the shared search stopword list happens not to carry but a
 * browse sentence uses. Detector-only on purpose: adding them to
 * {@link STOPWORDS} would change what SEARCH drops, and this module must
 * never move search behavior. */
const DETECTOR_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'please',
  'bitte',
  'mir',
  'uns',
  'steht',
  'stehen',
  'moi',
  'nous',
  'que',
  's',
]);

/**
 * Whether a search query is a stuffed listing, and the list call it means.
 * `undefined` honors the search — the only wrong answer here is steering a
 * real information need away from retrieval.
 */
export function detectListingIntent(query: string): ListingIntent | undefined {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;

  let signals = 0;
  let kind: RagSearchKind | undefined;
  let status: RagSearchStatus | undefined;
  for (const token of tokens) {
    if (LIST_SIGNALS.has(token)) {
      signals += 1;
      continue;
    }
    const kindHit = KIND_NOUNS.get(token);
    if (kindHit !== undefined) {
      signals += 1;
      kind ??= kindHit;
      continue;
    }
    const statusHit = STATUS_WORDS.get(token);
    if (statusHit !== undefined) {
      signals += 1;
      status ??= statusHit;
      continue;
    }
    if (
      STOPWORDS.has(token) ||
      DETECTOR_FUNCTION_WORDS.has(token) ||
      token.length <= 1
    ) {
      continue;
    }
    // A surviving noun means the query names a thing: honor the search.
    return undefined;
  }

  if (signals < 2) return undefined;
  // A bare state question ("what is open?") is a task list with that status.
  const inferred = kind ?? (status !== undefined ? 'task' : undefined);
  if (inferred === undefined || inferred === 'web-page') return undefined;
  return { kind: inferred, ...(status !== undefined ? { status } : {}) };
}
