---
title: Anfragen betroffener Personen
description: Self-Service-Verwaltung für DSGVO-Art.-17-Löschungsanfragen mit Fristverfolgung, einmaliger Art.-12(3)-Verlängerung und Audit-Beleg.
---

Org-Admins bearbeiten DSGVO-Art.-17-Anfragen (Recht auf Löschung) direkt unter **Einstellungen > Governance > Anfragen betroffener Personen**. Jede Einreichung legt einen dauerhaften Beleg mit 30-Tage-Frist an, führt die Kaskade asynchron aus und schreibt für jeden Statuswechsel einen Audit-Eintrag (eingereicht → blockiert / ausgeführt / verlängert / wiederholt).

Die Seite ist nach dem DSR-Oberbegriff benannt — nicht nach „Löschung" allein —, damit künftige Art.-16- (Berichtigung) und Art.-20-Flows (Datenübertragbarkeit) ohne Route-Umbenennung folgen können. Heute ist nur Art. 17 implementiert.

## Identitätsprüfung erfolgt außerhalb des Produkts

Tale ist bewusst administrationsgesteuert — es gibt kein Self-Service-Portal für betroffene Personen. Der einreichende Admin **ist** die Identitätsprüfungsstelle und hat die Identität der Person über den eigenen Organisationsprozess (Offboarding, Support-Ticket, persönliche Verifizierung etc.) bestätigt, bevor er den Dialog öffnet. Das Produkt fügt keinen IDV-Schritt im Flow hinzu.

Dieser Vertrag macht den Admin maßgeblich. Counsel sollte die Bestätigungsphrase („ERASE") im Einreichdialog als IDV-Gate behandeln: das bewusste Eintippen ist ein audit-protokolliertes Signal, dass der Admin die Identität verifiziert hat.

## Anfrage einreichen

Klicke oben auf der Seite auf **Anfrage einreichen**. Der Dialog erfasst:

- **Person** — ein aktives Mitglied der Organisation, ausgewählt aus einer durchsuchbaren Liste. Es ist derselbe Picker wie in der Legal-Hold-Oberfläche.
- **Rechtsgrund** — einer von sieben strukturierten Codes, abgebildet auf DSGVO Art. 17(1)(a)–(f) plus den operativen Grund `contract_termination` für HR-Offboarding. Produktive DSR-Tools (OneTrust, TrustArc, Ketch) führen alle einen strukturierten Code neben der freien Begründung, weil Aufsichtsbehörden Anfragen nach Rechtsgrund klassifiziert sehen wollen.
- **Begründung** — Freitext (≥ 10 Zeichen) zum Verifizierungskontext. Landet im Beleg und im Audit-Log.
- **Bestätigung tippen** — tippe `ERASE`, um den Absende-Button freizuschalten. Die Phrase ist sprachneutral, damit die Anforderung in jeder Sprache identisch ist.

Beim Absenden läuft die Kaskade asynchron in einer Convex-Node-Action und löscht Chat-Threads der Person, RAG-indizierte Dokumente, File-Metadata-Blobs sowie neun pro-Tabelle erfasste Kategorien. Anschließend werden die PII aus der Audit-Kette für Zeilen gescrubt, die die Person erstellt hat.

Steht die Person unter aktiver rechtlicher Sperre (organisationsweit oder Aufbewahrungssperre), wird die Anfrage **am Gate abgewiesen** und ein Inline-Panel zeigt die Zahl der bewahrten Threads / Dokumente sowie einen Deep-Link zur Legal-Hold-Seite. Der Beleg wird dennoch mit `status: blocked` geschrieben, damit die Audit-Spur für die Aufsicht beweisbar bleibt.

## Frist-Badge und Art.-12(3)-Verlängerung

Jede Anfrage trägt eine 30-Tage-Frist (`requestedAt + 30 Tage`). Liste und Detailansicht zeigen ein SLA-Badge mit vier Stufen:

- **Grün** — mehr als 7 Tage übrig.
- **Gelb** — 7 oder weniger Tage übrig.
- **Rot** — überfällig.
- **Grau** — Endzustand (`done` / `failed`); Frist obsolet.

Art. 12(3) DSGVO erlaubt, das Antwortfenster um bis zu zwei weitere Monate zu verlängern, **aber die Verlängerung selbst muss innerhalb des ursprünglichen Monats begründet mitgeteilt werden**. Die Aktion **Frist verlängern** im Detail-Drawer setzt das um:

- Verfügbar, solange die Anfrage nicht in einem Endzustand ist und die ursprüngliche Frist noch nicht abgelaufen ist.
- 1–60 Tage hinzufügen, mit Pflicht-Begründung (≥ 10 Zeichen).
- Jede Anfrage kann **höchstens einmal** verlängert werden — der zweite Versuch wird mit `ALREADY_EXTENDED` abgewiesen.
- Das SLA-Badge nutzt `extensionDeadlineAt ?? slaDeadlineAt`, damit gewährte Verlängerungen sofort die Farbstufe und den angezeigten Countdown beeinflussen.

Das Audit-Log hält fest, wer verlängert hat, mit welchem Grund und auf welche neue Frist.

## Teilweise / blockierte / fehlgeschlagene Läufe wiederholen

Drei Zustände sind wiederholbar:

- `partial` — Kaskade lief, einzelne Kategorien wurden durch eine zwischenzeitlich gesetzte Sperre übersprungen, oder ein Thread hat das Seiten-Limit erreicht.
- `blocked` — Anfrage wurde am Legal-Hold-Gate abgewiesen. Sperre lösen, dann erneut versuchen.
- `failed` — Kaskade ist abgestürzt (RAG-Service nicht erreichbar, transienter Infrastrukturfehler) oder wurde vom Watchdog nach Überschreiten des 30-Minuten-Limits erfasst.

Die Aktion **Erneut versuchen** im Drawer plant den Processor neu ein. Das Hold-Gate läuft beim Start des Processors erneut, schließt also das Fenster zwischen „Sperre aufheben" und „Wiederholen".

## Was der Beleg zeigt

Der Detail-Drawer rendert den vollständigen Art.-17-/-19-Beleg für eine Anfrage:

- Status-Badge + Frist-Countdown.
- Identifier der Person, Rechtsgrund, Begründung, Einreichende Person und Zeitpunkt, aktuelle Frist (mit Verlängerungs-Info, falls vorhanden).
- Zähler: gelöschte / Ziel-Threads, aus RAG entfernte Dokumente, gelöschte Dokumente, durch Sperre übersprungene Dokumente, Fehlermeldung im Fehlerfall.
- Audit-Verlauf: jede `gdpr_erasure_*`-Zeile, die zur Person gehört, sortiert nach Audit-Kette.

**Es werden keine gelöschten PII-Inhalte angezeigt** — nur aggregierte Zähler und Identifier. Der Beleg darf direkt an die Aufsicht oder an die Person ausgehändigt werden.

## Scope heute, Scope später

Diese Seite liefert nur DSGVO Art. 17 (Löschung). Bewusst nicht enthalten (v1):

- Art. 16 Berichtigung und Art. 20 Datenübertragbarkeit — landen später als zusätzliche `kind`-Werte auf derselben DSR-Seite, ohne Route-Umbenennung.
- Self-Service-Portal für betroffene Personen — Tale ist administrationsgesteuert.
- In-Product-Identitätsprüfung — außerhalb des Produkts beim Admin.
- Benachrichtigung der betroffenen Person bei Abschluss — Aufgabe der Email-Infrastruktur.
- Bulk-Subject-Requests (Sammelklagen).
- Multi-Jurisdiktions-Templates (CCPA, LGPD etc.) — zuerst nur DSGVO.
- KI-gestützte Schwärzung — Tale löscht statt zu schwärzen.

## Verwandt

- [Governance-Übersicht](/platform/admin/governance) — Schwesterseiten zu Retention, Legal Hold und Audit-Log.
- [DSGVO Art. 12 — Transparente Informationen und Modalitäten](https://gdpr-info.eu/art-12-gdpr/)
- [DSGVO Art. 17 — Recht auf Löschung](https://gdpr-info.eu/art-17-gdpr/)
