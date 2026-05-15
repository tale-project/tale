/**
 * Closed list of high-frequency Tale nouns with their grammatical gender.
 *
 * Consumed by `services/docs/tests/grammar-de.test.ts` (warn-only) to flag
 * indefinite-article gender disagreement (`einen einmaligen Warnung` →
 * `eine einmalige Warnung`).
 *
 * Add a noun here only after verifying with Duden; ambiguous-gender words
 * (e.g. `Code Review`, where the gender depends on the German speaker)
 * are deliberately omitted.
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
  Anweisung: 'f',
  Anhang: 'm',
  Antwort: 'f',
  Aufbewahrung: 'f',
  Ausführung: 'f',
  Berechtigung: 'f',
  Commit: 'm',
  Datenbank: 'f',
  Datei: 'f',
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
  Schlüssel: 'm',
  Schritt: 'm',
  Server: 'm',
  Team: 'n',
  Token: 'n',
  Tool: 'n',
  Trigger: 'm',
  Übersicht: 'f',
  Vorschau: 'f',
  Warnung: 'f',
  Webhook: 'm',
  Website: 'f',
  Workflow: 'm',
  Wissensdatenbank: 'f',
  Zertifizierung: 'f',
  Zugriff: 'm',
};
