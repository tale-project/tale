---
title: API-Referenz
description: Rufe die REST-API auf, wähle Organisation und Projekt, lies mehrseitige Ergebnisse und behandle asynchrone Vorgänge und Fehler.
i18nLintExclude:
  - terminology-loanword
---

Die REST-API liest und verändert Tale-Ressourcen mit einem API-Schlüssel: Projekte, Dateien, Aufgaben, Automationen, Läufe und Chat-Threads. Prüfe den Zugriff mit [deiner ersten API-Anfrage](/de/get-started/developers) und nutze danach die passenden Abschnitte unten.

Deine Instanz stellt das OpenAPI-Schema mit allen Feldern unter `/openapi.json` und eine interaktive Referenz unter `/docs` bereit. Erzeuge Clients aus dem Schema dieser Instanz. Diese Seite erklärt Berechtigungen, Geltungsbereiche, asynchrone Arbeit und Fehler über die einzelnen Operationen hinweg.

## Eine erste Anfrage

Setze `TALE_URL` auf die Adresse der Anwendung, `TALE_API_KEY` auf deinen Schlüssel und `TALE_ORG_SLUG` auf die gewünschte Organisation. Bewahre Geheimnisse in der Umgebung auf. Prüfe zuerst die Identität, bevor du Ressourcen anlegst:

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/me" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

Bei `200` enthält die Antwort `user`, die ausgewählte `organization`, alle aktuellen `organizations`, Deployment-`capabilities` sowie Name und Ablauf des verwendeten `key`. Prüfe Organisation und Rolle vor den nächsten Schritten. Die weiteren Beispiele verwenden Platzhalter für Projekt-, Datei- und Lauf-IDs. Übernimm echte IDs aus vorherigen Antworten, nicht aus Anzeigenamen oder Vermutungen.

### Alle Seiten einer Liste lesen

Listen liefern benannte Sammlungen statt eines nackten Arrays. Das OpenAPI-Schema der `200`-Antwort nennt mit `x-tale-pagination` die passende Form der Seitennavigation.

| Form | Anfrage | Antwort und Abbruchbedingung |
| --- | --- | --- |
| Keyset | `cursor`, `limit` | Einträge, `isDone` und `continueCursor`; bei `isDone: true` stoppen |
| Offset: nur Website-Seiten | `cursor` oder `offset`, nie beide | `pages`, `total`, `offset`, `hasMore`, zusätzlich `isDone` und signierter `continueCursor` |
| Ohne Seitennavigation | Weder `cursor` noch `limit` | Benanntes Array mit vollständiger oder ausdrücklich begrenzter Auswahl |

Sende bei Keyset-Listen `continueCursor` unverändert zurück. Dekodiere oder erhöhe ihn nicht. Auf der letzten Seite ist er leer; sendest du diesen leeren Wert erneut, folgt `400 INVALID_QUERY`, nicht die erste Seite. Die Obergrenze steht je Operation im Schema: meist 100 oder 200, bei Aufgabenkommentaren 500. Größere Query-Limits werden begrenzt.

Kontakte, Produkte, Dokumente, Wissenseinträge, Threads, Nachrichten, Websites und Benachrichtigungsexporte liefern ihre Keyset-Einträge unter `page`. Läufe, Zustellungen, Aufgabenkommentare, Projekte und Projektdateien verwenden den Ressourcennamen, etwa `runs` oder `files`. Lauflisten sind absteigend nach Zeit sortiert, liefern standardmäßig 50 Einträge und akzeptieren 1–200. `GET /api/v1/runs` umfasst sichtbare Läufe über Automatisierungen hinweg.

Automatisierungen, Agenten, Skills, Ordner, Modelle, Browsersitzungen, Versionen und Trigger haben keine Seitennavigation. Eine Website-Seitenanfrage mit `cursor` und `offset` erhält `400 INVALID_QUERY`. Der signierte Cursor für den nächsten Offset funktioniert auch mit der normalen Keyset-Schleife.

Kontakte und Produkte sind nach `updatedAt`, dann `id`, jeweils absteigend sortiert. Wird ein Eintrag während des Durchlaufens geändert, kann er vor deinen Cursor rücken; dieser Durchlauf erfasst die Änderung dann möglicherweise nicht. Vergleiche für einen vollständigen Abgleich das `updatedAt` jedes Eintrags und wiederhole vollständige Durchläufe. Ein Cursor garantiert keinen unveränderlichen Datenstand. Hub-Dokumente, Projekte, Projektdateien und Websites stehen dagegen nach `createdAt` mit den neuesten zuerst.

## Authentifizierung

Erstelle Schlüssel mit Admin- oder Entwicklerzugriff unter **Einstellungen > API > REST**; [API-Schlüssel](/de/platform/admin/api-keys) erklärt die Oberfläche. Ein Schlüssel erscheint einmal und handelt als sein Ersteller. Diese REST-Oberfläche erstellt, listet, rotiert oder widerruft keine Schlüssel.

| Header | Regel |
| --- | --- |
| `Authorization: Bearer <key>` | Einzige erlaubte Stelle; die vollständige Zeichenfolge samt Präfix `tale` unverändert übernehmen |
| `X-Organization-Slug: <slug>` | Aktuelle Mitgliedschaft auswählen; in wiederverwendbaren Integrationen immer mitsenden |
| `x-api-key` | Führt zu `401`, auch neben einem gültigen Bearer-Header; macht aus dem Schlüssel keine App-Sitzung |

Bei genau einer Organisation ist der Organisations-Header optional. Mit mehreren Mitgliedschaften braucht jede Anfrage ihn, auch beim Lesen. Die im Dashboard ausgewählte Organisation bestimmt niemals den API-Kontext. Die Groß-/Kleinschreibung des Slugs spielt keine Rolle; leere Werte oder reiner Leerraum gelten als fehlend.

| Organisationsauswahl | Ergebnis |
| --- | --- |
| Mehrere Mitgliedschaften, kein Slug | `400 ORG_SLUG_REQUIRED`; mögliche Slugs stehen in `data.organizations` |
| Unbekannter Slug | `404 ORG_SLUG_INVALID` |
| Vorhandene Organisation ohne Mitgliedschaft | `403 ORG_FORBIDDEN` |
| Gültige Mitgliedschaft | Anfrage läuft mit Organisation und Rolle weiter |

`GET /api/v1/me` liefert die Mitgliedschaften auch als `organizations`. `key.expiresAt` enthält Unixzeit in Millisekunden oder `null` bei unbegrenzter Gültigkeit. Rotiere unbeaufsichtigte Zugangsdaten vor dem Ablauf, bevor `401` den Dienst unterbricht. `key.name` benennt den verwendeten Schlüssel.

Prüfe vor einer Operation sowohl die Rolle als auch den Zugriff auf die Ressource. Projektleser dürfen chatten und kommentieren; Änderungen und Aufgaben-Workflows benötigen Bearbeitungszugriff.

| Berechtigung aus `/me` | Bedeutung |
| --- | --- |
| `developer` | Inhaber, Admins und Entwickler dürfen beliebige Live-Läufe starten, Läufe abbrechen oder löschen, Trigger binden oder lösen, Automatisierungen löschen sowie Projekt-Automatisierungen installieren oder deinstallieren. Ohne diese Berechtigung liefern diese REST-Operationen `403 ROLE_FORBIDDEN`. MCP prüft sie ebenfalls beim Speichern, Bereitstellen und für weitere privilegierte Tools, nutzt aber sein eigenes Fehlerformat. Validierung und Mock-Tools bleiben für Mitglieder verfügbar. Der Projektzugriff wird gesondert geprüft. |
| `deploymentEditor` | Die Freigabeliste des Betreibers erlaubt Import und Widerruf von Browsersitzungen. Eine administrative Rolle allein reicht dafür nicht. |
| `notificationExport` | Der Schlüssel darf Benachrichtigungen von Mitgliedern über `GET /api/v1/notifications/sync` exportieren. Inhaber und Admins haben diese Berechtigung durch ihre Rolle, alle anderen Mitglieder nur mit einer gültigen Berechtigung `tale:notifications.export`, die ein Admin erteilt hat; siehe [Export ohne Admin-Rolle delegieren](#export-ohne-admin-rolle-delegieren). Ohne sie liefert der Export `403 ROLE_FORBIDDEN`. |
| `actAs` | Der Schlüssel darf auf `POST …/runs/{runId}/asks/{askId}` und `POST …/tasks/{taskId}/review` einen `actor` nennen — das verifizierte Mitglied, für das eine weitergereichte Handlung festgehalten wird. Inhaber und Admins haben das Recht durch ihre Rolle; jedes andere Mitglied nur, solange eine `tale:rest.act-as`-Freigabe eines Admins gilt — siehe [Das Mitglied benennen, für das gehandelt wird](#das-mitglied-benennen-fuer-das-gehandelt-wird). Ohne dieses Recht antwortet ein gesendeter `actor` mit `403 ROLE_FORBIDDEN`. |

## Was für jede Anfrage gilt

### JSON und Query-Parameter validieren

Sende JSON in UTF-8. Ungültiges UTF-8, NUL-Zeichen, ungepaarte UTF-16-Surrogate in Schlüsseln oder Werten sowie Ganzzahlen über 2^53 − 1 führen zu `400 INVALID_BODY`. Übertrage große Kennungen als Strings. Bei verschachtelten Werten nennt `data.issues` den vollständigen Pfad, etwa `messages.0.createdAt`. IDs sind Strings, Zeitstempel Unixzeit in Millisekunden. `updatedAt` eines Skills bezeichnet den Schreibzeitpunkt seiner `SKILL.md`.

| Eingabe | Regel |
| --- | --- |
| Unbekannter Body-Schlüssel | `400 INVALID_BODY`, mit Angabe des Schlüssels |
| Doppelter JSON-Schlüssel | Der letzte Wert gilt |
| Unbekannter, doppelter oder leerer Query-Parameter | `400 INVALID_QUERY` |
| Query bei einer Schreiboperation | Abgelehnt; Schreiboperationen akzeptieren keine Query-Parameter |
| Query-`limit` außerhalb des Bereichs | Auf den Bereich der Operation begrenzt |
| Body-Zahl außerhalb des Bereichs | `400 INVALID_BODY`, etwa Such-`limit` oder `maxOutputTokens` |
| `Content-Type` | Der Body wird unabhängig davon als JSON gelesen; diese Oberfläche liefert kein `415` |
| `Accept` | JSON-Operationen liefern auch dann JSON, wenn der Header ein anderes Format verlangt oder JSON ausschließt; es gibt kein `406` |

### Größe und Übertragungsdauer begrenzen

| Body | Maximum |
| --- | --- |
| Normale JSON-Anfrage | 1 MiB |
| Eingebetteter Dokumentinhalt | 32 MiB |
| Kontakt-Sammelimport | 8 MiB |
| Konversations-Snapshot | 8 MiB |
| Bereitgestellter Konversationsupload | 30 MiB |
| Skill speichern | 4 MiB |
| Zustellung beanspruchen, Fehler melden oder bestätigen | 64 KiB |

Ein zu großer Body erhält `413 BODY_TOO_LARGE`. Überschreitet schon die deklarierte Größe das Limit, liest die Plattform den Body nicht. Andernfalls stoppt sie beim ersten Chunk über der Grenze. Ein übergroßer Body wird nie vollständig gepuffert. Uploadregeln können niedrigere Grenzen setzen als diese Transportlimits.

Header und Body müssen innerhalb von 15 Minuten eintreffen. Für 30 MiB sind dafür ungefähr 35 KB/s nötig. Eine langsamere Anfrage erhält `408 REQUEST_TIMEOUT`, und die Verbindung wird geschlossen. Nutze eine schnellere Verbindung, kleinere unterstützte Anfragen oder den zweistufigen Projektupload, dessen Dateiübertragung außerhalb dieses JSON-Zeitfensters läuft.

### Methoden und Antwortkennungen

Vorhandene Leserouten unterstützen `HEAD` mit der unkomprimierten `GET`-Länge und ohne Body. `HEAD` wird nie komprimiert. `OPTIONS` benötigt keinen Schlüssel und liefert `204` mit `Allow`. Eine nicht unterstützte Methode auf einer vorhandenen Route erhält `405 METHOD_NOT_ALLOWED` mit den erlaubten Methoden. Ein abschließender Schrägstrich wird toleriert.

Die produktive REST-Oberfläche ist für Server-zu-Server-Aufrufe gedacht und aktiviert kein CORS. Halte API-Schlüssel hinter deinem eigenen Backend. Das schlüssellose Status-JSON ist eine getrennte Oberfläche mit CORS.

Jede API-Antwort enthält `X-Request-Id`. Zur Zuordnung in Logs kannst du bis zu 255 Zeichen aus Buchstaben, Ziffern, `_`, `-` und `=` senden. Ein ungültiger Wert wird durch eine neue UUID ersetzt; die Antwort nennt die tatsächlich verwendete Kennung. Bei `429`, `500`, `413` und `414` steht `requestId` zusätzlich in der JSON-Hülle. Zwei Ablehnungen sind die Ausnahme, weil der HTTP-Parser des Edge sie beantwortet, bevor eine Anfrage existiert, die sich loggen ließe: Die nackte `431` für Kopfzeilen über dem 64-KiB-Budget und die nackte `400` für ein Steuerzeichen in einem Kopfzeilenwert tragen keine `X-Request-Id`, keinen Umschlag und keine `X-Tale-Api-Version` — es gibt nichts zu zitieren, und die Anfrage selbst ist das, was du änderst.

`Idempotency-Key` lesen nur die Operationen, die die Kopfzeile deklarieren — ein Lauf-Start, ein Chat-Senden; das OpenAPI-Dokument listet sie, und die Webhook-Türen lesen sie nach ihrer eigenen Regel als Zustellungs-ID. Jede andere Operation ignoriert die Kopfzeile: Ihr Höchstens-einmal-Schutz ist der natürliche Schlüssel, den ihr Body nennt — die `externalId` eines Kontakts, das `(externalSystem, externalId)` einer Aufgabe, die `externalItemId` eines Projekts. Ein `Expect: 100-continue` holt sich vom Edge ein `100 Continue`, sobald er den Body weiterleitet; das Urteil der Plattform — eine `413` für eine deklarierte Länge über der Grenze — kommt trotzdem, bevor ein Body-Byte gelesen ist.

Antworten von `/api/v1` und Webhook-Routen enthalten `X-Tale-Api-Version`; siehe [Versionierung](#versionierung). Die schlüssellosen Pfade `/api/health`, `/status`, `/status.json` und `/openapi.json` gehören nicht zu diesem Vertrag und haben keinen Versionsheader.

<Accordion title="Details zu HTTP und Proxy-Verhalten">

Die URL einschließlich Query ist auf 32 KiB begrenzt; größere URLs erhalten vor der Routensuche `414 URI_TOO_LONG`. Am Proxy gilt für Header insgesamt 64 KiB. HTTP/1.1 lässt vor einer nackten `431` einige KiB Spielraum zu. Eine URL mit 66 KiB kann deshalb die Plattform erreichen und `414` erhalten. HTTP/2 setzt die Headergrenze exakt durch und schließt die Verbindung ohne Antwort.

Steuerzeichen unter 0x20 außer Tabulator sowie DEL in Headerwerten werden vor der Plattform abgelehnt: HTTP/1.1 liefert eine reine Textantwort mit `400` ohne `X-Request-Id`; HTTP/2 setzt den Stream zurück oder schließt eine Verbindung mit Body.

Fehlerhafte HTTP/1.1-Chunk-Kodierung, etwa eine nicht hexadezimale Chunk-Größe oder ein fehlendes CRLF, führt am Proxy zu `400 BODY_CHUNK_MALFORMED`. Korrigiere den HTTP-Client oder die Zwischenstelle, die die Anfrage kodiert. Dieselben fehlerhaften Bytes erneut zu senden hilft nicht.

Bei einem bereits laut Länge zu großen Body kann der HTTP/1.1-Proxy vor der Fehlerausgabe bis zu 256 KiB verwerfen, obwohl die Plattform nichts liest. Endet ein Body vor seiner deklarierten Länge, liefert HTTP/2 `400 BODY_LENGTH_MISMATCH`, sofern nicht die Plattform mit ihrer `413` schneller war. HTTP/1.1 wartet bis zum Ablauf der 15 Minuten auf die fehlenden Bytes.

Proxy-Fehler haben eine eigene Anfragekennung und kein `X-Tale-Api-Version`: Der Proxy kennt den Anwendungsvertrag nicht. Beispiele sind eine `404` für Punktsegmente, `BODY_LENGTH_MISMATCH`, `BODY_CHUNK_MALFORMED` und `502`/`503`/`504 UPSTREAM_UNAVAILABLE` beim Neustart. Verlasse dich nicht darauf, dass jede Zwischenstelle die JSON-Fehlerhülle der API liefert.

</Accordion>

## Caching, Kompression und gezieltes Lesen

### Unveränderte Antworten wiederverwenden

Jede JSON-Leseantwort — ein `GET`, das **200** antwortet — trägt einen `ETag`, der über ihre Bytes berechnet ist, und `Cache-Control: private, no-cache`: Behalte die Antwort und schicke den Tag beim nächsten Lesen als `If-None-Match` zurück. Eine unveränderte Ressource antwortet **304** ohne Body — wer einen fertigen Lauf, einen ruhenden Thread oder den Indexierungsstatus eines Dokuments pollt, zahlt so einen Roundtrip statt der Nutzlast.

Schick den Tag genau so zurück, wie du ihn bekommen hast: Hinter dem komprimierenden Edge lautet der Tag einer komprimierten Antwort `"…-gzip"` oder `"…-zstd"`, und diese Form passt, ebenso die schwache Form `W/"…"`; die 304 trägt den Tag, den die API berechnet hat. Dateiinhalte — `GET /api/v1/projects/{id}/files/{documentId}/content` und das `GET /api/v1/documents/{id}/content` eines Dokuments der Wissensdatenbank gleichermaßen — prüfen `If-None-Match` und `If-Modified-Since` genauso gegen den `ETag` und das `Last-Modified`, die sie ausgeben — ein Spiegel lädt eine Datei nur dann neu, wenn sich ihre Bytes geändert haben.

Das Datum wird sekundengenau beurteilt — genauer ist ein HTTP-Datum nicht —, und reisen beide mit, entscheidet `If-None-Match` allein; bei einem Dokument der Wissensdatenbank mit reinem Inline-Inhalt ist `Last-Modified` das eigene `updatedAt` des Dokuments, das auch ein Patch des Titels oder der Metadaten bewegt — ein Spiegel, der Bytes verfolgt, sendet also den `ETag`. Eine **304** zählt trotzdem als eine Anfrage gegen die [Rate-Limits](/de/develop/rate-limits).

```bash
# Das erste Lesen antwortet 200 und seinen ETag; die Wiederholung mit diesem Tag antwortet 304
curl -sS --compressed -D - -o /dev/null "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H 'If-None-Match: "<ETag aus der vorigen Antwort>"'
```

### Kompression anfordern

JSON- und Textantworten werden ab ungefähr 512 Bytes komprimiert, wenn die Anfrage `gzip` oder `zstd` über `Accept-Encoding` anbietet. `curl --compressed` fordert unterstützte Formate an; `br` wird nicht ausgeliefert.

`Content-Length` bezeichnet bei einer komprimierten Antwort die komprimierte Größe, falls der Header vorhanden ist. Große Antworten können ohne ihn streamen. Das ETag trägt entsprechend den Zusatz `-gzip` oder `-zstd`. `HEAD` bleibt unkomprimiert und nennt die unkomprimierte Größe. Fordere Kompression für große JSON-Antworten an, wenn dein Client sie unterstützt; die Einsparung hängt vom Inhalt ab und verringert nicht die Zahl berechneter Anfragen.

### Nur benötigte Felder lesen

Wo eine Ressource groß ist und ein Lesen nur einen Teil davon braucht, sagt es die Operation: Ein Lauf-Lesen nimmt `?fields=status,finishedAt` (beliebige Schlüssel des Laufs, kommagetrennt) und antwortet genau mit diesen Schlüsseln, und eine Laufliste, die über `?include=` volle Zeilen einbettet, liest höchstens 25 Zeilen pro Seite und antwortet mit höchstens 8 MiB davon — sie endet bei der letzten Zeile, die noch passt, mit `isDone: false` und einem `continueCursor` an dieser Zeile; folge dem Cursor also weiter, bis `isDone` gilt.

## Mit Tale bei einer Anwendung anmelden

Tale ist auch ein OpenID-Connect-Aussteller. Eine registrierte Anwendung führt dich durch die native Anmeldung und Einwilligung in Tale. Sie erhält eine signierte Identität mit bestätigter E-Mail-Adresse und der Mitgliedschaft in genau der Organisation, an die ihr Client gebunden ist. Ein API-Schlüssel ersetzt in diesem Ablauf keine persönliche Anmeldung.

Registriere die Anwendung mit einer aktiven Owner- oder Admin-Sitzung, deren ausgewählte Organisation `TALE_ORG_ID` entspricht. `TALE_ORIGIN` ist der Ursprung deiner Tale-Instanz, `TALE_SESSION_COOKIE` der Cookie-Header dieser Sitzung. Verwende die genaue HTTPS-Callback-URL der Anwendung; HTTP ist nur auf Loopback für die lokale Entwicklung erlaubt:

```bash
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

Die erste Antwort lautet **201** mit `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Speichere das Geheimnis in der geheimen Umgebungskonfiguration der Anwendung. Derselbe Schlüssel mit unveränderter Konfiguration liefert bei Wiederholung **200**, `created: false` und dieselbe Client-ID ohne Geheimnis. Eine geänderte Callback-URL oder Richtlinie führt zu **409**. Ein erneuter Lauf kann eine bestehende Integration so nicht unbemerkt umleiten.

| Zweck               | Endpoint oder Anforderung                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| Aussteller          | `https://your-host.example.com/api/auth`                                       |
| Discovery           | `GET /api/auth/.well-known/openid-configuration`                               |
| Autorisierung       | `GET /api/auth/oauth2/authorize`                                               |
| Code-Austausch      | `POST /api/auth/oauth2/token`, `client_secret_basic` oder `client_secret_post` |
| Signaturschlüssel   | `GET /api/auth/jwks`                                                           |
| Aktuelle Identität  | `GET /api/auth/oauth2/userinfo`, Bearer-Zugriffstoken                          |
| Angeforderte Scopes | `openid profile email tale:organization`                                       |

Verwende einen gepflegten OIDC-Client mit Authorization Code Flow, S256 PKCE sowie einmaligem State und Nonce. Prüfe Aussteller, Zielgruppe, RS256-Signatur, Ablaufzeit und Nonce des ID-Tokens und verlange `email_verified: true`. Der Claim `https://tale.dev/organization` enthält `{id, slug, role}` für die registrierte Organisation.

Jedes ID-Token trägt denselben Wert `acr: "urn:mace:incommon:iap:bronze"`. Die Discovery führt ihn unter `acr_values_supported` und `claims_supported`. Er bescheinigt keinen stärkeren Authentifizierungskontext und keine abgeschlossene MFA-Prüfung; verwende ihn dafür nicht als Zugangskriterium. `prompt_values_supported` nennt die unterstützten Werte `none`, `login` und `consent`; `select_account` und `create` werden nicht angeboten.

Tale prüft vor der Token-Ausgabe und beim Abruf von Userinfo die aktuelle Mitgliedschaft und die native MFA-Pflicht erneut. Die Anwendung bleibt für ihre eigene Zugangsrichtlinie verantwortlich. Codes laufen nach 60 Sekunden ab und lassen sich einmal einlösen; Zugriffs- und ID-Tokens laufen nach fünf Minuten ab. Dynamische Registrierung, Implicit Grants und Refresh Tokens sind deaktiviert.

Zugriffstokens gelten nur für die native Userinfo-Schnittstelle; externe Ressourcenzielgruppen sind deaktiviert. Verwende für REST-Anfragen native API-Schlüssel.

### Fehler des Identitätsanbieters behandeln

Fehler folgen RFC 6749 und RFC 6750 — genau das, was ein gepflegter Client erwartet. `userinfo` antwortet auf ein ungültiges oder abgelaufenes Zugriffstoken mit **401** `invalid_token` und einer `WWW-Authenticate: Bearer`-Challenge — jeder Ablauf nach fünf Minuten nimmt diesen Weg, behandle ihn also als erneute Anmeldung, nicht als Wiederholung — und ohne Token mit **401** und der bloßen Challenge; ein Token ohne den Scope `openid` ergibt **403** `insufficient_scope`.

Token- und Autorisierungs-Endpoint antworten mit `{ "error", "error_description" }`: Ein anderer Grant als `authorization_code` ist `unsupported_grant_type`, eine fehlerhafte Anfrage — ein fehlendes `grant_type` eingeschlossen — `invalid_request`, wobei die Beschreibung den Parameter nennt (`grant_type is required`, `client_id is required`, `response_type must be one of "code"`). Ein Body des falschen Medientyps an einem reinen JSON-Endpoint (ein Formular, das an `register` gepostet wird) ergibt **400** `invalid_request` mit dem Typ, den er nimmt — ein 415 gibt es auf dieser Oberfläche nicht.

Eine Autorisierungsanfrage, deren `client_id` keinen registrierten Client benennt, wird auf die eigene Fehlerseite des Ausstellers umgeleitet — nie auf die `redirect_uri`, die sie geschickt hat — mit `error=invalid_client` und einer Beschreibung, die den Client als unbekannt benennt, damit eine vertippte ID nicht für eine fehlende gehalten wird. Discovery führt `https://tale.dev/organization` unter `claims_supported`; sie nennt außerdem die Introspection-, Revocation- und End-Session-Endpoints des Providers, die der Ablauf oben nicht braucht.

### Anwendungs-Client rotieren oder deaktivieren

Für einen geprüften Client-Schlüssel liefert `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` mit `{}` einmalig ein neues `client_secret` und macht das alte ungültig. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` mit `{ "disabled": true }` sperrt neue Autorisierungen; `false` aktiviert denselben Client wieder. Beide Aufrufe benötigen wie die Registrierung dieselbe aktuelle Organisation, eine Admin-Sitzung, den Origin-Header und JSON als Inhaltstyp. Beim Löschen einer Organisation werden ihre Clients und Einwilligungen entfernt.

## Endpoint-Gruppen

Bei Projektressourcen unter `/api/v1` steht die Projekt-ID in der URL. Ein `projectId` im Anfrageinhalt ergibt hier **400**, weil die Schemas unbekannte Felder ablehnen. Die Ressource muss zum benannten Projekt gehören und für den Schlüsselbesitzer sichtbar sein; andernfalls antwortet Tale mit **404**. Antworten dürfen `projectId` als Metadatum enthalten. Organisationskataloge wie Automatisierungsdefinitionen und Skill-Bundles behalten ihre Organisationspfade.

Jede **201**, die eine adressierbare Ressource anlegt, trägt `Location` — den eigenen Pfad der Ressource, relativ zur Anfrage-URL —, damit ein generischer Client ihr folgt, welche Form der Body auch hat (`{id}` bei einem Kontakt, `{project}` bei einem Projekt, `{task}` bei einer Aufgabe); der Massenimport von Kontakten legt viele an und trägt keine.

| Ressource | Pfad und Umfang |
| --- | --- |
| Automatisierungen | `/api/v1/automations/...`<br>Definitionen, Versionen, Trigger und die Projekte, in denen jede installiert ist; eine Definition löschen; Läufe ohne Projekt starten und auflisten. |
| Projekt-Automatisierungen | `/api/v1/projects/{id}/automations/...`<br>Installierte Automatisierungen auflisten, eine installieren oder wieder entfernen und Läufe dieses Projekts starten oder lesen. |
| Läufe | `/api/v1/runs`, `/api/v1/projects/{id}/runs` und ein einzelner Lauf unter `/api/v1/projects/{id}/runs/{runId}` oder `/api/v1/runs/{runId}`<br>Läufe über Automatisierungen hinweg auflisten; einen vollständig lesen — Status, Ausgabe, Trace, Effekte; einen laufenden mit `POST .../cancel` abbrechen und einen beendeten mit `DELETE` entfernen; die Frage eines wartenden Laufs unter `GET .../ask` lesen und unter `POST .../asks/{askId}` beantworten; Projektläufe verwenden den Projektpfad. |
| Threads | `/api/v1/projects/{id}/threads/...` oder `/api/v1/threads/...`<br>Eigene Chats innerhalb eines Projekts oder ohne Projekt: auflisten, anlegen, lesen, archivieren oder wiederherstellen, löschen, Nachrichten senden, den Turn abfragen und abbrechen. |
| Modelle | `GET /api/v1/models`<br>Konfigurierte Chat-Modelle, die dem Schlüsselbesitzer in dieser Organisation zur Verfügung stehen — dazu `harnesses`, die Coding-Harnesses, auf denen ein Projektagent laufen darf — mit `contextWindow`, `maxOutputTokens` (fehlt, wenn der Katalog keine Obergrenze nennt — dann prüft ein Senden auch keine), Fähigkeiten, optionalen `pricing`-Angaben bei veröffentlichten Katalogpreisen und `default: true` an der Wahl der Organisation, wenn eine konfiguriert und zugänglich ist. |
| Teams | `GET /api/v1/teams`<br>Jedes Team der Organisation — `id`, `name` und ob der Schlüsselbesitzer `member` ist — als vollständige Menge: die IDs, die ein Team-Publikum nimmt (`teamIds` bei einem Projekt oder Hub-Dokument, `teams` bei einem Skill). Teams werden in der App (Einstellungen > Teams) oder von einem Identitätsanbieter angelegt und besetzt; nichts auf dieser Oberfläche schreibt eines. |
| Agenten | `/api/v1/projects/{id}/agents/...`<br>Agenten im angegebenen Projekt auflisten, lesen, anlegen, ändern (bedingt, mit `expectedUpdatedAt`) und löschen. Ein `PUT`, das genau die gespeicherte Konfiguration nennt, schreibt nichts und lässt `updatedAt` in Ruhe. |
| Skills | `/api/v1/skills/...`<br>Skill-Bundles der Organisation auflisten, lesen, anlegen oder ändern und löschen; jede Datei eines Bundles lesen — ein validierter Lesezugriff (`ETag` und `Last-Modified` über die Bytes; `If-None-Match` / `If-Modified-Since` antworten **304**), ein Spiegel lädt also nur neu, was sich geändert hat. Jeder Skill nennt seine Version (`etag`, `updatedAt`), und ein Speichern lässt sich mit `If-Match` absichern; eine Versionshistorie hat ein Skill an dieser Oberfläche nicht — das Lesen antwortet nur mit dem aktuellen Bundle. |
| Wissenseinträge | `/api/v1/knowledge-entries/...`<br>Themen-Fakten: auflisten (`?topic=`, `?status=`), anlegen, ablösen, löschen, dazu der Versionsverlauf eines Themas unter `GET .../{id}/versions`. |
| Wissenssuche | `POST /api/v1/projects/{id}/knowledge/search` oder `POST /api/v1/knowledge/search`<br>Indexierte Dateien eines Projekts oder sichtbare Dokumente der Wissensdatenbank ohne Projektzuordnung und Websites durchsuchen. |
| Dokumente | `/api/v1/documents/...`<br>Dokumente der Wissensdatenbank: CRUD (ein `PATCH` antwortet mit dem aktualisierten Dokument), `GET .../content` für die Bytes, plus `POST .../retry-indexing`; jedes dateigestützte Dokument trägt seinen `indexing`-Zustand. Projektdateien tauchen hier nie auf — sie leben unter Projekte. |
| Websites | `/api/v1/websites/...`<br>Gecrawlte Quellen: CRUD (ein `PATCH` antwortet mit der aktualisierten Website) plus `.../pages` — jede Seite mit ihrem `status` (`discovered`, bis ein Abruf sie speichert, danach `active`), `failCount` und, wenn ihr letzter Versuch fehlschlug, `lastError`, `lastErrorKind` und `lastErrorAt`, sodass eine Seite, die die Abrufsperre abgelehnt hat (eine Weiterleitung auf eine private Adresse), von einer zu unterscheiden ist, die noch niemand abgerufen hat —, `.../sync` und `.../search`. Die Suche antwortet `{results, total}` — jedes Ergebnis mit `url`, `title`, `content`, `chunkIndex` und `score` —, eine eigene Form, nicht das `{hits, diagnostics}` der Endpunkte zur Wissenssuche; ihr `limit` (1–100, Standard 10) ist ein Body-Feld und wird außerhalb des Bereichs mit **400**, `INVALID_BODY`, abgewiesen — nie begrenzt. An der Website zählt `crawledPageCount` die Seiten, die der Crawler versucht hat, gespeichert oder nicht, und `failedPageCount` die, deren letzter Versuch fehlschlug; die drei Zähler stempelt der Abgleich Korpus → Zeile, der nach dem Entdecken, nach jedem gespeicherten Batch, am Ende jedes Abschnitts und am Ende des Scans läuft (`metadata.lastStatusSyncAt` sagt, wann) und den `POST .../sync` erzwingt, und `lastScannedAt` ist das Ende des letzten Scans. Das Entdecken hält sich auf jedem Weg, über den eine URL hereinkommen kann, an die `Disallow`-Regeln der `robots.txt` — gelistete URLs ausgenommen —, und eine Seite, die eine Regel abdeckt, verlässt den Index beim nächsten Scan; `POST /api/v1/websites` weist eine `http://`-Domain ab (`WEBSITE_DOMAIN_INVALID` — der Crawler wählt nur https) und lässt einen Punkt am Ende fallen, `example.com.` ist also `example.com`; das `lastError` einer Seite ist eine Zeile, die die Ursache nennt, nie das Aufrufprotokoll eines Frameworks. |
| Browser-Sessions | `/api/v1/browser-sessions/...`<br>Browser-Cookies für die [Video-Ingestion](/de/self-hosted/configuration/video-ingestion). Organisationsmitglieder dürfen die maskierte Liste lesen. `POST .../import` und `DELETE .../{id}` verlangen einen freigegebenen Deployment-Editor; `/me` nennt dies unter `capabilities.deploymentEditor`. Sitzungen gelten standardmäßig 14 Tage und höchstens 180 Tage. |
| Produkte | `/api/v1/products/...`<br>Produktkatalog-Einträge: CRUD (ein `PATCH` antwortet mit dem aktualisierten Produkt). |
| Kontakte | `/api/v1/contacts/...`<br>Kontaktdaten: CRUD (ein `PATCH` antwortet mit dem aktualisierten Kontakt) plus `POST /api/v1/contacts/bulk`. |
| Gespräche | `/api/v1/conversations/...`<br>Externe Gespräche als versionierte Snapshots in den Posteingang spiegeln, die Snapshot-Quittung einer Quelle lesen, in die Zustellwarteschlange einer Quelle schauen, native Antworten abholen, ihre Zustellung bestätigen oder als fehlgeschlagen melden, eine unzustellbar abgelegte neu anstoßen und ein gespiegeltes Gespräch einem Team zuweisen; genaue Schemas stehen unter `/docs` der laufenden Instanz. |
| Benachrichtigungen | `GET /api/v1/notifications/sync`<br>Persönliche oder sichtbare Organisationsmeldungen eines bestätigten Mitglieds exportieren; für Inhaber/Admins oder Mitglieder, denen ein Admin `tale:notifications.export` erteilt hat. Signierte Pagination, übersetzte Texte, stabile IDs und Hashes für Inhalt und Lesestatus. |
| Projekte | `/api/v1/projects/...`<br>Der Maschinenzugang für externe Worker: Projekte auflisten oder eines per externer ID nachschlagen, anlegen, archivieren und wiederherstellen, löschen; Ordner vorbereiten, Dateien hochladen, herunterladen und löschen, eine Datei sofort indexieren, Ordner löschen. |
| Aufgaben | `/api/v1/projects/{id}/tasks/...`<br>Aufgaben aus externen Referenzen idempotent anlegen, Status lesen, Workflows starten (die Antwort nennt die `runId` zum Pollen), kommentieren und die Prüfung einer Aufgabe unter `GET .../review` lesen bzw. unter `POST .../review` für ein Mitglied entscheiden, jeweils im benannten Projekt. |
| MCP | `POST /api/v1/mcp`<br>Der [MCP-Endpoint](/de/develop/mcp-endpoint) — derselbe Schlüssel, JSON-RPC statt REST. |
| Webhook-Trigger | `POST /api/projects/{id}/automations/webhook/{token}` oder `POST /api/automations/webhook/{token}`<br>Eine bereitgestellte Automatisierung per Token starten; [Webhooks](/de/develop/webhooks) erklärt URLs mit und ohne Projekt. |

Automatisierungsdefinitionen bearbeitest du über den [MCP-Endpoint](/de/develop/mcp-endpoint) oder den Editor der App: Dort kannst du sie speichern, validieren, testen und bereitstellen. Diese REST-Oberfläche bietet dafür keine Routen. `tale deploy` veröffentlicht Deployment-Konfigurationen; der Befehl ist kein REST-Endpoint zum Bearbeiten von Definitionen.

### Gleichzeitige Änderungen schützen

Sende bei einem Kontakt-, Produkt- oder Dokument-`PATCH` das zuletzt gelesene `updatedAt` als `expectedUpdatedAt`, wenn deine Änderung auf diesem Stand aufbaut. Ein veralteter Wert ergibt `409 CONTACT_STALE`, `PRODUCT_STALE` oder `DOCUMENT_STALE`. Lade die Ressource erneut, führe deine Änderung mit der zwischenzeitlichen Bearbeitung zusammen und sende die neue Vorbedingung.

Hub-Dokumente unterstützen zusätzlich `If-Match`: Sende den starken `ETag` aus dem `GET` des Dokuments. Der Vergleich erfolgt innerhalb derselben Transaktion wie die Änderung. Passt der Tag nicht mehr, folgt `412 PRECONDITION_FAILED` mit dem aktuellen Tag in `data.etag`; nichts wird geschrieben. Eine Liste von Tags oder `*` ist erlaubt. Ein schwacher `W/`-Tag passt nie. Der Tag umfasst die gesamte Antwort einschließlich `indexing`; der Indexierungsfortschritt kann ihn daher ändern, ohne das `updatedAt` der Dokumentzeile zu verändern.

Ein erfolgreicher Kontakt-, Produkt-, Dokument- oder Website-`PATCH` liefert `200` mit der aktualisierten Ressource; ein Dokument-`PATCH` trägt außerdem den `ETag` der neuen Darstellung, den Wert, den das nächste `If-Match` sendet. Bleiben bei einem Kontakt, Produkt, Dokument oder Projekt alle gespeicherten Werte gleich, schreibt Tale nichts und bewahrt `updatedAt`. Vorbedingungen werden zuerst geprüft: Auch ein unveränderter Body umgeht kein veraltetes `expectedUpdatedAt` oder `If-Match`.

### Kontakte, Produkte und Website-Identität bearbeiten

Für Kontakte und Produkte gelten dieselben Grundregeln beim Bearbeiten. Tale entfernt äußere Leerzeichen aus Strings und speichert Kontakt-E-Mails in Kleinbuchstaben. Der Teil vor `@` darf höchstens 64 Zeichen haben. Diese Duplikate werden beim Anlegen und bei `PATCH` mit **409** abgewiesen:

| Ressource | Bereits vorhandener Wert | Code |
| --- | --- | --- |
| Kontakt | `email`, unabhängig von Groß- und Kleinschreibung | `CONTACT_DUPLICATE_EMAIL` |
| Kontakt | `externalId` | `CONTACT_DUPLICATE_EXTERNAL_ID` |
| Produkt | `name`, unabhängig von Groß- und Kleinschreibung | `DUPLICATE_PRODUCT_NAME` |
| Produkt | `externalId` | `DUPLICATE_PRODUCT_EXTERNAL_ID` |

`null` leert ein optionales Feld. Bei `PATCH` wird auch ein leerer String als `null` behandelt. Ein leeres Pflichtfeld, etwa der Produktname, ergibt **400** `INVALID_BODY`. Beim Anlegen und Massenimport gelten leere Strings — und `null` — dagegen als ausgelassene Felder, eine CSV-Zeile oder ein JSON-Export importiert also sauber (das OpenAPI-Dokument deklariert die optionalen Felder des Anlegens deshalb als nullable). Der Massenimport verlangt mindestens einen Kontakt; `contacts: []` ergibt **400** `INVALID_BODY`.

Ein Kontakt benötigt mindestens eines der Felder `name`, `email` oder `externalId`. Ein `PATCH`, der das letzte dieser Identitätsfelder entfernt, ergibt **400** `CONTACT_IDENTITY_REQUIRED`.

Werte einen Kontakt-Sammelimport zeilenweise aus. `POST /api/v1/contacts/bulk` erwartet ausschließlich `contacts`, ein Array mit 1–500 Zeilen. Die Zeilen werden einzeln geprüft; auch bei einzelnen Fehlern lautet die Antwort `201`:

| Antwortfeld | Verwendung |
| --- | --- |
| `success`, `failed` | Anzahl angenommener und abgewiesener Zeilen |
| `created[]` | `id` jedes angelegten Kontakts und sein ursprünglicher, bei null beginnender `index` |
| `errors[]` | Ursprünglicher `index` und `contact`, lesbarer `error`, stabiler `errorCode` sowie feldbezogene `issues` bei Schemafehlern |

Eine ungültige E-Mail, ein unbekannter Zeilenschlüssel oder eine fehlende Identität ergibt einen Zeilenfehler mit `INVALID_BODY`. Duplikate haben eigene Codes. Korrigiere nur die fehlgeschlagenen Zeilen und sende diese erneut. Eine ungültige äußere Struktur, überschrittene Transportgrenzen oder fehlerhafte JSON-Kodierung weisen weiterhin die gesamte Anfrage vor der Zeilenverarbeitung ab.

Der Filter `source` der Kontaktliste akzeptiert dieselbe feste Auswahl wie Schreiboperationen, darunter `manual_import`, `api_import`, `shopify`, `hubspot`, `webhook` und `custom`. Die vollständige Auswahl steht im OpenAPI-Schema der Instanz. Ein anderer Wert führt zu `400 INVALID_QUERY`.

Für `metadata` verwenden Kontakte, Produkte und Dokumente JSON Merge Patch nach RFC 7396: Gesendete Schlüssel werden gesetzt, ausgelassene bleiben erhalten und Schlüssel mit dem Wert `null` werden entfernt. `metadata: null` leert das gesamte Feld. `address` wird dagegen vollständig ersetzt.

Für `address` und `metadata` gelten jeweils höchstens 64 KiB JSON, 8 Verschachtelungsebenen und insgesamt 500 Schlüssel. Größere oder tiefere Werte ergeben **400** `INVALID_BODY` mit dem betroffenen Pfad.

Die `currency` eines Produkts ist ein ISO-4217-Code wie `USD` oder `EUR`; Tale akzeptiert jede Groß-/Kleinschreibung und speichert Großbuchstaben. `imageUrl` muss eine absolute HTTP- oder HTTPS-URL mit öffentlichem Host sein. Relative Pfade, andere Protokolle, private oder Loopback-IP-Adressen, Hostnamen ohne Domain und Cloud-Metadatenhosts ergeben `400 INVALID_BODY`. Die Prüfung liest nur die URL, löst kein DNS auf und ruft das Bild nicht ab. Die Betreibereinstellung `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` erlaubt private Netzwerkziele, jedoch niemals Metadatenhosts.

Für ein über das Produktformular hochgeladenes Bild gilt ein eigener Ablauf. Die App nimmt PNG-, JPEG-, WebP-, GIF- und SVG-Dateien bis 5 MiB an, prüft ihren Inhalt und liefert eine dauerhaft nutzbare, geschützte URL. REST-Leseantworten geben diese Adresse als absolute URL zurück. Du kannst sie in `imageUrl` erneut übermitteln, auch bei einer privaten Bereitstellung: Das Bild muss zur selben Organisation gehören und entweder von dir hochgeladen worden sein oder bereits von einem vorhandenen Produkt verwendet werden. Ein fehlendes oder nicht zugängliches Bild ergibt `404 FILE_NOT_FOUND`, eine veränderte verwaltete URL `400 INVALID_BODY`. Zum Abrufen der Bilddaten brauchst du eine berechtigte App-Sitzung. Die URL ist kein öffentlicher Freigabelink; ein REST-API-Schlüssel gewährt keinen Zugriff auf diese App-Route. Mit `imageUrl: null` in PATCH entfernst du das Bild vom Produkt. Die Bilddatei lädst du über das App-Formular hoch; einen REST-Endpunkt für Produktbilduploads gibt es nicht.

Die `domain` einer Website ist unveränderlich: `PATCH /api/v1/websites/{id}` akzeptiert den gespeicherten Wert als Echo (ein Client darf die Ressource senden, die er gelesen hat) und antwortet auf jeden anderen mit **400**, `WEBSITE_DOMAIN_IMMUTABLE`.

`POST /api/v1/websites` speichert den Host so, wie er kommt — `www.` bleibt erhalten —, und die Schreibweisen mit `www.` und ohne (Apex) zählen als eine Site: Eine Domain, die unter einer der beiden schon registriert ist, ergibt **409**, `WEBSITE_DUPLICATE_DOMAIN`, mit `data.websiteId` und `data.domain` für die bestehende Zeile.

Eine Ausnahme gilt für URL-Listen: Ist die Domain bereits als Liste registriert und stimmt ihre Schreibweise exakt überein, erweitert ein erneuter Aufruf diese Liste und liefert **200** mit derselben ID. Eine URL-Liste kann keinen bestehenden vollständigen Website-Crawl ersetzen; das ergibt **409** und reiht nichts ein. Prüfe vor dem Aufruf `kind` und verwende die Domain-Schreibweise aus der bestehenden Ressource oder der Konfliktantwort.

Der `status` einer Website beschreibt den Scan. `GET /api/v1/websites?status=` akzeptiert `scanning` (hier beginnt eine registrierte Website), `active`, `error` oder `deleting`; andere Werte ergeben `400 INVALID_QUERY`, ebenso `?scanInterval=` außerhalb seiner sieben Werte. `active` bedeutet, dass nach dem abgeschlossenen Scan mindestens eine Seite gespeichert ist. Es bedeutet nicht, dass alle Seiten aktualisiert wurden. Bei einem fehlgeschlagenen Scan oder wenn nach den Abrufversuchen keine gespeicherten Seiten verbleiben, lautet der Status `error`; lies dazu `metadata.lastSyncError`.

Das `lastErrorKind` einer Seite unterscheidet Netzwerk- und TLS-Probleme (`network_error`, `tls_error`), abgewiesene Ziele (`private_ip`), HTTP-Fehler (`http_error`), Extraktions- oder Darstellungsfehler, nicht in Text umwandelbare Inhalte (`unsupported_content`) und eine `robots_noindex`-Ablehnung — der Ursprung hat mit `X-Robots-Tag: noindex` geantwortet oder die Seite trägt ein `<meta name="robots" content="noindex">`-Tag. Nach einer fehlgeschlagenen Aktualisierung kann älterer indexierter Inhalt erhalten bleiben. Prüfe deshalb neben dem Website-Status auch die Seitenfehler.

`POST /api/v1/websites/{id}/search` sucht mit Stichwörtern in den gespeicherten Textabschnitten dieser Website. Der BM25-`score` hat keine feste Obergrenze und lässt sich nur innerhalb einer Antwort vergleichen. Ohne ParadeDB verwendet die Instanz eine Teilstringsuche und liefert bei jedem Treffer `0`. Für semantische Ähnlichkeit und `minSimilarity` verwende `POST /api/v1/knowledge/search` mit `corpus: "web"`. Das durchsucht den sichtbaren Webbestand, nicht nur eine ausgewählte Website.

### Skill-Pakete speichern und abgleichen

`PUT /api/v1/skills/{slug}` legt ein neues Bundle an (**201**) oder aktualisiert das vorhandene (**200**). Für einen Abgleich brauchst du deshalb keinen vorgelagerten Existenztest. `description` und `body` sind Pflicht. Für optionale Felder gilt:

- Ausgelassene `icon`, `labels`, `teams`, `visibility` und `disableModelInvocation` behalten ihre gespeicherten Werte.
- `null` leert `icon` oder `labels`.
- `disableModelInvocation: false` entfernt dieses Flag.

`body` enthält Markdown mit höchstens 507.893 UTF-8-Bytes. Die Grenze lässt Platz für Frontmatter innerhalb der maximal 512 KiB großen `SKILL.md`. Fehlt ein abschließender Zeilenumbruch, hängt Tale einen an; ein späterer Abruf kann deshalb ein Byte mehr enthalten.

Beim Speichern wird nur `SKILL.md` neu geschrieben. Andere Bundle-Dateien und zusätzliche Frontmatter-Schlüssel wie `license`, `recommended-packages` oder Community-Erweiterungen bleiben erhalten. Zum Ersetzen eines vollständigen Bundles verwendest du den ZIP-Upload der App.

Jeder Skill enthält `etag`, den in Anführungszeichen gesetzten SHA-256-Hash seiner `SKILL.md`, und `updatedAt`, den letzten Schreibzeitpunkt dieser Datei. Änderungen anderer Bundle-Dateien verändern diese Versionsangaben nicht.

Ist die zusammengesetzte `SKILL.md` bytegleich mit der gespeicherten Datei, bleibt sie unverändert. Tale liefert **200** mit dem bisherigen `etag` und `updatedAt` und legt keinen Verlaufseintrag an. Vorbedingungen werden trotzdem geprüft: Ein veraltetes `If-Match` ergibt auch bei identischem Inhalt **412**.

`GET /api/v1/skills/{slug}` trägt den Tag als `ETag` und antwortet **304** auf ein `If-None-Match`, das ihn nennt — die schwache Form `W/"…"` und die `"…-gzip"`-Form des Edge eingeschlossen —, mit demselben `Cache-Control: private, no-cache` wie seine **200**. `GET /api/v1/skills` antwortet außerdem mit `failures` — Bundles auf der Platte, die sich nicht lesen ließen, jedes mit `slug`, `path` und `message`; normalerweise ein leeres Array —, eine Liste scheitert also nie daran, dass ein Bundle kaputt ist.

Sende beim Aktualisieren oder Löschen das zuletzt gelesene `etag` als `If-Match`. Hat sich die Datei geändert, folgt **412** `SKILL_STALE` mit dem aktuellen Tag in `data.etag`. Es wird nichts geschrieben. Ein geschütztes `PUT` auf einen Skill, den es nicht gibt, ergibt dieselbe **412** mit `data.etag: null`; ein geschütztes `DELETE` auf einen solchen Skill ergibt schlicht **404** `SKILL_NOT_FOUND` — was schon weg ist, ist erledigt. Lade den aktuellen Inhalt und führe die Änderungen zusammen, bevor du erneut speicherst.

Für diese Schreibprüfung ist ein starker Tag erforderlich; `W/"…"` passt nicht. Die Anfragevalidierung findet vor der Vorbedingungsprüfung statt. Mit `If-None-Match: *` erlaubst du ausschließlich das Anlegen: Ein bereits vorhandenes Bundle ergibt **412** `SKILL_EXISTS`.

`GET /api/v1/skills/{slug}/files/{path}` liest jede Datei des Bundles — `SKILL.md` eingeschlossen — als rohe Bytes, benannt über `Content-Disposition`, mit `path` genau so, wie `files[].path` es listet (`/` roh oder als `%2F`); der Lesezugriff ist validiert — der `ETag` sind die Bytes der Datei, `Last-Modified` ihre Änderungszeit, und `If-None-Match` oder `If-Modified-Since` antwortet **304** —; ein Pfad, den die Liste nie tragen würde, ergibt **404**, `SKILL_FILE_NOT_FOUND`, und ein Bundle, das die Dateischicht ablehnt — ein eingeschleuster Symlink, eine Datei über der Staging-Grenze von 4 MiB — **422**, `SKILL_MALFORMED`.

Ein rohes Punktsegment in der URL (`../`, oder `%2e%2e/` — die Punkte kodiert, der Schrägstrich nicht) erreicht die Route nie: Der Edge weist es zuerst ab, mit einer eigenen **404**, `NOT_FOUND`, einer eigenen `X-Request-Id` und ohne `X-Tale-Api-Version`; eine Schreibweise, in der auch die Schrägstriche kodiert sind (`%2e%2e%2f…`), erreicht die Route und wird als `SKILL_FILE_NOT_FOUND` gelesen. Jeder Skill trägt `canEdit` — ob dieser Schlüssel das Bundle bearbeiten darf; mitgelieferte Skills sind Organisations-Bundles, die ein Administrator überschreiben darf —, prüfe es also vor einem Speichern, das eines ersetzen soll. Skills unterstützen die Sichtbarkeit `org` und `team`; `teams` muss Teams dieser Organisation benennen.

Die Sichtbarkeit `private` gibt es für Skills nicht mehr: setzen lässt sie sich nicht, und ein Bundle, das sie noch trägt, behält sie nur, wenn das Speichern `visibility` weglässt. Ein Slug hat höchstens 64 Zeichen aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen, und `anthropic` und `claude` sind reserviert; `PUT` weist einen fehlerhaften mit **400**, `INVALID_SKILL_SLUG`, ab und nennt die verletzte Regel, während `GET` und `DELETE` ihn als nicht vorhanden mit **404**, `SKILL_NOT_FOUND`, beantworten.

### Konversationen spiegeln und Antworten zustellen

Lege zuerst den Kontakt mit `POST /api/v1/contacts` an. Ein Konversations-Snapshot verweist über `externalContactId` auf dessen `externalId` in derselben Organisation. Fehlende Kontakte ergeben **404** `CONTACT_NOT_FOUND`, mehrdeutige Zuordnungen **409** `CONTACT_AMBIGUOUS`. Ein bereits gespiegeltes Quellgespräch lässt sich nicht einem anderen Kontakt zuordnen; eine abweichende `externalContactId` ergibt **409** `CONVERSATION_CONTACT_CONFLICT`.

`POST /api/v1/conversations/sync` verarbeitet die ganzzahlige `version` nach diesen Regeln:

| Eingang | Ergebnis |
| --- | --- |
| Neuere Version | Snapshot übernehmen. |
| Ältere Version | Snapshot ignorieren. |
| Gleiche Version, anderer Inhalt | **409** `CONVERSATION_SNAPSHOT_CONFLICT`. |
| `deleted: true`, Version mindestens so hoch wie gespeichert | Spiegelung schließen; Wiederholung nach dem Schließen ändert nichts. |

Das Schließen behält Gespräch und Nachrichten im Posteingang. Diese API löscht sie nicht endgültig.

Antworten aus dem Tale-Posteingang holst du über `POST /api/v1/conversations/deliveries/claim` ab. Willst du eine solche Antwort später im Snapshot zurückmelden, setze `taleMessageId` auf ihre `messageId` und bestätige zuvor die Zustellung unter ihrer `externalId`. Andernfalls folgt **409** `DELIVERY_UNACKNOWLEDGED`. Ohne `taleMessageId` gilt eine Nachricht als Nachricht des Quellsystems, unabhängig von `isCustomer`.

Ein Claim muss eine von dir gespiegelte Quelle benennen. Eine unbekannte Quelle ergibt **404** `CONVERSATION_SOURCE_NOT_FOUND`; eine Quelle, die ausschließlich anderen Service-Benutzern gehört, **403** `INTEGRATION_NOT_OWNED`. Eine falsche Quelle liefert somit keine irreführend leere Warteschlange.

Abgeholte Zustellungen enthalten `attempts`, `leaseExpiresAt`, `lastErrorCode` und `firstClaimedAt`. Mit `GET /api/v1/conversations/deliveries?source=` liest du die Warteschlange, ohne eine Zustellung zu übernehmen. Die Antwort enthält Status (`queued`, `leased`, `failed`, `delivered`), Versuchszahl und Zeitstempel, aber weder Claim-Token noch Nachrichteninhalt. Die am längsten fälligen Einträge stehen zuerst in `{deliveries, isDone, continueCursor}`; verwende `?cursor=` für Folgeseiten.

`?status=failed` beschränkt die Liste auf unzustellbare Antworten. `POST /api/v1/conversations/deliveries/{id}/retry` stößt eine solche Zustellung erneut an und wird wie die entsprechende Aktion im Posteingang protokolliert. Für andere Zustellungen folgt **409** `DELIVERY_RETRY_UNAVAILABLE`.

Mit `POST /api/v1/conversations/assignment` weist du ein gespiegeltes Gespräch einem Team zu: `{source, externalId, teamId}`, wobei `teamId` aus `GET /api/v1/teams` stammt und `null` die Zuweisung aufhebt. Die Mitglieder des Teams können das Gespräch danach im Posteingang öffnen und werden benachrichtigt. Wie im Posteingang dürfen nur Schlüssel von Admins und Inhabern zuweisen; ein Schlüssel mit Bearbeitungsrechten erhält **403** `ROLE_FORBIDDEN` und kann seine Quelle stattdessen über eine [Routing-Regel](/de/platform/admin/governance/policies-and-limits) zuordnen. Ein Team außerhalb der Organisation ergibt **400** `TEAM_NOT_IN_ORG`, ein Spiegel ohne Snapshot **404** `CONVERSATION_NOT_FOUND` und einer, der einem anderen Dienstnutzer gehört, **403** `INTEGRATION_NOT_OWNED`.

Bereite Anhänge vor dem Snapshot über `POST /api/v1/conversations/uploads` vor. Ungültige Anhänge verhindern die Übernahme:

| Problem | Antwort |
| --- | --- |
| Nicht vorbereitete, abgelaufene, ungültige oder organisationsfremde `storageId` | **400** `ATTACHMENT_NOT_STAGED`. |
| Von einem anderen Service-Benutzer derselben Organisation vorbereiteter Anhang | **403** `ATTACHMENT_NOT_OWNED`. |
| Deklarierte `size` weicht von den hochgeladenen Bytes ab | **400** `ATTACHMENT_SIZE_MISMATCH`. |

`replyConstraints` begrenzt Textlänge, Anzahl und Größe der Anhänge sowie Dateiendungen für Antworten, die Personen im Posteingang verfassen. Diese Grenzen werden beim Antworten durchgesetzt, nicht beim Einlesen eines Snapshots.

`GET .../deliveries/{id}/attachments/{index}` liefert `DELIVERY_NOT_FOUND`, wenn keine abgeholte Zustellung mit dieser ID existiert. Eine fehlende Anhangposition oder ein Index außerhalb der ganzen Zahlen von 0 bis 9 ergibt `ATTACHMENT_NOT_FOUND`.

Nicht gebundene vorbereitete Uploads werden automatisch bereinigt: nach dem Zwei-Stunden-Fenster plus 24 Stunden Karenz, beim nächsten Upload in derselben Organisation. Eine Löschroute dafür gibt es nicht. Gebundene Anhänge bleiben so lange erhalten wie ihre Nachricht. Alle Anfrageinhalte dieser Familie sind strikt; unbekannte Schlüssel, auch innerhalb von Nachrichten oder Anhängen, ergeben **400** `INVALID_BODY` mit dem Feldnamen.

`GET /api/v1/conversations/sync` nennt außerdem die gebundene `externalContactId`, die `contactId` der gebundenen Zeile und `contactStatus`: `active`, `trashed` oder `missing` — sowie `sourceDeleted` mit dem Inbox-`status`, damit eine Engine, die von der Quittung aus weitermacht, einen gelandeten Abbau erkennt: Ein Inhalts-Snapshot auf einen abgebauten Spiegel antwortet in jeder Version **409** `CONVERSATION_CLOSED` (spiegle die Quellunterhaltung unter einer neuen `externalId`, um neu zu beginnen). Die Bindung behält die ursprüngliche Kontaktzeile. Ein gelöschter Kontakt liegt im Papierkorb; seine E-Mail und externe ID werden wieder frei. Ein neuer Kontakt mit denselben Kennungen übernimmt jedoch niemals den alten Konversationsverlauf. Ein im CRM umgeschlüsselter Kontakt (ein `PATCH` seiner `externalId`) behält dagegen seine Unterhaltungen: Ein Snapshot, der die aktuelle ID nennt, greift, und die Quittung folgt ihr, während die ID, die er nicht mehr trägt, **409** `CONVERSATION_CONTACT_CONFLICT` ergibt und die ID nennt, an die die Unterhaltung gebunden ist. `GET /api/v1/conversations?source=` listet jede Unterhaltung, die du unter einer Quelle gespiegelt hast — `conversationId`, `externalId`, `externalContactId`, `contactId`, `contactStatus`, `version`, `sourceDeleted`, `status`, `subject` —, neueste zuerst als Keyset-Seite unter `conversations` (dieselbe `?cursor=`-Schleife wie bei jeder Liste), und `?contactStatus=trashed` findet die Spiegel, die ein gelöschter Kontakt eingefroren hat.

Ein neuerer Inhalts-Snapshot für einen Kontakt im Papierkorb ergibt `409 CONVERSATION_CONTACT_TRASHED`. Stelle den Kontakt wieder her — mit `POST /api/v1/contacts/{id}/restore`, das nach der Regel des Anlegens arbeitet (ein lebender Kontakt, der seitdem seine E-Mail oder `externalId` übernommen hat, weist die Wiederherstellung mit der **409** des Anlegens ab), oder über den Papierkorb der App —, bevor du weiteren Inhalt sendest, oder beende die Spiegelung mit `deleted: true` und einer gleichen oder höheren Version; eine beendete Spiegelung öffnet die Wiederherstellung nicht wieder, ein späterer Inhalts-Snapshot ergibt also dieselbe 409, solange der Kontakt im Papierkorb bleibt. Ältere Snapshots bleiben ignoriert, und für Wiederholungen derselben Version gelten weiterhin die Versionsregeln oben. Das Löschen macht also nicht jede Wiederholung zu einem Fehler.

### Durchsuchbares Wissen und Hub-Dokumente erstellen

`POST /api/v1/documents` kann Text direkt als `content` speichern. Dieser Inline-Inhalt bleibt lesbar, wird aber nicht indexiert. Die Wissenssuche findet nur dateigestützte Dokumente. `POST .../retry-indexing` liefert deshalb bei Inline-Dokumenten `{"status": "skipped", "reason": "content-only"}`.

Weitere Gründe für `skipped` sind `untracked-blob`, `unsupported` (dauerhafter Indexierungsfehler; siehe `indexing.errorCode`) und `in-progress` (ein frischer Indexierungsjob wartet bereits oder läuft). Frage im letzten Fall den Dokumentzustand erneut ab. Für eine bisher von der Indexierung ausgenommene Datei hebt ein Retry diese Ausnahme auf und liefert `indexing`.

Eine Projektdatei gehört nicht zu dieser Schnittstelle — sie ergibt **404**, `DOCUMENT_NOT_FOUND`, wie jede ID außerhalb der Wissensdatenbank —, hat aber denselben Retry unter `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`, der die beim Binden gesetzte Abmeldung `skipRagIndexing` aufhebt (siehe **Prüfen, was angekommen ist** unten). Der eine wie der andere Retry läuft durch dieselben Schutzmechanismen wie **Jetzt indexieren** in der App, ein Budget von 10 pro Benutzer und Minute eingeschlossen (**429**, `RATE_LIMITED`). Die Alternative `fileId` verlangt einen noch ungebundenen Upload für die Wissensdatenbank, den der Schlüsselbesitzer selbst in der ausgewählten Organisation über die App angelegt hat. REST erstellt keinen solchen Upload.

Für durchsuchbaren Text verwendest du `POST /api/v1/knowledge-entries`. Tale erstellt ein dateigestütztes Dokument mit `sourceProvider: knowledge` und startet die Indexierung. Erlaubt sind höchstens 8.000 Zeichen und ein aktiver Eintrag pro Thema. Die Antwort **201** `{id, documentId}` enthält bereits die Dokument-ID; frage damit `GET /api/v1/documents/{documentId}` ab, bis die Indexierung abgeschlossen ist.

Ein `PATCH` ersetzt den aktiven Eintrag durch eine neue Version und indexiert unter derselben `documentId` erneut. Sind `topic` und `content` nach dem Trimmen unverändert, entsteht keine Version; die Antwort nennt die vorhandene Eintrags-ID. Ein `PATCH` auf eine abgelöste Zeile ergibt **409**, `KNOWLEDGE_ENTRY_SUPERSEDED`, und nennt in `data.activeId` die aktive Zeile des Themas (in `data.supersededBy` ihre direkte Nachfolgerin) — ändere diese Zeile, ohne die Kette entlangzuhangeln. Ein Eintrag, der über diese Tür angelegt oder abgelöst wird, trägt `source: "api"` (das Formular der App schreibt `manual`, das Festhalten durch den Assistenten `chat`), sodass die Tabelle der Wissenseinträge die drei auseinanderhält. Ein Löschen verschiebt das zugehörige Dokument in den Papierkorb.

Die Endpunkte für Wissenseinträge benötigen das Schreibrecht für Wissen — ein Mitglied mit Leserechten ergibt **403**, `KNOWLEDGE_ENTRY_FORBIDDEN` —, und ein Objektspeicher, der den Inhalt nicht binnen 30 Sekunden annimmt, ergibt **503**, `KNOWLEDGE_ENTRY_STORE_TIMEOUT`, ohne dass etwas geschrieben wird. Dieses Dokument verweigert ein direktes `DELETE /api/v1/documents/{id}` und ein `PATCH` seines Titels oder Inhalts mit **409**, `DOCUMENT_HAS_KNOWLEDGE_ENTRY` und `data.entryId` — der Eintrag ist der Weg, es zu ändern. `GET /api/v1/knowledge-entries?topic=<topic>&status=superseded` listet die abgelösten Versionen eines Themas, jede mit `supersededAt` gestempelt, und `GET /api/v1/knowledge-entries/{id}/versions` antwortet mit der ganzen Kette von jeder ihrer Zeilen aus, die neueste zuerst.

`GET /api/v1/documents` listet Hub-Dokumente mit den neuesten zuerst. Wenn du die Ordneransicht der App nachbildest, wähle den Bereich ausdrücklich:

| Abfrageparameter `folderId` | Zurückgegebene Dokumente |
| --- | --- |
| Nicht angegeben | Alle sichtbaren Hub-Dokumente, auch innerhalb von Ordnern. |
| `root` | Nur Dokumente, die in keinem Ordner liegen. |
| Eine Ordner-ID | Dokumente direkt in diesem Ordner. |

`GET /api/v1/documents/{id}/content` liefert den Inhalt mit denselben Download-Funktionen wie Projektdateien: `Content-Disposition`, `Range` und `HEAD`. Bei Inline-Dokumenten liefert die Route den Text mit dem gespeicherten `mimeType`. Die Metadatenroute `GET /api/v1/documents/{id}` enthält `content` nur für Inline-Inhalt; bei dateigestützten Dokumenten ist es `null`.

`contentHash` ist ein eigenes Antwortfeld, kein Schlüssel in deinen `metadata`. Es enthält den SHA-256-Hash, sofern Tale ihn für den Inhalt berechnet hat, etwa bei Wissenseinträgen und synchronisierten Dateien; andernfalls ist es `null`.

Ein Dokument-`PATCH`, der nichts ändert — ein leerer Body, oder jedes Feld schon auf seinem Wert —, schreibt nichts und lässt `updatedAt` in Ruhe, ein wiederholter No-op macht also nie das `expectedUpdatedAt` eines anderen Clients ungültig; Inhalt, MIME-Typ, Erweiterung oder Quellanbieter eines kontrollierten Records werden mit **400**, `DOCUMENT_RECORD_FROZEN` (in Prüfung oder freigegeben) oder `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` (ein Entwurf — nimm den Ersetzungs-Ablauf), abgewiesen, und ein Eintrag in `teamIds`, dessen Team der Schlüsselbesitzer nicht angehört, mit **403**, `TEAM_ACCESS_DENIED` (ein Team, das nicht zur Organisation gehört, mit **400**, `TEAM_NOT_IN_ORG`; eine wiederholte ID fällt auf eine zusammen).

Jedes dateigestützte Dokument trägt `indexing` — `status` ist `pending`, `queued`, `running`, `completed`, `failed`, `unsupported` oder `skipped`, mit `indexedAt`, `error` und `errorCode`, sobald gesetzt —, polle das Dokument nach dem Anlegen oder einem `retry-indexing` also, statt zu schlafen. Bereits an ein Dokument, einen Thread oder ein Gespräch gebundene Uploads lassen sich hier nicht erneut verwenden. Fehlende Uploads, Uploads anderer Benutzer und gebundene Uploads ergeben **404**, `FILE_NOT_FOUND`. Projekt-, Chat- und Gesprächsuploads können über diese Route nicht zu Dokumenten der Wissensdatenbank werden. Gelöschte oder abgelaufene Dokumente, auch Dateien, die zusammen mit ihrem Projekt gelöscht wurden, erscheinen hier nicht. Dateien, die du beim Löschen eines Projekts in die Wissensbibliothek verschiebst, bleiben dort verfügbar.

Die Inhalte von `POST` und `PATCH` sind strikt: Ein `projectId` ergibt **400**. Projektdateien legst du über die Upload- und Dateirouten des Projekts an.

Verzweige nach `indexing.errorCode`, nicht nach dem Wortlaut von `error`. Das OpenAPI-Schema enthält diese feste Auswahl:

| Status und Codes | Nächster Schritt |
| --- | --- |
| `unsupported`: `unsupported_type`, `image_no_vision`, `empty`, `not_text`, `malformed` | Ersetze die Quelle oder exportiere sie in einem unterstützten Format. Bei `not_text` brauchst du tatsächlichen UTF-8-Text. `malformed` bezeichnet derzeit ein unlesbares PDF; beschädigte Office-Dateien können stattdessen `indexer_error` liefern. Die Retry-Route überspringt dauerhafte Codes auch bei älteren Zeilen mit Status `failed`. |
| `failed`: `embedding_upstream`, `indexer_error`, `index_rebuilding` | Der Hintergrundauftrag wiederholt diese Fehler. Prüfe den Status, bevor du selbst erneut anstößt. |
| `failed`: `embedding_not_configured`, `embedding_provider_refused`, `index_repair_failed` | Lass Anbieter-Konfiguration, Berechtigungen oder Indexzustand vom Betreiber korrigieren und versuche es danach erneut. `embedding_provider_refused` deckt auch ein Modell ab, das Vektoren mit einer anderen Breite liefert, als die Einstellungen angeben; das Speichern korrigierter Embedding-Einstellungen stellt jedes Dokument, das am Embedding-Modell gescheitert ist, erneut in die Warteschlange. |
| `failed`: `secret_detected`, `pii_blocked` | Korrigiere die Quelle oder die freigegebene Inhaltsrichtlinie der Organisation vor dem nächsten Versuch. |

## Benachrichtigungen eines Mitglieds spiegeln

`GET /api/v1/notifications/sync` exportiert die Benachrichtigungen, die ein bestimmtes Mitglied sehen darf. Die Route ist seit API-Vertrag 1.8.0 verfügbar und eignet sich für eine einseitige Synchronisierung in eine andere Anwendung. Der API-Schlüssel muss einem Inhaber oder Admin der ausgewählten Organisation gehören oder einem Mitglied, dem ein Admin die Berechtigung `tale:notifications.export` erteilt hat (seit API-Vertrag 1.14.0). Eine andere Rolle allein reicht nicht, auch nicht die Entwicklerrolle.

### Export ohne Admin-Rolle delegieren

Ein Dienst, der Benachrichtigungen spiegelt, braucht kein Admin-Konto. Mit der Admin-Rolle lassen sich auch Mitglieder, Single Sign-on und SCIM verwalten und Passwörter rangniedrigerer Mitglieder zurücksetzen. Betreibe den Dienst deshalb als gewöhnliches Mitglied und erteile diesem Mitglied genau die Berechtigung, die der Export prüft. Sie ist ein Eintrag im Kompetenzregister der Organisation: Sie gilt nur in dieser Organisation, wird protokolliert, kann ein Ablaufdatum haben und wird automatisch widerrufen, wenn ein Admin das Mitglied entfernt oder dein Identitätsanbieter die Mitgliedschaft per SCIM aufhebt.

Ein Inhaber oder Admin erteilt sie unter **Einstellungen > Richtlinien > Kompetenzen** ([Kompetenzen](/de/platform/admin/governance/competences)) oder per HTTP aus einer aktiven Sitzung. `TALE_ORIGIN` ist der Ursprung deiner Tale-Instanz, `TALE_SESSION_COOKIE` der Cookie-Header dieser Sitzung. `TALE_ORG_ID` und `TALE_WORKER_USER_ID` sind die Werte `organization.id` und `user.id`, die `GET /api/v1/me` für den Schlüssel des Dienstes liefert:

```bash
GRANT_BODY=$(jq -n --arg user "$TALE_WORKER_USER_ID" \
  '{userId:$user,competence:"tale:notifications.export",evidence:"Notification mirror worker"}')
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/governance/competences?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$GRANT_BODY"
```

Die Antwort ist **201** mit `{ "recordId": "…" }`. Mit `expiresAt` in Unixzeit-Millisekunden endet die Berechtigung von selbst; ohne das Feld läuft sie nicht ab. Solange eine Berechtigung gültig ist, liefert eine erneute Erteilung **409** `COMPETENCE_ALREADY_GRANTED`. Ein anderer Name unter `tale:` liefert **400** `COMPETENCE_CAPABILITY_UNKNOWN`, ein Benutzer außerhalb der Organisation **400** `COMPETENCE_USER_NOT_MEMBER` und eine Sitzung ohne Inhaber- oder Admin-Rolle **403** `COMPETENCE_FORBIDDEN`. Prüfe vor der ersten Seite mit dem Schlüssel des Dienstes, dass `GET /api/v1/me` `capabilities.notificationExport: true` meldet.

Um die Berechtigung zu entziehen, suche mit derselben Sitzung ihre `id` in `GET /api/app/governance/competences?orgId=<orgId>&userId=<userId>` und sende `POST /api/app/governance/competences/<recordId>/revoke?orgId=<orgId>`. Die nächste Exportanfrage des Dienstes liefert `403 ROLE_FORBIDDEN`. Ein widerrufener Eintrag bleibt als Prüfpfad in der Liste; erteile die Berechtigung neu, um den Export wieder zu erlauben.

### Empfänger und Datenstrom wählen

Setze `TALE_RECIPIENT_EMAIL` auf die bestätigte E-Mail-Adresse des gewünschten Mitglieds. Es muss genau eine passende aktive Mitgliedschaft in der Organisation geben. Die Route prüft Mitgliedschaft und E-Mail-Bestätigung bei jeder Seite erneut. Für Organisationsbenachrichtigungen gelten die Sichtrechte der empfangenden Person: Ein Admin-Schlüssel exportiert keine Sicherheitsmeldungen, die diese Person in Tale nicht sehen dürfte.

| Query-Parameter | Regel |
| --- | --- |
| `recipientEmail` | Gültige E-Mail-Adresse als Pflichtfeld, höchstens 320 Zeichen. Der Abgleich ignoriert Groß- und Kleinschreibung. |
| `stream` | Pflichtfeld: `personal` für persönliche Meldungen oder `organization` für sichtbare Organisationsmeldungen. Für eine vollständige Spiegelung musst du beide getrennt lesen. |
| `locale` | Optional `en`, `de` oder `fr`. Ohne Angabe gilt die Organisationssprache; fehlende Meldungstexte werden aus Englisch ergänzt. |
| `limit` | Standard und Höchstwert 100, Mindestwert 1. Ganze Zahlen außerhalb des Bereichs werden auf die Grenze begrenzt. |
| `cursor` | Bei der ersten Anfrage weglassen, danach den vorherigen `continueCursor` unverändert senden. Ein numerischer `offset` wird nicht unterstützt. |

```bash
curl --fail-with-body --silent --show-error --compressed --get \
  "$TALE_URL/api/v1/notifications/sync" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --data-urlencode "recipientEmail=$TALE_RECIPIENT_EMAIL" \
  --data-urlencode 'stream=personal' \
  --data-urlencode 'locale=de' \
  --data-urlencode 'limit=100'
```

Eine erfolgreiche Anfrage liefert `200` mit `{recipientId, page, isDone, continueCursor}`. Fehlt die Person, ist sie deaktiviert oder ihre E-Mail nicht bestätigt, oder ist die Mitgliedschaft mehrdeutig, lautet die Antwort `recipientId: null`, `page: []`, `isDone: true` mit leerem Cursor. Die Route lädt niemanden ein und legt kein Konto an.

### Einträge lesen und einen Durchlauf abschließen

| Feld eines Eintrags | Bedeutung |
| --- | --- |
| `id` | Stabile Quell-ID im Format `<organizationId>:<stream>:<notificationId>`. Nutze sie zum Abgleichen und Aktualisieren in der Spiegelung dieser Person. Organisationsmeldungen können bei mehreren Personen dieselbe ID haben; halte ihre Spiegelungen getrennt. |
| `version` | SHA-256-Hash mit 64 Hexadezimalzeichen über den exportierten Eintrag, bevor der Hash ergänzt wird. Inhalt und Lesestatus beeinflussen ihn; geänderte Übersetzungen von Titel oder Text ebenfalls. Er kennzeichnet Änderungen und ist keine fortlaufende Nummer. |
| `title`, `body` | Texte aus Tales Benachrichtigungskatalogen mit eingesetzten Parametern, begrenzt auf 500 beziehungsweise 8.000 UTF-16-Codeeinheiten. Behalte die Sprache zwischen Durchläufen bei. |
| `path` | Dasselbe organisationsbezogene Ziel unter `/dashboard/...` wie in der Benachrichtigungsglocke, einschließlich kodierter IDs und Query-Parameter. Ergänze den Browser-Ursprung von Tale, nicht die interne API-Adresse. Die Person braucht weiterhin Zugriff und gegebenenfalls eine Verbindung zum privaten Netz. |
| `createdAt` | Erstellungszeit als Millisekunden seit Unix-Epoch. |
| `read` | Ob die empfangende Person die Meldung in Tale gelesen hat. |

Persönliche Meldungen sind nach absteigender Sequenznummer sortiert, Organisationsmeldungen nach absteigender Erstellungszeit und ID. Beide verwenden signierte Keyset-Cursor. Jeder Cursor gilt nur für seine Organisation, Person und seinen Datenstrom. Verwende ihn nicht für eine andere Person oder den anderen Datenstrom.

So hältst du die Spiegelung aktuell:

1. Beginne beide Datenströme ohne Cursor. Gleiche Einträge anhand ihrer `id` ab und erkenne Änderungen an `version`.
2. Sende bei `isDone: false` den erhaltenen Cursor zurück. Beende den Datenstrom bei `true`; sende keinen leeren Abschlusscursor.
3. Entferne fehlende Einträge im Ziel erst, wenn beide Datenströme vollständig und erfolgreich gelesen wurden. Bei einem Fehler behältst du die vorherige Spiegelung und behebst die fehlgeschlagene Abfrage.
4. Beginne spätere Durchläufe wieder auf der ersten Seite. So erkennst du auch geänderte Texte oder Lesestatus älterer Meldungen. Ein Cursor ist eine Position innerhalb der Liste, kein Fortschrittsmarker für einen Änderungsstrom.

Der Export markiert keine Tale-Meldung als gelesen und löscht keine Meldung. Es gibt hier keinen Aufruf zum Bestätigen oder Zurückschreiben. Ein geänderter Lesestatus im Zielsystem verändert Tale nicht.

### Fehler beim Export beheben

| Antwort | Nächster Schritt |
| --- | --- |
| `401 UNAUTHORIZED` | Fehlenden, ungültigen oder abgelaufenen API-Schlüssel ersetzen. |
| `403 ROLE_FORBIDDEN` | Einen Schlüssel eines Inhabers oder Admins der ausgewählten Organisation verwenden oder dem Benutzer des Schlüssels von einem Admin `tale:notifications.export` erteilen lassen; `capabilities.notificationExport` in `GET /api/v1/me` bestätigt es. Eine abgelaufene oder widerrufene Berechtigung erlaubt den Export nicht mehr. Die Mitgliedschaft der empfangenden Person erteilt dem Aufrufer keine Exportrechte. |
| `400 INVALID_QUERY` | Fehlende oder ungültige Empfänger-, Datenstrom- oder Sprachangaben, unbekannte oder doppelte Parameter sowie leere Cursor oder Limits korrigieren. `data.issues` nennt die Felder. |
| `400 INVALID_LIMIT` | Eine ganze Zahl als Limit senden. |
| `400 INVALID_CURSOR` | Den betroffenen Datenstrom ohne Cursor neu beginnen. Eine entfernte oder geänderte Mitgliedschaft kann den bisherigen Cursor ungültig machen. |
| `200`, `recipientId: null` | Aktuelle Mitgliedschaft und bestätigte E-Mail prüfen. Die leere abgeschlossene Seite bestätigt nicht, dass ein Konto existiert. |
| `429 RATE_LIMITED` | `Retry-After` und das [gemeinsame API-Budget](/de/develop/rate-limits) beachten. Währenddessen die vorhandene Spiegelung beibehalten. |

Zusätzlich gelten die üblichen Fehler bei der Organisationsauswahl. Behandle einen fehlgeschlagenen Export im Zielsystem niemals als erfolgreich gelesene leere Liste.

## Agenten eines Projekts verwalten

Jeder Agent gehört zu einem Projekt. Die Projekt-ID steht bei jeder Operation verpflichtend in der URL; die Antwort enthält `projectId` und die `id` des Agenten. API und Projekt-Tab **Agenten** verwalten dieselben Datensätze mit denselben Zugriffsrechten.

| Operation                       | Route                                           | Erfolg         |
| ------------------------------- | ----------------------------------------------- | -------------- |
| Agenten auflisten               | `GET /api/v1/projects/{id}/agents`              | `200 {agents}` |
| Anlegen                         | `POST /api/v1/projects/{id}/agents`             | `201 {agent}`  |
| Lesen                           | `GET /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Gesamte Konfiguration speichern | `PUT /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Löschen                         | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204`          |

Wähle ein vorhandenes Projekt, einen Harness, den `GET /api/v1/models` unter `harnesses` führt — die, die die Plattform mit ihren eigenen Zugangsdaten betreibt —, und ein Modell, das er bedienen kann. Das Beispiel legt einen Claude-Code-Agenten an und liest seine Konfiguration zurück; eine Aufgabe startet es nicht.

```bash
: "${BASE:?Set BASE to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${ORG_SLUG:?Set ORG_SLUG}"
: "${PROJECT_ID:?Set PROJECT_ID to an existing project ID}"
: "${MODEL_ID:?Set MODEL_ID to a model served by your harness}"
AGENT_URL="$BASE/api/v1/projects/$PROJECT_ID/agents"
AGENT_BODY=$(jq -n --arg model "$MODEL_ID" \
  '{name:"Reviewer",harness:"claude-code",model:$model,skills:[],connectors:[]}')
AGENT_ID=$(curl -fsS "$AGENT_URL" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  -H 'Content-Type: application/json' -d "$AGENT_BODY" | jq -er '.agent.id')
curl -fsS "$AGENT_URL/$AGENT_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  | jq '.agent | {name, harness, skills, connectors}'
```

```json
{
  "name": "Reviewer",
  "harness": "claude-code",
  "skills": [],
  "connectors": []
}
```

### Vollständige Agentenkonfiguration speichern

`POST` und `PUT` verlangen `name`, `harness`, `model`, `skills` und `connectors`; ein `harness` außerhalb der zulässigen Menge ergibt **400**, `PROJECT_AGENT_HARNESS_INVALID`, mit der Menge in `data.harnesses`. Optional sind `modelProvider`, `tools`, `secrets` und `instructions`. Ein `PUT` speichert die gesamte Konfiguration: Ausgelassene Anbieter- und Anweisungsfelder werden `null`, ausgelassene Tool- und Secret-Listen werden leer. Die Agenten-ID muss bereits existieren; ein `PUT` legt keinen neuen Agenten an. Übergib das zuletzt gelesene `updatedAt` als `expectedUpdatedAt`, um das Speichern bedingt zu machen: Ein Agent, der sich seitdem geändert hat, ergibt **409**, `PROJECT_AGENT_STALE`, mit dem aktuellen `updatedAt` in `data`, und nichts wird geschrieben — lade ihn neu und führe zusammen, bevor du erneut speicherst.

### Modelle, Freigaben und Grenzen prüfen

Ein Projekt fasst höchstens 50 Agenten. Namen müssen innerhalb des Projekts unabhängig von Groß- und Kleinschreibung eindeutig sein und dürfen bis zu 120 Zeichen lang sein; jede Ausstattungsliste erlaubt 25 Einträge, Anweisungen 20.000 Zeichen. Ungültige Konfiguration oder eine überschrittene Grenze ergibt **400**; ein Name, den ein anderer Agent des Projekts schon trägt, ergibt **409**, `PROJECT_AGENT_NAME_TAKEN` — die Klasse, mit der jedes andere Duplikat an dieser Schnittstelle antwortet —, verwende also den bestehenden Agenten, statt es erneut zu versuchen.

`model` muss ein Modell aus dem Katalog der Organisation sein (nenne `modelProvider`, wenn mehrere Anbieter es bedienen), und `tools` darf nur bekannte Tool-Freigaben nennen — ein falscher Wert ergibt **400** mit `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` oder `PROJECT_AGENT_TOOL_UNKNOWN`, das sagt, was zu korrigieren ist, statt eines Agenten, der an seiner ersten Aufgabe scheitert. `secrets` enthält Namen von Organisationsgeheimnissen, niemals deren Werte; ein Name, den die Organisation nicht gespeichert hat, wird mit **400**, `PROJECT_AGENT_SECRET_UNKNOWN`, abgewiesen und in `data.secrets` genannt (der Dialog der App entfernt solche Namen, die API nicht — ein Tippfehler ergibt also nie einen Agenten, der ohne seine Zugangsdaten läuft).

Nur Inhaber und Admins der Organisation dürfen die Freigaben ändern. Ein Redakteur muss vorhandene Freigaben beim Speichern beibehalten.

Projektleser dürfen die Agenten lesen; Änderungen verlangen Bearbeitungsrechte und ein aktives Projekt. Ein unsichtbares oder fehlendes Projekt sowie eine Agenten-ID aus einem anderen Projekt ergibt **404**. Bei Mitgliedschaft in mehreren Organisationen muss jede Lese- und Schreibanfrage `X-Organization-Slug` enthalten. [Projekt-Agenten](/de/platform/projects/project-agents) erklärt die Arbeit an Aufgaben; der direkte Chat verwendet weiterhin den eingebauten Assistenten.

## Automatisierungsnamen in URLs

Der Name einer Automatisierung ist ein `/`-Pfad — `billing/dunning` — und ein Pfad passt nicht in ein einzelnes URL-Segment. Schreib den Namen in jeder `.../automations/{name}/...`-URL mit `__` an Stelle jedes `/`:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Antworten tragen immer den echten Namen (`"name": "billing/dunning"`); die `__`-Form existiert nur in URLs. Skill-Slugs sind flach und brauchen keine Kodierung. Projekt-Agenten verwenden die Projekt-ID und die Agenten-ID.

### Die tatsächlich ausgeführte Version lesen

`GET /api/v1/automations` listet jede Automatisierung mit `latestVersion`, `deployedVersion` und `projectIds` — den Projekten, in denen sie installiert ist und die die Lauf-Routen unten verlangen — plus dem, was ein Starter ohne zweiten Aufruf braucht: ihre `description`, das `inputs`-Schema, zu dem ein Lauf passen muss (das der deployten Version, sonst das der neuesten gespeicherten), und ihren `trigger` — Art, Schalter und Gesundheit: `lastFiredAt`, `lastSkippedAt` und `lastSkipReason`, dieselben Stempel, die `GET .../triggers` liest, ein einziger Listenaufruf findet also jede Bindung, die eingeschaltet ist und nicht feuert — oder `null`, wenn keine gebunden ist.

`GET /api/v1/automations/{name}` antwortet standardmäßig mit der neuesten gespeicherten Version (`?version=latest` schreibt den Standard aus), und die kann ein Entwurf sein; ein Live-Lauf führt die deployte aus, lies den Vertrag des Codes, der wirklich läuft, also mit `?version=deployed` (eine Zahl benennt jede gespeicherte Version). Eine Version, die die Automatisierung nicht hat, ergibt **404** `AUTOMATION_VERSION_UNKNOWN` — `?version=deployed` ohne deployte Version ebenso —, während eine unbekannte Automatisierung `AUTOMATION_NOT_FOUND` ergibt.

`GET /api/v1/automations/{name}/versions` nennt die `deployedVersion` und markiert jede Zeile mit `deployed`, und jede Zeile trägt das Testurteil der Version: `testsPassed` ist `null`, bis die Tests gelaufen sind (ein Dokument ohne Tests bleibt `null`), sonst `true` oder `false` für den letzten Lauf — den des Speicherns, wenn `save_automation` per MCP ein Dokument mit Tests speichert, oder den des Deploy-Gates, das eine Ablehnung festhält —, und `testsCheckedAt` sagt, wann — neben einem Urteil, das festgehalten wurde, bevor 0.5.24 die Zeit mitzuschreiben begann, steht `null`, verlass dich fürs Urteil also auf `testsPassed` und auf `testsCheckedAt` nur dafür, wie frisch es ist; das jüngste Urteil gilt.

`DELETE /api/v1/automations/{name}` entfernt die Automatisierung samt Versionen, Triggern und Projektbindungen — ihre Läufe bleiben: `GET /api/v1/runs` listet sie weiterhin, per ID bleiben sie lesbar, und `GET /api/v1/automations/{name}/runs` (samt Projekt-Zwilling) antwortet sie weiter unter dem Namen, unter dem sie gelaufen sind — auf den `GET /api/v1/automations/{name}`, seine Versionen und seine Trigger dann **404** antworten — und antwortet mit **409** `AUTOMATION_HAS_ACTIVE_RUNS`, solange ein Lauf in Arbeit ist; es verlangt die Entwickler-Fähigkeit. Anlegen, Speichern und Deployen einer Automatisierung gehören nicht auf diese Oberfläche: Das sind `save_automation` und `deploy_automation` des [MCP-Endpoints](/de/develop/mcp-endpoint), der Canvas der App oder ein Konfigurations-Release per `tale deploy` — REST listet, liest, startet, installiert und verdrahtet Trigger für Automatisierungen, die dort gebaut wurden.

## Trigger

Ein Trigger startet eine Automatisierung ohne deinen Aufruf: nach Zeitplan, über eine Webhook-URL oder wenn die Plattform ein Event auslöst. Binde einen mit `PUT /api/v1/automations/{name}/triggers` — ein Trigger pro Automatisierung, und das `PUT` ersetzt, was vorher gebunden war:

```bash
curl -sS --compressed -X PUT "https://your-host.example.com/api/v1/automations/billing__dunning/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "event", "event": "contact.created" }'
# → 200 { "name": "billing/dunning", "deployed": true }
```

### Triggertyp auswählen

`kind` ist `schedule` (mit einem fünfteiligen `cron` und einer optionalen IANA-`timezone`), `webhook` (die Antwort trägt das `token` der URL genau einmal — die [Webhooks-Seite](/de/develop/webhooks) behandelt diesen Zugang) oder `event`. Einen Trigger, der nie feuern könnte, weist Tale mit **400** `AUTOMATION_TRIGGER_INVALID` und einem Satz ab, der die Korrektur nennt: ein Cron-Ausdruck, der auf nichts passt (auch ein Tag, den kein benannter Monat hat, `0 0 30 2 *`), eine Zeitzone, die keine IANA-Zone ist, ein Event, das die Plattform nicht auslöst.

Jede Art nimmt ihre eigenen Schlüssel — `cron` und `timezone` nur mit `schedule`, `event` nur mit `event`, `rotateToken` nur mit `webhook` —, und ein Schlüssel, der zu einer anderen Art gehört, wird als unbekannter Schlüssel abgewiesen (**400** `INVALID_BODY`, unter `data.issues` beim Namen genannt), ein Webhook-Trigger kann sich also nie als einer zurücklesen, der auch nach Zeitplan läuft. Ein Event-Trigger bindet eines der Events, die die Plattform heute auslöst, und die Eingabe des Laufs ist `{ "trigger": "event", "event": "<name>", "payload": <die Daten des Events> }`:

| Event                                                   | Ausgelöst, wenn                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact.created`, `contact.updated`, `contact.deleted` | ein Kontakt angelegt, geändert oder gelöscht wird — über die API, die App oder einen Import                                                                                  |
| `conversation.created`                                  | ein Gespräch im Posteingang aufgeht — eine eintreffende E-Mail oder ein hereingespiegeltes externes Gespräch                                                                 |
| `conversation.message_received`                         | eine Nachricht auf einem bestehenden Gespräch landet                                                                                                                         |
| `project.created`                                       | ein Projekt angelegt wird                                                                                                                                                    |
| `task.created`                                          | eine Aufgabe angelegt wird — auf einem Board, über die API oder durch einen Intake                                                                                           |
| `task.status_changed`                                   | eine Person eine Aufgabe in einen anderen Status verschiebt (die eigenen Züge eines Agenten lösen nichts aus, eine Automatisierung kann sich also nicht selbst neu triggern) |
| `comment.created`                                       | ein Kommentar auf einer Aufgabe landet                                                                                                                                       |
| `comment.mentioned`                                     | ein Aufgabenkommentar jemanden mit `@` erwähnt                                                                                                                               |

### Triggerzustand prüfen und gezielt pausieren

`GET .../triggers` liest die Bindung zurück — als `triggers`, eine Liste mit höchstens einem Eintrag, der eine Plural in dieser Familie — samt ihrer Gesundheit: `lastFiredAt` ist der letzte Zeitpunkt, zu dem diese Bindung **einen Lauf gestartet** hat — `lastRunId` nennt ihn, und beide bleiben `null`, bis es so weit war —, während `lastSkippedAt` und `lastSkipReason` das letzte Mal festhalten, dass sie fällig war und nichts gestartet hat: `not_deployed` (nichts ist live — deploy eine Version), `unusable_cron` (der Ausdruck oder die Zone ließ sich nicht lesen; der Scheduler lässt die Bindung in Ruhe, bis sie bearbeitet wird) oder `start_refused` (das `inputs`-Schema der Live-Version hat die Eingabe des Laufs abgelehnt). Eine Webhook-Zustellung, die das `inputs`-Schema der Live-Version ablehnt, ist ein anderer Fall: Der Absender erhält **400** `AUTOMATION_INPUT_INVALID`, nichts startet, und keiner dieser Stempel bewegt sich — die Bindung war nicht fällig, ein Webhook, dessen jede Zustellung abgelehnt wird, liest sich also wie einer, der nie aufgerufen wurde. Prüfe Zustellungen auf der Absenderseite.

Eine Bindung lebt, wenn `lastFiredAt` mit ihrem Takt Schritt hält; eine, deren `lastSkippedAt` der neuere Stempel ist, wird fällig und läuft nicht, und der Grund sagt, was zu korrigieren ist. Ein Umbinden auf eine andere Art setzt jeden Stempel neu. `enabled: false` pausiert einen Trigger, ohne ihn zu verlieren; `DELETE .../triggers` entfernt ihn — und bei einem Webhook widerruft es die URL. Dasselbe tut das Binden einer anderen Art über einen lebenden Webhook: Der `PUT` antwortet weiterhin **200**, mit `"revoked": "webhook"` neben dem Namen, und die alte URL ist endgültig weg — ein späteres Webhook-Binden erzeugt ein anderes Token.

Der `PUT` antwortet außerdem mit `deployed`: Binden vor dem Deployen ist erlaubt, und ein Trigger, der an eine Automatisierung ohne deployte Version gebunden ist, startet nichts — jeder Termin wird als `not_deployed` übersprungen, was der `trigger` der Zeile in `GET /api/v1/automations` zeigt —, bis eine Version deployt ist.

## Einen Lauf starten, dann pollen

Ein Lauf wird dauerhaft gespeichert und kann mehrere Minuten dauern — der Start antwortet deshalb mit **202** und der Identität des Laufs, nicht mit seinem Ergebnis:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

### Laufende und wartende Zustände auswerten

Polle `GET /api/v1/projects/{id}/runs/{runId}?fields=status,finishedAt`, bis `status` `queued`/`running`/`waiting` verlässt — mit den benannten Schlüsseln bleibt der Poll eine Zeile statt des ganzen Laufs, und der `ETag` der Antwort als `If-None-Match` macht aus einem unveränderten Poll eine **304** ohne Body ([Caching](#caching-kompression-und-gezieltes-lesen)); dann lies den Lauf vollständig: Er trägt `output`, den `trace` pro Knoten und die `effects`, die er erzeugt hat.

`waiting` deckt zwei Familien ab, und nur eine braucht dich: Solange ein Lauf parkt, sagt `waitingFor`, worauf — `approval` (die Entscheidung einer Person an einem Kontrollpunkt) und `ask` (eine Frage, die eine Person beantworten muss) brauchen einen Menschen; `agent` (ein noch laufender Agent-Turn) und `repeat` (ein Knoten, der pollt, bis seine `repeatUntil`-Bedingung gilt) nicht, und ein Lauf kann in beiden minutenlang gesund sitzen. „Läufe, die eine Person brauchen“ ist `waitingFor` in (`approval`, `ask`) — nie `status=waiting` allein, das sich mit pollenden Läufen füllt. `detail` benennt das Parken (`approval:<approvalId>`, `agent:<nodeId>`, `repeat:<nodeId>`) und, sobald fehlgeschlagen, den Fehlersatz.

`POST /api/v1/projects/{id}/runs/{runId}/cancel` stoppt den Lauf an der nächsten Knotengrenze; erledigte Arbeit wird nicht rückgängig gemacht. Die Antwort enthält `cancelled` und den resultierenden `status`. Bei erfolgreichem Abbruch lauten sie `true` und `"cancelled"`; das `detail` des Laufs wird `null`. Ist der Lauf bereits beendet, stehen neben `cancelled: false` sein Endstatus `success`, `failed` oder `cancelled`.

Bei fehlgeschlagenen Läufen ergänzt der stabile `failureCode` die lesbare Fehlerbeschreibung in `detail`. Andere Zustände liefern `null`; auch ältere fehlgeschlagene Läufe können noch keinen Code haben. In Zusammenfassungen fehlt ein nicht gesetzter Code.

| Fehlergruppe | Beispiele und nächster Schritt |
| --- | --- |
| Automatisierung | `node_error`, `connector_error`, `llm_output_invalid`, `approval_rejected`, `execution_limit`, `automation_deleted`: Prüfe den betroffenen Knoten und die Ablaufspur. Korrigiere Eingabe oder Definition. Wurde eine Aktion abgelehnt, kläre den Grund vor einem neuen Lauf. |
| Modellanbieter | Etwa `credit_exhausted` oder `rate_limited`: Behebe die Ursache beim Anbieter vor dem nächsten Versuch. |
| Agentenausführung | Etwa `harness_error`, `session_gone`, `deadline` oder `budget_exceeded`: Prüfe die Fehlerbeschreibung und Grenzen des Agenten. Die vollständige Auswahl steht in OpenAPI. |

Der Code benennt die Ursache, garantiert aber keinen gefahrlosen Neustart des ganzen Laufs: Frühere Knoten können externe Systeme bereits verändert haben. `startedAt` bezeichnet die Annahme des Starts, noch vor der Übernahme durch einen Worker. Einen gesonderten Übernahmezeitpunkt gibt es nicht; `finishedAt - startedAt` enthält daher Warteschlangen- und andere Wartezeiten.

### Start ohne zusätzlichen Lauf wiederholen

Ein Start lässt sich gefahrlos wiederholen, wenn du ihn benennst: Sende `Idempotency-Key: <dein Schlüssel>`, und eine Wiederholung innerhalb von 24 Stunden — ein wiederholter Timeout, eine verlorene Antwort — antwortet mit **202**, dem Lauf, den der erste Versuch gestartet hat, und `"duplicate": true`; ein zweiter Lauf entsteht also nicht. Derselbe Schlüssel mit anderem Body ergibt **409** `IDEMPOTENCY_KEY_REUSED`. Der Schlüssel gilt je Automatisierung und URL-Projekt, und ein abgewiesener Start merkt sich nichts — derselbe Schlüssel läuft also, sobald die Ablehnung behoben ist.

Ein optionaler `Idempotency-Key` muss nach dem Entfernen äußerer Leerzeichen 1–255 druckbare ASCII-Zeichen enthalten. Ein vorhandener, aber leerer, zu langer oder anders kodierter Header ergibt `400 INVALID_HEADER`; `data.issues` nennt den Header, und nichts startet. Verwende für eine Wiederholung denselben getrimmten Wert und denselben Body. Lasse den Header nur weg, wenn du keinen Schutz vor doppelter Ausführung brauchst.

### Live- oder Mock-Ausführung wählen

`mode` ist standardmäßig `live`. Frei gestartete Live-Läufe und das Abbrechen von Läufen verlangen die Entwickler-Fähigkeit. Für Projektläufe brauchst du außerdem Bearbeitungsrechte auf ein aktives Projekt, auch mit `mode: "mock"`. Mock-Läufe verwenden deterministische Mocks; ohne Projekt genügt dafür eine Mitgliedschaft. Ein Trigger ist für den Start nicht nötig. Ohne bereitgestellte Version antwortet Tale mit **409**, sofern du nicht ausdrücklich eine gespeicherte Version für einen Mock-Lauf auswählst.

Eine unbekannte Automatisierung antwortet mit **404**. Ein Live-Lauf darf nur die deployte `version` verwenden; eine andere gespeicherte Version ergibt **409**. Teste diese mit `mode: "mock"`. Ohne Body gilt `{}`; fehlerhaftes JSON ergibt **400** und startet nichts. Definiert die Automatisierung ein `inputs`-Schema, muss die Eingabe dazu passen, bevor ein Lauf entsteht: Eine Abweichung ergibt **400** `AUTOMATION_INPUT_INVALID` mit jedem Problem unter `data.issues` (`path`, `message`), genau wie ein abgelehnter Body. `input` fällt nur auf `{}` zurück, wenn es fehlt — `null` geht als null durch, damit das Schema darüber urteilt.

### Geltungsbereich und Laufhistorie auswählen

Das Projekt in der URL bestimmt den Kontext der Aufgaben- und Dokumentwerkzeuge des Laufs. Hat die Automatisierung Projektbindungen, darf sie nur in einem dieser Projekte laufen; eine ohne Bindungen läuft in jedem Projekt, das der Aufrufer bearbeiten darf — sie zu installieren (`POST /api/v1/projects/{id}/automations/{name}`) listet sie unter diesem Projekt und grenzt sie darauf ein, ist aber keine Hürde, die eine nie gebundene Automatisierung nehmen müsste. `GET /api/v1/projects/{id}/automations/{name}/runs` liest die Historie dieses Projekts für eine Automatisierung, `GET /api/v1/projects/{id}/runs` für alle.

Listen antworten mit Zusammenfassungen — Identität, Geltungsbereich, Status und Zeiten, jede Zeile nennt den Lauf als `id` und, unter dem Namen, den der Start beantwortet hat, als `runId`, ein Wert unter beiden Namen —, die neuesten zuerst, als `{ "runs": [...], "isDone": ..., "continueCursor": ... }`: Hänge `?status=failed` an (ein oder mehrere Status, kommagetrennt), um sie einzugrenzen, `?include=input,output` (auch `trace`, `effects`, `checkpoints`), um die Felder der vollen Zeile einzubetten, die eine Zusammenfassung weglässt — eine einbettende Seite liest höchstens 25 Zeilen, ist auf 8 MiB davon begrenzt und endet vorzeitig mit `isDone: false`, wenn die nächste Zeile nicht mehr passt —, und gib `continueCursor` als `?cursor=` zurück, bis `isDone` gilt.

`GET /api/v1/runs` ist die Sicht quer über alles: jeder Lauf, den der Schlüsselbesitzer sehen darf, Organisationsläufe wie Läufe sichtbarer Projekte, jede Zeile mit ihrer `projectId`. Eine Automatisierung ohne Bindungen kannst du mit `POST /api/v1/automations/{name}/runs` ohne Projekt starten; eine gebundene Automatisierung ergibt dort **409**. `GET /api/v1/automations/{name}/runs` und `/api/v1/runs/{runId}` zeigen ausschließlich Läufe ohne Projekt. Zum Lesen, Abbrechen und Löschen eines Projektlaufs brauchst du dessen Projekt-URL. `DELETE /api/v1/projects/{id}/runs/{runId}` (oder `/api/v1/runs/{runId}`) entfernt einen beendeten Lauf — samt gespeicherter Eingabe und Ausgabe — unter der Entwickler-Fähigkeit; ein Lauf, der noch in Arbeit ist, ergibt **409** `RUN_ACTIVE`, brich ihn also zuerst ab.

## Für ein Mitglied handeln: Frage eines Laufs beantworten, Prüfung einer Aufgabe entscheiden

Ein Lauf, der mit `waitingFor: "ask"` parkt, und eine Aufgabe in `in_review` warten beide auf eine Person. Arbeitet diese Person in einer anderen Anwendung — etwa einem Büroportal, das den Arbeitsplatz spiegelt —, reicht der Maschinenaufruf ihre Handlung weiter und nennt sie als `actor`. Tale hält dann die Person fest, nicht den Schlüssel. Beide Türen brauchen den API-Vertrag 1.16.0.

### Die Frage beantworten, auf die ein Lauf wartet

`GET /api/v1/projects/{id}/runs/{runId}/ask` liefert die offene Frage als `PendingAsk` — den Satz, optional ein strukturiertes `questions`-Set, den fragenden Knoten und die Frist `expiresAt` — oder `ask: null`, wenn niemand gefragt ist. Zum Lesen genügt derselbe Zugriff wie zum Lesen des Laufs.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/ask" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "ask": { "askId": "...", "question": "...", "expiresAt": 1758210000000, "taskId": "..." } }
```

Die Antwort geht an `POST /api/v1/projects/{id}/runs/{runId}/asks/{askId}`. Tale speichert sie, setzt den Lauf in derselben Transaktion fort und stellt die Antwort als eigenen Kommentar der antwortenden Person auf die Zeitleiste der Aufgabe. Bei einem `questions`-Set sendest du pro Frage eine Zeile, so wie es die App tut: `<Frage> → <gewählte Option>; <eingetippter Text> (in their own words)`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/asks/<askId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "answer": "Im Februar buchen.", "actor": { "email": "reviewer@example.com" } }'
# → 200 { "ok": true, "askId": "...", "runId": "...", "answeredBy": "<userId>", "actorUserId": "<userId>", "taskId": "..." }
```

Ein Projektlauf verlangt Schreibzugriff auf ein aktives Projekt, ein Organisationslauf die Mitgliedschaft. Ohne `actor` antwortet der Schlüssel als er selbst, und `answeredBy` lautet `api-key:<userId>`. Eine bereits beantwortete oder geschlossene Frage liefert **409** `HUMAN_ASK_NOT_PENDING`, eine abgelaufene **409** `HUMAN_ASK_EXPIRED` — der Lauf scheitert dann mit `failureCode: "ask_expired"` — und eine Frage, die nicht dieser Lauf gestellt hat, **404** `HUMAN_ASK_NOT_FOUND`. Eine leere Antwort liefert **400** `EMPTY_ANSWER`.

### Die Prüfung einer Aufgabe entscheiden

`GET /api/v1/projects/{id}/tasks/{taskId}/review` liefert den Status der Aufgabe und ihre offene Prüfung als `TaskReview`, sonst `review: null`. Ein `POST` auf denselben Pfad entscheidet sie — hier ist `actor` Pflicht, denn eine Prüfung ist immer die Entscheidung einer Person:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/review" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "approve", "actor": { "email": "reviewer@example.com", "userId": "<userId>" } }'
# → 200 { "task": { "id": "...", "status": "done" }, "decision": "approve", "approvalId": "...", "actorUserId": "<userId>" }
```

`approve` entspricht dem Verschieben nach Erledigt auf dem Board: Es gelten der eigene Projektzugriff des Mitglieds und die `review_policy` der Organisation genau wie dort (**403** `REVIEW_INDEPENDENT_REVIEWER_REQUIRED` oder `REVIEW_COMPETENCE_REQUIRED`, wenn die Richtlinie die Person ablehnt), die Prüfung wird als vom Mitglied freigegeben festgehalten, und die Aufgabe wird `done`; eine Aufgabe mit offenen Teilaufgaben liefert **409** `TASK_HAS_OPEN_SUBTASKS`. `request_changes` braucht `comment` und `workflowSlug`: Die Prüfung wird zurückgezogen, der Kommentar landet auf der Zeitleiste, und der Workflow startet erneut auf der Aufgabe und liest den Kommentar als Rückmeldung; die Antwort nennt die `runId` zum Pollen, mit `started: false`, wenn ein laufender Lauf weiterverwendet wurde. Eine Aufgabe, die nicht in Prüfung ist, liefert **409** `TASK_NOT_IN_REVIEW`. Jede Entscheidung wird als `task.review_relayed` protokolliert, mit dem Mitglied und dem Schlüssel, der für es gehandelt hat.

### Das Mitglied benennen, für das gehandelt wird

`actor.email` benennt das Mitglied über seine E-Mail-Adresse. Tale löst sie in der Organisation nach derselben Regel auf wie den Benachrichtigungsexport: genau eine aktive Mitgliedschaft mit verifizierter Adresse. Kein solches Mitglied liefert **404** `ACTOR_NOT_FOUND`, zwei liefern **409** `ACTOR_AMBIGUOUS`, eine nicht verifizierte Adresse **403** `ACTOR_UNVERIFIED`, eine deaktivierte Mitgliedschaft **403** `ACTOR_DISABLED`. Jede Antwort nennt die aufgelöste `actorUserId`; pinne sie bei späteren Aufrufen als `actor.userId`. Eine Adresse, die inzwischen zu einem anderen Konto gehört, liefert dann **409** `ACTOR_REBOUND`, statt für den neuen Inhaber zu handeln. Ein Mitglied, das das Projekt nicht sehen darf – oder an der Review-Tür seine Aufgabe nicht schreiben darf –, liefert **403** `ACTOR_FORBIDDEN`; der Zugriff des Schlüsselinhabers wird zuerst geprüft, dieser Code spricht also immer vom Handelnden.

Einen `actor` zu nennen ist ein eigenes Recht. Ein Inhaber- oder Admin-Schlüssel hat es durch seine Rolle; jeder andere Schlüsselinhaber braucht die Berechtigung `tale:rest.act-as`, die genau wie die Exportberechtigung in [Export ohne Admin-Rolle delegieren](#export-ohne-admin-rolle-delegieren) erteilt und entzogen wird, mit `"competence":"tale:rest.act-as"` im Freigabetext. `GET /api/v1/me` meldet sie als `capabilities.actAs`; ein ohne dieses Recht gesendeter `actor` liefert **403** `ROLE_FORBIDDEN`, bevor ein Mitglied nachgeschlagen wird. Was die weitergereichte Handlung darf, entscheiden weiterhin die eigenen Berechtigungen des Mitglieds.

## Eine Nachricht senden, dann den Turn pollen

Projektchats folgen ebenfalls dem Ablauf 202, dann Statusabfrage. Wähle ein Projekt, das du lesen darfst, lege einen Thread an, sende eine Nachricht, frage den Status ab und lies die Antwort:

### Aufrufbares Modell auswählen

Rufe vor dem Senden die Modelle ab. Jeder Eintrag trägt, was ein Client zum Auswählen braucht — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing`, wenn der Katalog einen Preis kennt, `tags` — und `default: true` markiert die Wahl der Organisation für diesen Schlüsselbesitzer; es erscheint nur, wenn die Organisation ein Standardmodell festgelegt hat, warte also nicht darauf. Übernimm `id` als `model`; ergänze `providerSlug`, wenn dieselbe ID unter mehreren Anbietern gelistet ist. Die Liste berücksichtigt die Modellzugriffsregeln der Organisation und enthält nur Modelle, die REST direkt aufrufen kann. Ist sie leer, steht dem Schlüsselbesitzer kein Chat-Modell zur Verfügung.

`maxOutputTokens` fehlt, wenn der Katalog keine Obergrenze nennt. Die Senderoute prüft dann keine Kataloggrenze. Dein Client muss das fehlende Feld beim Lesen der Modellliste akzeptieren.

`capabilities` und `tags` beschreiben das Modell, nicht das, was diese Oberfläche ihm schicken kann: Das Senden per REST ist reiner Text (`content`), ein `vision`-Modell liest hier also nur dann ein Bild, wenn der Thread aus der App mit einem Bildanhang fortgesetzt wurde — eine Data-URI, die in `content` eingefügt wird, erreicht das Modell als Text und wird als Text beantwortet, und nichts in Anfrage oder Antwort kennzeichnet das; Bildeingabe über REST gibt es in dieser Version nicht.

Die Liste ist der konfigurierte Katalog der Organisation, kein Versprechen des Anbieterkontos: Ein Modell, das der Tarif des Anbieters nicht abdeckt, schließt ein Operator über die Modell-Allowlist der Zugangsdaten in den Einstellungen aus. Das Paar wird beim Senden geprüft, direkt an der Schnittstelle: Eine ID, die die Liste nicht kennt, ergibt **400**, `CHAT_MODEL_UNKNOWN`; eine ID, die mehrere Anbieter bedienen, ohne dass einer genannt ist, **400**, `CHAT_MODEL_AMBIGUOUS` mit den Kandidaten in `data.providers`; ein `providerSlug`, den die Liste nicht kennt, **400**, `CHAT_PROVIDER_UNKNOWN`; einer, der das gewählte `model` nicht bedient, **400**, `CHAT_MODEL_NOT_ON_PROVIDER`.

Die 202 nennt den Anbieter, auf dem der Turn läuft — er weicht nie stillschweigend auf einen anderen aus.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# Kein Modell verfügbar → 200 { "models": [] }
```

```bash
# 1. Ein eigener Thread
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Nachricht senden — auf dieser API ist das Modell immer explizit, nie automatisch gewählt
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Fasse mir dieses Quartal zusammen.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "providerSlug": "...", "messageId": "<assistantMessageId>", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Bis idle pollen, dann lesen
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "queued", "messageId": "..." } … dann { "status": "streaming", "messageId": "...", "text": "Das Quartal…", "textOffset": 0, "textLength": 12, "reasoning": "", "reasoningOffset": 0, "reasoningLength": 0, "cancelRequested": false, "updatedAt": 1774... } … dann { "status": "idle", "lastMessageId": "<assistantMessageId>", "lastStatus": "complete" }

# 4. Die Antwort über die ID lesen, die die 202 genannt hat
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages/<assistantMessageId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "id": "<assistantMessageId>", "role": "assistant", "status": "complete", "finishReason": "stop", "parts": [ … ], "usage": { … }, … }
```

### Die angenommene Nachricht verfolgen

Angenommene Chatnachrichten teilen sich eine Warteschlange für alle Organisationen und Schlüssel der Instanz; ältere Aufträge kommen zuerst. Der Hintergrund-Worker verarbeitet pro Durchgang bis zu `WORKER_CONCURRENCY` Antwortläufe, standardmäßig 5. Sein nächster Durchgang beginnt erst, wenn der aktuelle abgeschlossen ist. Eine angenommene Nachricht kann deshalb hinter Aufträgen anderer Clients warten. Die API liefert weder Warteschlangenposition noch voraussichtlichen Startzeitpunkt.

Bewahre die `messageId` aus der `202`-Antwort auf. Unter dieser ID wird die Assistentenantwort gespeichert. Frage die Generierung alle zwei bis fünf Sekunden ab und werte ihren Zustand aus:

| Generierungsstatus | Bedeutung und nächster Schritt |
| --- | --- |
| `queued` | Angenommen, wartet auf einen Worker; weiter abfragen. Bis ein Worker den Lauf öffnet, ist diese Abfrage die einzige Sicht darauf: `GET .../messages` listet den Lauf noch nicht (die Seite liest sich ohne ihn als vollständig), und `.../messages/{messageId}` kann für die vom Senden genannte ID **404** antworten |
| `streaming` | Der Anbieter erzeugt die Ausgabe; `text` und `reasoning` enthalten den bisherigen Zwischenstand |
| `idle`, passende `lastMessageId` | Dein Antwortlauf ist beendet; `lastStatus` nennt das Ergebnis |
| `idle`, andere `lastMessageId` | Die Zusammenfassung gehört zu einer anderen Nachricht; lies deine gespeicherte Nachrichten-ID direkt |

Lies das Ergebnis unter `GET /api/v1/projects/{id}/threads/{threadId}/messages/{messageId}`. Mit `GET .../messages?order=desc` blätterst du den Verlauf von der neuesten Nachricht aus. Ein Cursor bleibt an seine ursprüngliche Sortierrichtung gebunden. Ein späterer Antwortlauf kann die Zusammenfassung ändern: Eine andere ID beweist deshalb nicht, dass dein früherer Aufruf nie ausgeführt wurde.

Setze ein Zeitlimit je Statusanfrage und eine separate Gesamtdauer für deinen Client; 30 Sekunden je gewöhnlicher Abfrage sind ein sinnvoller Ausgangspunkt. Der Server hat keine feste Gesamtdauer für einen Antwortlauf. Nach 180 Sekunden ohne Anbieteraktivität bricht er die Anfrage ab. Jedes empfangene Byte, auch Reasoning, setzt diese Uhr zurück. Hohe Denktiefe kann den Lauf daher ohne sichtbaren Antworttext aktiv halten. Wenn du ihn nicht mehr brauchst, rufe `DELETE .../generation` auf, statt nur die Abfrageschleife zu beenden.

Für inkrementelle Updates sende die bisherige `textLength` als `since` und `reasoningLength` als `reasoningSince`. Die Einheit sind UTF-16-Code-Units — JavaScripts `String.length`, ein Emoji zählt zwei; keine Codepunkte —, gib also die Längen zurück, die der Poll geantwortet hat, statt selbst Zeichen zu zählen. `textOffset` und `reasoningOffset` zeigen den Beginn der zurückgegebenen Ausschnitte: der Wert, den du gesendet hast, eins darunter, wenn er ein Surrogatpaar zerschnitten hätte (der Ausschnitt schickt das ganze Zeichen dann noch einmal), oder 0, wenn eine abgeschlossene Tool-Runde den Ausgabestrom zurückgesetzt hat. Setze nach einer Regel zusammen, `held = held.slice(0, textOffset) + text`, und keiner der drei Fälle braucht eine eigene Behandlung.

Ging die Sendeantwort verloren, lies zuerst `.../generation`, bevor du erneut sendest. `queued` und `streaming` kennzeichnen einen aktiven Antwortlauf. Bei `idle` prüfe die neueste Assistentenantwort oder suche die neueste Benutzernachricht mit deinem `content`. Ohne gespeicherte Nachrichten-ID darfst du eine andere aktuelle Antwort nicht einfach dem verlorenen Aufruf zuordnen.

### Eine Nachricht sicher erneut senden

Sende einen stabilen `Idempotency-Key` für die Nachricht. Eine Wiederholung innerhalb von 24 Stunden liefert dieselbe `202`-Antwort einschließlich `messageId` und zusätzlich `duplicate: true`. Es wird kein zweiter Antwortlauf gestartet oder abgerechnet. Derselbe Schlüssel mit anderem Body führt zu `409 IDEMPOTENCY_KEY_REUSED`.

Der Schlüssel gilt für den Thread und das Projekt in der URL. Ein abgelehnter Aufruf, etwa wegen eines laufenden Antwortlaufs, wird nicht gespeichert. Du kannst denselben Schlüssel erneut verwenden, sobald die Generierung `idle` meldet.

Ein optionaler `Idempotency-Key` muss nach dem Entfernen äußerer Leerzeichen 1–255 druckbare ASCII-Zeichen enthalten. Ein vorhandener, aber leerer, zu langer oder anders kodierter Header ergibt `400 INVALID_HEADER`; `data.issues` nennt den Header, und nichts startet. Verwende für eine Wiederholung denselben getrimmten Wert und denselben Body. Lasse den Header nur weg, wenn du keinen Schutz vor doppelter Ausführung brauchst.

### Assistentenverhalten und Token-Grenzen verstehen

Ein Antwortlauf, technisch ein Turn, umfasst die gesamte Verarbeitung einer angenommenen Nachricht einschließlich Modellrunden und Tool-Aufrufen. REST-Chat verwendet den integrierten Arbeitsbereichsassistenten mit seinen Anweisungen, Sicherheitsregeln und drei Recherche-Tools. Diese belegen ungefähr 3.000 Prompt-Tokens je Modellrunde und zählen zu `usage.inputTokens`. Mit Tools kann ein Lauf bis zu fünf Runden umfassen, deren vollständiger Prompt jeweils abgerechnet wird. Wünsche nach Arbeitsergebnissen wie Dokumenten oder Berichten verweist der Assistent an Aufgaben.

Projekt-Threads können Dateien dieses Projekts und die Wissensdatenbank der Organisation abrufen, aber keine Dateien anderer Projekte. Threads ohne Projekt greifen nur auf die Wissensdatenbank zu. Ob eine Suche nötig ist, entscheidet der Assistent anhand der Frage. Ein Dateiname oder eine ausdrückliche Suchanweisung verdeutlicht dein Ziel; kein Anfragefeld erzwingt jedoch einen Suchaufruf.

| Feld | Verhalten |
| --- | --- |
| `reasoningEffort` | `low`, `medium`, `high`, `extra` oder `max`; ohne `capabilities.reasoning` ignoriert |
| `maxOutputTokens` | Gesamtbudget des Antwortlaufs über alle Modellrunden; höchstens die Modellgrenze aus `/models` |

Ein zu hohes Ausgabebudget ergibt `400 INVALID_BODY` mit der Obergrenze. Jede Runde erhält nur das Restbudget; ist es aufgebraucht, startet keine weitere. Reasoning-Tokens zählen zu diesem Budget und zu `usage.outputTokens` und werden zum Preis für Ausgabe-Tokens berechnet. Sie können die gesamte Grenze verbrauchen: Dann endet ein berechneter Antwortlauf mit `complete` und `finishReason: "length"`, aber ohne Antworttext. Erhöhe das Ausgabebudget oder reduziere die Denktiefe, wenn deine Aufgabe eine sichtbare Antwort benötigt.

Eine Ausnahme gilt für Anbieter mit einem ausdrücklichen Denkbudget nach dem Extended-Thinking-Verfahren von Anthropic: Werte unter 2.048 werden auf 2.048 angehoben, damit mindestens 1.024 Tokens fürs Denken und ebenso viele für die Antwort verfügbar sind. Modelle mit einer Denktiefenstufe, darunter GLM und DeepSeek, haben diese Untergrenze nicht.

Lies `finishReason`, statt nur `status: "complete"` oder die Token-Zahl zu prüfen. Mögliche Werte sind `stop`, `length`, `tool-calls`, `content-filter`, `cancelled` und `other`; ohne Anbieterangabe fehlt das Feld. Erreicht eine Runde die Längengrenze, wird keiner ihrer Tool-Aufrufe ausgeführt, auch wenn einzelne Argumente vollständig sind. Jeder zurückgehaltene `tool-result` hat `status: "invalid_args"`; seine Meldung unterscheidet vollständige von abgeschnittenen Argumenten. Prüfe daher Abbruchgrund und Tool-Ergebnisse, selbst wenn der abschließende Text vollständig wirkt.

Eine leere Antwort oder ein Abbruch vor dem ersten Text hat keinen Textteil. `parts` kann leer sein oder nur Reasoning- und Tool-Teile enthalten. Prüfe auf tatsächlichen Text, bevor du eine Antwort anzeigst oder exportierst.

Threads, Nachrichten und Generierungsstatus sind nur für ihren Besitzer sichtbar. Eine gemeinsame Projektmitgliedschaft gibt keinen Einblick in fremde Chats. `GET /api/v1/projects/{id}/threads` listet deine Threads; `GET /api/v1/projects/{id}/threads/{threadId}` liest einen davon.

### Sprache, Status, Verbrauch und Nachrichtenteile lesen

`content` wird getrimmt. Ein leerer Prompt — nichts als Leerraum und unsichtbare Formatzeichen wie Leerzeichen ohne Breite — führt ohne Antwortlauf zu `400` (Markdown, das als nichts gerendert wird, etwa ein leerer Codeblock, ist trotzdem ein Prompt). Mit `locale` kannst du einen BCP-47-Sprachcode wie `de` oder `en-GB` angeben. Er weist den Assistenten über System- und Nachrichtenanweisungen an, in dieser Sprache zu antworten. Verbindliche Organisationsanweisungen haben Vorrang. Ohne `locale` nutzt der Assistent die Sprache des Prompts.

Die Sprache ist eine Anweisung an das Modell, keine validierte Ausgabegarantie. Gerade bei kurzen Prompts mit aktiviertem Reasoning kann die Antwort abweichen. Es gibt dafür kein Fehlerkennzeichen. Wenn eine bestimmte Sprache zwingend ist, prüfe die Antwort vor ihrer Verwendung.

| Nachrichtenstatus | Bedeutung |
| --- | --- |
| `pending` | Assistentenzeile mit leeren `parts` vorhanden; die Generierung nennt ihre `messageId` |
| `complete` | Antwortlauf beendet; `finishReason` auf Längengrenzen oder andere Abbruchgründe prüfen |
| `cancelled` | Gestoppt, mit bereits eingetroffenen Teilinhalten |
| `failed` | Fehlgeschlagen, mit `error` und gegebenenfalls `errorCode` |

| Verbrauchsfeld | Bedeutung |
| --- | --- |
| `inputTokens`, `outputTokens` | Gemeldete Eingabe- und Ausgabetokens |
| `reasoningTokens` | Anteil der Ausgabetokens fürs Denken; fehlend bedeutet nicht gemeldet, `0` bedeutet ausdrücklich null |
| `cachedInputTokens` | Anteil der Eingabetokens aus dem Cache des Anbieters |
| `costEstimateCents` | Katalogschätzung in US-Cent mit Nachkommastellen, auf ein Millionstel Cent gerundet; fehlt ohne Katalogpreis |
| `estimated: true` | Von der Plattform geschätzte Werte, meist bei verlorenen Anbieterzahlen nach einem Abbruch |
| `stepLimitHit: true` | Die Tool-Schleife hat ihr vollständiges Rundenbudget verbraucht |

Die Verbrauchserfassung bucht dieselbe Katalogschätzung. Eingaben aus dem Cache werden zum normalen Eingabepreis angesetzt; bei solchen Aufrufen ist die Schätzung daher eine Obergrenze. Geschätzter Verbrauch berücksichtigt den vollständigen Prompt einschließlich der Assistenten-Tools. Schlägt ein Lauf fehl, bevor Zähler verfügbar sind, fehlt `usage`.

`parts` ist eine geordnete Liste mit dem Unterscheidungsfeld `type`: `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval` oder `human-input`. OpenAPI beschreibt jede Variante als eigenes benanntes Schema (`TextPart`, `ReasoningPart`, `AttachmentPart`, `ToolCallPart`, `ToolResultPart`, `ApprovalPart`, `HumanInputPart`) hinter einem `type`-Diskriminator mit explizitem Mapping, ein generierter Client bekommt also eine Klasse je Art. Behandle künftig unbekannte Varianten als undurchsichtige Daten, statt die gesamte Nachricht abzulehnen.

Ein `reasoning`-Teil enthält Überlegungen, nicht die abschließende Antwort. Er kann dem Modell übergebene Anweisungen wiedergeben, darunter Organisations- und Projektanweisungen sowie Vertrauensregeln für abgerufene Inhalte. Zeige ihn getrennt und nur Personen, die diese Anweisungen sehen dürfen.

### Thread-Kontext und Zugriff beachten

Für persönliche Chats ohne Projekt verwendest du `/api/v1/threads` sowie die zugehörigen Detail-, Nachrichten- und Statuspfade. Projektthreads sind dort nicht erreichbar. Ein falsches Projekt in der URL ergibt **404**. Beide Chatarten verwenden den eingebauten Assistenten; `projectId`, `agentSlug` oder `agentId` beim Anlegen oder Senden ergibt **400**. Projektleser einschließlich Mitgliedern dürfen Threads anlegen und Nachrichten senden. Ein archiviertes Projekt verweigert diese Aufrufe mit **403**.

Ein archivierter Thread verweigert eine Nachricht mit **409**, `CHAT_THREAD_ARCHIVED`, ein Sandbox-Thread mit **409**, `CHAT_THREAD_NOT_DIRECT`, und ein Thread, dessen Turn noch läuft — oder dessen angenommenes Senden noch in der Warteschlange steht —, mit **409**, `CHAT_TURN_IN_PROGRESS`; nichts wird eingereiht, und der laufende Turn behält seine `messageId`. Den letzten wiederholst du, sobald die Abfrage idle meldet, die anderen beiden nie.

### Thread umbenennen, archivieren, löschen oder stoppen

Den Lebenszyklus steuerst du über dieselben URLs. `PATCH .../threads/{threadId}` mit `{ "archived": true }` archiviert einen Thread, `false` holt ihn zurück (ein Thread, dessen Turn läuft oder dessen Senden noch wartet, weist das Archivieren wie das Löschen mit **409** `CHAT_TURN_IN_PROGRESS` ab — brich zuerst ab; Zurückholen und Umbenennen bleiben mitten im Turn offen), und `{ "title": "Q3 review" }` benennt ihn um (sende mindestens eines von beiden; ein Titel wird getrimmt und hat 1–120 Zeichen, beim Anlegen wie beim Umbenennen); einen ohne Titel angelegten Thread benennt der Assistent nach seiner ersten Nachricht, und das `title` des Threads trägt den Namen in beiden Fällen.

Archivieren stempelt `archivedAt` auf den Thread und lässt `updatedAt` in Ruhe — `updatedAt` ist die letzte Nachrichtenaktivität, ein Abgleich, der darauf schaut, muss also `archived` und `archivedAt` lesen, um ein Archivieren oder Zurückholen zu sehen. `DELETE .../threads/{threadId}` verschiebt ihn in den Papierkorb (**409**, `CHAT_TURN_IN_PROGRESS`, solange ein Turn läuft oder ein Senden noch in der Warteschlange steht); `DELETE .../threads/{threadId}/generation` bittet den laufenden Turn zu stoppen — **202** `{ "status": "cancelling", "messageId": "..." }`, danach pollst du bis idle; die gestoppte Antwort landet als `status: "cancelled"` mit dem, was schon gestreamt war.

Ein Senden, das noch in der Warteschlange steht (der Poll sagt `queued`), wird genauso gestoppt: **202** mit der Antwort, die die 202 des Sendens versprochen hat, das Modell wird nie aufgerufen, und diese Antwort landet als `cancelled` mit leeren `parts`. Läuft nichts und wartet nichts, **404**, `CHAT_TURN_NOT_RUNNING` — sein `data.lastMessageId` und `data.lastStatus` nennen die neueste Assistenten-Nachricht, wie ein idle-Poll es tut, ein Stopp, der das Rennen gegen ein schnelles Modell verloren hat, liest sich also ohne zweiten Aufruf als „die Antwort ist schon da". Ein archiviertes Projekt verweigert alle drei mit **403**.

### Modell- und Zugriffsfehler beheben

Ein Modellfehler kann als Assistenten-Nachricht mit lesbarem `error` und, wenn verfügbar, `errorCode` erscheinen. Die Modellliste ist der konfigurierte Katalog der Organisation, kein Versprechen des Anbieterkontos — zwei Codes meinen deshalb das Konto, nicht die Anfrage: `credit_exhausted` (Guthaben aufgebraucht) und `model_not_entitled` (der Tarif des Anbieters enthält dieses Modell nicht). `error` ist die Antwort des Anbieters selbst, mit seinem HTTP-Status davor — eine **429** des Anbieters kann als `model_not_entitled` eingestuft werden, wenn der Tarif und nicht die Rate das Modell verweigert hat —, verzweige also auf `errorCode`, nie auf den Satz.

Wähl ein anderes Modell oder bring das Konto in Ordnung — Warten ändert nichts, und keiner von beiden ist ein `rate_limited`. Vor dem Öffnen des Turns prüft der Worker den angenommenen Thread und den Projektzugriff erneut. Wechselt der Thread während der Wartezeit das Projekt oder entfällt der Zugriff, führt er den Turn nicht aus und schreibt auch keine Fehlermeldung in den neuen Kontext.

## Die Dateien eines Projekts durchsuchen

Verwende die Projekt-URL, wenn alle Treffer aus einem Projekt stammen sollen. Die Suche erfasst ausschließlich dessen indexierte Dateien und verlangt Leserechte, auch bei einem archivierten Projekt. Dokumente der Wissensdatenbank oder von Teams, andere Projekte, Websites und E-Mail-Anhänge bleiben außen vor. Lass `corpus` weg oder setze es auf `"documents"`. Ein anderer Korpus oder `projectId` im Anfrageinhalt ergibt **400**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Frist für die Q1-Meldung", "limit": 10 }'
```

### Suchwerte und Fehler einordnen

`query` ist erforderlich und wird vor der Prüfung getrimmt. Optional sind `limit` (1–50, Standard 10) und `minSimilarity` (0–1). Tale sucht zunächst in einem größeren Kandidatenpool, prüft die aktuelle Sichtbarkeit jedes Dokuments und begrenzt erst nach dem Zusammenführen die Ergebnismenge. `limit: 1` liefert so die beste lesbare Passage (bei gleichem `fusedScore` geht eine Passage, die der Stichwort-Zweig gerankt hat, einer vor, die nur der Vektor-Zweig gefunden hat, danach die niedrigere Zeilenidentität — ein exakter Begriff ist ein stärkerer Beleg als ein nächster Nachbar).

`minSimilarity` begrenzt nur die Vektorsuche, bevor deren Ergebnisse mit den Stichworttreffern zusammengeführt werden. Für die REST-Route gibt es keinen Standardwert; auch schwache Vektortreffer können deshalb erscheinen. Die Stichwortsuche hat keine solche Untergrenze. Der eingebaute Assistent verwendet hingegen die Organisationskonfiguration: `minSimilarity` in [`embedding.json`](/de/self-hosted/configuration/data-residency#das-embedding-modell-der-organisation), standardmäßig 0,45.

| Feld | Bedeutung und Grenze |
| --- | --- |
| `fusedScore` | Sortierwert aus Σ 1/(60+Rang) der passenden Suchzweige, normalisiert am bestmöglichen Wert für deren Anzahl. Nur innerhalb derselben Antwort vergleichbar; keine Konfidenz. Der beste Treffer einer Suche mit nur einem Zweig kann 1,0 erreichen, auch wenn er inhaltlich schwach passt. |
| `similarity` | Kosinuswert der Vektorsuche auf der modellabhängigen Skala 0–1; `null` bei reinen Stichworttreffern — die behältst du, ein exakter Bezeichner- oder Phrasentreffer ist ein stärkerer Beleg als jeder Kosinus (im Code: `hits.filter(h => h.similarity === null ? h.keywordScore !== null : h.similarity >= floor)`). Für eine Schwelle nutzbar, aber keine kalibrierte Wahrscheinlichkeit. |
| `keywordScore` | Unbeschränktes BM25-Gewicht der Stichwortsuche; `null` bei reinen Vektortreffern. |
| `matchedLegs` | Suchzweige, die den Treffer geliefert haben: `documents:keyword`, `documents:dense`, `web:keyword`, `web:dense`. |
| `legs` | Anzahl dieser Zweige; 2, wenn Stichwort- und Vektorsuche dieselbe Passage finden. |
| `score` | Ursprünglicher Wert des ersten passenden Suchzweigs. |

Hohe Ähnlichkeit allein beweist keine passende Antwort. Unbekannte oder falsch geschriebene Begriffe können unerwartete Vektortreffer erzeugen. Prüfe die Passage selbst, besonders wenn ein Dokumenttreffer ohne `documents:keyword` ausschließlich aus der Vektorsuche stammt. Unsichtbare Dokumente werden vor der Zusammenführung entfernt und beeinflussen die Rangfolge nicht.

Jeder Treffer enthält die Passage und ihre `source`. `diagnostics.cached` und `diagnostics.reranked` sind für zusätzliche semantische Caches oder Reranker vorgesehen; in der ausgelieferten Implementierung bleiben beide `false`. `diagnostics.legs` nennt jeden Zweig, der gelaufen ist, mit den zugelassenen Kandidaten, die er beigesteuert hat — `0`, wenn er lief und nichts übrig blieb (`documents:dense: 0` ist ein Vektor-Zweig, der im Geltungsbereich nichts gefunden hat, nie ein fehlender) —, und `diagnostics.dense` ist nur dann `false`, wenn der Korpus den Vektor-Zweig gar nicht bedienen konnte, so wie `diagnostics.bm25` für den Stichwort-Index. Passagen tragen außer Tab, Zeilenvorschub und Wagenrücklauf keine Steuerzeichen, und eine Passage, die sich innerhalb eines Dokuments wiederholt — ein Export aus einer Zeile, ein Bericht aus einer Vorlage —, wird einmal indexiert, über ihr erstes Vorkommen, eine Datei voller Duplikate verstopft also weder den Vektor-Zweig noch rankt sie ihre Kopien eine nach der anderen. Dokumenttreffer enthalten neben der Blob-`ref` auch `source.documentId`:

- Ohne Projektzuordnung (`source.projectId: null`) verwendest du `GET /api/v1/documents/{id}`.
- Bei Projektdateien verwendest du `GET /api/v1/projects/{projectId}/files/{documentId}/content` oder `DELETE .../files/{documentId}`. Die organisationsweite Dokumentroute ergibt dafür **404**.

| Antwort | Nächster Schritt |
| --- | --- |
| **409** `EMBEDDING_NOT_CONFIGURED` | Ein Admin muss ein Embedding-Modell konfigurieren. |
| **409** `EMBEDDING_CREDIT_EXHAUSTED` | Guthaben, Ausgabenlimit und Tarif des Anbieterkontos prüfen. |
| **409** `EMBEDDING_CREDENTIAL_REJECTED` | Zugangsdaten und Berechtigung für das Modell korrigieren. |
| **503** `EMBEDDING_UPSTREAM_ERROR` | `Retry-After` beachten und mit wachsender Wartezeit erneut versuchen. |

Die beiden Kontofehler sind keine Rate-Limits; Warten allein behebt sie nicht. Für sichtbare Dokumente der Wissensdatenbank und von Teams ohne Projektzuordnung sowie registrierte Websites verwendest du `POST /api/v1/knowledge/search`. Dort erlaubt `corpus` `"documents"`, `"web"` und den Standard `"all"`. Projektdateien und E-Mail-Anhänge sind ausgeschlossen. Beide Suchen finden nur dateigestützte Dokumente; Inline-`content` wird nicht indexiert.

## Ein externes System in ein Projekt spiegeln

Die Projekt-Gruppe ist für einen unbeaufsichtigten Worker gebaut, der ein externes System — ein CRM, eine Kanzleisoftware — nach Tale spiegelt: das Projekt des Kunden finden oder anlegen, Ordner vorbereiten, Dateien hochladen, prüfen. Jeder Aufruf handelt als der Benutzer, der den Schlüssel erzeugt hat: ein Projekt, das dieser Benutzer nicht sieht, antwortet wie eines, das nicht existiert, und Schreiben braucht eine bearbeitende Rolle (Redakteur oder höher — Mitglied liest hier nur) plus Bearbeitungszugriff auf das Projekt.

Diese Routen — und die Aufgaben-Routen unten — raten nie, welche Organisation gemeint ist: ein Schlüssel, dessen Benutzer mehreren Organisationen angehört, muss `X-Organization-Slug` bei jedem Aufruf senden — eine Anfrage ohne den Header antwortet **400**. Erzeuge Maschinen-Schlüssel für einen eigenen Benutzer mit genau einer Mitgliedschaft, und die Frage stellt sich nie; die Beispiele senden den Header trotzdem — er wird immer auf Mitgliedschaft geprüft, nie ignoriert.

### Projekt finden oder anlegen

Ein Projekt trägt sein Publikum in `teamIds` — die Teams, die es sehen dürfen; leer heißt die ganze Organisation. Die IDs liest du aus `GET /api/v1/teams` (jedes Team mit Namen, mit `member: true` bei denen, in denen der Schlüsselbesitzer Mitglied ist — wer kein Organisations-Admin ist, darf nur diese nennen), schickst sie bei `POST /api/v1/projects` mit oder ersetzt die ganze Menge mit `PATCH /api/v1/projects/{id} { "teamIds": [...] }` (ein Admin-Verb). Eine wiederholte ID fällt auf eine zusammen, das Publikum erneut zu nennen, das das Projekt schon trägt, ist ein No-op und lässt `updatedAt` in Ruhe, und ein archiviertes Projekt weist die Änderung wie jede andere Schreiboperation ab (**403**, `PROJECT_ARCHIVED`), es sei denn, derselbe Body stellt es wieder her.

`externalItemId` ist dein Schlüssel, nicht der von Tale — ein opaker String (die Datensatz-ID deines CRM), eindeutig pro Organisation, von der Plattform nie interpretiert. Gespeichert und verglichen wird er nach NFC-Normalisierung und Trimmen: Ein Schlüssel, den ein macOS-Dateisystem in NFD übergibt, findet das Projekt, das ein Worker aus einer CSV in NFC angelegt hat, und ein Zeilenumbruch am Ende einer Shell-Variable erzeugt nie ein zweites Projekt.

Eine Altzeile, deren Schlüssel sich von einem anderen nur in der Normalisierung unterschied, hat die Plattform freigegeben — ihre `externalItemId` ist leer, die Zeile mit der kanonischen Schreibweise hat den Schlüssel behalten —, gib ihr also mit `PATCH /api/v1/projects/{id}` einen neuen Schlüssel, wenn sie die gemeinte ist. Schlag ihn zuerst nach; die Suche antwortet mit höchstens einem Projekt, und ein Treffer, den der Benutzer des Schlüssels nicht sehen darf, sieht genauso aus wie keiner:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — oder [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

Ein Treffer trägt `archivedAt`, wenn das Projekt archiviert ist — entscheide vorher, was dein Worker mit diesem Fall macht. Ohne `externalItemId` listet dieselbe Route jedes Projekt, das der Benutzer des Schlüssels sehen darf, die neuesten zuerst, Keyset-paginiert wie jede andere Liste — `{projects, isDone, continueCursor}`; gib `continueCursor` als `?cursor=` zurück, bis `isDone` gilt (solange weitere Seiten bleiben, trägt die Antwort auch `cursor`, dasselbe Token unter seinem Namen vor 1.5 — veraltet, lies `continueCursor`; ein Nachschlagen antwortet `isDone: true` mit leerem `continueCursor`) —, archivierte Projekte ausgenommen, sofern du nicht danach fragst (`?archived=include` oder `?archived=only`).

Jede Zeile trägt `createdAt` und `updatedAt`, ein Worker kann also abgleichen, was er angelegt hat:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?limit=50" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711", "createdAt": 1774..., "updatedAt": 1774... } ], "isDone": true, "continueCursor": "" }
```

Eine leere Suche heißt anlegen:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (das Präfix der Aufgaben-Kennungen) und `description` sind optional — der Key leitet sich aus dem Namen ab, wenn du ihn weglässt. Ein zweites Anlegen mit derselben `externalItemId` — derselben nach NFC-Normalisierung und Trimmen — antwortet **409**; derselbe String in einer anderen Organisation ist in Ordnung, die Eindeutigkeit gilt pro Organisation. Ein Schlüssel, der getrimmt leer ist, ergibt **400**, `INVALID_BODY`.

Ein expliziter Projekt-`key` besteht aus 2–6 Buchstaben oder Ziffern, beginnt mit einem Buchstaben und landet in Großbuchstaben. Ungültige Werte ergeben **400**, ohne Kürzung. Lässt sich aus dem Namen kein gültiger Key ableiten, entsteht das Projekt ohne Key. Kollidiert ein abgeleiteter Key, leitet Tale so lange neu ab, bis er frei ist; ein expliziter Key, der kollidiert, ergibt **409**, `PROJECT_KEY_TAKEN` — sende einen freien mit. Dieselbe `externalItemId` ein zweites Mal ergibt **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

### Ordner anlegen

Ordner entstehen per Get-or-create: derselbe Name unter demselben Elternordner — verglichen ohne Rücksicht auf Groß- und Kleinschreibung, `inbox` und `INBOX` sind also ein Ordner — antwortet mit dem bestehenden Ordner, seinem gespeicherten Namen und `created: false` (**200**) statt mit einem Duplikat; ein Worker darf seinen Setup-Schritt nach einem Absturz blind wiederholen, und zwei Worker, die denselben Ordner gleichzeitig anlegen, bekommen einen Ordner.

Ein Name ist ein Name, nie ein Pfad: Ein `/` oder `\`, ein Steuerzeichen, `.` oder `..` ergibt **400**, `FOLDER_NAME_INVALID`, der Satz nennt die verletzte Regel und `data.issues` nennt `name` — dieselbe Regel, der ein Dateiname folgt, und wie ein Dateiname wird der Ordnername getrimmt und NFC-normalisiert gespeichert —, und `parentId` ist entweder ein Ordner dieses Projekts oder bleibt für einen Wurzelordner weg (ein leeres ergibt **400**, `INVALID_BODY`). Ordnernamen haben keine plattformseitig reservierte Bedeutung — das Layout gehört dir:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (ein Ordner dieses Projekts) verschachtelt tiefer; lass es für einen Wurzelordner weg. Ein Name hat höchstens 128 Zeichen, wird getrimmt und ist nie ein Pfad — `a/b`, `.` und `..` ergeben **400**, `FOLDER_NAME_INVALID` —, und ein Ordner in 20 Ebenen Tiefe nimmt kein Kind mehr an (**400**, `FOLDER_DEPTH_EXCEEDED`).

Der Baum liest sich Ebene für Ebene zurück: `GET .../folders` listet die Wurzelordner, `GET .../folders?parentId=<folderId>` die Kinder eines Ordners, und jeder Ordner trägt seine `parentId` (`null` an der Wurzel); `GET .../folders/{folderId}` löst einen einzelnen Ordner auf — die `folderId`, die jede Datei in `GET .../files` trägt —, ein Worker, der den Baum nicht gebaut hat, kann ihn also trotzdem entdecken, und ein Pfad ist die aufwärts gelaufene Elternkette. Eine `parentId` oder `folderId`, die kein Ordner dieses Projekts ist, ergibt **404**, `FOLDER_NOT_FOUND`.

### Eine Datei in zwei Schritten hochladen

Zwei REST-Aufrufe umgeben einen direkten Upload zum Objektspeicher: Übergabe vorbereiten, Bytes übertragen und dann dem Projekt zuordnen. Das Shell-Beispiel benötigt `jq`, einen vorhandenen Projektordner und eine lokale Datei mit erlaubter Endung und passendem MIME-Typ. Führe den nächsten Befehl erst aus, wenn der vorherige erfolgreich war.

```bash
: "${TALE_URL:?Set TALE_URL to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${TALE_ORG_SLUG:?Set TALE_ORG_SLUG}"
: "${TALE_PROJECT_ID:?Set TALE_PROJECT_ID}"
: "${TALE_FOLDER_ID:?Set TALE_FOLDER_ID to a folder in this project}"
: "${FILE_PATH:?Set FILE_PATH to an existing local file}"
: "${FILE_MIME:?Set FILE_MIME, for example application/pdf}"

FILE_NAME=$(basename "$FILE_PATH")
FILE_SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
UPLOAD_BODY=$(jq -n --arg name "$FILE_NAME" --arg type "$FILE_MIME" \
  --argjson size "$FILE_SIZE" '{fileName:$name,contentType:$type,size:$size}')
UPLOAD_JSON=$(curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/uploads" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$UPLOAD_BODY")
UPLOAD_ID=$(printf '%s' "$UPLOAD_JSON" | jq -er '.uploadId')
UPLOAD_URL=$(printf '%s' "$UPLOAD_JSON" | jq -er '.url')
FILE_REF=$(printf '%s' "$UPLOAD_JSON" | jq -er '.s3Ref')
printf '%s' "$UPLOAD_JSON" | jq '{uploadId,method,expiresAt,maxBytes}'
```


#### Bytes vor dem Zuordnen senden

Die zurückgegebene `url` ist eine vorsignierte URL für einen direkten `PUT` zum Objektspeicher. Sende keinen `Authorization`-Header: Die URL enthält bereits eine Signatur; eine zusätzliche Authentifizierung wird abgewiesen. Falls du bei der Vorbereitung einen `contentType` angegeben hast, muss der `Content-Type` des PUT exakt damit übereinstimmen. Ohne diese Angabe ist kein bestimmter Header vorgeschrieben. Verwende anschließend die zurückgegebene `s3Ref` als `fileId` beim Zuordnen.

Gib `fileName` schon bei der Vorbereitung an, etwa `"fileName": "ledger-2026-q1.pdf"`. Tale prüft dann Dateiformat und Upload-Richtlinie, bevor es eine URL ausstellt. Ein nicht erlaubter Dateityp oder ein Name ohne Endung ergibt **400** mit `UPLOAD_POLICY_REJECTED` oder `UNSUPPORTED_FILE_TYPE`. Ein angegebener MIME-Typ ersetzt die erforderliche Endung nicht.

`maxBytes` nennt die zulässige Dateigröße für den angegebenen Typ: höchstens 100 MiB (104.857.600 Bytes), bei einer strengeren Organisationsrichtlinie entsprechend weniger. Mit dem optionalen Feld `size` lässt du die geplante Größe vorab prüfen. Über der Plattformgrenze folgt **400** `FILE_TOO_LARGE`; bei einer verletzten Organisationsgrenze oder einem ausgeschöpften Volumenkontingent folgt **400** `UPLOAD_POLICY_REJECTED`. `data.limitBytes` nennt die Grenze.

Die Vorprüfung spart die Übertragung einer zu großen Datei. Beim Zuordnen zählt trotzdem die tatsächliche Größe im Objektspeicher. Tale vergleicht sie mit den geltenden Grenzen, nicht mit der zuvor deklarierten `size`; eine zu kleine Größenangabe umgeht die Prüfung daher nicht.

Übertrage die Bytes an die zurückgegebene URL. Sende dorthin keinen Tale-API-Schlüssel: Die Signatur authentifiziert den Zugriff auf den Objektspeicher bereits. Ordne die Datei erst nach erfolgreichem Upload zu.

```bash
curl --fail-with-body --silent --show-error --request PUT "$UPLOAD_URL" \
  --header "Content-Type: $FILE_MIME" \
  --upload-file "$FILE_PATH"
```

```bash
BIND_BODY=$(jq -n --arg upload "$UPLOAD_ID" --arg ref "$FILE_REF" \
  --arg folder "$TALE_FOLDER_ID" --arg name "$FILE_NAME" \
  '{uploadId:$upload,fileId:$ref,folderId:$folder,fileName:$name}')
curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/files" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$BIND_BODY"
```

Die Zuordnung liefert `201 {file}` mit der neuen Dokument-ID. Bewahre `file.id` für spätere Abrufe, Downloads, Indexierung oder Löschung auf. Sie unterscheidet sich von `uploadId` und `s3Ref`.

#### Ablauf, Formatregeln und abgebrochene Uploads behandeln

`uploadId` lässt sich einmal verwenden. Sie und die vorsignierte URL laufen nach 30 Minuten ab; `expiresAt` gilt für beide. Ist die Frist nach einem abgebrochenen Upload verstrichen, bereite einen neuen Upload vor.

`fileName` muss ein einzelner Dateiname sein. Tale entfernt äußere Leerzeichen und normalisiert ihn nach NFC. Pfadtrenner oder Steuerzeichen ergeben **400**. Eine erlaubte Dateiendung ist bei Vorbereitung und Zuordnung erforderlich: Namen wie `CON` oder `attachment-4711` ergeben `UNSUPPORTED_FILE_TYPE`, auch wenn du `contentType` angibst.

Beim Zuordnen prüft Tale die Upload-Richtlinie erneut. Erlaubt sind `pdf`, `doc`, `docx`, `odt`, `ppt`, `pptx`, `xls`, `xlsx`, `csv`, `txt`, `md`, `json`, `yaml`, `yml`, `py`, `jpg`, `jpeg`, `png`, `gif`, `webp` und `ac2` (Banana-Buchhaltungsjournal), soweit die Organisation diese Formate zulässt. Die Meldung zu `UNSUPPORTED_FILE_TYPE` enthält die sortierte Formatliste. Ein nicht erlaubtes Format oder eine überschrittene Größenbegrenzung ergibt **400** mit dem jeweiligen Fehlercode.

Sind die Bytes noch nicht im Objektspeicher angekommen, folgt **404** `BLOB_NOT_FOUND`. Die Upload-ID bleibt nach dieser Ablehnung verwendbar: Führe den PUT aus und wiederhole die Zuordnung mit derselben ID.

Ohne konfigurierten Objektspeicher ergeben Vorbereitung und Zuordnung **503** `OBJECT_STORE_UNCONFIGURED`. Nicht zugeordnete Blobs werden automatisch bereinigt: frühestens 24 Stunden nach Ablauf der 30-minütigen Upload-Frist, bei einer späteren Upload-Vorbereitung in derselben Organisation. Jede solche Anfrage bereinigt einen Stapel abgelaufener Upload-Datensätze samt Blobs. Das betrifft auch abgelehnte Zuordnungen und Uploads, deren Client zwischen Übertragung und Zuordnung abgebrochen ist.

Bis zur Bereinigung liegen diese Bytes im Bucket, erscheinen aber in keiner Dateiliste und zählen nicht zum Kontingent.

#### Über die Dateiindexierung entscheiden

Projektdateien werden standardmäßig nicht für die Wissenssuche indexiert: Beim Zuordnen gilt `skipRagIndexing: true`. Setze den Wert auf `false`, wenn die Datei in die Projektsuche aufgenommen werden soll. Projektdateien erscheinen unabhängig davon nicht unter `/api/v1/documents`; diese Route ist für Dokumente der Wissensdatenbank vorgesehen.

Der Projektchat kann auch nicht indexierte Dateien auflisten. Im Tab **Wissen** des Projekts steht eine solche Datei als **Nicht indexiert**. Für die Suche musst du sie erst indexieren: über **Jetzt indexieren** in der Dateizeile oder `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`.

Der REST-Aufruf verwendet dieselbe Indexierungslogik und dasselbe Budget von 10 Aufrufen pro Benutzer und Minute wie bei Dokumenten der Wissensdatenbank. Er hebt die bisherige Ausnahme von der Indexierung auf und liefert `{"status": "indexing"}` oder `skipped` mit einem `reason`. Eine reine Textdatei bis 4 MiB kann der Assistent auch ohne Indexierung lesen: `rag_fetch` mit ihrer ID liefert den Text direkt.

Der gespeicherte `mimeType` wird aus der Dateierweiterung bestimmt und beim Download als `Content-Type` verwendet. Der Medientyp eines Multipart-Uploads oder ein Upload-Hinweis überschreibt diese Regel nicht.

### Prüfen, was angekommen ist

Mit `folderId` wählst du den Bereich: Ohne den Parameter erhältst du alle Projektdateien, mit `folderId=root` nur Dateien ohne Ordner auf der obersten Projektebene. Eine Ordner-ID liefert die Dateien dieses Ordners. Gehört der Ordner nicht zum Projekt, lautet die Antwort **404**, `FOLDER_NOT_FOUND`.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "mimeType": "application/pdf", "size": 48213, "indexing": { "status": "skipped" }, "createdAt": 1774... } ], "isDone": true, "continueCursor": "" }
```

Jede Dateizeile enthält die tatsächliche `size` und ein `indexing`-Objekt mit denselben Statuswerten wie bei `/api/v1/documents`. Nach einer Zuordnung mit dem Standard `skipRagIndexing: true` lautet der Status `skipped`. Starte bei Bedarf `POST .../files/{documentId}/retry-indexing` und frage den Zustand erneut ab. Erst `completed` bestätigt die abgeschlossene Indexierung für die Suche.

Die Liste liefert `{files, isDone, continueCursor}`. Solange `isDone` `false` ist, übergib das unveränderte, signierte Token als `?cursor=`. `?limit=` erlaubt höchstens 100 Einträge. Wenn weitere Seiten folgen, enthält die Antwort zusätzlich das veraltete Feld `cursor` aus der Zeit vor Version 1.5; verwende in neuen Clients `continueCursor`.

Für eine einzelne Datei genügt `GET /api/v1/projects/{id}/files/{documentId}`. Die Antwort `{file}` enthält `id`, `fileName`, `folderId`, `mimeType`, `createdAt` und `size` in Bytes (`null`, wenn unbekannt) sowie den Indexierungszustand, sofern vorhanden. Sende den `ETag` als `If-None-Match`, um bei unverändertem Zustand `304` zu erhalten. Nach `POST .../retry-indexing` kannst du diese eine Zeile abfragen, bis die Indexierung endet; ein erneuter Durchlauf durch die ganze Dateiliste ist unnötig. Fehlende, gelöschte, projektfremde oder nicht dateibasierte Einträge ergeben einheitlich `404 FILE_NOT_FOUND`.

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/projects/<projectId>/files/<documentId>" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

### Löschen, was du nicht mehr brauchst

`DELETE .../files/{documentId}` löscht eine Projektdatei endgültig: Dokumentdatensatz, Suchdaten und Blob werden gemeinsam bereinigt. Erfolg ergibt **204**; eine fehlgeschlagene Bereinigung wird als Fehler zurückgegeben.

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

`DELETE .../folders/{folderId}` löscht einen Ordner samt Unterordnern und Dateien. Tale bereinigt zuerst die Dateien einschließlich ihrer Suchdaten und entfernt dann den Teilbaum. Liegt darin ein geschütztes gelenktes Dokument oder ein Dokument unter Legal Hold, wird die gesamte Aktion vor der ersten Änderung mit **409** abgewiesen.

Kann die Bereinigung im Objektspeicher nicht abgeschlossen werden, folgt **503** `PURGE_INCOMPLETE`; es wurde nichts entfernt. Wiederhole die Anfrage. Beide Löschrouten verlangen Bearbeitungsrechte auf ein aktives Projekt. Bereits gelöschte Ressourcen und IDs aus anderen Projekten ergeben **404** mit `FILE_NOT_FOUND` beziehungsweise `FOLDER_NOT_FOUND`.

#### Projekt archivieren, umbenennen oder löschen

Auch das Projekt selbst hat einen Lebenszyklus, für Organisations-Admins (**403**, `ROLE_FORBIDDEN`, für alle anderen). `PATCH /api/v1/projects/{id}` mit `{ "archived": true }` archiviert es — es bleibt über diesen Zugang lesbar, verweigert jedes Schreiben mit **403**, `PROJECT_ARCHIVED`, hält seine `externalItemId` belegt, und `{ "archived": false }` holt es zurück.

Derselbe `PATCH` trägt die Identität, die ein Spiegel weiterreicht, wenn sich der Quelldatensatz ändert: `name` (getrimmt, nie leer), `description` (`null` leert sie) und `externalItemId` (NFC-normalisiert und getrimmt gespeichert; `null` gibt den Schlüssel frei, der Schlüssel eines anderen Projekts ergibt **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`, mit dem Schlüssel in `data`) — für Redakteure mit Projektbearbeitungsrechten an einem aktiven Projekt, jedes Feld optional und mindestens eines Pflicht. Ein Body, der zurückholt und umbenennt, wendet das Zurückholen zuerst an, einer, der umbenennt und archiviert, das Archivieren zuletzt; ein archiviertes Projekt umzubenennen, das der Body nicht zurückholt, ergibt **403**, `PROJECT_ARCHIVED`.

Wird aus „ACME Ltd“ im CRM „ACME Group“, ist `{ "name": "ACME Group" }` der ganze Umzug — nichts unter dem Projekt wird angefasst. `DELETE /api/v1/projects/{id}` entfernt es und gibt den Schlüssel frei: standardmäßig als Kaskade — jedes Dokument läuft in die Aufbewahrungs-Pipeline ab, deine eigenen Chats wandern in den Papierkorb, jede Aufgabe wird stillgelegt und ihre laufenden Läufe abgebrochen — oder, mit dem Body `{ "mode": "detach" }`, werden Dokumente und Chats stattdessen in die Organisation entlassen. Die Laufhistorie des Projekts geht in beiden Fällen mit, beendete Läufe eingeschlossen — anders als beim Löschen einer Automatisierung, das ihre Läufe behält.

Agenten und Ordner gehen in beiden Fällen mit dem Projekt, und eine Kaskade zehrt vom selben Budget pro Benutzer wie das Löschen in der App (5 pro Minute):

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

Das Löschen wird mit **409** abgewiesen, bevor irgendetwas geschrieben ist, solange eine Automatisierung im Projekt installiert ist — `PROJECT_HAS_BOUND_AUTOMATIONS`, `data.automations` nennt sie; deinstalliere jede zuerst über `DELETE /projects/{id}/automations/{name}` —, solange eine Kaskade ein gelenktes Dokument zerstören würde, das in Prüfung oder genehmigt ist oder eine genehmigte Version behält (`PROJECT_HAS_PROTECTED_RECORDS`, `data.documents` nennt sie), oder solange ein Legal Hold eines seiner Dokumente erfasst (`PROJECT_LEGAL_HOLD`).

## Eine Aufgabe anlegen, dann ausführen

Die Aufgabenrouten machen aus einem externen Datensatz eine Aufgabe auf dem Projektboard, starten einen bereitgestellten Workflow und liefern die Ergebnisse zurück. Eine projektgebundene Automatisierung muss zuvor in diesem Projekt installiert sein. Das Installieren ist idempotent: **201** beim ersten Aufruf, **200** bei vorhandener Bindung. Es verlangt die Entwickler-Fähigkeit und Bearbeitungsrechte auf ein aktives Projekt. Fehlen dem Worker diese Rechte, richte die Bindung vorher ein:

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` listet die in diesem Projekt installierten Automatisierungen. Eine Automatisierung ganz ohne Projektbindungen darf ebenfalls in einem zugänglichen Projekt laufen, wenn der Aufrufer die nötigen Bearbeitungsrechte hat; in der Liste der installierten Automatisierungen erscheint sie jedoch nicht. `DELETE /api/v1/projects/{id}/automations/{name}` entfernt eine Installation wieder — **204**, oder **404** `AUTOMATION_NOT_INSTALLED`, wenn sie dort nicht installiert war — unter derselben Entwickler-Fähigkeit und denselben Bearbeitungsrechten.

### Gespiegelte Aufgabe erstellen oder aktualisieren

Das Anlegen einer Aufgabe ist pro `(projectId, externalSystem, externalId)` idempotent: Der erste Aufruf legt sie an (**201**, `created: true`) — in `backlog`, der Eingangsspalte des Spiegels, während die App eine neu angelegte Aufgabe unter „To do“ einsortiert —, ein erneuter liefert dieselbe Aufgabe (**200**, `created: false`). Beide Schlüssel werden nach NFC-Normalisierung und Trimmen gespeichert und verglichen — dieselbe Regel wie bei der `externalItemId` eines Projekts —, eine Wiederholung mit Leerzeichen drumherum oder anderer Normalisierung ist also noch dieselbe Aufgabe, und ein Schlüssel, der getrimmt leer ist, ergibt **400**. Die `projectId` kommt aus der URL; im Anfrageinhalt ergibt sie **400**. Zum Anlegen brauchst du Bearbeitungsrechte auf ein aktives Projekt.

`externalState` übernimmt den Zustand des Quelldatensatzes nach folgenden Regeln:

- `closed` setzt die Aufgabe auf `in_review`, damit eine Person den Abschluss prüft. Nur die Workflow-Engine setzt einen automatischen Abschluss direkt auf `done`.
- `open` setzt eine zuvor durch diese Spiegelung geschlossene Aufgabe aus `in_review` oder `done` zurück auf `backlog`.
- Hat eine Person oder ein Agent den Zustand geändert, überschreibt `open` diese Entscheidung nicht. Eine Statusänderung über das Board beendet die Zuständigkeit der Spiegelung für den zuvor gesetzten Status.
- Abgebrochene Aufgaben bleiben abgebrochen.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Ein erneuter Aufruf mit derselben externen Referenz einer aktiven Aufgabe aktualisiert Titel und Beschreibung. Ohne `description` wird die Beschreibung gelöscht; Labels ändern sich nur, wenn du sie mitsendest. Archivierte Aufgaben bleiben unverändert. Die Aufgaben-ID bleibt gleich; `runWorkflowSlug` startet dabei keinen weiteren Lauf. Sende beim Wiederholen nach einer verlorenen Antwort dieselben Daten.

### Einrichtungsordner und Automatisierungszuordnung festlegen

Optional sind `description`, `labels`, `externalUrl` und `setupFolderName`. `title` erlaubt höchstens 200 Zeichen. Eine direkt angegebene `externalUrl` muss eine absolute `http(s)`-URL sein. Ungültige Werte ergeben **400**; Tale kürzt oder ersetzt sie nicht automatisch.

Mit `setupFolderName` wählst du einen Wurzelordner des Projekts anhand seines Namens, unabhängig von Groß- und Kleinschreibung. Tale speichert dessen ID als `externalUrl` der Aufgabe. Eine Automatisierung kann so den Einrichtungsordner aus ihrer Aufgaben-Eingabe lesen. Bei wiederholten Anfragen wird der Name erneut aufgelöst.

Ein Name, den kein Wurzelordner des Projekts trägt, ergibt **400**, `SETUP_FOLDER_MISSING`, und es entsteht keine Aufgabe; zusammen mit `externalUrl` gesendet ergibt er **400**, `INVALID_BODY`.

Labelnamen werden getrimmt und nach NFC normalisiert. Der Abgleich mit vorhandenen Projektlabels ignoriert Groß- und Kleinschreibung. Neue Labels werden in der gesendeten Schreibweise angelegt; vorhandene behalten ihre gespeicherte Schreibweise. Die Antwort übernimmt deine Reihenfolge. So bleibt `["Bug", "P1"]` unverändert, während `["bug"]` bei einem vorhandenen Label `Bug` auf dieses Label verweist. Namen, die sich nur in der Schreibweise unterscheiden, erzeugen keine zwei Labels.

Mit `automationSlug` weist du die Aufgabe einer Automatisierung zu. Diese Zuordnung aktiviert im Aufgabendialog den Arbeitsbereich mit Startschaltfläche, Fortschritt und Rückfragen des Laufs. Eine spätere Anfrage ergänzt eine fehlende Zuordnung, überschreibt aber keine bereits zuständige Person oder Automatisierung.

`runWorkflowSlug` startet einen bereitgestellten Workflow direkt beim Anlegen einer neuen Aufgabe. Der Start erfolgt vor der Antwort; diese enthält die `runId` für spätere Statusabfragen. Das veraltete Feld `executionId` enthält denselben Wert. Gibt es unter dem Slug keine bereitgestellte Automatisierung oder schlägt der Start nach dem Speichern der Aufgabe fehl, ist `runId` `null`. Die Aufgabe bleibt gespeichert. Prüfe den Workflow und verwende nach der Korrektur den separaten Startaufruf.

Verwende den separaten Startaufruf, wenn du den Workflow erst nach dem Anlegen auswählen möchtest. Eine angegebene `automationSlug` muss auf eine vorhandene Automatisierung mit bereitgestellter Version verweisen: Andernfalls folgen **404** `AUTOMATION_NOT_FOUND` oder **409** `AUTOMATION_NOT_DEPLOYED` mit dem Namen. Eine Automatisierung, die ausschließlich an andere Projekte gebunden ist, ergibt **403**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "runId": "<runId>", "executionId": "<runId>" }
```

### Prüfen, ob ein Aufgabenlauf gestartet wurde

Zum Starten brauchst du Bearbeitungsrechte auf ein aktives Projekt und eine aktive Aufgabe — eine archivierte Aufgabe ergibt **403**, `TASK_ARCHIVED` (das Lesen der Aufgabe trägt `archivedAt`, solange sie es ist; `PATCH …/tasks/{taskId}` mit `{ "archived": false }` stellt sie wieder her — siehe unten). Der Lauf erhält die Aufgabe als `{task: ...}`; eine zusätzliche Entwickler-Fähigkeit ist dafür nicht nötig. Das Laufprotokoll ordnet den Start deinem Schlüssel zu. Polle `GET /api/v1/projects/{id}/runs/{runId}` mit der `runId` (`executionId` trägt denselben Wert und ist veraltet).

Die Antwort ist **200**, ob ein Lauf gestartet ist oder nicht, verzweige also auf `started`, nie auf den Status allein: Bei `started: false` liefert `reason: "already_running"` die `runId` des bereits laufenden Laufs — eine Aufgabe hält höchstens einen lebenden Lauf, egal welche Automatisierung ihn gestartet hat, dieser Lauf kann also zu einer anderen Automatisierung gehören (sein `name` sagt, zu welcher); polle diesen. Ein Workflow, der an andere Projekte gebunden ist, ergibt **403**, `AUTOMATION_PROJECT_FORBIDDEN`.

Der `workflowSlug` benennt die Automatisierung so, wie `GET /api/v1/automations` sie listet — in der `/`-Form (`billing/dunning`), nie in der `__`-Schreibweise des URL-Pfads —, und muss eine benennen, die es gibt — sonst **404**, `AUTOMATION_NOT_FOUND` — und die eine bereitgestellte Version hat: Eine gespeicherte, aber nicht bereitgestellte ergibt **409**, `AUTOMATION_NOT_DEPLOYED`, und nennt sie — dieselben zwei Ablehnungen, die das Anlegen einer Aufgabe einem `automationSlug` gibt, beurteilt, bevor das Execute-Budget belastet wird; `reason: "not_started"` bleibt dem einen Restfall vorbehalten, einer Bereitstellung, die zwischen dieser Prüfung und dem Start zurückgezogen wurde.

Gleichzeitige Starts derselben Aufgabe verwenden denselben laufenden Durchgang, egal welche Automatisierung sie nennen. Das ist keine Unterstützung für `Idempotency-Key` bei Aufgabenstarts: Nach dessen Abschluss kann ein weiterer Start einen neuen Lauf erzeugen. Speichere die zurückgegebene `runId` und prüfe diesen Lauf, bevor du einen unklaren Start wiederholst.

### Aufgabe archivieren oder wiederherstellen

`PATCH /api/v1/projects/{id}/tasks/{taskId}` mit `{ "archived": true }` archiviert die Aufgabe — genau wie das Board: sie bleibt hier lesbar und verweigert Kommentare und Starts mit **403**, `TASK_ARCHIVED` — und `{ "archived": false }` stellt sie wieder her. Beides ist idempotent; ein Spiegel, der eine Aufgabe ablöst (eine erneute Lieferung, die eine neue Aufgabe eröffnet hat, ein storniertes Quellobjekt), legt die alte Aufgabe ab, ohne sie vorher zu lesen. Nötig sind Bearbeitungsrechte auf ein **aktives** Projekt (**403**, `PROJECT_ARCHIVED` oder `RBAC_FORBIDDEN`); die Aufgabe selbst darf archiviert sein — dafür ist die Wiederherstellung da. Der Body enthält genau `archived`; Titel, Beschreibung und Labels laufen über die Wiederholung der Aufnahme. Die Antwort ist die Aufgabe in ihrem neuen Zustand.

```bash
curl -sS --compressed -X PATCH "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "archived": true }'
# → 200 { "task": { "id": "<taskId>", "status": "in_progress", "archivedAt": 1789921403000, ... } }
```

### Kommentieren und Aufgabenstatus lesen

Melde zurück und lies den Zustand — der Kommentar erscheint als der Benutzer, der den Schlüssel erzeugt hat, ununterscheidbar von derselben Person in der App, @-Erwähnungen eingeschlossen. Projektleser einschließlich Mitgliedern dürfen eine aktive Aufgabe in einem aktiven Projekt kommentieren; eine archivierte Aufgabe verweigert den Kommentar mit **403**, `TASK_ARCHIVED`, so wie ein archiviertes Projekt mit `PROJECT_ARCHIVED`. Nach der Archivierung bleiben Aufgabe und Kommentare lesbar. Jede Aufgaben-URL wird von links nach rechts beurteilt: Ein fehlendes oder unsichtbares Projekt ergibt **404**, `PROJECT_NOT_FOUND`, und nur eine Aufgabe, die fehlt oder zu einem anderen Projekt gehört, ergibt `TASK_NOT_FOUND`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

### Kommentare und Arbeitsergebnisse lesen

Beim Schreiben eines Kommentars kannst du neben dem ursprünglichen `body` optional `bodyByLocale` mitsenden. Beim Lesen wird es zurückgegeben, sofern vorhanden. Liefere inhaltlich gleichwertige, nicht leere Übersetzungen für `en`, `de` und `fr`; weitere Sprach- oder Sprachregionsschlüssel wie `nl`, `it` und `de-CH` sind erlaubt. Jeder Wert wird außen von Leerraum bereinigt und darf höchstens 10.000 Zeichen enthalten; pro Kommentar sind bis zu 16 Sprachvarianten erlaubt. Zeige zuerst die genaue Spracheinstellung des Lesers, danach die Grundsprache, dann `en` und zuletzt `body` an. Als Autor bleibt der Schlüsselinhaber eingetragen. Eine reine Textbearbeitung in Tale entfernt die alten Übersetzungen, damit sie die Änderung nicht verdecken.

Aufgaben- und Workflow-Agenten erhalten die Anweisung, die Sprache aus Titel und Beschreibung der Aufgabe beizubehalten. Ist keine erkennbar, gilt die Standardsprache der Organisation für Agenten. Vorgegebene Wörter einer Titelvorlage, Quartalskennungen, die Sprache der Quelldokumente und die Oberflächensprache der startenden Person legen die Aufgabensprache nicht fest. Das gilt auch für Rückfragen, fortgesetzte Läufe und neue zugehörige Aufgaben. Dies sind Anweisungen an das Modell; gespeicherte Übersetzungen von Fortschrittsmeldungen erlauben Clients, die angezeigte Sprache unabhängig davon zu wählen.

Lies die Lauf-Ausgabe und die Kommentare, um die Ergebnisse der Automatisierung abzurufen. Ob sie zusätzlich Dateien erstellt und in welchem Ordner diese liegen, bestimmt der Workflow; aus dem Aufgabenstart allein folgt keine Ablage im Beispielordner.

Kommentare werden seitenweise geliefert: zuerst die neueste Seite, innerhalb jeder Seite chronologisch. `limit` ist standardmäßig 200 und höchstens 500. Solange `isDone` `false` ist, übergib `continueCursor` unverändert als `cursor`, um ältere Kommentare zu lesen. Das Token ist signiert und keine Seitennummer.

Der Content-Endpoint streamt die Bytes selbst (**200**, kein Redirect, dem du folgen müsstest), benannt über eine `Content-Disposition` nach RFC 6266; ein schlichtes `curl -o` legt die Datei also ab, und `--fail-with-body` macht aus einer Ablehnung einen Exit-Code ungleich null statt einer Datei voller JSON.

`Range` wird beachtet: Ein einzelner Bytebereich (`bytes=0-1023`, `bytes=1024-`, `bytes=-512`) antwortet **206** mit `Content-Range`; ein Bereich, der am oder hinter dem Dateiende beginnt — was `curl -C -` sendet, sobald die lokale Kopie vollständig ist —, antwortet **416** mit leerem Body und `Content-Range: bytes */<size>` mit der Größe, ein fortsetzender Worker erfährt also, dass er fertig ist; mehrere Bereiche oder ein `Range`, das der Server nicht lesen kann, werden ignoriert, und die ganze Datei antwortet **200**.

Ein `HEAD` antwortet mit denselben Kopfzeilen, die ein `GET` trägt — `Content-Length`, `Content-Type`, `ETag`, `Last-Modified`, `Accept-Ranges` —, ohne die Bytes, und ignoriert `Range`, ein Poller prüft also mit `curl -I` (nicht `curl -X HEAD`, das auf einen Body wartet) auf eine neue Version und sendet den `ETag` als `If-None-Match` zurück, um **304** zu bekommen, solange sich nichts geändert hat:

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "…", ... } ], "isDone": false, "continueCursor": "<opakes Token>" }

curl -sS --compressed --fail-with-body "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -o report.md
# → die Datei-Bytes (Content-Disposition trägt den Dateinamen)
```

## Fehlermodell

Ablehnungen der API verwenden normalerweise dieses flache JSON-Format. Antworten ohne Body, etwa `304` oder `HEAD`, und die oben beschriebenen frühen Ablehnungen am Proxy sind Ausnahmen:

```json
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` beschreibt das Problem für Menschen; `code` ist der stabile Wert für deine Programmlogik. Das OpenAPI-Schema `Error.code` enthält die bekannten Codes. Neue Codes können mit einem Minor-Release hinzukommen: Behandle unbekannte Werte anhand des HTTP-Status, statt die Antwort zurückzuweisen.

Das optionale Feld `data` ergänzt strukturierte Angaben, etwa `issues` bei ungültigen Eingaben, `retryAfterMs` bei einem Rate-Limit oder `providers` bei einem mehrdeutigen Modell. Werte bekannte Codes gezielt aus und verwende den Status als Rückfall:

**400: Korrigiere die Anfrage vor dem nächsten Versuch.** Ungültige Anfrageinhalte ergeben `INVALID_BODY` mit `data.issues`. Jedes Problem enthält einen Feldpfad wie `price` oder `contacts.2.email` und eine kurze Meldung, etwa `is required`, `must be a string`, `must not be blank`, `must be at most 200 characters` oder `must be one of "a", "b"`. Unbekannte Schlüssel werden unter ihrem eigenen Namen gemeldet. Verwende `code` für die Programmlogik; die Meldung ist für Menschen bestimmt.

Die Prüfung weist fehlende Pflichtwerte, falsche Typen, unbekannte Schlüssel, ungültiges JSON oder UTF-8, NUL-Zeichen, ungepaarte UTF-16-Surrogate, ganze Zahlen jenseits von 2^53 − 1 und Zahlen außerhalb ihres Feldbereichs ab. Ein Such-`limit` im JSON-Body wird bei Überschreitung abgewiesen, nicht begrenzt. Die API liest den Body unabhängig von `Content-Type` als JSON und liefert dafür kein 415.

| Weitere 400-Codes | Bedeutung und Korrektur |
| --- | --- |
| `INVALID_CURSOR` | Das Token stammt nicht aus dieser Liste. Beginne die Seitennavigation ohne Token neu. |
| `INVALID_LIMIT` | Ein Query-`limit` ist keine ganze Zahl. Ganze Zahlen außerhalb des Bereichs werden dagegen auf die Grenze begrenzt. |
| `INVALID_QUERY` | Ein anderer Query-Parameter ist ungültig. `data.issues` nennt den Parameter; Query-Fehler führen nie unbemerkt zur ersten Seite zurück. |
| `AUTOMATION_INPUT_INVALID` | Korrigiere die Eingabe anhand des `inputs`-Schemas und der `data.issues`. |
| `AUTOMATION_TRIGGER_INVALID` | Korrigiere einen nicht ausführbaren Trigger, etwa ein unmögliches Datum wie `0 0 30 2 *`. |
| `CONTACT_IDENTITY_REQUIRED` | Behalte mindestens ein Identitätsfeld des Kontakts. |
| `DOCUMENT_RECORD_FROZEN`, `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` | Verwende den Ersetzungsablauf für gelenkte Dokumente statt einer direkten Inhaltsänderung. |
| `ORG_SLUG_REQUIRED` | Gib bei mehreren Mitgliedschaften die Organisation an. |
| `INVALID_HEADER` | Verwende nach dem Trimmen 1–255 druckbare ASCII-Zeichen für `Idempotency-Key`; `data.issues` nennt den Header. |
| `INVALID_URL` | Entferne NUL-Bytes (`%00`) aus Pfad oder Query. Diese Prüfung findet vor Routing und Anmeldung statt. |
| `BODY_CHUNK_MALFORMED` | Korrigiere die HTTP/1.1-Chunk-Kodierung im Client oder Proxy. Die Edge-Antwort hat eine eigene `requestId` und keinen Vertragsversionsheader. |
| `BODY_LENGTH_MISMATCH` | Unter HTTP/2 endete der Body vor der angegebenen `Content-Length`. Die Proxyantwort enthält eine neue `requestId`, aber kein `X-Tale-Api-Version`. |

- **401** — fehlender oder ungültiger API-Schlüssel (`UNAUTHORIZED`), mit einer `WWW-Authenticate: Bearer`-Challenge.
- **403** — die Rolle (`ROLE_FORBIDDEN`, `KNOWLEDGE_ENTRY_FORBIDDEN`) oder Projektbearbeitungsrechte fehlen, die `teamIds` eines Dokuments oder Projekts benennen ein Team, dem der Besitzer nicht angehört (`TEAM_ACCESS_DENIED`), die gewünschte Änderung betrifft ein archiviertes Projekt oder eine archivierte Aufgabe (`PROJECT_ARCHIVED`, `TASK_ARCHIVED` — die `teamIds` eines Projekts eingeschlossen), die Automatisierung darf in diesem Projekt nicht laufen, oder `X-Organization-Slug` benennt eine Organisation, in der der Schlüsselbesitzer kein Mitglied ist (`ORG_FORBIDDEN`).
- **404** — die Ressource fehlt, ist für den Schlüsselbesitzer unsichtbar, gehört einem anderen Threadbenutzer oder liegt in einem anderen Projekt als dem der URL; jede Familie nennt ihren eigenen Code (`PROJECT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `THREAD_NOT_FOUND`, …), ein `X-Organization-Slug`, der keine Organisation benennt, antwortet `ORG_SLUG_INVALID`, und eine unbekannte Route antwortet `NOT_FOUND` — sobald der Schlüssel geprüft ist: Ohne Schlüssel kommt die **401** der Schnittstelle zuerst, ein Pfad, den diese Schnittstelle nie bedient hat (etwa `/api/v1/openapi.json`), antwortet also ohne Schlüssel **401** und mit Schlüssel **404**; das Dokument selbst liegt unter `/openapi.json`, außerhalb der Schnittstelle und ohne Schlüssel.
- **405** — die Route existiert, aber nicht für dieses Verb (`METHOD_NOT_ALLOWED`); `Allow` nennt die Verben, die sie bedient.
- **409** — der Zustand verhindert die Aktion: keine bereitgestellte Version, eine gebundene Automatisierung ohne Projekt-URL, ein beim Löschen noch laufender Lauf (`RUN_ACTIVE`), ein `Idempotency-Key`, der mit anderem Body wiederverwendet wurde (`IDEMPOTENCY_KEY_REUSED`), ein archivierter Thread oder laufender Turn, ein Duplikat — die `email` oder `externalId` eines Kontakts (`CONTACT_DUPLICATE_EMAIL`, `CONTACT_DUPLICATE_EXTERNAL_ID`), der `name` oder die `externalId` eines Produkts (`DUPLICATE_PRODUCT_NAME`, `DUPLICATE_PRODUCT_EXTERNAL_ID`), das Thema eines Wissenseintrags (`KNOWLEDGE_ENTRY_DUPLICATE`), die `externalItemId` eines Projekts (`PROJECT_DUPLICATE_EXTERNAL_ID`) —, ein abgelöster Wissenseintrag (`KNOWLEDGE_ENTRY_SUPERSEDED`), ein veraltetes `expectedUpdatedAt` (`CONTACT_STALE`, `PRODUCT_STALE`, `DOCUMENT_STALE`), ein Dokument, hinter dem ein aktiver Wissenseintrag steht (`DOCUMENT_HAS_KNOWLEDGE_ENTRY` — lösche oder ändere stattdessen den Eintrag), ein erneutes Anstoßen einer Zustellung, die nicht als unzustellbar abgelegt ist (`DELIVERY_RETRY_UNAVAILABLE`), ein neuerer Konversationsinhalt für einen Kontakt im Papierkorb (`CONVERSATION_CONTACT_TRASHED`) oder eine Suche ohne Embedding-Modell.
- **412** — eine Vorbedingung ist gescheitert, und nichts wurde geschrieben: `If-Match` auf einem Skill, dessen `SKILL.md` sich seit deinem Lesen geändert hat, oder ohne gespeichertes Dokument (`SKILL_STALE` — `data.etag` nennt den aktuellen Tag, `null`, wenn nichts gespeichert ist); `If-None-Match: *` auf einem Skill-Slug, der schon ein Bundle hat (`SKILL_EXISTS`).
- **413** — der Body ist zu groß (`BODY_TOO_LARGE`; der Satz nennt die Grenze): jeder JSON-Body an seiner Grenze (1 MiB, sofern die Operation nichts anderes sagt — die Grenzen stehen oben), der Webhook-Trigger an seiner Grenze von 256 KiB (262.144 Bytes). Eine hochgeladene Datei, die die Größen- oder Typ-Policy verletzt, wird beim Binden stattdessen mit **400** und einem Reason-Code abgewiesen.
- **422** — ein Skill-Bundle, das die Dateischicht nicht lesen kann — ein eingeschleuster Symlink, eine Datei über der Staging-Grenze von 4 MiB, eine `SKILL.md`, die sich nicht parsen lässt (`SKILL_MALFORMED`): kommt von den Lesezugriffen und bei `PUT` nur für das Bundle, das schon unter dem Slug gespeichert ist — der Body, den du sendest, wird als **400** validiert (`INVALID_BODY`, `INVALID_SKILL`), ein JSON-Body allein löst die 422 also nie aus.
- **429** — Rate-Limit erreicht (`RATE_LIMITED`). `error` beschreibt die Wartezeit; `requestId` identifiziert die Anfrage. Warte vor dem nächsten Versuch die Dauer aus `Retry-After` in ganzen Sekunden oder `data.retryAfterMs` in Millisekunden ab. Siehe [Rate-Limits](/de/develop/rate-limits).

| Status | Bedeutung und nächster Schritt |
| --- | --- |
| **414** | die Anfrage-URL (Pfad und Query) übersteigt 32 KiB (`URI_TOO_LONG`); der Umschlag trägt eine `requestId`. |
| **408** | die Anfrage ist nicht binnen 15 Minuten vollständig angekommen, Kopfzeilen und Body zusammen (`REQUEST_TIMEOUT`); der Umschlag trägt eine frische `requestId` (die abgebrochene Anfrage hat nie eine eigene bekommen), und die Verbindung wird geschlossen — wiederhole über eine schnellere Leitung oder in kleineren Stücken. |
| **431** | die Anfrage-Kopfzeilen insgesamt übersteigen das 64-KiB-Budget des Edge; unter HTTP/1.1 kommt die Antwort ohne Umschlag und ohne `X-Request-Id`, weil der Parser des Edge sie schreibt, bevor irgendeine Route läuft (und erst nach ein paar KiB Spielraum — eine URL oder Kopfzeile knapp über dem Budget erreicht die Plattform noch und wird nach deren Regeln beurteilt, eine 66-KiB-URL antwortet **414**), unter HTTP/2, wo das Budget exakt gilt, wird die Verbindung geschlossen. |
| **500** | interner Fehler (`INTERNAL_ERROR`); der Umschlag trägt eine `requestId`, die du beim Melden nennst. |
| **503** | eine Abhängigkeit, die die Anfrage brauchte, ist nicht erreichbar: der Embedding-Anbieter (`EMBEDDING_UPSTREAM_ERROR`, mit `Retry-After`), der Objektspeicher hinter einem Datei-Download (`OBJECT_STORE_UNAVAILABLE`, mit `Retry-After`) oder ein Deployment ohne Objektspeicher (`OBJECT_STORE_UNCONFIGURED`), eine Dokumentbereinigung, die nicht abschließen konnte (`PURGE_INCOMPLETE`), oder ein Objektspeicher, der das Schreiben eines Wissenseintrags angenommen und binnen 30 Sekunden nie beantwortet hat (`KNOWLEDGE_ENTRY_STORE_TIMEOUT` — nichts wird geschrieben) — wiederhole mit Backoff. |
| **502**, **503**, **504** | am Edge beantwortet, während die Plattform neu startet oder nicht erreichbar ist (`UPSTREAM_UNAVAILABLE`, mit `Retry-After`, einer frischen `requestId` und ohne `X-Tale-Api-Version`), an jedem Maschinenzugang — `/api/*`, `/events`, `/status.json`, `/openapi.json`, `/.well-known/*`; eine Browser-Navigation bekommt stattdessen die Wartungsseite — wiederhole mit Backoff. |

Auch ein Dokument-`If-Match`, das nicht mehr zur gelesenen Darstellung passt, ergibt `412 PRECONDITION_FAILED`. `data.etag` nennt den aktuellen Tag; nichts wurde geschrieben.

Das Lösen eines Triggers einer vorhandenen Automatisierung (`DELETE .../triggers`) antwortet mit **204**, auch wenn kein Trigger gebunden war. Eine unbekannte Automatisierung ergibt **404**. Das Löschen einer fehlenden Ressource ergibt ebenfalls **404**, auch bei einem Kontakt im Papierkorb, einem bereits gelöschten Produkt oder einem bereits gelöschten Wissenseintrag. Das `DELETE` eines Kontakts verschiebt ihn in den Papierkorb (`POST /api/v1/contacts/{id}/restore` holt ihn zurück); das eines Produkts ist endgültig — Produkte haben weder Papierkorb noch Wiederherstellung, und Name wie `externalId` sind sofort wieder frei für ein neues Produkt, das eine neue Zeile mit neuer ID ist. Das Löschen eines aktiven Wissenseintrags legt jede Version seines Themas still und verschiebt das Dokument der Wissensdatenbank dahinter in den Papierkorb — und nimmt dessen Passagen sofort aus dem Suchkorpus; dieses Dokument direkt zu löschen wird verweigert. Ein unbekannter Lauf ergibt beim Abbrechen **404**; `{cancelled: false}` bedeutet, dass der Lauf existiert und bereits beendet ist.

Die vollständige Liste der Fehlercodes kannst du ohne Schlüssel lesen:

```bash
curl --fail --silent --show-error "$TALE_URL/openapi.json" \
  | jq -r '.components.schemas.Error.properties.code.enum[]'
```

## Versionierung

Drei Nummern beschreiben eine laufende Instanz, und sie bedeuten Verschiedenes. Der Build (`GET /api/health` antwortet mit ihm) ist das Release des Deployments. Der REST-Präfix, `/api/v1/`, ist die Kompatibilitätslinie: Eine Route darunter wird bedient, bis ein `/api/v2/` existiert und die Abschaltung von `/api/v1/` in den Release-Notes mindestens zwei Minor-Releases im Voraus angekündigt wurde, mit `Deprecation`- und `Sunset`-Kopfzeilen auf den auslaufenden Routen in der Zwischenzeit.

`info.version` in `/openapi.json` beschreibt den API-Vertrag nach Semver: Ein Minor-Release ergänzt etwa eine Operation, ein Feld, einen Header oder einen Fehlercode. Eine Entfernung oder Bedeutungsänderung verlangt ein Major-Release. `X-Tale-Api-Version` nennt die implementierte Vertragsversion in jeder API-Antwort; damit erkennt ein Client Versionsänderungen.

Das OpenAPI-Dokument enthält Routen sowie Anfrage- und Antwortschemas der laufenden Instanz. `servers` verweist auf diese Instanz; unter `/docs` findest du die gerenderte Referenz.

Nutze das OpenAPI-Dokument als Vertrag für deinen Client. Unter **API-Vertragsänderungen** nennen die Release-Notes jede Änderung mit vorherigem und neuem Verhalten; siehe [Release-Notes-Format](/de/self-hosted/operate/release-notes/format).

Einige Endpunkte sind bewusst nicht in diesem Dokument enthalten: `GET /api/health` ist der Liveness-Probe ohne Anmeldung (`{"status":"ok","version":"<build>"}`), `GET /status` und `/status.json` die eigene [Status-Seite](/de/develop/status-page) des Deployments, `/openapi.json` und `/docs` der Vertrag selbst; die [WebDAV](/de/develop/webdav-api)- und OpenID-Connect-Oberflächen (oben) sprechen ihre eigenen Protokolle.

Veröffentlichte Versionshinweise findest du auf [GitHub Releases](https://github.com/tale-project/tale/releases).

## Wo das hingehört

Über den [MCP-Endpoint](/de/develop/mcp-endpoint) greifen MCP-Clients auf Tale zu und erstellen oder bearbeiten Automatisierungen. Die [Webhooks-Anleitung](/de/develop/webhooks) beschreibt eingehende Trigger, die Läufe ohne API-Schlüssel starten. Für die Arbeit mit Projekt-Agenten und Automatisierungen in der App führt dich der Bereich [Plattform](/de/platform) weiter.
