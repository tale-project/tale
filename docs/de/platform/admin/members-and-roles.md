---
title: Mitglieder und Rollen
description: Die sechs Rollen, die Tale mitbringt, und die Berechtigungs-Matrix auf Ressourcen-Ebene, die sagt, wer was darf. Admins und Inhaber lesen das beim Aufsetzen eines Teams oder wenn ein Audit fragt, wer welchen Zugriff hat.
---

Mitglieder sind die Personen in deiner Organisation, die sich bei Tale anmelden können. Rollen kontrollieren, was jedes Mitglied tun darf — lesen, schreiben, konfigurieren, regeln. Diese Seite ist die kanonische Referenz für die sechs Rollen und die Berechtigungen pro Ressource, die jede Rolle trägt.

Sechs Rollen decken nahezu jedes Team ab, an das Tale ausgeliefert wird. Admins und Inhaber lesen diese Seite, wenn sie ein Team zum ersten Mal aufsetzen, wenn ein Audit fragt, wer welchen Zugriff hat, oder wenn sie wissen müssen, ob sie einem neuen Kollegen Redakteur oder Entwickler geben.

Lieber erst zusehen? Episode 8 geht in gut zwei Minuten durch Besetzung, Rollenleiter und Teamwände — mit Untertiteln.

<Video src="/videos/de/tutorials/ep8-people/ep8-people.de.mp4" poster="/videos/de/tutorials/ep8-people/ep8-people.de.webp" captions="/videos/de/tutorials/ep8-people/ep8-people.de.vtt" lang="de" title="Episode 8 — Menschen, Rollen & Teams" caption="Episode 8 — Menschen, Rollen & Teams (2:35)">

</Video>

<Frame caption="Der Mitglieder-Abschnitt unter Einstellungen > Organisation — jeder Account und die Rolle, die ihn begrenzt.">

![Die Organisations-Einstellungsseite mit ihrem Mitglieder-Abschnitt, der den Inhaber des Workspace und eine Schaltfläche Mitglied hinzufügen zeigt.](/images/get-started/settings-organization-members.webp)

</Frame>

## Ein Mitglied hinzufügen

Um eine Person in deine Organisation aufzunehmen, öffne **Einstellungen > Organisation**, scroll zum Abschnitt **Mitglieder** und klick auf **Mitglied hinzufügen**. Trag **Name**, **E-Mail** und **Rolle** ein und vergib ein **Passwort** — Tale verschickt keine Einladungs-E-Mail, deshalb ist ein Passwort erforderlich, um ein neues Konto zu erstellen. (Gehört die E-Mail bereits zu einem Tale-Konto, wird kein Passwort verlangt: die Person meldet sich mit ihren bestehenden Zugangsdaten an und wird einfach dieser Organisation hinzugefügt.)

Beim **Mitglied hinzufügen** zeigt Tale die neuen Zugangsdaten **einmalig** an, mit dem Hinweis, sie jetzt zu speichern — sie werden nicht erneut angezeigt. Gib sie dem neuen Mitglied auf einem anderen Weg weiter; es gibt keine Reset-E-Mail. Wer sein Passwort später vergisst, wendet sich an einen Admin, der im selben Mitglieder-Abschnitt ein neues setzen kann.

Wähl die Rolle im Formular, bevor du absendest; sie später hochzustufen oder zu ändern ist eine Ein-Klick-Änderung im selben Mitglieder-Abschnitt.

## Die sechs Rollen

**Inhaber** hat jede Berechtigung, die Admin hat, plus die eine, die Admin fehlt: Eigentum übertragen und die Organisation löschen. Die meisten Teams haben genau einen Inhaber; manche behalten zwei für Kontinuität.

**Admin** regelt die Organisation: Mitglieder, Anbieter, Branding, Governance-Richtlinien, Connectors, das Audit-Log. Admins tun alles, was Redakteur und Entwickler tun, plus die Konfigurationsoberfläche. Sie können das Eigentum nicht übertragen.

**Entwickler** baut: Agents, Workflows, Connectors, API-Keys, MCP-Server. Entwickler können jede Ressource lesen und in die meisten schreiben, inklusive Governance-Richtlinien (nur lesen). Greif zu Entwickler, wenn jemand die API-Ebene und das Connector-Tooling braucht.

**Redakteur** kuratiert und betreibt: Agents, die Wissensdatenbank (Dokumente, Kontakte, Produkte, Lieferanten, Websites), den Konversations-Posteingang, Genehmigungen, die Skill-Bibliothek. Redakteure können Workflows lesen, aber nicht ändern; sie können Connectors lesen, aber nicht konfigurieren. Greif zu Redakteur, wenn jemand die tägliche Produktarbeit erledigt, ohne die API- oder Connectorsebene zu berühren.

**Mitglied** nutzt: Chat, durchsucht die Wissensdatenbank und liest Konversationen und Genehmigungen. Konversationen sind zuweisungsbezogen sichtbar: Mitglieder sehen Threads, die ihnen zugewiesen oder in die Warteschlange ihrer Teams gelegt sind; wirklich unzugewiesene Post sichten nur Admins — nutze [Konversations-Routing](/de/platform/admin/governance/policies-and-limits#konversations-routing), damit eingehende Post beim Eintreffen in eine Team-Warteschlange landet. Mitglieder schreiben nur an Nachrichten-Feedback (Daumen hoch / runter). Greif zu Mitglied als Default — die meisten Benutzer in den meisten Organisationen sind Mitglieder.

**Deaktiviert** hat keine Berechtigungen. Nutz das, um Zugriff zu entziehen, ohne den Account zu löschen; Transkripte und Audit-Historie bleiben intakt, und ein Reaktivieren stellt die vorherige Rolle wieder her.

## Die Berechtigungs-Matrix

| Ressource                 | Inhaber | Admin | Entwickler | Redakteur | Mitglied | Deaktiviert |
| ------------------------- | ------- | ----- | ---------- | --------- | -------- | ----------- |
| Agents                    | R / W   | R / W | R / W      | R / W     | R        | —           |
| Dokumente                 | R / W   | R / W | R / W      | R / W     | R        | —           |
| Produkte                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Kontakte                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Lieferanten               | R / W   | R / W | R / W      | R / W     | R        | —           |
| Projekte                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Websites                  | R / W   | R / W | R / W      | R / W     | R        | —           |
| Konversationen            | R / W   | R / W | R / W      | R / W     | R        | —           |
| Konversations-Nachrichten | R / W   | R / W | R / W      | R / W     | R        | —           |
| Genehmigungen             | R / W   | R / W | R / W      | R / W     | R        | —           |
| Workflow-Ausführungen     | R / W   | R / W | R / W      | R         | R        | —           |
| Workflow-Processing       | R / W   | R / W | R / W      | R         | R        | —           |
| Connectors                | R / W   | R / W | R / W      | R         | R        | —           |
| OneDrive-Sync-Konfigs     | R / W   | R / W | R / W      | R         | R        | —           |
| Google-Drive-Sync-Konfigs | R / W   | R / W | R / W      | R         | R        | —           |
| Audit-Logs                | R / W   | R / W | R / W      | R / W     | R        | —           |
| Governance-Richtlinien    | R / W   | R / W | R          | R         | R        | —           |
| Nachrichten-Feedback      | R / W   | R / W | R / W      | R / W     | R / W    | —           |

R = lesen, W = schreiben, — = kein Zugriff. Die Matrix ist die autoritative Beschreibung, was jede Rolle über die Ressourcen tun kann, die Tale verfolgt; die Zeilen sind dieselbe Menge, die das In-Produkt-Berechtigungssystem zur Request-Zeit nutzt. Die Audit-Log-Seiten selbst sehen nur Admins und Inhaber, egal was die Matrix-Zeile über Lesen sagt.

## Die Einstellungs-Oberfläche und das Menü

Mitglieder, Redakteure und deaktivierte Benutzer sehen die Konfigurationsoberfläche nicht — nur ihre persönlichen Einstellungen plus die Skill-Bibliothek der Organisation. Entwickler sehen die Entwickler-Oberfläche (KI-Anbieter, Connectors, Sandboxes, den API-Bereich), aber nicht den Governance-Unterzweig. Admins und Inhaber sehen alles. Das Einstellungsmenü ist gruppiert in **Persönlich** (Konto, Einstellungen, Benachrichtigungen, Umgebung — jede Rolle), **Organisation** (Teams, Mitglieder, KI-Anbieter, Branding, Governance, Metriken und der Rest — Admin und Inhaber, wobei Entwickler eine Teilmenge sehen) und **Erweitert** (die API-, Enterprise-SSO- und Data-Residency-Oberfläche). Governance ist ein Eintrag innerhalb der Organisations-Gruppe, keine eigene Gruppe, und braucht Admin-Zugriff.

## Randfälle

**Eigentum übertragen** liegt im Zeilenmenü des Mitglieds — bestätige, und die Zielperson wird Inhaber, während du zu Admin herabgestuft wirst, mit sofortiger Wirkung.

**Der letzte Admin bleibt.** Tale verweigert, den letzten Admin herabzustufen — die Änderung kommt mit _Der letzte Admin kann nicht herabgestuft werden_ zurück. Zwei weitere Wächter stehen daneben: Die Inhaber-Rolle wandert nur über **Eigentum übertragen**, und die Rolle der Person, die die Organisation angelegt hat, ist unveränderlich.

**Zwei-Faktor zurücksetzen** liegt auf der Zeile des Mitglieds im Mitglieder-Abschnitt. Zurücksetzen entfernt den zweiten Faktor; der nächste Sign-in registriert neu.

## Wo das hingehört

Rollen sind die Zugriffsoberfläche, die jede andere Admin-Seite berührt: SSO authentifiziert sie, API-Keys gehören ihnen, Audit-Logs benennen sie, Governance-Richtlinien grenzen Verhalten nach Rolle ein. Die nächste Lektüre hängt davon ab, was du als Nächstes tust. Wenn du Sign-in an deinen Identitätsanbieter verdrahtest, behandelt [Authentifizierung](/de/self-hosted/configuration/authentication) die vier Sign-in-Modi. Wenn du Zugriff nach Team statt nur nach Rolle eingrenzt, deckt [Teams](/de/platform/admin/teams) die Team-Ebene dieser Eingrenzung ab.
