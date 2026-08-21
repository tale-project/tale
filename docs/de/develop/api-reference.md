---
title: API-Referenz
description: Wie du Tale von außen aufrufst — Authentifizierung, das Endpoint-Inventar, Pagination, die asynchronen Lauf- und Turn-Schleifen und das Fehlermodell. Die einzige Quelle der Wahrheit für die REST-Oberfläche.
i18nLintExclude:
  - terminology-loanword
---

Die Tale-API ist die Oberfläche für alle, die außerhalb des Produkts stehen und es skripten wollen: Wissensressourcen, Projekte mit ihren Dateien und Aufgaben, Automatisierungen und ihre Läufe, Chat-Threads, Agenten und Skills — alles als JSON über HTTPS, mit einem API-Schlüssel im Header. Derselbe Schlüssel öffnet auch den [MCP-Endpoint](/de/develop/mcp-endpoint) — diese Seite behandelt die REST-Hälfte.

Diese Seite ist das kanonische Inventar der Oberfläche, des Auth-Modells und der Fehlerform. Request- und Response-Schemas auf Feldebene liefert das OpenAPI-Dokument deiner Instanz unter `/docs` — lade es dort, wenn du jede Property brauchst; lies diese Seite, um zu verstehen, wie sich die API verhält.

## Eine erste Anfrage

Die kürzeste nützliche Anfrage — die Automatisierungen der Organisation auflisten — ist ein curl:

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Eine erfolgreiche Antwort ist eine Seite: `{ "page": [ { "name": "billing/dunning", "latest": 3, "deployedVersion": 2 } ], "isDone": true, "continueCursor": null }`. Jeder Listen-Endpoint antwortet mit genau diesem Umschlag — gib `continueCursor` als `?cursor=` zurück, um die nächste Seite zu holen, und begrenze die Seitengröße mit `?limit=`. Die eine Ausnahme ist der Maschinenzugang unter Projekte: seine Listen antworten leichter — sein Abschnitt zeigt die Formen.

## Authentifizierung

API-Schlüssel erzeugt jeder mit Admin- oder Entwickler-Berechtigungen im Produkt — [API-Schlüssel](/de/platform/admin/api-keys) beschreibt das Panel. Ein Schlüssel wird bei der Erstellung genau einmal gezeigt und nie wieder; er gehört dem Benutzer, der ihn erzeugt hat — jeder Aufruf handelt als dieser Benutzer.

Übergib den Schlüssel als Bearer-Token: `Authorization: Bearer <key>`. Die Organisation wird pro Anfrage aus den Mitgliedschaften des Schlüssel-Benutzers aufgelöst — ein Schlüssel erreicht genau die Organisationen, denen sein Benutzer angehört, sonst keine. Ein expliziter `X-Organization-Slug`-Header gewinnt immer und wird auf Mitgliedschaft geprüft: ein Slug, dessen Organisation der Benutzer nicht angehört, wird abgewiesen. Ohne Header landet ein Benutzer mit einer Organisation in dieser einen; ein Benutzer mit mehreren folgt der zuletzt im Dashboard aktiven Organisation — außer auf den Projekt- und Aufgaben-Routen, die nie raten: dort muss ein Multi-Org-Schlüssel den Header senden, und eine Anfrage ohne ihn antwortet **400**. Was der Schlüssel _tun darf_, folgt der Rolle seines Besitzers: Lesen und Mock-Läufe brauchen Mitgliedschaft; Live-Arbeit starten und Deploytes verändern braucht die Entwickler-Fähigkeit. Wo das zählt, sagen es die Abschnitte unten.

## Endpoint-Gruppen

| Gruppe            | Pfad                                    | Was sie abdeckt                                                                                                                      |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Automatisierungen | `/api/v1/automations/...`               | Auflisten, Versionen lesen, Läufe starten, Laufhistorie lesen, Trigger binden und lösen.                                             |
| Läufe             | `/api/v1/runs/{runId}`                  | Ein durabler Lauf in voller Tiefe — Status, Output, Trace, Effekte — plus `POST .../cancel`.                                         |
| Threads           | `/api/v1/threads/...`                   | Die Chat-Threads des Schlüsselbesitzers: erstellen, Nachrichten lesen, senden, Turn pollen.                                          |
| Agenten           | `/api/v1/agents/...`                    | Agenten der Organisation auflisten, lesen, anlegen oder ersetzen, löschen.                                                           |
| Skills            | `/api/v1/skills/...`                    | Dieselbe Form wie Agenten, für Skills.                                                                                               |
| Wissenseinträge   | `/api/v1/knowledge-entries/...`         | Themen-Fakten: auflisten, anlegen, ablösen, löschen.                                                                                 |
| Wissenssuche      | `POST /api/v1/knowledge/search`         | Semantische Suche über das indexierte Wissen der Organisation.                                                                       |
| Dokumente         | `/api/v1/documents/...`                 | Dokumente der Wissensdatenbank: CRUD plus `POST .../retry-indexing`. Projektdateien tauchen hier nie auf — sie leben unter Projekte. |
| Websites          | `/api/v1/websites/...`                  | Gecrawlte Quellen: CRUD plus `.../pages`, `.../sync`, `.../search`.                                                                  |
| Produkte          | `/api/v1/products/...`                  | Produktkatalog-Einträge: CRUD.                                                                                                       |
| Kontakte          | `/api/v1/contacts/...`                  | Kontaktdaten: CRUD plus `POST /api/v1/contacts/bulk`.                                                                                |
| Projekte          | `/api/v1/projects/...`                  | Der Maschinenzugang für externe Worker: per externer ID nachschlagen, anlegen, Ordner vorbereiten, Dateien hochladen.                |
| Aufgaben          | `/api/v1/tasks/...`                     | Idempotentes Anlegen aus einer externen Referenz, Zustand lesen, Workflow starten, kommentieren.                                     |
| MCP               | `POST /api/v1/mcp`                      | Der [MCP-Endpoint](/de/develop/mcp-endpoint) — derselbe Schlüssel, JSON-RPC statt REST.                                              |
| Webhook-Trigger   | `POST /api/automations/webhook/<token>` | Eine deployte Automatisierung von außen starten; die [Webhooks-Seite](/de/develop/webhooks).                                         |

## Automatisierungsnamen in URLs

Der Name einer Automatisierung ist ein `/`-Pfad — `billing/dunning` — und ein Pfad passt nicht in ein einzelnes URL-Segment. Schreib den Namen in jeder `/api/v1/automations/{name}/...`-URL mit `__` an Stelle jedes `/`:

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Antworten tragen immer den echten Namen (`"name": "billing/dunning"`); die `__`-Form existiert nur in URLs. Agent- und Skill-Slugs sind flach und brauchen keine Kodierung.

## Einen Lauf starten, dann pollen

Ein Lauf ist durabel und darf Minuten dauern — der Start antwortet deshalb mit **202** und der Identität des Laufs, nicht mit seinem Ergebnis:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Polle `GET /api/v1/runs/{runId}`, bis `status` `queued`/`running`/`waiting` verlässt; der fertige Lauf trägt `output`, den `trace` pro Knoten und die `effects`, die er erzeugt hat. `POST /api/v1/runs/{runId}/cancel` stoppt einen Lauf an seiner nächsten Knotengrenze — was ein Knoten schon getan hat, wird nicht rückgängig gemacht.

`mode` ist standardmäßig `live`. Ein Live-Lauf handelt im Namen der Organisation und braucht deshalb einen Schlüssel, dessen Besitzer die Entwickler-Fähigkeit hat; `{"mode": "mock"}` läuft gegen deterministische Mocks und braucht nur Mitgliedschaft. Ein Start braucht keinen Trigger — der API-Schlüssel ist die Berechtigung. Eine Automatisierung ohne deployte Version antwortet **409**; deploye eine Version, deren Tests bestehen, und derselbe Aufruf geht durch.

`projectId` benennt das Projekt, in dem der Lauf arbeitet — das Projekt, auf das seine Aufgaben- und Dokument-Tools wirken. Lässt du es weg, ist der Lauf organisationsweit — außer eine an ein einzelnes Projekt gebundene Automatisierung läuft automatisch in diesem einen; eine an mehrere gebundene akzeptiert nur eine `projectId` aus dieser Menge und weist jede andere ab.

## Eine Nachricht senden, dann den Turn pollen

Chat hat dieselbe 202-dann-pollen-Form. Erstelle einen Thread, sende eine Nachricht, polle die Generierung, lies dann die Nachrichten:

```bash
# 1. Ein eigener Thread
curl -sS -X POST "https://your-host.example.com/api/v1/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Nachricht senden — auf dieser API ist das Modell immer explizit, nie automatisch gewählt
curl -sS -X POST "https://your-host.example.com/api/v1/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Fasse mir dieses Quartal zusammen.", "model": "<ein Modell deiner Organisation>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/threads/<threadId>/generation" }

# 3. Bis idle pollen, dann lesen
curl -sS "https://your-host.example.com/api/v1/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY"
# → 200 { "status": "streaming" } … dann { "status": "idle" }
```

`{"status": "idle"}` heißt: kein Turn läuft — lies `GET /api/v1/threads/{id}/messages` für die Antwort. Ein Turn, der vor jeder Ausgabe scheitert, taucht trotzdem auf: der Fehler landet als Assistenten-Nachricht, nie lautlos. Über die API gelistete und gelesene Threads sind die des Schlüsselbesitzers; die Threads anderer Benutzer bleiben für deinen Schlüssel unsichtbar, auch innerhalb derselben Organisation.

## Ein externes System in ein Projekt spiegeln

Die Projekt-Gruppe ist für einen unbeaufsichtigten Worker gebaut, der ein externes System — ein CRM, eine Kanzleisoftware — nach Tale spiegelt: das Projekt des Kunden finden oder anlegen, Ordner vorbereiten, Dateien hochladen, prüfen. Jeder Aufruf handelt als der Benutzer, der den Schlüssel erzeugt hat: ein Projekt, das dieser Benutzer nicht sieht, antwortet wie eines, das nicht existiert, und Schreiben braucht eine bearbeitende Rolle (Redakteur oder höher — Mitglied liest hier nur) plus Bearbeitungszugriff auf das Projekt.

Diese Routen — und die Aufgaben-Routen unten — raten nie, welche Organisation gemeint ist: ein Schlüssel, dessen Benutzer mehreren Organisationen angehört, muss `X-Organization-Slug` bei jedem Aufruf senden — eine Anfrage ohne den Header antwortet **400**. Erzeuge Maschinen-Schlüssel für einen eigenen Benutzer mit genau einer Mitgliedschaft, und die Frage stellt sich nie; die Beispiele senden den Header trotzdem — er wird immer auf Mitgliedschaft geprüft, nie ignoriert.

### Projekt finden oder anlegen

`externalItemId` ist dein Schlüssel, nicht der von Tale — ein opaker String (die Datensatz-ID deines CRM), eindeutig pro Organisation, von der Plattform nie interpretiert. Schlag ihn zuerst nach; die Suche antwortet mit höchstens einem Projekt, und ein Treffer, den der Benutzer des Schlüssels nicht sehen darf, sieht genauso aus wie keiner:

```bash
curl -sS "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — oder [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

Ein Treffer trägt `archivedAt`, wenn das Projekt archiviert ist — entscheide vorher, was dein Worker mit diesem Fall macht. Eine leere Liste heißt anlegen:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (das Präfix der Aufgaben-Kennungen) und `description` sind optional — der Key leitet sich aus dem Namen ab, wenn du ihn weglässt. Ein zweites Anlegen mit derselben `externalItemId` antwortet **409**; derselbe String in einer anderen Organisation ist in Ordnung, die Eindeutigkeit gilt pro Organisation.

### Ordner anlegen

Ordner entstehen per Get-or-create: derselbe Name unter demselben Elternordner antwortet mit dem bestehenden Ordner und `created: false` (**200**) statt mit einem Duplikat — ein Worker darf seinen Setup-Schritt nach einem Absturz blind wiederholen. Ordnernamen haben keine plattformseitig reservierte Bedeutung — das Layout gehört dir:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (ein Ordner dieses Projekts) verschachtelt tiefer; lass es für einen Wurzelordner weg. `GET .../folders` listet die Wurzelordner.

### Eine Datei in zwei Schritten hochladen

Ein Upload ist ein Handoff, dann ein Binden. Hole zuerst den Handoff — er sagt dir, wohin die Bytes gehen:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/uploads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "application/pdf" }'
# → 200 { "uploadId": "...", "url": "https://...", "method": "POST", "expiresAt": 1774... }
```

`method` benennt die Storage-Spur, die du bekommen hast. `POST` zielt auf den Plattform-Speicher: sende die Bytes mit dieser Methode an `url`, und die Antwort trägt `{"storageId": "..."}` — das ist deine `fileId`. `PUT` ist eine vorsignierte URL für den eigenen Bucket der Organisation: sende die Bytes und binde dann die `s3Ref` aus dem Handoff als `fileId`. So oder so schließt das Binden den Upload ab:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<storageId oder s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

Die `uploadId` ist einmalig verwendbar und läuft nach 60 Minuten ab — ein Worker, der mitten im Upload abgestürzt ist, holt einen frischen Handoff, statt den alten zu wiederholen. Beim Binden gilt die Upload-Policy: ein zu großer Blob antwortet **413**, ein Typ außerhalb der erlaubten Liste **415**.

Dateien durch diesen Zugang sind Arbeitsmaterial des Projekts, kein Organisationswissen: sie werden standardmäßig nicht für die Wissenssuche indexiert (`skipRagIndexing` ist beim Binden standardmäßig `true`; sende `false`, um sie aufzunehmen), und sie tauchen nie unter `/api/v1/documents` auf — diese Familie bleibt die Oberfläche der Wissensdatenbank.

### Prüfen, was angekommen ist

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "createdAt": 1774... } ] }
```

Die Liste antwortet `{files, cursor?}`: ein `cursor` in der Antwort heißt, es gibt weitere Seiten — gib ihn als `?cursor=` zurück und begrenze die Seite mit `?limit=` (höchstens 100).

## Eine Aufgabe anlegen, dann ausführen

Die Aufgaben-Gruppe schließt den Kreis: der Worker macht aus einem externen Eintrag eine Aufgabe auf dem Board des Projekts, startet einen deployten Workflow darauf und meldet zurück. Eine Voraussetzung gibt es, wenn die Automatisierung projektgebunden ist: ihre Bindungen entscheiden, wo sie laufen darf — ein frisch angelegtes Projekt braucht die Bindung also einmal. Auch das ist ein API-Aufruf, idempotent (**201** beim ersten Binden, **200**, wenn die Bindung schon existiert), und er verlangt die Developer-Berechtigung — dieselbe Hürde wie das Bindungs-Panel im Dashboard. Präge den Key des Workers für einen Benutzer mit dieser Berechtigung, oder binde vorab:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/vat-return/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>" }'
# → 201 { "name": "vat-return", "added": true }
```

Eine Automatisierung ganz ohne Bindungen ist organisationsweit und braucht davon nichts — jedes Projekt sieht sie. Das Lösen einer Bindung bleibt eine Dashboard-Operation.

Das Anlegen einer Aufgabe ist idempotent pro `(projectId, externalSystem, externalId)` — der erste Aufruf legt an (**201**, `created: true`), jede Wiederholung antwortet mit derselben Aufgabe (**200**, `created: false`) — ein Worker, der nach dem POST abgestürzt ist, wiederholt also gefahrlos. `projectId` ist Pflicht; dieser Zugang fällt nie auf einen organisationsweiten Standard zurück.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>", "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

`description`, `labels` und `externalUrl` sind optional. Schick `automationSlug` mit, wenn die Aufgabe einer Automatisierung gehört: sie wird zum Assignee, und daran hängt das Arbeits-Panel des Aufgaben-Dialogs — der Start-Button, der Lauf-Fortschritt und die Fragen, die ein Lauf an den Operator stellt (ein späterer Re-Pick füllt eine fehlende Zuordnung nach, überschreibt aber nie einen Assignee). `runWorkflowSlug` plant im selben Aufruf einen deployten Workflow auf einer frisch angelegten Aufgabe ein — die Antwort trägt dann `executionId: null` (eingeplant, noch keine Lauf-Identität); für eine pollbare Lauf-ID starte explizit:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

Die Eingabe des Laufs ist die Aufgabe selbst — Starten braucht deshalb Mitgliedschaft und die Sichtbarkeit der Aufgabe, nicht die Entwickler-Fähigkeit: der privilegierte Akt war das Deployen des Workflows, und das Lauf-Log schreibt den Start deinem Schlüssel zu. Polle den Lauf am vertrauten `GET /api/v1/runs/{runId}`. `started: false` trägt einen `reason`: `already_running` antwortet mit der `executionId` des laufenden Laufs, statt ein Duplikat zu riskieren — polle diesen; `not_started` heißt, der Slug benennt keine deployte Automatisierung.

Melde zurück und lies den Zustand — der Kommentar erscheint als der Benutzer, der den Schlüssel erzeugt hat, ununterscheidbar von derselben Person in der App, @-Erwähnungen eingeschlossen:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

## Fehlermodell

Jede Nicht-2xx-Antwort trägt einen flachen Umschlag:

```json
{ "error": "Automation not found" }
```

Verzweige auf den HTTP-Status; die Meldung ist für Menschen:

- **400** — fehlerhafte Anfrage: fehlendes Pflichtfeld, falscher Typ, nicht parsebarer Body — oder ein Multi-Org-Schlüssel ohne `X-Organization-Slug` auf den Projekt- und Aufgaben-Routen.
- **401** — fehlender oder ungültiger API-Schlüssel.
- **403** — der Schlüssel ist gültig, aber der Rolle seines Besitzers fehlt die Fähigkeit (Live-Läufe, Trigger-Schreiben, Abbrechen).
- **404** — die Ressource existiert nicht in deiner Organisation, gehört zum Thread eines anderen — oder ist ein Projekt oder eine Aufgabe, die der Benutzer des Schlüssels nicht sehen darf: mit Absicht nicht von einer unterscheidbar, die es gar nicht gibt.
- **409** — der Zustand verweigert die Aktion: keine deployte Version, ein doppeltes Thema, eine doppelte E-Mail oder `externalItemId` (eindeutig pro Organisation — derselbe String in einer anderen Organisation ist in Ordnung), ein bereits laufender Turn.
- **413** — der Body ist zu groß (der Webhook-Trigger deckelt bei 256 KB), oder eine hochgeladene Datei überschreitet die Größengrenze.
- **415** — der Typ einer hochgeladenen Datei liegt außerhalb der erlaubten Liste.
- **429** — Rate-Limit erreicht; die Antwort trägt `Retry-After` in ganzen Sekunden — siehe [Rate-Limits](/de/develop/rate-limits).
- **500** — interner Fehler.

Zwei Lösch-Semantiken existieren, mit Absicht. Das Lösen eines Automatisierungs-Triggers (`DELETE .../triggers`) antwortet **204**, ob ein Trigger existierte oder nicht — ein idempotentes „stell es so her“. Das Löschen einer Ressource (`DELETE /api/v1/agents/{slug}`) antwortet **404**, wenn nichts da war — du wolltest etwas entfernen, das es nicht gibt.

## Versionierung

Die API ist über das URL-Präfix versioniert — heute `/api/v1/` — und wächst darin additiv: neue Endpoints und neue optionale Felder kommen dazu, bestehende Formen bleiben. Ein Breaking Change würde unter einem neuen Präfix erscheinen. Das OpenAPI-Dokument unter `/docs` beschreibt immer die laufende Instanz.

## Wo das hingehört

Diese Seite ist die REST-Hälfte der Außenfläche. Der [MCP-Endpoint](/de/develop/mcp-endpoint) öffnet dieselbe Plattform für MCP-Clients — das Autorieren von Automatisierungen lebt dort, nicht in REST. Die [Webhooks-Seite](/de/develop/webhooks) behandelt den eingehenden Trigger, der Läufe ohne Schlüssel startet. Baust du innerhalb des Produkts — Agenten, Automatisierungen, eigene Tools — ist der [Platform-Tab](/de/platform) dein Alltag; diese Seite ist für draußen.
