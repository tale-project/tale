---
title: WebDAV
description: Hänge den Dokumentenspeicher deiner Organisation als Netzlaufwerk im Finder, Datei-Explorer oder einem beliebigen WebDAV-Client ein. Erzeuge ein App-Passwort unter Einstellungen > WebDAV und verbinde dich vom Gerät aus.
---

WebDAV verwandelt Tales Dokumentenspeicher in einen Remote-Ordner, den du wie ein Netzlaufwerk einhängen kannst. Aus dem Finder auf dem Mac, dem Datei-Explorer unter Windows, der Files-App auf iOS oder einem Linux-Dateimanager verbindest du dich mit einer URL und authentifizierst dich mit einem App-Passwort; von dort erscheint die Dokumentenhierarchie unter deiner Organisation als Ordner zum Durchsuchen, Hochladen und Bearbeiten. Es ist derselbe Speicher wie der Dokumenten-Hub in der Web-Oberfläche — was du in der einen Oberfläche siehst, siehst du auch in der anderen.

Diese Seite ist der Einrichtungsleitfaden. Die Protokoll-Referenz findest du unter [Entwickeln > WebDAV-API](/develop/webdav-api).

## Bevor du beginnst

Der WebDAV-Endpunkt authentifiziert mit **App-Passwörtern** — kurzen Zufallsgeheimnissen, die du pro Gerät unter Einstellungen erzeugst. Dein Haupt-Konto-Passwort funktioniert hier nicht; die Plattform akzeptiert es auf dem WebDAV-Endpunkt nicht, und es wäre unsicher, dies zu tun (jeder WebDAV-Client speichert Zugangsdaten im System-Schlüsselbund, abspielbar für alles, was diesen Schlüsselbund lesen kann). App-Passwörter erlauben Zugriffsscope pro Gerät und Widerruf pro Gerät, ohne sonst etwas zu drehen.

Eine Anmerkung zum Benutzernamen-Feld: Das App-Passwort ist die einzige Berechtigung, die der Server tatsächlich prüft — der Benutzername wird nicht mit deinem Konto abgeglichen. Die Konvention ist, deine Tale-Konto-E-Mail einzutragen, damit Audit-Logs und das Zeilen-Label lesbar bleiben, und die meisten Client-UIs erwarten ohnehin eine E-Mail-ähnliche Zeichenkette — die Auth-Entscheidung fällt aber allein auf dem Passwort.

Du benötigst außerdem den **Organisations-Slug** deiner Org und die **Site-URL** deines Deployments. Beides ist im Panel Einstellungen > WebDAV sichtbar, und das Panel füllt die Verbindungsdaten unten beim Passwort-Generator vor.

Zum Erzeugen eines App-Passworts brauchst du **Admin**- oder **Developer**-Rechte in der Organisation — dieselbe Berechtigung, die auch API-Schlüssel absichert. Ein einfaches Mitglied sieht beim Öffnen von Einstellungen > WebDAV statt des Generators einen Zugriff-verweigert-Hinweis; bitte eine Org-Admin, ein Passwort auszustellen oder dir die Berechtigung zu erteilen.

## App-Passwort generieren

Öffne **Einstellungen > WebDAV** und tippe ein Label, das den Verwendungszweck beschreibt — `MacBook Finder`, `iPhone Files`, `ops-laptop rclone`. Klicke **Erzeugen**. Das vollständige Passwort erscheint einmal, mit einer Kopier-Schaltfläche daneben; kopiere es in den Verbindungsdialog deines Geräts oder in deinen Passwort-Manager, bevor du das Panel schließt. Nach dem Verwerfen sind nur die ersten vier Zeichen aus der Tabelle sichtbar, was reicht, um die Zeile beim späteren Widerruf zu identifizieren.

Du kannst beliebig viele App-Passwörter halten. Der Plan ist eines pro Gerät — verlierst du das Gerät oder nutzt es nicht mehr, widerrufst du diese Zeile, ohne einen anderen konfigurierten Client zu stören.

## Verbinden vom macOS Finder

Drücke im Finder **⌘K** (Mit Server verbinden). Die Adresse ist `https://<deine-Site>/dav/<orgSlug>/documents/` — kopiere sie aus dem Verbindungsdaten-Panel. Wenn der Finder nach Zugangsdaten fragt, nutze deine Tale-Konto-E-Mail als Benutzernamen und das App-Passwort. Der Finder hängt die Freigabe in der Seitenleiste ein; von dort kannst du den Dokumentbaum durchsuchen, Dateien zum Hochladen hineinziehen, zum Herunterladen herausziehen sowie direkt umbenennen und löschen.

Die erste PROPFIND kann bei einem großen Dokumentenbaum einige Sekunden dauern — der Finder fordert eine Depth-1-Auflistung des eingehängten Pfads an, und die Plattform antwortet aus demselben Convex-Baum wie die Dokumenten-Hub-Oberfläche. Nach dem ersten Laden ist das Durchsuchen schnell.

## Verbinden vom Windows-Datei-Explorer

Wähle unter **Dieser PC** den Punkt **Netzlaufwerk verbinden**. Der Ordner ist `https://<deine-Site>/dav/<orgSlug>/documents/`. Wähle einen Laufwerksbuchstaben, lass **Bei Anmeldung wiederherstellen** aktiviert und klicke **Verbindung mit anderen Anmeldeinformationen herstellen**. Nutze deine Tale-Konto-E-Mail und das App-Passwort.

Windows erzwingt ein **Standard-Größenlimit von 50 MB** für einzelne Dateien über WebDAV. Um es anzuheben, öffne `regedit` und bearbeite `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` — setze es auf einen Dezimalwert bis `4294967295` (4 GB). Starte danach den **WebClient**-Dienst neu. Dieses Limit wird von Windows erzwungen, nicht von Tale, also funktionieren Dateien unter dem Limit ohne den Registry-Eingriff.

Lehnt der Datei-Explorer mit **„Der eingegebene Ordner scheint nicht gültig zu sein“** ab, liegt die Ursache fast immer an Windows' Default-Weigerung, Basic-Auth über HTTPS auf Non-Port-443-Ursprüngen zu nutzen. Läuft dein Deployment auf einem nicht-standard HTTPS-Port, setze `BasicAuthLevel` unter demselben Registry-Schlüssel auf `2`.

## Verbinden von iOS Files

Tippe in Files auf das Drei-Punkte-Menü oben rechts und wähle **Mit Server verbinden**. Die Adresse ist dieselbe `https://<deine-Site>/dav/<orgSlug>/documents/`. Nutze deine Tale-Konto-E-Mail und das App-Passwort. iOS Files unterstützt Durchsuchen und Herunterladen; direktes Bearbeiten wird für App-Formate mit iOS-Pendant unterstützt.

## Verbinden mit rclone

Für Batch-Uploads oder skriptgesteuerten Sync ist `rclone` der zuverlässigste WebDAV-Client:

```bash
rclone config create tale webdav \
    url=https://<deine-Site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<deine-Email> \
    pass=$(rclone obscure '<App-Passwort>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` ist die richtige Einstellung — Tales WebDAV-Server ist generisch, kein benannter Geschmack (`nextcloud`, `owncloud`, `sharepoint`), den rclone namentlich erkennt.

## Was geht und was nicht

Lesen und Schreiben im **documents**-Namespace spiegeln, was du in der Dokumenten-Hub-Oberfläche tun kannst. Dateien, die du über WebDAV hochlädst, landen im selben Speicher mit derselben Aufbewahrung, Indexierung und Suche; das Quell-Feld am Dokument wird auf `webdav` gesetzt, damit du sie in Audit-Logs und Reports filtern kannst. Über MKCOL erzeugte Ordner erscheinen sofort in der Oberfläche.

Der **.trash**-Namespace ist nur lesbar — `https://<deine-Site>/dav/<orgSlug>/.trash/` listet Dokumente auf, die du soft-gelöscht hast, aber noch im Aufbewahrungszeitraum stehen. Du kannst Dateien aus dem Trash zur Wiederherstellung herunterladen, aber Schreibvorgänge dort werden mit 403 abgelehnt. Stelle über die Dokumenten-Hub-Oberfläche wieder her.

Einige Clients senden PROPFIND mit **Depth: infinity** — eine Anfrage, den gesamten Baum in einer Antwort zu dumpen. Tale lehnt das mit `403` ab, um Runaway-Antworten auf großen Speichern zu verhindern. Jeder Mainstream-Client (Finder, Datei-Explorer, iOS, rclone, cadaver) nutzt Depth 0 oder 1, sodass du dem in der Praxis nie begegnen wirst.

## Sperren

Tale implementiert WebDAV-Class-2-Sperren. Öffnest du eine Datei in einer App, die Sperren respektiert (Microsoft Office, LibreOffice, BBEdit, einige Texteditoren), sperrt die App die Ressource für die Dauer des Edits; ein anderer Client, der während dieses Fensters auf denselben Pfad zu schreiben versucht, erhält `423 Locked`. Sperren laufen automatisch nach höchstens einer Stunde ab, selbst wenn die App abstürzt; musst du eine festsitzende Sperre früher räumen, widerrufe das App-Passwort, das sie hält — Tale gibt jede unter einem widerrufenen App-Passwort gehaltene Sperre in derselben Operation frei.

## Widerrufen

Klicke zum Widerruf auf das Papierkorb-Symbol neben der Zeile. Die Zeile bleibt für den Audit-Trail in der Tabelle und wird als **widerrufen** ausgezeichnet. Eine in-flight Anfrage mit dem widerrufenen Passwort wird abgeschlossen; die nächste wird abgelehnt. Es gibt keinen Undo — erzeuge ein neues Passwort, wenn du die falsche Zeile widerrufen hast.

## Fehlerbehebung

Eine Anfrage, die `401` zurückgibt, nachdem sie gestern noch funktionierte, bedeutet fast immer, dass das App-Passwort widerrufen wurde oder abgelaufen ist. Der Benutzername selbst wird nicht geprüft — nur das Passwort — also löst ein Tippfehler im Benutzernamen kein 401 aus, aber ein falsches, widerrufenes oder fehlerhaft eingefügtes Passwort tut es.

Eine Anfrage, die `423 Locked` zurückgibt, bedeutet, der Pfad ist von einem anderen Client gesperrt. Warte den Ablauf ab, wechsle auf einen anderen Dateinamen oder widerrufe das App-Passwort, das die Sperre hält.

Hängt ein Finder-Mount beim ersten Durchsuchen, ist meist Convex langsam beim Beantworten einer großen PROPFIND auf einem tiefen Baum — warte ab. Kehrt es nie zurück, prüfe, ob dein Konto noch Mitglied des in der URL stehenden Organisations-Slugs ist; der WebDAV-Endpunkt lehnt Anfragen von Nicht-Mitgliedern mit `403` ab.

Ein `502` bei GET zeigt an, dass die Plattform die Dokument-Metadaten holen konnte, aber die Blob-Bytes nicht aus dem Speicher. Prüfe die Convex-Logs auf Speicher-Fehler und bestätige, dass `ADMIN_KEY` in der Plattform-Umgebung gesetzt ist — der WebDAV-Server liest Blobs über einen admin-authentifizierten Client.

## Sicherheit

WebDAV nutzt HTTP Basic, das heißt das App-Passwort wird bei jeder Anfrage gesendet — kein Session-Cookie, das abläuft, kein Refresh-Token, einfach die nackte Berechtigung jedes Mal über die Leitung, wenn der Client mit dem Server spricht. Hänge die Freigabe nur über HTTPS ein; über reines HTTP kann jeder auf der Strecke zwischen dir und dem Server das Passwort mitlesen. Lass deinen OS-Schlüsselbund (macOS Keychain, Windows Credential Manager, GNOME Keyring) das Passwort halten — füge es nie in die `https://user:pass@host/...`-Kurzform ein, weil die meisten Werkzeuge URLs in Shell-History, Crash-Reports und Proxy-Access-Logs protokollieren, wo die Berechtigung den Mount weit überdauern würde.

Vermutest du, dass ein Passwort geleakt ist, widerrufe die Zeile in **Einstellungen > WebDAV** sofort. Der Widerruf ist instant; die nächste Anfrage mit dem geleakten Passwort wird abgelehnt. Andere Geräte mit eigenen App-Passwörtern bleiben unberührt.

## Wo das hinpasst

WebDAV steht neben dem [Dokumenten-Hub](/platform/knowledge/documents) (dieselben Daten, durch die Web-Oberfläche betrachtet), [Integrationen](/platform/integrations/overview) (Drittanbieter-Systeme, aus denen Tale zieht) und [API-Keys](/platform/admin/api-keys) (organisationsweite REST-API-Zugangsdaten). WebDAV ist pro Benutzer — die Zugangsdaten authentifizieren als du, beschränkt auf Organisationen, in denen du Mitglied bist. Für Maschine-zu-Maschine-Dokumentenimport sind API-Keys plus die REST-API meist die bessere Wahl.
