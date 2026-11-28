/**
 * German grammar config — 53 closed-list nouns with their gender, used by
 * `grammar-articles` to catch indefinite-article disagreement
 * (`einen Anfrage` → `eine Anfrage`).
 *
 * Migrated from `services/docs/tests/data/noun-genders-de.ts`. Add a noun
 * only after verifying with Duden; ambiguous-gender words (e.g. compound
 * loanwords whose gender depends on the speaker) are deliberately omitted.
 */

import type { LocaleGrammarConfig, NounGenderEntry } from '../types';

const NOUN_GENDERS: ReadonlyArray<NounGenderEntry> = [
  { noun: 'Agent', gender: 'm' },
  { noun: 'Anbieter', gender: 'm' },
  { noun: 'Anfrage', gender: 'f' },
  { noun: 'Anhang', gender: 'm' },
  { noun: 'Antwort', gender: 'f' },
  { noun: 'Anweisung', gender: 'f' },
  { noun: 'Aufbewahrung', gender: 'f' },
  { noun: 'Ausführung', gender: 'f' },
  { noun: 'Automation', gender: 'f' },
  { noun: 'Automatisierung', gender: 'f' },
  { noun: 'Berechtigung', gender: 'f' },
  { noun: 'Commit', gender: 'm' },
  { noun: 'Connector', gender: 'm' },
  { noun: 'Datei', gender: 'f' },
  { noun: 'Datenbank', gender: 'f' },
  { noun: 'Dokument', gender: 'n' },
  { noun: 'Eingabe', gender: 'f' },
  { noun: 'Einstellung', gender: 'f' },
  { noun: 'E-Mail', gender: 'f' },
  { noun: 'Endpoint', gender: 'm' },
  { noun: 'Entwurf', gender: 'm' },
  { noun: 'Genehmigung', gender: 'f' },
  { noun: 'Konfiguration', gender: 'f' },
  { noun: 'Konversation', gender: 'f' },
  { noun: 'Kunde', gender: 'm' },
  { noun: 'Lieferant', gender: 'm' },
  { noun: 'Lookup', gender: 'm' },
  { noun: 'Mitglied', gender: 'n' },
  { noun: 'Modell', gender: 'n' },
  { noun: 'Nachricht', gender: 'f' },
  { noun: 'Nutzer', gender: 'm' },
  { noun: 'Ordner', gender: 'm' },
  { noun: 'Plan', gender: 'm' },
  { noun: 'Pipeline', gender: 'f' },
  { noun: 'Produkt', gender: 'n' },
  { noun: 'Provider', gender: 'm' },
  { noun: 'Repository', gender: 'n' },
  { noun: 'Rolle', gender: 'f' },
  { noun: 'Schlüssel', gender: 'm' },
  { noun: 'Schritt', gender: 'm' },
  { noun: 'Server', gender: 'm' },
  { noun: 'Sitzung', gender: 'f' },
  { noun: 'Team', gender: 'n' },
  { noun: 'Token', gender: 'n' },
  { noun: 'Tool', gender: 'n' },
  { noun: 'Trigger', gender: 'm' },
  { noun: 'Übersicht', gender: 'f' },
  { noun: 'Vorschau', gender: 'f' },
  { noun: 'Warnung', gender: 'f' },
  { noun: 'Webhook', gender: 'm' },
  { noun: 'Website', gender: 'f' },
  { noun: 'Wissensdatenbank', gender: 'f' },
  { noun: 'Workflow', gender: 'm' },
  { noun: 'Zertifizierung', gender: 'f' },
  { noun: 'Zugriff', gender: 'm' },
];

export const GRAMMAR_DE: LocaleGrammarConfig = {
  nounGenders: NOUN_GENDERS,
  indefiniteArticles: {
    m: { nom: 'ein', acc: 'einen', dat: 'einem' },
    f: { nom: 'eine', acc: 'eine', dat: 'einer' },
    n: { nom: 'ein', acc: 'ein', dat: 'einem' },
  },
};
