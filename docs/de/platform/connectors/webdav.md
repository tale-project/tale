---
title: Tale-Dokumente über WebDAV öffnen
description: Erzeuge ein Gerätepasswort, verbinde einen WebDAV-Client und prüfe den Zugriff auf organisationsweite Dokumente.
---

Mit WebDAV öffnet und bearbeitet ein kompatibler Datei-Client Tale-Dokumente wie einen entfernten Ordner. Änderungen betreffen denselben Speicher wie **Wissen > Dokumente**. Dateien aus dem Wissensbereich einzelner Projekte sind nicht Teil dieses Laufwerks.

## Die Verbindungsdaten abrufen

Öffne **Einstellungen > API > WebDAV**. Inhaber, Admins und Entwickler können eigene Gerätezugänge erzeugen. Kopiere die angezeigte URL einschließlich Organisations-Slug und `/documents/`. Baue sie nicht aus einer Organisations-ID zusammen und verwende keine Adresse einer anderen Organisation.

<Frame caption="Einstellungen > API > WebDAV — oben die vorbefüllten Verbindungsdaten, darunter der App-Passwort-Generator.">

![Die WebDAV-Einstellungen zeigen Verbindungs-URL und Benutzername über drei App-Passwörtern. Retired design workstation ist widerrufen; Design workstation und MacBook Pro sind aktiv und bieten die Aktion zum Widerrufen.](/images/platform/settings-webdav.webp)

</Frame>

Verwende deine Tale-E-Mail-Adresse als Benutzernamen und ein App-Passwort als Passwort. Das normale Kontopasswort funktioniert für WebDAV nicht. Verbinde dich bei einem bereitgestellten Dienst über HTTPS. Schreibe Zugangsdaten weder in URLs noch in die Befehlshistorie.

## Ein Passwort pro Gerät erzeugen

1. Wähle **Erzeugen** und gib unter **Bezeichnung** einen Namen wie `Design-Laptop` ein.
2. Erzeuge das Passwort und kopiere es vor dem Schließen. Der vollständige Wert erscheint nur einmal.
3. Speichere es in der Zugangsdatenverwaltung des Clients und wähle **Ich habe es gespeichert**.

Die Liste enthält Bezeichnung, Präfix und Nutzungsdaten, kein wiederherstellbares Passwort. Bei Verlust erzeugst du einen Ersatz und widerrufst das alte Passwort, nachdem der Client umgestellt ist. Getrennte Passwörter erlauben den Entzug eines einzelnen Gerätezugangs.

## Den Client einrichten

<Tabs>

<Tab title="macOS Finder">

Öffne im Finder mit **⌘K** die Verbindung zu einem Server. Füge die WebDAV-URL ein und melde dich mit E-Mail-Adresse und App-Passwort an. Öffne den verbundenen Ordner und prüfe ein bekanntes Dokument, bevor du Dateien hineinkopierst. Speichere den Zugang nur auf einem vertrauenswürdigen Gerät.

</Tab>

<Tab title="Windows">

Verbinde im Datei-Explorer ein Netzlaufwerk mit der HTTPS-WebDAV-Adresse und den erzeugten Zugangsdaten. Der Windows-Dienst WebClient muss verfügbar sein. Kläre Verbindungs- oder Größenprobleme anhand von Microsofts [WebDAV-Anforderungen und Limits](https://learn.microsoft.com/en-us/iis/publish/using-webdav/using-the-webdav-redirector) mit der IT oder nutze einen eigenen WebDAV-Client. Behalte HTTPS bei.

</Tab>

<Tab title="Linux">

Ein Dateimanager mit WebDAV-Unterstützung verwendet den angezeigten Host und Pfad. GNOME Files nutzt `davs://` für sicheres WebDAV, KDE Dolphin `webdavs://`. Trennt der Dialog Server und Ordner, trage den Host als Server und `/dav/<orgSlug>/documents/` als Ordner ein, mit HTTPS und dem passenden Port.

</Tab>

<Tab title="iPhone und iPad">

Wähle einen Client, der WebDAV ausdrücklich unterstützt, und ein eigenes App-Passwort für das Gerät. Für gelegentlichen Zugriff eignet sich auch Tales Dokumentenseite im Browser. Der allgemeine Serverdialog der Dateien-App ist kein gesicherter WebDAV-Einstieg. Direkte WebDAV-Uploads aus Pages, Numbers und Keynote werden [nicht mehr unterstützt](https://support.apple.com/en-us/101948).

</Tab>

<Tab title="rclone">

Starte `rclone config` und lege einen WebDAV-Zugang mit Tales URL, deiner E-Mail-Adresse und dem App-Passwort an. Wähle `other` als Anbieter und gib das Passwort interaktiv ein. Die [WebDAV-Anleitung von rclone](https://rclone.org/webdav/) erklärt Auflisten und Kopieren. Beginne mit einem kleinen Testordner.

</Tab>

</Tabs>

## Eine kleine Übertragung prüfen

Öffne oder lade ein Dokument herunter, das du auch in Tale lesen kannst. Darfst du schreiben, lade eine kleine Textdatei mit eindeutigem Namen in einen Testordner hoch. Prüfe Name und Inhalt unter **Wissen > Dokumente** und danach den Indexierungsstatus, bevor du sie in der Suche erwartest.

WebDAV-Uploads folgen den Dokumentberechtigungen und Indexierungsregeln; ihre Quelle wird als `webdav` erfasst. Eine abgeschlossene Übertragung bedeutet nicht, dass die Indexierung fertig ist. Fehlt eine Projektdatei im Laufwerk, öffne stattdessen den Wissensbereich dieses Projekts.

## Sperren und gelöschte Dateien handhaben

Ein kompatibler Editor kann eine Datei während der Bearbeitung sperren. Ein konkurrierender Schreibzugriff erhält **423 Locked**. Beende die andere Bearbeitung, statt wiederholt zu überschreiben. Der Widerruf eines App-Passworts löst auch seine Dateisperren.

Unter `.trash/` liegen vorläufig gelöschte Dokumente schreibgeschützt. Lade eine noch gespeicherte Datei bei Bedarf zur Prüfung herunter und stelle sie über Tale wieder her. Endgültig entfernte Dateien lassen sich dort nicht zurückholen.

## Einen Zugang widerrufen oder reparieren

Wähle an der Passwortzeile **Widerrufen** und bestätige. Künftige Anfragen damit werden abgelehnt; andere App-Passwörter bleiben nutzbar. Der Widerruf ist nicht umkehrbar. Stelle den Client bei Bedarf auf ein neues Passwort um. Das Erzeugen und das Widerrufen eines App-Passworts hinterlassen je einen Eintrag im Audit-Log unter **Einstellungen > Richtlinien > Protokolle**.

Bei wiederholten Anmeldeaufforderungen prüfe die genaue URL, Organisationsmitgliedschaft und einen möglichen Widerruf. Eine fehlende Berechtigung nach der Anmeldung unterscheidet sich von einem falschen Passwort. Die [WebDAV-API-Referenz](/de/develop/webdav-api) erklärt Statuscodes und Protokolldiagnose. Für Software mit REST-Zugriff dienen stattdessen [API-Schlüssel](/de/platform/admin/api-keys).
