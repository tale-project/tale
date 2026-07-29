---
title: WebDAV
description: Hänge die Dokumente deiner Organisation als Netzlaufwerk im Finder, im Datei-Explorer oder in jedem WebDAV-Client ein — erzeuge ein App-Passwort unter Einstellungen > API > WebDAV und verbinde dich von deinem Gerät.
---

WebDAV verwandelt Tales Dokumentenspeicher in einen entfernten Ordner, den du wie jedes geteilte Netzlaufwerk einhängst. Der dahinterliegende Speicher ist derselbe, den der Dokumenten-Hub zeigt — was du in den eingehängten Ordner legst, erscheint in der UI, und umgekehrt. Alles Nötige liegt auf einem Panel: **Einstellungen > API > WebDAV** trägt die Verbindungsdaten und den App-Passwort-Generator.

<Frame caption="Einstellungen > API > WebDAV — oben die vorbefüllten Verbindungsdaten, darunter der App-Passwort-Generator.">

![Die WebDAV-Einstellungsseite mit einer Verbindungs-URL, einem Benutzernamensfeld mit der Konto-E-Mail, einer Erklärung, dass das Passwort ein erzeugtes App-Passwort ist, und einer App-Passwort-Tabelle mit zwei Einträgen — Design workstation und MacBook Pro, jeder nur mit seinem Präfix und dem Erstellungsdatum — neben einem Erzeugen-Button.](/images/platform/settings-webdav.webp)

</Frame>

## Ein App-Passwort erzeugen

Der Endpunkt authentifiziert mit App-Passwörtern — kurzen Geheimnissen, die du pro Gerät prägst — weil jeder WebDAV-Client seinen Zugangsnachweis im System-Schlüsselbund ablegt, und dorthin gehört ein begrenztes, widerrufbares Geheimnis statt deines Konto-Passworts. Dein Konto-Passwort funktioniert an diesem Endpunkt nicht.

Klicke auf **Erzeugen**, benenne das Passwort nach dem Gerät (`MacBook Finder`, `ops-laptop rclone`) und kopiere es — nutze eines pro Gerät; das vollständige Passwort erscheint nur einmal. Danach behält die Tabelle nur die Bezeichnung und ein kurzes Präfix, genug, um die Zeile wiederzuerkennen, wenn du sie widerrufst. Das Erzeugen verlangt dieselbe Berechtigung, die auch API-Schlüssel schützt; Mitglieder ohne sie bitten einen Admin.

Für den Benutzernamen nimm deine Tale-Konto-E-Mail. Der Server prüft tatsächlich nur das Passwort, aber die E-Mail hält Audit-Zeilen lesbar und entspricht dem, was Client-Dialoge erwarten.

## Von deinem Gerät verbinden

Die Adresse ist die URL vom Panel — `https://<your-site>/dav/<orgSlug>/documents/`.

<Tabs>

<Tab title="macOS Finder">

Drücke **⌘K** (Mit Server verbinden), füge die URL ein und melde dich mit deiner E-Mail und dem App-Passwort an. Die Freigabe erscheint in der Seitenleiste; zieh Dateien hinein zum Hochladen, hinaus zum Herunterladen, und benenne um oder lösche direkt an Ort und Stelle. Das erste Auflisten eines großen Baums kann ein paar Sekunden dauern.

</Tab>

<Tab title="Windows">

Wähle in **Dieser PC** die Option **Netzlaufwerk verbinden**, füge die URL als Ordner ein und wähle **Verbindung mit anderen Anmeldeinformationen herstellen**. Windows deckelt WebDAV-Übertragungen standardmäßig bei 50 MB pro Datei — erhöhe `FileSizeLimitInBytes` unter dem Registrierungsschlüssel `WebClient\Parameters` und starte den WebClient-Dienst neu. Auf einem Nicht-Standard-HTTPS-Port setze `BasicAuthLevel` unter demselben Schlüssel auf `2`.

</Tab>

<Tab title="iOS Files">

Tippe auf das Dreipunkt-Menü, wähle **Mit Server verbinden** und gib dieselbe URL und dieselben Zugangsdaten ein. Die Dateien-App unterstützt Durchsuchen und Herunterladen; Bearbeiten an Ort und Stelle funktioniert für Formate mit einer iOS-App.

</Tab>

<Tab title="rclone">

```bash
rclone config create tale webdav \
    url=https://<your-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<your-email> \
    pass=$(rclone obscure '<app-password>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` ist richtig — Tales Server ist generisch, keine benannte Spielart, die rclone kennt.

</Tab>

</Tabs>

## Was das eingehängte Laufwerk kann

Lese- und Schreibzugriffe spiegeln deine Berechtigungen im Dokumenten-Hub, Dateien, die du hochlädst, landen im Index und in der Suche wie direkte Uploads, und ihr Quellfeld steht auf `webdav` zum Filtern in Audit-Ansichten. Projekt-Dateien sind die Ausnahme: Der **Wissen**-Tab eines Projekts ist auf dieses eine Projekt begrenzt und taucht nie über WebDAV auf, das eingehängte Laufwerk zeigt also nur den org-weiten Dokumenten-Hub. Der Namensraum `.trash/` listet weich gelöschte Dokumente schreibgeschützt — lade zur Wiederherstellung herunter, stelle über die UI wieder her. Editoren, die WebDAV-Locks nehmen (Office, LibreOffice), bekommen sie; ein konkurrierender Schreibzugriff während einer Bearbeitung erhält `423 Locked`.

## Widerrufen

Widerrufe ein Passwort mit dem Papierkorb-Symbol auf seiner Zeile — die nächste Anfrage damit wird abgewiesen, andere Geräte bleiben unberührt, und alle Locks, die es hielt, werden freigegeben. Es gibt kein Zurück; präge ein neues Passwort, wenn du die falsche Zeile widerrufst.

<Warning>

Basic Auth sendet das App-Passwort mit jeder Anfrage. Hänge nur über HTTPS ein, lass das Passwort im Schlüsselbund des Betriebssystems und füge es nie in eine URL der Form `https://user:pass@host/` ein — Shell-Verlauf und Proxy-Logs überleben das Laufwerk. Widerrufe sofort bei jedem Verdacht auf ein Leck.

</Warning>

## Wo das hingehört

WebDAV ist die gerätezugewandte Tür pro Nutzer zu denselben Daten wie der [Dokumenten-Hub](/de/platform/knowledge/documents); das Drahtprotokoll steht unter [WebDAV-API](/de/develop/webdav-api). Für Maschine-zu-Maschine-Importe sind [API-Schlüssel](/de/platform/admin/api-keys) plus die REST-API meist die bessere Wahl.
