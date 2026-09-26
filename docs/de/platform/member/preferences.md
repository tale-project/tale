---
title: Konto und persönliche Einstellungen verwalten
description: Ändere deinen Namen, sichere die Anmeldung ab, wähle eine Sprache und lerne die persönlichen Einstellungen kennen.
---

Die Kontoeinstellungen bestimmen, welchen Namen deine Kollegen sehen und wie du dich anmeldest. Im Profilmenü wechselst du außerdem Organisation und Sprache und siehst, zu welchen Teams du gehörst. Dafür brauchst du keine Admin-Rolle.

## Den sichtbaren Namen ändern

Öffne **Einstellungen > Konto**. Ändere unter **Profil** das Feld **Name** und klicke oben auf **Speichern**. Mit **Verwerfen** stellst du den gespeicherten Wert wieder her. Die E-Mail-Adresse ist schreibgeschützt, weil sie dein Konto bei der Anmeldung und für Benachrichtigungen identifiziert.

Dein Name ist für Kollegen sichtbar. Er ist keine persönliche Anweisung an den Assistenten.

## Die Anmeldung absichern

Unter **Sicherheit** findest du **Passwort ändern** oder **Passwort festlegen**, falls dein Konto noch keines hat. Beachte die Anforderungen im Dialog. Eine Passwortänderung beendet deine Sitzungen. Halte das neue Passwort deshalb bereit, bevor du bestätigst.

Richte unter **Zwei-Faktor-Authentifizierung** eine Authenticator-App ein oder ergänze unter **Passkeys** einen Passkey. Bewahre Wiederherstellungscodes an einem Ort auf, den du ohne Tale-Anmeldung erreichst. [Zwei-Faktor-Authentifizierung](/de/platform/admin/two-factor-authentication) erklärt Einrichtung, Wiederherstellung und Organisationsvorgaben.

## Sprache oder Arbeitsbereich wechseln

Öffne das Profilmenü über deinen Avatar. Unter **Sprache** änderst du die Oberflächensprache. Bist du in mehreren Organisationen, wechselst du mit **Organisation** den Arbeitsbereich. Die Zeile **Teams** nennt deine Teams und öffnet die Kontoseite; sie wechselt nichts, denn ein Team ist kein Arbeitsbereich.

Prüfe den Organisationsnamen, bevor du Einstellungen änderst oder Inhalte hinzufügst.

## Deine Rolle sehen {#role}

Unter **Einstellungen > Konto > Deine Rolle** steht deine Rolle in dieser Organisation, zum Beispiel Redakteur oder Mitglied. Die Rolle bestimmt, was du tun darfst; deine Teams bestimmen, welche Team-Inhalte du siehst. Admins vergeben Rollen unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles). Mit Single Sign-On kann auch dein Identity-Provider deine Rolle bei jeder Anmeldung festlegen. Inhaber und Admins sehen im Abschnitt den Link **Mitglieder verwalten**.

## Deine Teams sehen {#teams}

Unter **Einstellungen > Konto > Deine Teams** stehen die Teams, zu denen du gehörst. Teams bestimmen, welche Team-Dokumente, Projekte und Posteingangs-Warteschlangen du siehst; was mit der ganzen Organisation geteilt ist, siehst du in jedem Fall. Bist du in keinem Team, sagt der Abschnitt das.

Um eine Liste auf bestimmte Arbeit einzugrenzen, nutze ihren Filter **Teams**: **Organisationsweit** zeigt nur Einträge ohne Team, **Meine Teams** zeigt Einträge, die eines deiner Teams sehen darf, und jedes Team steht mit Namen zur Wahl. Der Posteingang bietet hinter seinem Suchfeld den Filter **Zuständig**, der Personen und Teams gemeinsam aufführt. Ein Filter ändert die Ansicht, erweitert aber nicht deinen Zugriff auf Daten anderer Teams.

Inhaber und Admins verwalten die Mitgliedschaften unter [Teams](/de/platform/admin/teams); der Abschnitt verlinkt für sie dorthin.

## Benutzerdefinierte Anweisungen für den Chat-Assistenten festlegen

Öffne **Einstellungen > Personalisierung**. **Benutzerdefinierte Anweisungen** sind feste Anweisungen, die der Chat-Assistent in jeder Antwort an dich befolgt, etwa ein bevorzugter Ton, eine Standard-Programmiersprache oder wie ausführlich du Antworten möchtest. Der Schalter kann dem Organisationsstandard folgen oder deine eigene Wahl speichern; der Hinweis darunter sagt, was gerade gilt. Das Textfeld erscheint, solange die Funktion aktiv ist. Gib deine Anweisungen ein und klicke in der Kopfzeile auf **Speichern**.

<Frame caption="Die Personalisierung enthält deine benutzerdefinierten Anweisungen und den Schalter, der sie aktiviert.">

![Die Seite Personalisierung zeigt den Schalter für benutzerdefinierte Anweisungen und das zugehörige Textfeld.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

Deine Anweisungen überschreiben weder die verbindlichen Anweisungen der Organisation noch **Allgemein > Anweisungen** eines Projekts; bei einem Widerspruch haben diese Vorrang. Schaltest du die Funktion aus, bleibt der Text für später erhalten, ohne angewendet zu werden.

</Note>

## Nutzungslimits prüfen {#usage-limits}

Unter **Einstellungen > Nutzung** siehst du, wie viel du von den Limits verbraucht hast, die deine Organisation für dich festlegt. Gilt kein Limit für dich, zeigt die Seite das an.

<Frame caption="Unter Einstellungen > Nutzung steht jedes Limit, das für dich gilt, mit Verbrauch und nächstem Zurücksetzen.">

![Die Seite Nutzung zeigt persönliche Monatslimits für Token, Kosten und Anfragen und die geteilten Monatslimits der Organisation, jeweils mit Verbrauchsbalken und Datum des Zurücksetzens. Darunter steht der belegte Speicherplatz im Vergleich zum Limit pro Person. Admins sehen zusätzlich die Schaltfläche Limits verwalten.](/images/platform/settings-usage.webp)

</Frame>

- **Deine Limits** zählen deine eigenen Chats, Sprachausgaben und Agenten-Läufe, egal auf welchem Weg du sie gestartet hast; [So wird die Nutzung gezählt](/de/platform/admin/governance/usage-attribution) erklärt, wem ein Lauf angerechnet wird. Ist eines erreicht, kannst du bis zum Zurücksetzen nichts davon neu starten: Eine Nachricht, die du dann sendest, wird mit einem Hinweis auf das Limit abgelehnt und bleibt im Eingabefeld.
- **Geteilte Limits** zählen die Nutzung aller, für die sie gelten, etwa eines Teams, zu dem du gehörst, oder der gesamten Organisation. Sie können deshalb vor deinen eigenen Limits erreicht sein.
- **Speicherplatz** vergleicht die Dateien, die du hochgeladen hast, mit deinem Speicherlimit. Ist es erreicht, werden neue Dokument-Uploads abgelehnt.

Jedes Nutzungslimit zeigt den Verbrauch, das Limit und den Zeitpunkt des Zurücksetzens in deiner Ortszeit. Die Zeiträume richten sich nach UTC: Tageslimits beginnen um Mitternacht neu, Wochenlimits am Montag und Monatslimits am Ersten des Monats. Hat ein Admin eine Warnschwelle festgelegt, färbt sich der Balken orange, sobald deine Nutzung sie erreicht. Warnt ein Banner über dem Eingabefeld vor einem Limit, öffnet **Nutzung anzeigen** diese Seite. Admins sehen zusätzlich **Limits verwalten**, das **Richtlinien > Richtlinien & Limits** öffnet.

## Alte Chats archivieren oder abmelden

Unter **Einstellungen > Konto > Deine Chats** findest du **Alle Chats archivieren** und **Alle Chats löschen** für deine eigenen Chats in der aktuellen Organisation, einschließlich Projekt-Chats. Archiviert werden nur noch nicht archivierte Chats. Das Löschen schließt archivierte Chats ein und verschiebt sie in den Papierkorb, wo du sie innerhalb der Aufbewahrungsfrist wiederherstellen kannst. Chats unter rechtlicher Aufbewahrung bleiben unverändert; Chats mit einer laufenden Antwort können nicht gelöscht werden.

Lies die Bestätigung, bevor du fortfährst. Das Ergebnis zeigt, wie viele Chats geändert wurden und wie viele nicht geändert werden konnten. Verwende das Menü eines einzelnen Chats im Bereich **Start**, wenn du nur dieses Gespräch ordnen möchtest. Archivierte Chats bleiben dort unter **Archiviert** am Ende der Liste; **Dearchivieren** im Menü eines Chats holt ihn zurück.

**Abmelden** im Profilmenü beendet die aktuelle Sitzung und führt zur Anmeldung zurück. Melde dich auf gemeinsam genutzten Geräten nach der Arbeit ab. Für ein eigenes App-Fenster auf deinem Gerät lies [Als App installieren](/de/platform/member/install-as-app).
