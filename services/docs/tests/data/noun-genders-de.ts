/**
 * Closed list of high-frequency Tale nouns with their grammatical gender.
 *
 * Consumed by `60-grammar-de.test.ts` (hard-fail after the precision
 * tightening + corpus sweep) to flag indefinite-article gender disagreement
 * (`einen einmaligen Warnung` → `eine einmalige Warnung`).
 *
 * Add a noun here only after verifying with Duden. Ambiguous-gender words
 * (e.g. `Code Review`, where the gender depends on the speaker) are
 * deliberately omitted — the test would produce false positives.
 *
 * Codes:
 *   m = masculine
 *   f = feminine
 *   n = neuter
 */

export type Gender = 'm' | 'f' | 'n';

export const NOUN_GENDERS_DE: Record<string, Gender> = {
  Agent: 'm',
  Anbieter: 'm',
  Anfrage: 'f',
  Anhang: 'm',
  Antwort: 'f',
  Anweisung: 'f',
  Aufbewahrung: 'f',
  Ausführung: 'f',
  Automation: 'f',
  Berechtigung: 'f',
  Commit: 'm',
  Datei: 'f',
  Datenbank: 'f',
  Dokument: 'n',
  Eingabe: 'f',
  Einstellung: 'f',
  'E-Mail': 'f',
  Endpoint: 'm',
  Entwurf: 'm',
  Genehmigung: 'f',
  Integration: 'f',
  Konfiguration: 'f',
  Konversation: 'f',
  Kunde: 'm',
  Lieferant: 'm',
  Lookup: 'm',
  Mitglied: 'n',
  Modell: 'n',
  Nachricht: 'f',
  Nutzer: 'm',
  Ordner: 'm',
  Plan: 'm',
  Pipeline: 'f',
  Produkt: 'n',
  Provider: 'm',
  Repository: 'n',
  Rolle: 'f',
  Schlüssel: 'm',
  Schritt: 'm',
  Server: 'm',
  Sitzung: 'f',
  Team: 'n',
  Token: 'n',
  Tool: 'n',
  Trigger: 'm',
  Übersicht: 'f',
  Vorschau: 'f',
  Warnung: 'f',
  Webhook: 'm',
  Website: 'f',
  Wissensdatenbank: 'f',
  Zertifizierung: 'f',
  Zugriff: 'm',
};
