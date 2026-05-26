---
title: Trust und Compliance
description: Welche Compliance-Haltung Tale Cloud ausliefert, wer was auditiert, welche Kontrollen bei dir liegen und wie du Vorfälle meldest.
---

Trust und Compliance auf Cloud ist die Seite, die ein Auditor will. Sie benennt die Frameworks, gegen die die Plattform zertifiziert ist, trennt Verantwortlichkeiten zwischen Tale und deiner Org sauber, listet die für dich verfügbaren Datenschutzkontrollen und sagt dir, wen du anrufst, wenn etwas schiefgeht.

Der Inhalt hier ist beschreibend — was heute ausgeliefert wird, welche Belege Tale auf Anfrage übergeben kann. Die rechtlichen Dokumente selbst (DPA, Terms, Privacy) leben unter [Legal](/de/legal/privacy); diese Seite ist die schnelle Betreiber-Referenz.

## Eine durchgespielte Kontrolle — Audit-Logs von Anfang bis Ende

Der Compliance-Verantwortliche der Org muss nachweisen, dass „jede Änderung an Zugriffskontrollen mit Akteur, Ziel und Zeitstempel protokolliert wird". Tales [Audit-Logs](/de/platform/admin/governance/audit-logs) zeichnen jede Mitgliedseinladung, Rollenänderung, Entfernung und 2FA-Zurücksetzung mit der User-ID des Akteurs, der ID des betroffenen Mitglieds und einem ISO-Zeitstempel auf. Logs sind unveränderlich — einen Schnappschuss wiederherzustellen verändert sie nicht — und gemäss dem konfigurierten Floor der Org aufbewahrt. Der Verantwortliche exportiert einen Datumsbereich als CSV, übergibt ihn dem Auditor, und das durchgespielte Beispiel räumt die Kontrolle ab.

## Zertifizierungen und Frameworks

Tale Cloud ist derzeit gegen die folgenden Frameworks auditiert oder attestiert; die Zertifizierungsberichte sind unter NDA über den Support verfügbar:

- SOC 2 Type II (jährlich)
- ISO/IEC 27001
- DSGVO-konforme Kontrollen (EDPB-Leitlinien angewendet)
- FADP-konforme Kontrollen für die Schweizer Region (revDSG)

Geplant: HIPAA BAA (US-Enterprise-Kunden), zusätzliche regionale Attestierungen, wenn die Regionsliste wächst.

## Geteilte Verantwortung

| Kontrolle                     | Tale                   | Du                      | Beleg                                                         |
| ----------------------------- | ---------------------- | ----------------------- | ------------------------------------------------------------- |
| Infrastruktur-Verfügbarkeit   | ✓                      |                         | Status-Seite, SOC 2 SLA-Bericht                               |
| Datenverschlüsselung ruhend   | ✓                      |                         | Architektur-Beschreibung                                      |
| Verschlüsselung im Transit    | ✓                      |                         | TLS-Terminierung an Tales Edge                                |
| Mitgliedsidentität und Rollen |                        | ✓                       | [Mitglieder und Rollen](/de/platform/admin/members-and-roles) |
| API-Key-Ausgabe und Rotation  |                        | ✓                       | [API-Keys](/de/platform/admin/api-keys)                       |
| Content-Filterung und DLP     | Stellt Hooks bereit    | Konfiguriert Regeln     | [Guardrails](/de/platform/admin/governance/guardrails)        |
| Audit-Log-Aufbewahrung        | Stellt Speicher bereit | Setzt die Aufbewahrung  | [Aufbewahrung](/de/self-hosted/configuration/retention)       |
| Auskunftsanfragen             | Stellt Workflow bereit | Initiiert und genehmigt | [DSAR](/de/platform/admin/governance/data-subject-requests)   |
| Provider-Credentials          |                        | ✓                       | [Provider](/de/platform/admin/providers)                      |

## Datenschutz-Kontrollen

Innerhalb des Produkts zählen drei Kontroll-Oberflächen für Compliance:

- **Audit-Logs** — unveränderlicher Datensatz, wer was getan hat; Aufbewahrung konfigurierbar.
- **Legal Hold** — nimmt eine Datensatz-Menge bis zur Aufhebung aus der Aufbewahrung; abgedeckt in [Legal Hold](/de/platform/admin/governance/legal-hold).
- **Auskunftsanfragen** — der Anfrage-→-Übernahme-→-Löschung-→-Audit-Workflow; abgedeckt in [DSAR](/de/platform/admin/governance/data-subject-requests).

## Vorfälle melden

Tales Sicherheitsvorfall-Kontakt ist `security@tale.dev`. Vermutete Schwachstellen-Offenlegung folgt der Responsible-Disclosure-Policy auf derselben E-Mail. Kundenseitige Sicherheits-Advisories werden auf der Status-Seite veröffentlicht und dem Owner der Org per E-Mail zugestellt.

## Wo das hineinpasst

Trust und Compliance ist die Audit-Zeit-Seite; [Daten-Residenz](/de/cloud/data-residency) ist die Architektur-Zeit-Seite; [Subprozessoren](/de/legal/subprocessors) ist die Vendor-Listen-Seite. Ein Auditor will normalerweise alle drei zugleich — leg dir Lesezeichen für alle drei. Betreibst du self-hosted, sind die Kontrollen dieselben; was sich ändert, ist, wer die Infrastruktur darunter betreibt — siehe [Self-hosted-Übersicht](/de/self-hosted/overview).
