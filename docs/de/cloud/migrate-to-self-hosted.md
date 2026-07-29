---
title: Auf Self-hosted migrieren
description: Wann Self-hosting Cloud schlägt, was mitkommt und was nicht, und wie du deine Org überträgst, ohne laufende Agents zu brechen.
---

Die Migration von Cloud zu Self-hosted ist ein echtes Verfahren, kein Setting-Flip. Die Daten exportieren, die neue Instanz importieren, DNS schwenkt auf den neuen Host, und dein Team meldet sich in derselben Org an, die es hatte — dieselben Agents, dieselben Chats, dieselbe Audit-History. Dieses Tutorial führt das Verfahren und zeigt, wo es schiefgeht.

Greif danach, wenn Self-hosting wirklich besser passt: Daten-Residenz erfordert Hardware unter deiner Kontrolle, Kosten im Massstab machen On-premise billiger als Pro-Token, oder die Org hat entschieden, den Stack selbst zu betreiben. Für die meisten Teams bleibt Cloud die richtige Wahl — lies [Cloud-Onboarding](/de/cloud/onboarding) noch einmal, wenn du noch entscheidest.

## Bevor du beginnst

Hab diese Dinge vor dem Export bereit:

- Einen Ziel-Host, der die Self-hosted-Voraussetzungen erfüllt — siehe [Quickstart](/de/self-hosted/install/quickstart) für die Spec.
- DNS-Kontrolle über die Domain, die deine Org aktuell nutzt; du wirst sie beim Cutover schwenken.
- Ein Wartungsfenster von mindestens einer Stunde. Der Import selbst ist schneller, aber DNS-Propagation und Validierung fügen Zeit hinzu.
- Eine kürzliche Backup-Bestätigung im Audit-Log deiner Cloud-Org. Während einer Migration wird in der Quelle nichts gelöscht, aber das Export-Bundle ist dein Beleg, dass der Quellzustand konsistent war.

## Was mitkommt und was nicht

Kommt mit: Chats, Threads, Nachrichten, Anhänge, Dokumente, Wissens-Embeddings, Agents, Agent-Versionen, Workflows, Executions, Audit-Logs, Mitglieder, Rollen, Teams, Branding, API-Keys, Connector-Metadaten.

Kommt nicht mit: externe Connectors müssen gegen die neue Instanz neu authentifiziert werden (die Credentials leben im Provider, nicht im Export-Bundle); aktiv laufende Workflows pausieren und nehmen auf der neuen Instanz nach dem Cutover wieder auf; Sprach-Audios, die über das Aufbewahrungsfenster der Org hinaus aufbewahrt werden, bleiben im Cloud-Object-Store, bis sie geleert werden.

## Schritt 1 — Exportieren

Öffne **Einstellungen > Organisation** auf Cloud und klick **Export**. Der Dialog führt den Export im Hintergrund aus und schickt einen Download-Link per E-Mail, wenn er fertig ist. Der Export ist ein einzelnes verschlüsseltes Bundle; die E-Mail enthält den Entschlüsselungs-Key. Lade das Bundle herunter und speichere den Key getrennt.

## Schritt 2 — Die Ziel-Instanz aufstellen

Folg auf dem Ziel-Host [Quickstart](/de/self-hosted/install/quickstart) bis zum First-Admin-Schritt. Lad noch keine User ein — der Import überschreibt die Mitgliederliste. Bestätige, dass die neue Instanz bootet und du dich als Owner anmelden kannst.

## Schritt 3 — Importieren

Melde dich auf der Ziel-Instanz als Owner an und besuche `/_internal/import` (verlinkt von der Einstellungsseite nach einer frischen Installation). Lad das Bundle hoch, füg den Entschlüsselungs-Key ein und klick **Import**. Der Import ist eine lang laufende Operation; die Seite zeigt Fortschritt pro Datenklasse. Löst sich die Seite zu **Import complete** auf, trägt die neue Instanz den vollen Zustand der Quell-Org.

## Schritt 4 — DNS schwenken

Aktualisiere den DNS-Eintrag für die Domain der Org, sodass er auf die neue Instanz zeigt. Sobald die Propagation landet und das TLS der neuen Instanz gesund ist, landen User, die sich anmelden, auf der Self-hosted-Instanz mit ihren bestehenden Credentials. Die Cloud-Org wird an diesem Punkt nur-lesbar — um Drift zu vermeiden, archiv sie nach ein paar Tagen Vertrauen unter **Einstellungen > Organisation** auf Cloud.

## Fehlersuche

- **Export hängt bei „preparing".** Sehr grosse Orgs (>100 GB) brauchen länger, als das E-Mail-Fenster annimmt. Öffne ein Support-Ticket; der Export läuft im Hintergrund bis zum Abschluss.
- **Import scheitert an Schema-Mismatch.** Deine Ziel-Instanz läuft eine ältere Tale-Version als der Cloud-Export erwartet. Upgrade die Ziel-Instanz, bevor du es erneut versuchst — das Bundle ist vorwärts-kompatibel, nicht rückwärts-kompatibel.
- **Mitglieder können sich nach dem Cutover nicht anmelden.** Session-Cookies sind auf den alten Host begrenzt. Mitglieder authentifizieren sich einmal neu; SSO- und 2FA-Einstellungen kommen mit.
- **Workflows zeigen „pausiert" nach dem Import.** Erwartet — der Import bewahrt den Zustand, nimmt aber laufende Executions nicht automatisch wieder auf. Öffne jeden Workflow und klick **Resume**, nachdem du bestätigt hast, dass die Ziel-Instanz von externen Triggern erreichbar ist.

## Wo das eingesetzt wird

Migration ist in der Praxis eine Einbahn-Operation — bist du einmal self-hosted, bleibst du es, ausser etwas ändert sich strukturell. Die umgekehrte Migration (Self-hosted zu Cloud) folgt derselben Form mit demselben Tooling und wird unterstützt, ist aber selten. Bist du noch auf Cloud und liest das für Kontext, ist die Anschluss-Seite [Self-hosted-Übersicht](/de/self-hosted/overview); sie benennt, was du dir aufhalst.
