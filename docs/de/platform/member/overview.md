---
title: Mitglied
description: Der Nur-Lese-Konsumenten-Sitz — anmelden, mit KI und Agents chatten, in der Wissensdatenbank stöbern, geteilte Konversationen und Freigaben lesen. Die Tag-eins-Orientierung des Mitglieds.
---

Ein **Mitglied** in Tale ist der Nur-Lese-Konsumenten-Sitz. Du meldest dich an, chattest mit KI-Modellen und Agents, die dein Team aufgesetzt hat, stöberst in der Wissensdatenbank, die deine Redakteure pflegen, und liest die Konversationen und Freigaben, die mit dir geteilt sind. Du lädst keine Dokumente hoch, erstellst keine Agents und änderst keine Einstellung, die andere betrifft — diese Oberflächen sind Redakteuren, Entwicklern und Admins vorbehalten. Diese Seite ist für Menschen, die zum ersten Mal in Tale einsteigen, und für alle, die nur jemals die Konsumenten-Seite des Produkts brauchen.

Es gibt nichts zu installieren — Tale läuft komplett im Browser. Falls du zusätzlich eine Tale-Instanz selbst installieren oder betreiben musst, decken [Lokaler Schnellstart](/de/self-hosted/install/quickstart) und [Produktions-Deployment](/de/self-hosted/install/linux-server) das ab, und der Rest des Selbst-gehostet-Bereichs deckt den Plattform-Betrieb ab.

## Ein Mitglieds-Tag

Ein typischer Tag startet auf der Home-Seite mit einem frischen Chat. Du stellst dem Modell eine Frage, die das Team dokumentiert hat; der Agent greift das relevante Dokument automatisch auf und antwortet mit einer Zitation, die zum Original zurück verlinkt. Später wirft eine Redakteurin ein neues Produkt-PDF in die Wissensdatenbank; deine nächste Frage zu diesem Produkt fädelt die neue Information ohne dein Zutun in die Antwort ein. Teilt ein Teammitglied eine Konversation, taucht sie unter **Konversationen** auf; wartet ein Workflow auf eine menschliche Entscheidung, die deine Rolle sehen darf, erscheint sie unter **Freigaben** (nur-lesend — das Urteil gehört einem Redakteur).

## Anmelden

Dein Admin bringt dich über eine von drei Methoden hinein, je nachdem, wie die Organisation konfiguriert ist.

- **E-Mail und Passwort.** Dein Admin legt das Konto aus **Einstellungen > Mitglieder** mit einem Anfangs-Passwort an und teilt es dir. Beim ersten Anmelden musst du es ändern.
- **SSO (Microsoft Entra ID).** Du meldest dich mit deinem bestehenden Microsoft-Konto an; dein Tale-Konto wird beim ersten Mal automatisch angelegt.
- **Reverse-Proxy (vertrauenswürdige Kopfzeilen).** Sitzt Tale hinter Authelia, Authentik, oauth2-proxy oder ähnlich, authentifiziert dich der Proxy und dein Konto wird bei der ersten Anfrage automatisch angelegt.

Kannst du dich nicht anmelden, frage deinen Admin, welche Methode aktiv ist. Admins: siehe [Authentifizierung](/de/self-hosted/admin/authentication) für die instanzweite Konfiguration.

## Was du tun kannst

### Chatten

Starte eine Konversation aus der Home-Seite. Wähle ein Modell aus der Auswahl, tippe eine Nachricht und sende sie. Die Eingabe nimmt auch:

- Datei-Anhänge — Bilder, PDFs, Audio, Video. Siehe [Chat-Anhänge](/de/platform/chat/attachments) für die vollständige Liste und die je-Typ-Verarbeitung.
- Eine `@`-Erwähnung eines Agents, den deine Redakteurin oder dein Entwickler veröffentlicht hat. Siehe [Agents im Chat](/de/platform/chat/agents-in-chat).
- Zwei Modelle nebeneinander im [Arena-Modus](/de/platform/chat/arena-mode), wenn die Frage „Welches Modell antwortet besser?" lautet.

Vollständige Referenz: [Chat-Grundlagen](/de/platform/chat/basics).

### Wissensdatenbank durchstöbern

Die Wissensdatenbank hält die Dokumente, die deine Organisation hochgeladen oder gecrawlt hat. Du kannst sie durchsuchen, Dokumente öffnen und aus dem Chat referenzieren. Als Mitglied kannst du nicht hochladen oder löschen — das ist eine Redakteurs-Aufgabe. Siehe [Wissensdatenbank](/de/platform/workspace/knowledge-base).

### Konversationen und Freigaben lesen

- **[Konversationen](/de/platform/workspace/conversations)** — Kunden-Threads, die mit dir geteilt sind. Nur-lesend in der Mitglieds-Rolle; Redakteure und höher können antworten.
- **[Freigaben](/de/platform/workspace/approvals)** — Ausgaben aus Automatisierungen, die auf ein menschliches Urteil warten. Du kannst lesen; Redakteure und höher entscheiden.

## Konto personalisieren

Setze Anzeigename, Sprache, Theme und Benachrichtigungs-Voreinstellungen aus dem Avatar-Menü. Die Details stehen auf [Deine Einstellungen](/de/platform/member/preferences).

## Wo das hingehört

Mitglieder sind die Nur-Lese-Konsumenten — der Sitz, der für Menschen gemacht ist, die die KI nutzen, ohne sie zu kuratieren. Um Agents zu erstellen, Wissen zu bearbeiten oder Automatisierungen zu fahren, frag einen Admin, deine Rolle auf Redakteur oder Entwickler hochzustufen. Die kanonische Rollen-Matrix lebt unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles); die rollenspezifischen Landungen ([Redakteur](/de/platform/editor/overview), [Entwickler](/de/platform/developer/overview)) beschreiben, was jede Hochstufung freischaltet.
