---
title: Erste Schritte als Mitglied
description: Anmelden, chatten, die Wissensdatenbank durchsuchen sowie geteilte Konversationen und Freigaben lesen — die Tag-1-Orientierung für Mitglieder.
---

Willkommen bei Tale. Als **Mitglied** hast du lesenden Zugriff auf den Arbeitsbereich deiner Organisation: Du kannst mit KI-Modellen und Agenten chatten, die Wissensdatenbank durchsuchen sowie Konversationen und Freigaben lesen, die mit dir geteilt wurden. Redakteure und Entwickler in deiner Organisation erstellen die Inhalte; Mitglieder nutzen sie.

Wenn du selbst eine Tale-Instanz installieren oder betreiben willst, siehe [Lokaler Schnellstart](/de/self-hosted/install/quickstart) oder [Produktions-Deployment](/de/self-hosted/install/linux-server).

## Anmelden

Es ist nichts zu installieren — Tale läuft vollständig im Browser. Dein Admin schaltet dich auf eine von drei Arten frei, je nachdem, wie deine Organisation konfiguriert ist.

- **E-Mail und Passwort.** Dein Admin legt dein Konto unter **Einstellungen → Mitglieder** mit einem initialen Passwort an und teilt es dir mit. Du wirst beim ersten Login aufgefordert, es zu ändern.
- **SSO (Microsoft Entra).** Melde dich mit deinem vorhandenen Microsoft-Konto an; dein Tale-Konto wird beim ersten Anmelden automatisch angelegt.
- **Reverse Proxy (Trusted Kopfzeilen).** Wenn Tale hinter Authelia, Authentik, oauth2-proxy o. ä. läuft, authentifiziert dich der Proxy und dein Konto wird bei der ersten Anfrage automatisch angelegt.

Wenn du dich nicht anmelden kannst, frage deinen Admin, welche Methode aktiv ist. (Admins: siehe [Authentifizierung](/de/self-hosted/admin/authentication) für die instanzweite Konfiguration.)

## Was du tun kannst

### Chat

Starte eine Konversation auf der Startseite. Wähle ein Modell, schreibe eine Nachricht und antworte. Der Chat-Eingabebereich unterstützt zusätzlich:

- Dateien anhängen (Bilder, PDFs, Dokumente) — siehe [Anhänge](/de/platform/chat/attachments).
- Einen Agent erwähnen, den ein Redakteur oder Entwickler erstellt hat — siehe [Agents im Chat](/de/platform/chat/agents-in-chat).
- Zwei Modelle nebeneinander vergleichen im [Arena-Modus](/de/platform/chat/arena-mode).

Vollständige Feature-Referenz: [Chat-Grundlagen](/de/platform/chat/basics).

### Wissensdatenbank durchsuchen

Die Wissensdatenbank enthält Dokumente, die deine Organisation hochgeladen oder gecrawlt hat. Durchsuche sie, öffne Dokumente und referenziere sie im Chat. Als Mitglied kannst du nichts hochladen oder löschen — das ist Aufgabe der Redakteure. Siehe [Wissensdatenbank](/de/platform/workspace/knowledge-base).

### Konversationen und Freigaben lesen

- **[Konversationen](/de/platform/workspace/conversations)** — geteilte Chat-Threads von Kolleg:innen.
- **[Freigaben](/de/platform/workspace/approvals)** — Outputs aus Automatisierungen, die auf eine menschliche Prüfung warten. Mitglieder können lesen; nur Redakteure und höher entscheiden.

## Konto personalisieren

Display-Name, Sprache, Theme und Benachrichtigungseinstellungen findest du im Avatar-Menü. Details: [Einstellungen](/de/platform/member/preferences).

## Mehr machen?

Mitglieder haben nur lesenden Zugriff. Um Agenten zu erstellen, Wissen zu bearbeiten oder Automatisierungen auszuführen, frage deinen Admin nach einer Rollenerhöhung. Die vollständige Rollenmatrix steht unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles).
