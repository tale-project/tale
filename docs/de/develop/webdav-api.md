---
title: WebDAV-API
description: Verbinde einen Dateiclient, prüfe Uploads und Downloads und berücksichtige WebDAV-Zugriffsrechte, Sperren und Protokollgrenzen.
---

Über WebDAV kann ein Dateiclient Ordner auflisten, Dateien lesen und schreiben sowie Bearbeitungssperren setzen. Der Endpunkt stellt die Dokumentenzentrale der Organisation bereit; Projektdateien gehören nicht zu diesem Verzeichnisbaum. Für Finder, Datei-Explorer und andere fertige Clients nutze die [WebDAV-Einrichtung](/de/platform/connectors/webdav).

Diese Referenz richtet sich an Entwickler von Clients. Prüfe zuerst einen authentifizierten Verzeichnisabruf und danach einen kleinen Upload. Eine Antwort mit `207` bestätigt den Zugriff; erst identische heruntergeladene Dateiinhalte bestätigen auch den Speicherpfad.

## URL-Schema

| Pfad | Zugriff | Inhalt |
| --- | --- | --- |
| `/dav/<orgSlug>/documents/<path>` | Lesen und Schreiben | Aktive Dateien und Ordner der Dokumentenzentrale |
| `/dav/<orgSlug>/.trash/<path>` | Nur Lesen | Dokumente im Papierkorb |
| `/dav/<orgSlug>/` | Nur Lesen | Die beiden Bereiche oben |

Kodiere jedes Pfadsegment einzeln. Der Parser normalisiert Unicode auf NFC und entfernt Leerraum am Anfang und Ende. Leere Namen, `.` und `..`, `/`, `\`, Steuerzeichen und Namen mit mehr als 255 UTF-16-Codeeinheiten sind unzulässig. Das ist eine Zeichenlängenprüfung, keine Grenze von 255 Bytes. Für Organisations-Slugs gilt `[a-zA-Z0-9_-]{1,64}`.

Verwende für Ordner einen abschließenden Schrägstrich, für Dateien keinen. Verzeichnisantworten enthalten kanonische URLs. Übernimm bei vorhandenen Einträgen den zurückgegebenen `href`, statt ihn aus dem Anzeigenamen abzuleiten. Das ist besonders bei gleichnamigen Dokumenten im selben Ordner wichtig.

## Authentifizierung

Erzeuge in **Einstellungen > WebDAV** ein App-Passwort mit einem Konto, das auf die Entwicklereinstellungen zugreifen darf. Das vollständige Passwort erscheint einmal. Gib jedem Client eine eigene Bezeichnung, damit du seinen Zugriff einzeln widerrufen kannst.

| Zugangsdaten | Wert |
| --- | --- |
| HTTP-Verfahren | Basic |
| Benutzername | Deine Konto-E-Mail; der Server akzeptiert jeden nicht leeren Benutzernamen |
| Passwort | Das erzeugte WebDAV-App-Passwort |
| Organisation | Der Slug in der URL; die Mitgliedschaft wird bei jedem Zugriff geprüft |

Das App-Passwort identifiziert den Benutzer. Kontopasswörter und REST-API-Schlüssel werden nicht akzeptiert. Auch mit einem gültigen Passwort brauchst du eine aktuelle Mitgliedschaft in der Organisation; andernfalls folgt `403`. Nur `OPTIONS` ist ohne Anmeldung möglich.

### Einen Verzeichnisabruf prüfen

Setze unten die URL deiner Installation und deine E-Mail ein. Jeder Befehl mit `curl --user` fragt das App-Passwort interaktiv ab. So steht es weder im Befehl noch im Shell-Verlauf.

```bash
export TALE_DAV_URL="https://your-host.example.com/dav/acme/documents"
export TALE_DAV_USER="you@example.com"

curl --user "$TALE_DAV_USER" --request PROPFIND \
  --header 'Depth: 1' "$TALE_DAV_URL/"
```

Erwartet wird `207 Multi-Status` mit XML für den Ordner und seine direkten Einträge. Auch ein leerer Ordner hat einen eigenen Antwortblock. Parse XML als XML; ein `207` bedeutet nicht, dass jeder enthaltene Einzelstatus erfolgreich ist.

### Schreiben und Herunterladen prüfen

Wähle einen neuen Ordnernamen, damit du nichts überschreibst. Die Befehle erstellen einen Ordner, laden eine Textdatei hoch und rufen sie wieder ab:

```bash
curl --user "$TALE_DAV_USER" --request MKCOL "$TALE_DAV_URL/Client%20test/"
printf 'Hello from WebDAV.\n' > webdav-test.txt
curl --user "$TALE_DAV_USER" --upload-file webdav-test.txt \
  --header 'Content-Type: text/plain' "$TALE_DAV_URL/Client%20test/webdav-test.txt"
curl --user "$TALE_DAV_USER" "$TALE_DAV_URL/Client%20test/webdav-test.txt"
```

Erwartet werden `201` für den neuen Ordner, `201` für die neue Datei und der Text `Hello from WebDAV.` beim Abruf. Ein Upload auf eine vorhandene Datei ersetzt den Inhalt und liefert `204`. Die Datei erscheint auch ohne zusätzlichen Abgleich in der Dokumentenzentrale.

## Methoden

Außer `OPTIONS` verlangen alle Methoden das App-Passwort.

| Methode | Zweck | Erfolgreiche Antwort |
| --- | --- | --- |
| `OPTIONS` | Fähigkeiten und erlaubte Methoden des Ziels abfragen | `200`, `DAV: 1, 2`, `Allow` |
| `PROPFIND` | Eigenschaften lesen; `Depth: 0` nur für das Ziel, `Depth: 1` einschließlich direkter Einträge | `207` mit XML |
| `PROPPATCH` | Eigenschaftsänderungen übermitteln; Einschränkungen siehe unten | `207` mit Status je Eigenschaft |
| `GET`, `HEAD` | Datei herunterladen oder Header lesen | `200`; bedingte und Bereichsanfragen können andere Status liefern |
| `PUT` | Datei erstellen oder ersetzen | `201` neu, `204` ersetzt |
| `DELETE` | Dokumente in den Papierkorb verschieben; bei Ordnern rekursiv, Ordnerdatensätze entfernen | `204` |
| `MKCOL` | Ordner unter einem vorhandenen übergeordneten Ordner erstellen | `201` |
| `MOVE` | Dokument oder Ordner umbenennen oder verschieben | `201` neues Ziel, `204` ersetzt |
| `COPY` | Datei oder Ordnerbaum serverseitig kopieren; Dateikopien teilen gespeicherte Bytes | `201` neues Ziel, `204` ersetzt |
| `LOCK` | Schreibsperre anfordern oder verlängern | `200` mit Sperrtoken |
| `UNLOCK` | Eigene Sperre freigeben | `204` |

Ein `GET` auf einen Ordner liefert `405`; nutze `PROPFIND`. Ohne `Depth` gilt `1`, während `Depth: infinity` mit `403` abgelehnt wird. `MKCOL` benötigt einen leeren Body. Für `PUT` ist `Content-Length` erforderlich: Verwende eine Datei bekannter Größe statt Chunked Transfer.

`MOVE` und `COPY` nutzen `Destination` und berücksichtigen `Overwrite: T/F` sowie `If`. Das Ziel muss auf demselben Host und in derselben Organisation liegen. Fehlt der übergeordnete Zielordner, folgt `409`; bei `Overwrite: F` und vorhandenem Ziel folgt `412`. Dokumente werden atomar verschoben, bei Ordnern ändert sich die Zuordnung zum übergeordneten Ordner. Destruktive Vorgänge berücksichtigen außerdem Aufbewahrungssperren und Einschränkungen kontrollierter Dokumente.

`Allow` beschreibt das jeweilige Ziel: Der Dokumentenbaum nennt alle Methoden oben, eine Datei im Papierkorb `OPTIONS, GET, HEAD, PROPFIND`, der Papierkorb und das Organisationsverzeichnis `OPTIONS, PROPFIND`. Bei noch nicht auswertbaren Pfaden wird für die Erkennung die vollständige Methodenliste ausgegeben. Windows erhält zusätzlich `MS-Author-Via: DAV` und `Microsoft-Server-WebDAV-Extensions: 1`.

## Eigenschaften

| DAV-Eigenschaft | Bedeutung |
| --- | --- |
| `resourcetype` | `<collection/>` bei Ordnern, leer bei Dateien |
| `displayname` | Ordnername oder Dokumenttitel |
| `getlastmodified` | RFC-1123-Zeitstempel; Änderungszeit der Quelle, ersatzweise Erstellungszeit |
| `creationdate` | Erstellungszeit nach ISO 8601 |
| `getcontenttype` | MIME-Typ der Datei |
| `getcontentlength` | Dateigröße in Bytes |
| `getetag` | Derselbe Validator wie bei `GET` und `HEAD` |
| `supportedlock` | Unterstützung exklusiver Schreibsperren |
| `lockdiscovery` | Angaben zu aktiven Sperren, sofern verfügbar |

Dateieigenschaften gelten nicht für Ordner. Ein ETag enthält den Inhaltshash in Anführungszeichen, falls vorhanden. Sonst ist es ein schwacher Validator aus Größe und Änderungszeit, etwa `W/"42-1789373842855"`. Bewahre Anführungszeichen und `W/` unverändert. Ersetze den Wert nicht durch die Dokument-ID und leite aus einem schwachen Validator keine Bytegleichheit ab. `GET` unterstützt bedingte Anfragen und Bytebereiche.

<Warning>

Eigene Eigenschaften werden nicht gespeichert. Enthält `PROPPATCH` nur sogenannte Dead Properties, meldet der Server aus Kompatibilitätsgründen jeweils `200`; beim nächsten Lesen sind diese Werte trotzdem nicht vorhanden. Eine geschützte Live Property erhält `403`, Dead Properties derselben Anfrage erhalten dann `424 Failed Dependency`. Speichere darin keine fachlichen Metadaten.

</Warning>

## Sperrsemantik

Nutze eine exklusive Schreibsperre und bewahre das Token `opaquelocktoken:<uuid>` auf. Der Server kündigt exklusive Sperren an. Der Parser akzeptiert zwar einen gemeinsamen Geltungsbereich, die Datenbank erlaubt aber nur eine aktive Sperre je Ressource. Plane deshalb keine gemeinsame Bearbeitung mit Shared Locks.

| Aktion des Clients | Erforderliche Anfrage |
| --- | --- |
| Anfordern | `LOCK` mit XML für eine Schreibsperre und `Timeout: Second-N` |
| Unter Sperre schreiben | `If: (<opaquelocktoken:...>)` mitsenden |
| Verlängern | `LOCK` mit leerem Body und demselben `If`-Token |
| Freigeben | Als Eigentümer `UNLOCK` mit `Lock-Token: <opaquelocktoken:...>` senden |

Die Dauer wird auf 1–3600 Sekunden begrenzt. Verlängere die Sperre vor Ablauf, wenn die Bearbeitung länger dauert. Ein fehlendes Token bei einem geschützten Schreibzugriff führt zu `423`; ein falsches Token oder ein unbekanntes Token beim Verlängern zu `412`. Sperren können Unterverzeichnisse einschließen, sodass auch eine Sperre im übergeordneten Ordner den Zugriff verhindert.

Die Sperren liegen in Postgres. Abgelaufene Einträge schützen eine Ressource auch vor ihrer verzögerten Bereinigung nicht mehr. Beim Widerrufen eines App-Passworts werden seine Sperren sofort entfernt. Das hilft auch nach einem Client-Absturz, trennt aber alle Verbindungen mit diesem Passwort.

## Statuscodes

| Status | Bedeutung und nächster Schritt |
| --- | --- |
| `200`, `201`, `204` | Lesen, Erstellen oder Ändern erfolgreich; siehe Methodentabelle |
| `207` | Jeden Ressourcen- und Eigenschaftsstatus im XML prüfen |
| `400` | Fehlerhafte Header `Destination`, `If`, `Lock-Token` oder `Timeout` korrigieren |
| `401` | Gültiges, nicht widerrufenes App-Passwort über Basic mitsenden |
| `403` | Mitgliedschaft, schreibgeschützten Bereich, Aufbewahrungs-/Dokumentregeln, Tiefe, Eigentümer und Ziel prüfen |
| `404` | Zurückgegebenen `href`, Organisations-Slug und Existenz prüfen |
| `405` | `Allow` prüfen; Ordner lassen sich nicht als Dateien abrufen oder überschreiben |
| `409` | Übergeordneten Zielordner zuerst erstellen |
| `411` | `Content-Length` bei `PUT` mitsenden |
| `412` | Ressource oder Sperre neu lesen; `If`, `If-Match`, `If-None-Match` und `Overwrite` prüfen |
| `413` | Datei/XML verkleinern oder Uploadgrenze mit dem Betreiber prüfen |
| `415` | Leeren `MKCOL`-Body senden; erweitertes MKCOL wird nicht unterstützt |
| `423` | Passendes Sperrtoken beschaffen oder Freigabe/Ablauf abwarten |
| `502` | Abweichenden Zielhost und Verbindung zum Objektspeicher prüfen |
| `503` | Nicht benötigte Sperren dieses Passworts freigeben und `Retry-After` beachten |
| `507` | Den Ordnerbaum in kleineren Teilen bearbeiten |

Wiederhole nicht jede abgelehnte Anfrage automatisch. Ein fehlender Ordner oder falsche Zugangsdaten müssen korrigiert werden; bei einer Sperre ist die Abstimmung mit dem anderen Bearbeiter nötig.

## Compliance

Der Endpunkt gibt `DAV: 1, 2` aus. Maßgeblich sind die hier beschriebenen Methoden und Einschränkungen; die Angabe verspricht nicht jede optionale WebDAV-Funktion. Insbesondere werden eigene Eigenschaften nicht gespeichert und gemeinsame Bearbeitungssperren nicht unterstützt. Erweiterungen für Kalender, Kontakte, Suche und ACLs sind nicht vorhanden.

Die Syntax beschreibt [RFC 4918](https://www.rfc-editor.org/rfc/rfc4918). DAV-Konformitätsklasse 3 bezeichnet die Konformität mit einer Protokollrevision, nicht Kalender- oder Kontakterweiterungen.

## Limits

| Grenze | Wert oder Verhalten |
| --- | --- |
| Rekursives Auflisten | `Depth: infinity` wird abgelehnt; Ebene für Ebene lesen |
| Sperrdauer | 1–3600 Sekunden |
| Aktive Sperren | 200 je App-Passwort |
| Uploadgröße | Standardmäßig 5 GB; `WEBDAV_MAX_PUT_BYTES` setzt die Bytegrenze |
| XML-Bodies | 64 KiB für `PROPFIND`, `PROPPATCH`, `MKCOL` und `LOCK` |
| App-Passwörter | Bis zu 50 aktive je Benutzer in einer Organisation |
| Nutzungszeitstempel | Höchstens einmal pro Minute und Passwort aktualisiert |

Uploads werden mit Flusskontrolle an den Objektspeicher weitergegeben. Der Server braucht die Größe vor dem Anlegen der Uploadanfrage; Chunked Uploads erhalten `411`. Ordneroperationen haben begrenzte Traversierungsbudgets und können `507` liefern. Teile große Bäume auf, statt denselben zu großen Vorgang ständig zu wiederholen.

## Netzwerk-Voraussetzungen

Das Backend bedient `/dav/*`; der Plattform-Proxy macht den Pfad unter demselben öffentlichen Host wie Tale erreichbar. Lokal leitet Vite `/dav` von Port 3000 an das Backend weiter. Clients können damit die normale lokale Anwendungsadresse verwenden. Ein eigener WebDAV-Dienst ist nicht nötig.

Ein Verzeichnisabruf kann erfolgreich sein, während Downloads oder Uploads scheitern: Verzeichnisse benötigen die Datenbank, Dateiinhalte zusätzlich den Objektspeicher. Prüfe nach Proxy- oder Speicheränderungen beide Wege. Halte das Größenlimit des Proxys mit `WEBDAV_MAX_PUT_BYTES` konsistent.

## Sicherheit

Nutze für entfernte Verbindungen HTTPS. Basic sendet das App-Passwort bei jeder Anfrage; Base64 ist eine Kodierung, keine Verschlüsselung. Unverschlüsseltes HTTP eignet sich nur für einen kontrollierten Test auf localhost. Hinterlege Zugangsdaten über den Passwortdialog des Clients oder den Schlüsselbund des Betriebssystems, niemals in einer URL wie `https://user:password@host/`.

Das Backend speichert HMAC-SHA256-Hashes und ein vierstelliges Suchpräfix. Der Hashvergleich läuft in konstanter Zeit. Die Startkonfiguration leitet `WEBDAV_APP_PASSWORD_HMAC_KEY` aus `INSTANCE_SECRET` ab, sofern kein ausdrücklicher Wert gesetzt ist. Bewahre diese Geheimnisse stabil und gesichert auf: Ein anderer HMAC-Schlüssel macht bestehende Passwörter ungültig.

Die Passwortliste zeigt Bezeichnung, Präfix, Erstellungszeit und letzte Nutzung. Damit kannst du das Passwort eines verlorenen Geräts erkennen und widerrufen. Die letzte Nutzung ist ein gedrosselt aktualisierter Zeitstempel, kein vollständiges Protokoll aller Anfragen.

## Wo das hinpasst

Nutze [REST](/de/develop/api-reference) für projektbezogene Importe, ausdrückliche IDs und Suche. WebDAV eignet sich für Dateiclients der Dokumentenzentrale, die Pfade und Sperren erwarten. Beide arbeiten mit Tale-Dokumenten; WebDAV stellt aber weder den Dateibaum eines Projekts noch sämtliche REST-Vorgänge bereit.
