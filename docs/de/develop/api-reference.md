---
title: API-Referenz
description: Wie du Tale von außen aufrufst — Authentifizierung, das Endpoint-Inventar, Pagination, die asynchronen Lauf- und Turn-Schleifen und das Fehlermodell. Die einzige Quelle der Wahrheit für die REST-Oberfläche.
i18nLintExclude:
  - terminology-loanword
---

Die Tale-API ist die Oberfläche für alle, die außerhalb des Produkts stehen und es skripten wollen: Wissensressourcen, Automatisierungen und ihre Läufe, Chat-Threads, Agenten und Skills — alles als JSON über HTTPS, mit einem API-Schlüssel im Header. Derselbe Schlüssel öffnet auch den [MCP-Endpoint](/de/develop/mcp-endpoint) — diese Seite behandelt die REST-Hälfte.

Diese Seite ist das kanonische Inventar der Oberfläche, des Auth-Modells und der Fehlerform. Request- und Response-Schemas auf Feldebene liefert das OpenAPI-Dokument deiner Instanz unter `/docs` — lade es dort, wenn du jede Property brauchst; lies diese Seite, um zu verstehen, wie sich die API verhält.

## Eine erste Anfrage

Die kürzeste nützliche Anfrage — die Automatisierungen der Organisation auflisten — ist ein curl:

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Eine erfolgreiche Antwort ist eine Seite: `{ "page": [ { "name": "billing/dunning", "latest": 3, "deployedVersion": 2 } ], "isDone": true, "continueCursor": null }`. Jeder Listen-Endpoint antwortet mit genau diesem Umschlag — gib `continueCursor` als `?cursor=` zurück, um die nächste Seite zu holen, und begrenze die Seitengröße mit `?limit=`.

## Authentifizierung

API-Schlüssel erzeugt jeder mit Admin- oder Entwickler-Berechtigungen im Produkt — [API-Schlüssel](/de/platform/admin/api-keys) beschreibt das Panel. Ein Schlüssel wird bei der Erstellung genau einmal gezeigt und nie wieder; er gehört dem Benutzer, der ihn erzeugt hat, und dessen Organisation.

Übergib den Schlüssel als Bearer-Token: `Authorization: Bearer <key>`. Der Organisationskontext kommt aus dem Schlüssel — außerhalb seiner Organisation ist er unbrauchbar, und alles, was er berührt, bleibt dort. Was der Schlüssel _tun darf_, folgt der Rolle seines Besitzers: Lesen und Mock-Läufe brauchen Mitgliedschaft; Live-Arbeit starten und Deploytes verändern braucht die Entwickler-Fähigkeit. Wo das zählt, sagen es die Abschnitte unten.

## Endpoint-Gruppen

| Gruppe            | Pfad                                    | Was sie abdeckt                                                                              |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Automatisierungen | `/api/v1/automations/...`               | Auflisten, Versionen lesen, Läufe starten, Laufhistorie lesen, Trigger binden und lösen.     |
| Läufe             | `/api/v1/runs/{runId}`                  | Ein durabler Lauf in voller Tiefe — Status, Output, Trace, Effekte — plus `POST .../cancel`. |
| Threads           | `/api/v1/threads/...`                   | Die Chat-Threads des Schlüsselbesitzers: erstellen, Nachrichten lesen, senden, Turn pollen.  |
| Agenten           | `/api/v1/agents/...`                    | Agenten der Organisation auflisten, lesen, anlegen oder ersetzen, löschen.                   |
| Skills            | `/api/v1/skills/...`                    | Dieselbe Form wie Agenten, für Skills.                                                       |
| Wissenseinträge   | `/api/v1/knowledge-entries/...`         | Themen-Fakten: auflisten, anlegen, ablösen, löschen.                                         |
| Wissenssuche      | `POST /api/v1/knowledge/search`         | Semantische Suche über das indexierte Wissen der Organisation.                               |
| Dokumente         | `/api/v1/documents/...`                 | Dokumente der Wissensdatenbank: CRUD plus `POST .../retry-indexing`.                         |
| Websites          | `/api/v1/websites/...`                  | Gecrawlte Quellen: CRUD plus `.../pages`, `.../sync`, `.../search`.                          |
| Produkte          | `/api/v1/products/...`                  | Produktkatalog-Einträge: CRUD.                                                               |
| Kontakte          | `/api/v1/contacts/...`                  | Kontaktdaten: CRUD plus `POST /api/v1/contacts/bulk`.                                        |
| MCP               | `POST /api/v1/mcp`                      | Der [MCP-Endpoint](/de/develop/mcp-endpoint) — derselbe Schlüssel, JSON-RPC statt REST.      |
| Webhook-Trigger   | `POST /api/automations/webhook/<token>` | Eine deployte Automatisierung von außen starten; die [Webhooks-Seite](/de/develop/webhooks). |

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

# 2. Nachricht senden — das Modell ist immer explizit, nie automatisch gewählt
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

## Fehlermodell

Jede Nicht-2xx-Antwort trägt einen flachen Umschlag:

```json
{ "error": "Automation not found" }
```

Verzweige auf den HTTP-Status; die Meldung ist für Menschen:

- **400** — fehlerhafte Anfrage: fehlendes Pflichtfeld, falscher Typ, nicht parsebarer Body.
- **401** — fehlender oder ungültiger API-Schlüssel.
- **403** — der Schlüssel ist gültig, aber der Rolle seines Besitzers fehlt die Fähigkeit (Live-Läufe, Trigger-Schreiben, Abbrechen).
- **404** — die Ressource existiert nicht in deiner Organisation oder gehört zum Thread eines anderen.
- **409** — der Zustand verweigert die Aktion: keine deployte Version, ein doppeltes Thema oder eine doppelte E-Mail, ein bereits laufender Turn.
- **413** — der Body ist zu groß (der Webhook-Trigger deckelt bei 256 KB).
- **429** — Rate-Limit erreicht; siehe [Rate-Limits](/de/develop/rate-limits).
- **500** — interner Fehler.

Zwei Lösch-Semantiken existieren, mit Absicht. Das Lösen eines Automatisierungs-Triggers (`DELETE .../triggers`) antwortet **204**, ob ein Trigger existierte oder nicht — ein idempotentes „stell es so her“. Das Löschen einer Ressource (`DELETE /api/v1/agents/{slug}`) antwortet **404**, wenn nichts da war — du wolltest etwas entfernen, das es nicht gibt.

## Versionierung

Die API ist über das URL-Präfix versioniert — heute `/api/v1/` — und wächst darin additiv: neue Endpoints und neue optionale Felder kommen dazu, bestehende Formen bleiben. Ein Breaking Change würde unter einem neuen Präfix erscheinen. Das OpenAPI-Dokument unter `/docs` beschreibt immer die laufende Instanz.

## Wo das hingehört

Diese Seite ist die REST-Hälfte der Außenfläche. Der [MCP-Endpoint](/de/develop/mcp-endpoint) öffnet dieselbe Plattform für MCP-Clients — das Autorieren von Automatisierungen lebt dort, nicht in REST. Die [Webhooks-Seite](/de/develop/webhooks) behandelt den eingehenden Trigger, der Läufe ohne Schlüssel startet. Baust du innerhalb des Produkts — Agenten, Automatisierungen, eigene Tools — ist der [Platform-Tab](/de/platform) dein Alltag; diese Seite ist für draußen.
