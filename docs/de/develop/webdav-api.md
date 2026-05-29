---
title: WebDAV-API
description: Protokoll-Referenz für Tales WebDAV-Server — URL-Schema, Authentifizierung, unterstützte Methoden, Eigenschaftsliste, Sperrsemantik und Limits.
---

Tale exponiert den Dokumentenspeicher unter `/dav/<orgSlug>/` als lese- und schreibfähigen WebDAV-Class-2-Endpunkt (RFC 4918). Diese Seite ist die Protokoll-Referenz — die Wire-Level-Oberfläche, die ein Client-Implementierer oder ein Drittanbieter-Werkzeug zur Integration braucht. Für den Endbenutzer-Einrichtungsleitfaden und Per-Client-Anweisungen siehe [Plattform > Integrationen > WebDAV](/platform/integrations/webdav).

## URL-Schema

```
/dav/<orgSlug>/documents/<path>      R/W  aktiver Dokumentenbaum
/dav/<orgSlug>/.trash/<path>         R/O  gelöschte Dokumente (Soft-Delete-Ansicht)
/dav/<orgSlug>/                      R/O  Sammlung, die die zwei obigen enthält
```

Segmente sind URL-kodiert. Der Server lehnt Segmente mit `/`, `\`, NUL oder den relativen Namen `.` und `..` ab. Jedes Segment muss 1–255 Byte umfassen. Der `orgSlug` matcht `[a-zA-Z0-9_-]{1,64}`.

Die Trailing-Slash-Konvention folgt WebDAV: Sammlungen (Ordner) werden mit Trailing Slash referenziert, Ressourcen (Dateien) ohne. Viele Clients normalisieren das im Flug; der Server akzeptiert beide Formen beim Lookup und gibt die kanonische Form in PROPFIND-Antworten aus.

## Authentifizierung

Nur HTTP Basic. Der Benutzername ist die Tale-Konto-E-Mail des Benutzers; das Passwort ist ein **App-Passwort**, das unter Einstellungen > WebDAV generiert wird. Das Haupt-Konto-Passwort wird auf diesem Endpunkt nicht akzeptiert.

```
Authorization: Basic <base64(email:app-passwort)>
```

App-Passwörter werden mit HMAC-SHA256 unter dem Deployment-Secret `WEBDAV_APP_PASSWORD_HMAC_KEY` gehasht. Der Lookup grenzt über die ersten vier Zeichen des Passworts ein (neben dem Hash gespeichert für indexierten Lookup) und verifiziert mit einem Konstant-Zeit-HMAC-Vergleich.

Jede authentifizierte Anfrage prüft zusätzlich, dass der anfragende Benutzer aktives Mitglied der Organisation in der URL ist — eine veraltete Zeile (Mitgliedschaft nach App-Passwort-Ausgabe entfernt) wird mit `403` abgelehnt.

`OPTIONS` ist die einzige Methode ohne Authentifizierung; Clients nutzen sie zur DAV-Capability-Prüfung vor der Anmeldung.

## Methoden

| Methode    | Verhalten                                                                                                                                                                                                                          | Auth         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| OPTIONS    | Capabilities ankündigen. Gibt `DAV: 1, 2`, `Allow: …` und `Microsoft-Server-WebDAV-Extensions: 1` für Windows-Kompatibilität zurück.                                                                                               | Anonym OK    |
| PROPFIND   | Eine Ressource auflisten (Depth 0) oder die direkten Kinder einer Sammlung (Depth 1). Die emittierte Eigenschaftsliste ist unten dokumentiert. **Depth: infinity wird mit 403 abgelehnt**, um unbegrenzte Antworten zu verhindern. | Erforderlich |
| PROPPATCH  | Gibt 207-Erfolg pro Eigenschaft zurück, ohne Werte zu speichern. Dead Properties werden in v1 nicht persistiert; PROPPATCH gelingt optimistisch zur Client-Kompatibilität.                                                         | Erforderlich |
| GET / HEAD | Den Dokument-Blob streamen. Setzt `Content-Type`, `Content-Length`, `ETag` und `Last-Modified`. GET auf eine Sammlung gibt 405 zurück.                                                                                             | Erforderlich |
| PUT        | Ein Dokument erstellen oder ersetzen. Neuer Blob im Convex-Speicher mit Content-Hash-Dedup; die Dokument-Zeile erhält `sourceProvider: "webdav"`. Gibt 201 beim Erstellen, 204 beim Überschreiben zurück.                          | Erforderlich |
| DELETE     | Ein Dokument soft-löschen (`lifecycleStatus: "trashed"`) oder einen Ordner (kaskadiert Trash auf enthaltene Dokumente, hard-löscht die Ordner-Zeilen). Gibt 204 zurück.                                                            | Erforderlich |
| MKCOL      | Einen Ordner unter einem bestehenden Eltern erstellen. Nur leerer Body. Gibt 201 zurück, 405 wenn das Ziel existiert oder 409 wenn der Eltern fehlt.                                                                               | Erforderlich |
| MOVE       | Umbenennen oder verschieben. Atomar für Dokumente. Für Ordner wird die `parentId` des verschobenen Ordners aktualisiert. Beachtet `Overwrite: T/F` und `If`. Gibt 201 (neues Ziel) oder 204 (Überschreiben) zurück.                | Erforderlich |
| COPY       | Serverseitige Kopie. Dokumentkopien wiederverwenden die Convex-Storage-ID (Dedup). Ordnerkopien rekursiv. Beachtet `Overwrite` und `If`.                                                                                           | Erforderlich |
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

Dead Properties werden nicht gespeichert. PROPPATCH gibt 200 pro Eigenschaft zurück, aber kein Wert wird persistiert.

## Sperrsemantik

Sperren leben in ihrer eigenen Convex-Tabelle, gekeyt mit `(organizationId, resourcePath)`. Wire-Form ist `opaquelocktoken:<uuid>`. Der Server:

- Deckelt Timeout auf 3600 Sekunden. Anfragen für längere Fenster werden still geklemmt.
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
- `403` — Depth: infinity abgelehnt; .trash-Schreibversuch; Root-Delete/Move; falscher App-Passwort-Besitzer bei UNLOCK; Benutzer kein Mitglied der Org
- `404` — Ressource nicht gefunden
- `405` — GET auf eine Sammlung; MKCOL auf existierendem Pfad; Root-MKCOL
- `409` — MKCOL wenn Eltern nicht existiert; PUT auf einen Sammlungs-Pfad
- `412` — `If`-Token-Mismatch
- `415` — MKCOL mit nicht-leerem XML-Body (extended MKCOL nicht implementiert)
- `423` — Schreiben auf einem gesperrten Pfad ohne passendes `If`
- `502` — Cross-Host- oder Cross-Org-`Destination`; Storage-Proxy-Fetch fehlgeschlagen

## Compliance

- DAV Class **1** (Basis): vollständig.
- DAV Class **2** (Sperren): vollständig, mit dem oben beschriebenen Lazy-Expiry-Verhalten.
- DAV Class **3** (Kalender, Kontakte, Suche, ACL): nicht implementiert.

Der Server bewirbt `DAV: 1, 2` in der OPTIONS-Antwort.

## Limits

- `Depth: infinity` auf PROPFIND wird mit `403` abgelehnt.
- `Timeout: Second-N` auf LOCK wird auf `[1, 3600]` geklemmt.
- Die PUT-Body-Größe ist durch das Upload-URL-Limit des Convex-Speichers der Plattform begrenzt. Der Plattform-Server leitet den Body an eine Convex-Presigned-URL; das Limit ist, was Ihr self-hosted Convex erzwingt. Für unbegrenztes Streaming sollten Sie Import über die REST-API erwägen.
- App-Passwörter werden mit HMAC-SHA256 gehasht; das Geheimnis taucht nach dem Create-Call in keiner Antwort mehr auf.
- `lastUsedAt` wird höchstens einmal pro Minute pro App-Passwort gepatcht, um Write-Storms auf belebten Mounts zu vermeiden.

## Netzwerk-Voraussetzungen

Der WebDAV-Endpunkt läuft im Plattform-Hono-Server (`platform:3000` in Compose). Caddy routet `/dav/*` über den Default-Fallback dorthin — keine Extra-Konfiguration erforderlich. Der Pfad erfordert, dass der Plattform-Server `ADMIN_KEY` in seiner Umgebung gesetzt hat, damit er interne Convex-Abfragen mit Admin-Auth aufrufen kann.

Für Dev (`bun dev`) wird derselbe Dispatch als Vite-Middleware gemountet (`vite-plugins/serve-webdav.ts`) — `curl` und Clients können `http://localhost:3000/dav/<orgSlug>/...` gegen einen laufenden Dev-Server ohne Rebuild treffen.

## Siehe auch

- [Plattform > Integrationen > WebDAV](/platform/integrations/webdav) — Endbenutzer-Einrichtungsleitfaden und Per-Client-Anweisungen.
- [Entwickeln > API-Referenz](/develop/api-reference) — die REST-API für Bulk-Dokumentenimport, Suche und andere Non-Mount-Workflows.
- RFC 4918 — WebDAV (HTTP-Erweiterungen für distributed authoring).
