---
title: Mitglieder und Rollen
description: Die sechs Rollen, die Tale mitbringt, und die Berechtigungs-Matrix auf Ressourcen-Ebene, die sagt, wer was darf. Admins und Inhaber lesen das beim Aufsetzen eines Teams oder wenn ein Audit fragt, wer welchen Zugriff hat.
---

Mitglieder sind die Personen in deiner Organisation, die sich bei Tale anmelden können. Rollen kontrollieren, was jedes Mitglied tun darf — lesen, schreiben, konfigurieren, regeln. Diese Seite ist die kanonische Referenz für die sechs Rollen und die Berechtigungen pro Ressource, die jede Rolle trägt.

Sechs Rollen decken nahezu jedes Team ab, an das Tale ausgeliefert wird. Admins und Inhaber lesen diese Seite, wenn sie ein Team zum ersten Mal aufsetzen, wenn ein Audit fragt, wer welchen Zugriff hat, oder wenn sie wissen müssen, ob sie einem neuen Kollegen Redakteur oder Entwickler geben.

## Eine durchgespielte Einladung

Um eine Person in deine Organisation aufzunehmen, öffne **Einstellungen > Mitglieder** und klick auf **Mitglied hinzufügen**. Das neue Mitglied erhält einen E-Mail-Link, der 24 Stunden gültig ist, und landet in der Standardrolle, die du auswählst — ändere die Rolle vor dem Senden im Formular, falls sie nicht Mitglied werden soll. Der Default greift, sobald die Person die Einladung annimmt; eine Hochstufung später ist eine Ein-Klick-Änderung in derselben Mitglieder-Ansicht.

## Die sechs Rollen

**Inhaber** hat jede Berechtigung, die Admin hat, plus die eine, die Admin fehlt: Eigentum übertragen und die Organisation löschen. Die meisten Teams haben genau einen Inhaber; manche behalten zwei für Kontinuität.

**Admin** regelt die Organisation: Mitglieder, Anbieter, Branding, Governance-Richtlinien, Integrationen, das Audit-Log. Admins tun alles, was Redakteur und Entwickler tun, plus die Konfigurationsoberfläche. Sie können das Eigentum nicht übertragen.

**Entwickler** baut: Agents, Automatisierungen, Integrationen, API-Keys, MCP-Server. Entwickler können jede Ressource lesen und in die meisten schreiben, inklusive Governance-Richtlinien (nur lesen). Greif zu Entwickler, wenn jemand die API-Ebene und das Integrations-Tooling braucht.

**Redakteur** kuratiert und betreibt: Agents, die Wissensdatenbank (Dokumente, Kunden, Produkte, Lieferanten, Websites), den Konversations-Posteingang, Genehmigungen, die Prompt-Bibliothek. Redakteure können Workflows lesen, aber nicht ändern; sie können Integrationen lesen, aber nicht konfigurieren. Greif zu Redakteur, wenn jemand die tägliche Produktarbeit erledigt, ohne die API- oder Integrationsebene zu berühren.

**Mitglied** nutzt: Chat, durchsucht die Wissensdatenbank, liest Konversationen und Genehmigungen, die ihm zugewiesen sind. Mitglieder schreiben nur an Nachrichten-Feedback (Daumen hoch / runter). Greif zu Mitglied als Default — die meisten Benutzer in den meisten Organisationen sind Mitglieder.

**Deaktiviert** hat keine Berechtigungen. Nutz das, um Zugriff zu entziehen, ohne den Account zu löschen; Transkripte und Audit-Historie bleiben intakt, und ein Reaktivieren stellt die vorherige Rolle wieder her.

## Die Berechtigungs-Matrix

| Ressource                 | Inhaber | Admin | Entwickler | Redakteur | Mitglied | Deaktiviert |
| ------------------------- | ------- | ----- | ---------- | --------- | -------- | ----------- |
| Agents                    | R / W   | R / W | R / W      | R / W     | R        | —           |
| Dokumente                 | R / W   | R / W | R / W      | R / W     | R        | —           |
| Produkte                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Kunden                    | R / W   | R / W | R / W      | R / W     | R        | —           |
| Lieferanten               | R / W   | R / W | R / W      | R / W     | R        | —           |
| Projekte                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Websites                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Konversationen            | R / W   | R / W | R / W      | R / W     | R        | —           |
| Konversations-Nachrichten | R / W   | R / W | R / W      | R / W     | R        | —           |
| Genehmigungen             | R / W   | R / W | R / W      | R / W     | R        | —           |
| Workflow-Ausführungen     | R / W   | R / W | R / W      | R         | R        | —           |
| Workflow-Processing       | R / W   | R / W | R / W      | R         | R        | —           |
| Integrationen             | R / W   | R / W | R / W      | R         | R        | —           |
| OneDrive-Sync-Konfigs     | R / W   | R / W | R / W      | R         | R        | —           |
| Prompt-Templates          | R / W   | R / W | R / W      | R / W     | R        | —           |
| Audit-Logs                | R / W   | R / W | R / W      | R / W     | R        | —           |
| Governance-Richtlinien    | R / W   | R / W | R          | R         | R        | —           |
| Nachrichten-Feedback      | R / W   | R / W | R / W      | R / W     | R / W    | —           |
| MCP-Server                | R / W   | R / W | R / W      | R         | R        | —           |

R = lesen, W = schreiben, — = kein Zugriff. Die Matrix ist die autoritative Beschreibung, was jede Rolle über die Ressourcen tun kann, die Tale verfolgt; die Zeilen sind dieselbe Menge, die das In-Produkt-Berechtigungssystem zur Request-Zeit nutzt.

## Die Einstellungs-Oberfläche und das Menü

Mitglieder, Redakteure und deaktivierte Benutzer sehen Einstellungen nicht — das Menü ist ausgeblendet. Entwickler sehen Einstellungen, aber nicht den Governance-Unterzweig (ausser Lese-Ansichten). Admins und Inhaber sehen das volle Menü. Die drei Sidebar-Gruppen (`Du`, `Workspace`, `Governance`) spiegeln diese Trennung: `Du` ist pro Benutzer, `Workspace` ist Konfiguration, `Governance` ist die Audit-und-Richtlinien-Oberfläche, die Admin-Zugriff braucht.

## Randfälle

**Eigentum übertragen** verlangt, dass ein bestehender Inhaber einen aktuellen Admin oder Inhaber nominiert; die neue Inhaber-Rolle wirkt sofort. Der vorherige Inhaber wird zu Admin, ausser er wird explizit herabgestuft.

**Warnung „letzter Admin".** Die Mitglieder-Ansicht warnt, wenn der letzte Admin oder Inhaber entfernt oder herabgestuft wird. Die Aktion ist erlaubt — Tale sperrt dich nicht aus — aber du solltest mindestens zwei Admin- oder Inhaber-Accounts für Kontinuität halten.

**2FA zurücksetzen** liegt auf der Zeile des Mitglieds in Mitglieder. Zurücksetzen entfernt den zweiten Faktor; der nächste Sign-in registriert neu.

## Wo das hingehört

Rollen sind die Zugriffsoberfläche, die jede andere Admin-Seite berührt: SSO authentifiziert sie, API-Keys gehören ihnen, Audit-Logs benennen sie, Governance-Richtlinien skopieren Verhalten nach Rolle. Die nächste Lektüre hängt davon ab, was du als Nächstes tust. Wenn du Sign-in an deinen Identitätsanbieter verdrahtest, behandelt [Authentifizierung](/de/self-hosted/configuration/authentication) die vier Sign-in-Modi. Wenn du Zugriff nach Team statt nur nach Rolle skopierst, deckt [Teams](/de/platform/admin/teams) die Per-Team-Skopierungsebene ab.
