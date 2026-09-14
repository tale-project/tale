---
title: WebDAV
description: Hänge die Dokumente deiner Organisation als Netzlaufwerk im Finder, im Datei-Explorer oder in jedem WebDAV-Client ein.
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

Wähle unter **Dieser PC** die Aktion **Netzlaufwerk verbinden**, füge die HTTPS-URL ein und aktiviere **Verbindung mit anderen Anmeldeinformationen herstellen**. Nutze deine E-Mail und das erzeugte App-Passwort. Der Windows-Dienst WebClient muss verfügbar und gestartet sein. Scheitern Verbindung oder große Übertragungen, nutze einen WebDAV-Client oder lass die IT die [Windows-WebDAV-Grenzen](https://learn.microsoft.com/en-us/iis/publish/using-webdav/using-the-webdav-redirector) prüfen. Behalte HTTPS bei: `BasicAuthLevel: 2` erlaubt unverschlüsselte Verbindungen und behebt keinen abweichenden Port.

</Tab>

<Tab title="Linux">

GNOME Dateien hängt WebDAV unter einem eigenen Schema ein — drücke **Strg+L**, gib die URL mit `davs://` statt `https://` ein (`davs://<your-site>/dav/<orgSlug>/documents/`) und melde dich mit deiner E-Mail und dem App-Passwort an. KDE Dolphin nutzt für dieselbe Adresse `webdavs://`.

Dateimanager mit einem geteilten **Mit Server verbinden**-Dialog (Nemo, Caja) bauen die Adresse aus ihren Feldern zusammen — trage in **Server** nur den Hostnamen ein (`<your-site>`), lass Port auf `443` und Typ auf **Sicheres WebDAV (HTTPS)** stehen und gib `/dav/<orgSlug>/documents` als Ordner an.

</Tab>

<Tab title="iPhone und iPad">

Nutze eine App mit ausdrücklicher WebDAV-Unterstützung, die HTTPS-URL und ein eigenes App-Passwort für das Gerät. Folge ihrer Anleitung; der allgemeine Serverdialog der Dateien-App ist keine WebDAV-Einrichtungsanleitung. Direkte WebDAV-Uploads in Pages, Numbers und Keynote werden [nicht mehr unterstützt](https://support.apple.com/en-us/101948). Für gelegentlichen Zugriff kannst du Tale im Browser öffnen und Dokumente nutzen.

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
