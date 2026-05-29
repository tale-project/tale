---
title: WebDAV
description: Hängen Sie den Dokumentenspeicher Ihrer Organisation als Netzlaufwerk im Finder, Datei-Explorer oder einem beliebigen WebDAV-Client ein. Generieren Sie ein App-Passwort unter Einstellungen > WebDAV und verbinden Sie sich vom Gerät aus.
---

WebDAV verwandelt Tales Dokumentenspeicher in einen Remote-Ordner, den Sie wie ein Netzlaufwerk einhängen können. Aus dem Finder auf dem Mac, dem Datei-Explorer unter Windows, der Files-App auf iOS oder einem Linux-Dateimanager verbinden Sie sich mit einer URL und authentifizieren sich mit einem App-Passwort; von dort aus erscheint die Dokumentenhierarchie unter Ihrer Organisation als Ordner zum Durchsuchen, Hochladen und Bearbeiten. Es ist derselbe Speicher wie der Dokumenten-Hub in der Web-Oberfläche — was Sie in der einen Oberfläche sehen, sehen Sie auch in der anderen.

Diese Seite ist der Einrichtungsleitfaden. Die Protokoll-Referenz finden Sie unter [Entwickeln > WebDAV-API](/develop/webdav-api).

## Bevor Sie beginnen

Der WebDAV-Endpunkt authentifiziert mit **App-Passwörtern** — kurzen Zufallsgeheimnissen, die Sie pro Gerät unter Einstellungen erzeugen. Ihr Haupt-Konto-Passwort funktioniert hier nicht; die Plattform akzeptiert es auf dem WebDAV-Endpunkt nicht, und es wäre unsicher, dies zu tun (jeder WebDAV-Client speichert Zugangsdaten im System-Schlüsselbund, abspielbar für alles, was diesen Schlüsselbund lesen kann). App-Passwörter erlauben Zugriffsscope pro Gerät und Widerruf pro Gerät, ohne sonst etwas zu drehen.

Sie benötigen außerdem den **Organisations-Slug** Ihrer Org und die **Site-URL** Ihres Deployments. Beides ist im Panel Einstellungen > WebDAV sichtbar, und das Panel füllt die Verbindungsdaten unten beim Passwort-Generator vor.

## App-Passwort generieren

Öffnen Sie **Einstellungen > WebDAV** und tippen Sie ein Label, das den Verwendungszweck beschreibt — `MacBook Finder`, `iPhone Files`, `ops-laptop rclone`. Klicken Sie **Generieren**. Das vollständige Passwort erscheint einmal, mit einer Kopier-Schaltfläche daneben; kopieren Sie es in den Verbindungsdialog Ihres Geräts oder in Ihren Passwort-Manager, bevor Sie das Panel schließen. Nach dem Verwerfen sind nur die ersten vier Zeichen aus der Tabelle sichtbar, was reicht, um die Zeile beim späteren Widerruf zu identifizieren.

Sie können beliebig viele App-Passwörter halten. Der Plan ist eines pro Gerät — verlieren Sie das Gerät oder verwenden Sie es nicht mehr, widerrufen Sie diese Zeile, ohne einen anderen konfigurierten Client zu stören.

## Verbinden vom macOS Finder

Drücken Sie im Finder **⌘K** (Mit Server verbinden). Die Adresse ist `https://<Ihre-Site>/dav/<orgSlug>/documents/` — kopieren Sie sie aus dem Verbindungsdaten-Panel. Wenn der Finder nach Zugangsdaten fragt, nutzen Sie Ihre Tale-Konto-E-Mail als Benutzernamen und das App-Passwort. Der Finder hängt die Freigabe in der Seitenleiste ein; von dort können Sie den Dokumentbaum durchsuchen, Dateien zum Hochladen hineinziehen, zum Herunterladen herausziehen sowie inplace umbenennen und löschen.

Die erste PROPFIND kann bei einem großen Dokumentenbaum einige Sekunden dauern — der Finder fordert eine Depth-1-Auflistung des eingehängten Pfads an, und die Plattform antwortet aus demselben Convex-Baum wie die Dokumenten-Hub-Oberfläche. Nach dem ersten Laden ist das Durchsuchen schnell.

## Verbinden vom Windows-Datei-Explorer

Wählen Sie unter **Dieser PC** den Punkt **Netzlaufwerk verbinden**. Der Ordner ist `https://<Ihre-Site>/dav/<orgSlug>/documents/`. Wählen Sie einen Laufwerksbuchstaben, lassen Sie **Bei Anmeldung wiederherstellen** aktiviert und klicken Sie **Verbindung mit anderen Anmeldeinformationen herstellen**. Nutzen Sie Ihre Tale-Konto-E-Mail und das App-Passwort.

Windows erzwingt ein **Standard-Größenlimit von 50 MB** für einzelne Dateien über WebDAV. Um es anzuheben, öffnen Sie `regedit` und bearbeiten Sie `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` — setzen Sie es auf einen Dezimalwert bis `4294967295` (4 GB). Starten Sie danach den **WebClient**-Dienst neu. Dieses Limit wird von Windows erzwungen, nicht von Tale, also funktionieren Dateien unter dem Limit ohne den Registry-Eingriff.

Lehnt der Datei-Explorer mit **„Der eingegebene Ordner scheint nicht gültig zu sein"** ab, liegt die Ursache fast immer an Windows' Default-Weigerung, Basic-Auth über HTTPS auf Non-Port-443-Ursprüngen zu nutzen. Läuft Ihr Deployment auf einem nicht-standard HTTPS-Port, setzen Sie `BasicAuthLevel` unter demselben Registry-Schlüssel auf `2`.

## Verbinden von iOS Files

Tippen Sie in Files auf das Drei-Punkte-Menü oben rechts und wählen Sie **Mit Server verbinden**. Die Adresse ist dieselbe `https://<Ihre-Site>/dav/<orgSlug>/documents/`. Nutzen Sie Ihre Tale-Konto-E-Mail und das App-Passwort. iOS Files unterstützt Durchsuchen und Herunterladen; inplace-Bearbeiten wird für App-Formate mit iOS-Pendant unterstützt.

## Verbinden mit rclone

Für Batch-Uploads oder skriptgesteuerten Sync ist `rclone` der zuverlässigste WebDAV-Client:

```bash
rclone config create tale webdav \
    url=https://<Ihre-Site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<Ihre-Email> \
    pass=$(rclone obscure '<App-Passwort>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` ist die richtige Einstellung — Tales WebDAV-Server ist generisch, kein benannter Geschmack (`nextcloud`, `owncloud`, `sharepoint`), den rclone namentlich erkennt.

## Was geht und was nicht

Lesen und Schreiben im **documents**-Namespace spiegeln, was Sie in der Dokumenten-Hub-Oberfläche tun können. Dateien, die Sie über WebDAV hochladen, landen im selben Speicher mit derselben Aufbewahrung, Indexierung und Suche; das Quell-Feld am Dokument wird auf `webdav` gesetzt, damit Sie sie in Audit-Logs und Reports filtern können. Über MKCOL erzeugte Ordner erscheinen sofort in der Oberfläche.

Der **.trash**-Namespace ist nur lesbar — `https://<Ihre-Site>/dav/<orgSlug>/.trash/` listet Dokumente auf, die Sie soft-gelöscht haben, aber noch im Aufbewahrungszeitraum stehen. Sie können Dateien aus dem Trash zur Wiederherstellung herunterladen, aber Schreibvorgänge dort werden mit 403 abgelehnt. Stellen Sie über die Dokumenten-Hub-Oberfläche wieder her.

Einige Clients senden PROPFIND mit **Depth: infinity** — eine Anfrage, den gesamten Baum in einer Antwort zu dumpen. Tale lehnt das mit `403` ab, um Runaway-Antworten auf großen Speichern zu verhindern. Jeder Mainstream-Client (Finder, Datei-Explorer, iOS, rclone, cadaver) nutzt Depth 0 oder 1, sodass Sie dem in der Praxis nie begegnen.

## Sperren

Tale implementiert WebDAV-Class-2-Sperren. Öffnen Sie eine Datei in einer App, die Sperren respektiert (Microsoft Office, LibreOffice, BBEdit, einige Texteditoren), sperrt die App die Ressource für die Dauer des Edits; ein anderer Client, der während dieses Fensters auf denselben Pfad zu schreiben versucht, erhält `423 Locked`. Sperren laufen automatisch nach höchstens einer Stunde ab, selbst wenn die App abstürzt; müssen Sie eine festsitzende Sperre früher räumen, widerrufen Sie das App-Passwort, das sie hält — Tale gibt jede unter einem widerrufenen App-Passwort gehaltene Sperre in derselben Operation frei.

## Widerrufen

Klicken Sie zum Widerruf auf das Papierkorb-Symbol neben der Zeile. Die Zeile bleibt für den Audit-Trail in der Tabelle und wird als **widerrufen** ausgezeichnet. Eine in-flight Anfrage mit dem widerrufenen Passwort wird abgeschlossen; die nächste wird abgelehnt. Es gibt keinen Undo — generieren Sie ein neues Passwort, wenn Sie die falsche Zeile widerrufen.

## Fehlerbehebung

Eine Anfrage, die `401` zurückgibt, nachdem sie gestern noch funktionierte, bedeutet fast immer, dass das App-Passwort widerrufen wurde oder Sie den Benutzernamen falsch getippt haben. Nutzen Sie die E-Mail, mit der Sie sich anmelden, nicht Ihren Anzeigenamen.

Eine Anfrage, die `423 Locked` zurückgibt, bedeutet, der Pfad ist von einem anderen Client gesperrt. Warten Sie den Ablauf ab, wechseln Sie auf einen anderen Dateinamen oder widerrufen Sie das App-Passwort, das die Sperre hält.

Hängt ein Finder-Mount beim ersten Durchsuchen, ist meist Convex langsam beim Beantworten einer großen PROPFIND auf einem tiefen Baum — warten Sie. Kehrt es nie zurück, prüfen Sie, ob Ihr Konto noch Mitglied des in der URL stehenden Organisations-Slugs ist; der WebDAV-Endpunkt lehnt Anfragen von Nicht-Mitgliedern mit `403` ab.

Ein `502` bei GET zeigt an, dass die Plattform die Dokument-Metadaten holen konnte, aber die Blob-Bytes nicht aus dem Speicher. Prüfen Sie die Convex-Logs auf Speicher-Fehler und bestätigen Sie, dass `ADMIN_KEY` in der Plattform-Umgebung gesetzt ist — der WebDAV-Server liest Blobs über einen admin-authentifizierten Client.

## Wo das hingehört

WebDAV steht neben dem [Dokumenten-Hub](/platform/knowledge/documents) (dieselben Daten, durch die Web-Oberfläche betrachtet), [Integrationen](/platform/integrations/overview) (Drittanbieter-Systeme, aus denen Tale zieht) und [API-Keys](/platform/admin/api-keys) (organisationsweite REST-API-Zugangsdaten). WebDAV ist pro Benutzer — die Zugangsdaten authentifizieren als Sie, beschränkt auf Organisationen, in denen Sie Mitglied sind. Für Maschine-zu-Maschine-Dokumentenimport sind API-Keys plus die REST-API meist die bessere Wahl.
