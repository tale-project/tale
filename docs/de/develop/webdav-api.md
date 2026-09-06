---
title: WebDAV-API
description: Protokoll-Referenz für Tales WebDAV-Server — URL-Schema, Authentifizierung, unterstützte Methoden, Eigenschaftsliste, Sperrsemantik und Limits.
---

Tale exponiert den Dokumentenspeicher unter `/dav/<orgSlug>/` als lese- und schreibfähigen WebDAV-Class-2-Endpunkt (RFC 4918). Diese Seite ist die Protokoll-Referenz — die Wire-Level-Oberfläche, die ein Client-Implementierer oder ein Drittanbieter-Werkzeug zur Connector braucht. Für den Endbenutzer-Einrichtungsleitfaden und Per-Client-Anweisungen siehe [Plattform > Connectors > WebDAV](/platform/connectors/webdav).

## URL-Schema

```text
/dav/<orgSlug>/documents/<path>      R/W  aktiver Dokumentenbaum
/dav/<orgSlug>/.trash/<path>         R/O  gelöschte Dokumente (Soft-Delete-Ansicht)
/dav/<orgSlug>/                      R/O  Sammlung, die die zwei obigen enthält
```

Segmente sind URL-kodiert. Der Server lehnt Segmente mit `/`, `\`, NUL oder den relativen Namen `.` und `..` ab. Jedes Segment muss 1–255 Byte umfassen. Der `orgSlug` entspricht `[a-zA-Z0-9_-]{1,64}`.

Die Trailing-Slash-Konvention folgt WebDAV: Sammlungen (Ordner) werden mit Trailing Slash referenziert, Ressourcen (Dateien) ohne. Viele Clients normalisieren das unterwegs; der Server akzeptiert beide Formen beim Lookup und gibt die kanonische Form in PROPFIND-Antworten aus.

## Authentifizierung

Nur HTTP Basic. Das Feld Benutzername kann ein beliebiger nicht-leerer Wert sein — das App-Passwort ist die eigentliche Berechtigung, und der Server vergleicht den Benutzernamen nicht mit deinem Konto. Deine Tale-Konto-E-Mail einzutragen ist die Konvention für lesbare Audit-Logs, und die meisten Clients erwarten eine E-Mail-ähnliche Zeichenkette, aber die Auth-Entscheidung wird allein auf dem Passwort getroffen. Das Passwort ist ein **App-Passwort**, das du unter Einstellungen > WebDAV erzeugst. Dein Haupt-Konto-Passwort wird auf diesem Endpunkt nicht akzeptiert.

```http
Authorization: Basic <base64(email-oder-beliebig:app-passwort)>
```

App-Passwörter werden mit HMAC-SHA256 unter dem Deployment-Secret `WEBDAV_APP_PASSWORD_HMAC_KEY` gehasht. Der Schlüssel wird vom Plattform-Entrypoint (Prod) und von `server.ts` (Dev) deterministisch aus `INSTANCE_SECRET` abgeleitet — Operatoren müssen ihn nicht manuell setzen; ein expliziter Wert in `.env` überschreibt jedoch den abgeleiteten. Der Lookup grenzt über die ersten vier Zeichen des Passworts ein (neben dem Hash gespeichert für indexierten Lookup) und verifiziert mit einem Konstant-Zeit-HMAC-Vergleich.

Jede authentifizierte Anfrage prüft zusätzlich, dass der anfragende Benutzer aktives Mitglied der Organisation in der URL ist — eine veraltete Zeile (Mitgliedschaft nach App-Passwort-Ausgabe entfernt) wird mit `403` abgelehnt.

`OPTIONS` ist die einzige Methode ohne Authentifizierung; Clients nutzen sie zur DAV-Capability-Prüfung vor der Anmeldung.

## Methoden

| Methode    | Verhalten                                                                                                                                                                                                                          | Auth         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| OPTIONS    | Capabilities ankündigen. Gibt `DAV: 1, 2`, `Allow: …` und `Microsoft-Server-WebDAV-Extensions: 1` für Windows-Kompatibilität zurück.                                                                                               | Anonym OK    |
| PROPFIND   | Eine Ressource auflisten (Depth 0) oder die direkten Kinder einer Sammlung (Depth 1). Die emittierte Eigenschaftsliste ist unten dokumentiert. **Depth: infinity wird mit 403 abgelehnt**, um unbegrenzte Antworten zu verhindern. | Erforderlich |
| PROPPATCH  | Gibt 207-Erfolg pro Eigenschaft zurück, ohne Werte zu speichern. Dead Properties werden in v1 nicht persistiert; PROPPATCH gelingt optimistisch zur Client-Kompatibilität.                                                         | Erforderlich |
| GET / HEAD | Den Dokument-Blob streamen. Setzt `Content-Type`, `Content-Length`, `ETag` und `Last-Modified`. GET auf eine Sammlung gibt 405 zurück.                                                                                             | Erforderlich |
| PUT        | Ein Dokument erstellen oder ersetzen. Neuer Blob im Objektspeicher; die Dokument-Zeile erhält `sourceProvider: "webdav"`. Gibt 201 beim Erstellen, 204 beim Überschreiben zurück. Braucht `Content-Length`; ein Chunked-Body wird mit 411 abgelehnt. | Erforderlich |
| DELETE     | Ein Dokument soft-löschen (`lifecycleStatus: "trashed"`) oder einen Ordner (kaskadiert Trash auf enthaltene Dokumente, hard-löscht die Ordner-Zeilen). Gibt 204 zurück.                                                            | Erforderlich |
| MKCOL      | Einen Ordner unter einem bestehenden Eltern erstellen. Nur leerer Body. Gibt 201 zurück, 405 wenn das Ziel existiert oder 409 wenn der Eltern fehlt.                                                                               | Erforderlich |
| MOVE       | Umbenennen oder verschieben. Atomar für Dokumente. Für Ordner wird die `parentId` des verschobenen Ordners aktualisiert. Beachtet `Overwrite: T/F` und `If`. Gibt 201 (neues Ziel) oder 204 (Überschreiben) zurück.                | Erforderlich |
| COPY       | Serverseitige Kopie. Dokumentkopien wiederverwenden dasselbe gespeicherte Objekt. Ordnerkopien rekursiv. Beachtet `Overwrite` und `If`.                                                                                           | Erforderlich |
| LOCK       | Class-2-exklusive oder geteilte Schreibsperre. Timeout aus `Timeout: Second-N`-Header, gedeckelt auf 3600. Refresh durch erneutes LOCK mit `If: (<opaquelocktoken:...>)` und leerem Body.                                          | Erforderlich |
| UNLOCK     | Eine Sperre per Token freigeben. Nur der Sperr-Besitzer kann freigeben. Gibt 204 zurück.                                                                                                                                           | Erforderlich |

`HEAD` teilt seinen Handler mit `GET` ohne Body.

## Eigenschaften

PROPFIND gibt diese Live-Eigenschaften für jede Ressource zurück:

- `resourcetype` — `<collection/>` bei Ordnern, leer bei Dokumenten.
- `displayname` — der Ordnername oder Dokumenttitel.
- `getlastmodified` — RFC-1123-Zeitstempel. Dokumente nutzen `sourceModifiedAt` falls gesetzt, sonst die Erstellungszeit der Dokument-Zeile.
- `creationdate` — ISO 8601 der Zeilen-Erstellungszeit.
- `getcontenttype` — nur Dokumente; der MIME-Typ beim Upload.
- `getcontentlength` — nur Dokumente; Bytes.
- `getetag` — nur Dokumente; Content-Hash falls bekannt, sonst Dokument-ID.
- `supportedlock` — bewirbt exklusive Schreibsperren.
- `lockdiscovery` — vorhanden bei Ressourcen mit aktiven Sperren.

Dead Properties werden nicht gespeichert. PROPPATCH gibt für eine allein gesetzte Dead Property 200 zurück, aber das Setzen einer Live-/geschützten Eigenschaft liefert pro Eigenschaft ein 403 (`cannot-modify-protected-property`), und alle Dead Properties derselben Anfrage werden dann als 424 Failed Dependency gemeldet (RFC 4918 §9.2 Atomarität). Es wird nie ein Wert persistiert.

## Sperrsemantik

Sperren leben in ihrer eigenen Postgres-Tabelle (`app.webdav_locks`), gekeyt mit `(organizationId, resourcePath)`. Wire-Form ist `opaquelocktoken:<uuid>`. Der Server:

- Deckelt Timeout auf 3600 Sekunden. Anfragen für längere Fenster werden still gekappt.
- Behandelt `LOCK` mit `If: (<opaquelocktoken:UUID>)`-Header und leerem Body als Refresh — der Ablauf der bestehenden Sperre wird verlängert.
- Gibt `412 Precondition Failed` beim Refresh zurück, wenn das gelieferte Token unbekannt ist.
- Gibt `423 Locked` auf `PUT / DELETE / MOVE / COPY / MKCOL / PROPPATCH` gegen einen gesperrten Pfad zurück, wenn die Anfrage keinen passenden `If`-Header trägt.
- Gibt `412 Precondition Failed` zurück, wenn das gelieferte `If`-Token nicht zur Live-Sperre passt.
- Lässt Sperren faul ablaufen — die Lookup-Abfrage gibt null für abgelaufene Zeilen zurück und plant eine Fire-and-Forget-Löschung.
- Hard-löscht jede unter einem App-Passwort gehaltene Sperre, wenn dieses App-Passwort widerrufen wird.

`UNLOCK` erfordert sowohl einen gültigen `Lock-Token`-Header als auch, dass der anfragende Benutzer der Sperr-Besitzer ist.

## Statuscodes

- `200` — OPTIONS, GET, HEAD, LOCK, LOCK-Refresh, PROPPATCH (pro Eigenschaft)
- `201` — PUT erstellen, MKCOL, MOVE/COPY auf neues Ziel
- `204` — DELETE, UNLOCK, PUT überschreiben, MOVE/COPY überschreiben
- `207` — PROPFIND, PROPPATCH (Multi-Status-Hülle)
- `400` — fehlerhafter `Destination` / `If` / `Lock-Token` / `Timeout`-Header
- `401` — fehlende oder ungültige Basic-Auth
- `403` — Depth: infinity abgelehnt; .trash-Schreibversuch; Root-Delete/Move; falscher App-Passwort-Besitzer bei UNLOCK; Benutzer kein Mitglied der Org; MOVE/COPY auf sich selbst oder in den eigenen Teilbaum; Cross-Org-`Destination`
- `404` — Ressource nicht gefunden
- `405` — GET auf eine Sammlung; PUT auf einen Sammlungs-Pfad; MKCOL auf existierendem Pfad; Root-MKCOL
- `409` — MKCOL, MOVE oder COPY wenn das Ziel-Elternverzeichnis nicht existiert
- `411` — PUT ohne `Content-Length` (Chunked Transfer wird nicht unterstützt: der Body geht an eine präsignierte Objektspeicher-URL, die die Länge vorab braucht)
- `412` — `If`-Token-Mismatch; `If-Match` / `If-None-Match`-Vorbedingung fehlgeschlagen; MOVE/COPY mit `Overwrite: F` auf ein existierendes Ziel
- `413` — PUT-Body über dem Größenlimit, oder ein XML-Request-Body (PROPFIND / PROPPATCH / MKCOL / LOCK) über 64 KB
- `415` — MKCOL mit nicht-leerem XML-Body (extended MKCOL nicht implementiert)
- `423` — Schreiben auf einem gesperrten Pfad ohne passendes `If`
- `502` — Cross-Host-`Destination`; Storage-Proxy-Fetch fehlgeschlagen
- `503` — LOCK-Anzahl-Limit für das App-Passwort überschritten (mit `Retry-After`)
- `507` — Ordner-Teilbaum zu groß zum Löschen, Verschieben oder Kopieren in einer einzigen Anfrage

## Compliance

- DAV Class **1** (Basis): vollständig.
- DAV Class **2** (Sperren): vollständig, mit dem oben beschriebenen Lazy-Expiry-Verhalten.
- DAV Class **3** (Kalender, Kontakte, Suche, ACL): nicht implementiert.

Der Server bewirbt `DAV: 1, 2` in der OPTIONS-Antwort.

## Limits

- `Depth: infinity` auf PROPFIND wird mit `403` abgelehnt.
- `Timeout: Second-N` auf LOCK wird auf `[1, 3600]` begrenzt.
- Die PUT-Body-Größe ist standardmäßig auf **5 GB** begrenzt (`413` bei Überschreitung), erzwungen sowohl am Reverse-Proxy als auch im Plattform-Server. Betreiber können das Limit über die Umgebungsvariable `WEBDAV_MAX_PUT_BYTES` anpassen. Der Body wird an eine präsignierte S3-URL gestreamt, ohne dass ein großer Upload im Plattform-Speicher gepuffert wird. Weil diese URL die Länge vorab braucht, wird ein PUT ohne `Content-Length` (Chunked Transfer) mit `411` abgelehnt.
- XML-Request-Bodys (PROPFIND / PROPPATCH / MKCOL / LOCK) sind auf **64 KB** begrenzt (`413` bei Überschreitung) — diese Envelopes sind per Design winzig.
- App-Passwörter werden mit HMAC-SHA256 gehasht; das Geheimnis taucht nach dem Create-Call in keiner Antwort mehr auf.
- `lastUsedAt` wird höchstens einmal pro Minute pro App-Passwort gepatcht, um Write-Storms auf belebten Mounts zu vermeiden.

## Netzwerk-Voraussetzungen

Der WebDAV-Endpunkt läuft im Plattform-Hono-Server (`platform:3000` in Compose). Caddy routet `/dav/*` über den Default-Fallback dorthin — keine Extra-Konfiguration erforderlich. Der Handler spricht direkt über die eigene Datenbankverbindung des Backends mit Postgres; einen separaten Dienst gibt es nicht zu erreichen.

Für Dev (`bun run dev`) proxyt Vite `/dav` an das Backend — `curl` und Clients können `http://localhost:3000/dav/<orgSlug>/...` gegen einen laufenden Dev-Server ohne Rebuild treffen.

## Sicherheit

WebDAV schickt das App-Passwort als HTTP-Basic-Header bei jeder Anfrage — keine Session, kein Token-Refresh, einfach die nackte Berechtigung wiedergespielt bei jedem PROPFIND, PUT, LOCK und so weiter. Hänge den Endpunkt nur über HTTPS ein; über reines HTTP leakt das Passwort an jeden auf der Leitung, und ein Widerruf der Zeile ist die einzige Erholung. Stecke das App-Passwort niemals direkt in die URL (die `https://user:pass@host/...`-Kurzform) — die meisten Clients protokollieren URLs in Shell-History, Crash-Reports und Proxy-Access-Logs, wo die Berechtigung den Unmount weit überdauern würde. Lass den WebDAV-Client das Passwort im System-Schlüsselbund speichern (macOS Keychain, Windows Credential Manager, GNOME Keyring) und über den Standard-Credential-Prompt herausgeben.

Der Server erzwingt TLS auf der Reverse-Proxy-Schicht in Produktion; der Dev-Modus über reines HTTP ist nur für `localhost`-Tests gedacht. Audit-Logs erfassen jede authentifizierte Anfrage mit dem Präfix des verwendeten Passworts, sodass eine geleakte Berechtigung sich nachverfolgen und widerrufen lässt, ohne die übrige Geräteflotte zu rotieren.

## Wo das hinpasst

WebDAV ist die Mount-Protokoll-Oberfläche desselben Dokumentenspeichers, den die [REST-API-Referenz](/develop/api-reference) für Bulk-Import und Suche bedient — beide Wege schreiben in dieselbe Tabelle, aus der der [Dokumenten-Hub](/platform/knowledge/documents) liest, sodass eine über den Finder erstellte Datei ohne Sync-Schritt in der Web-Oberfläche erscheint. Das Protokoll ist die richtige Wahl, wenn Dokumente sich wie ein lokaler Ordner anfühlen sollen; die REST-API ist die richtige Wahl, wenn ein Skript oder Agent Byte-Kontrolle über das Geschriebene braucht. RFC 4918 ist die Wire-Level-Autorität für alles auf dieser Seite.
