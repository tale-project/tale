---
title: MCP-Endpoint
description: Verbinde einen MCP-Client mit Tale — ein Endpoint, 22 Tools für das Autorieren von Automatisierungen, Lauf- und Trigger-Verwaltung und die Capability-Oberfläche der Organisation.
i18nLintExclude:
  - terminology-loanword
---

Tale ist selbst ein MCP-Server. Richte einen beliebigen MCP-Client — ein Agent-Harness, eine IDE, deine eigene SDK-Schleife — auf einen Endpoint, und er kann Automatisierungen autorieren und betreiben, durchsuchen, was die Organisation kann, eine Capability aufrufen und Wissen abrufen — mit demselben API-Schlüssel wie die REST-Oberfläche. Wo REST die Connectorsnaht für deinen Code ist, ist der MCP-Endpoint die Naht für _Modelle_: jedes Tool antwortet Text, den ein Modell lesen und verwerten kann.

Lies das, um einen Client zu verbinden und das Tool-Inventar zu verstehen. Die Grammatik zum Autorieren von Automatisierungen ist hier bewusst nicht dupliziert — der Endpoint lehrt sie selbst, über `get_docs`.

## Einen Client verbinden

Der Endpoint spricht MCP-Protokoll `2025-03-26` als JSON-RPC über HTTPS — reine JSON-Antworten, kein SSE-Stream, eine Nachricht pro Request (ein Batch antwortet Fehler `-32600`). Authentifiziere mit einem Organisations-API-Schlüssel ([API-Schlüssel](/de/platform/admin/api-keys) beschreibt das Erzeugen):

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer tale_...
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }
```

Der Server identifiziert sich als `tale-platform`. In einem Client mit Config-Block ist das alles, was du brauchst:

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer tale_..." }
    }
  }
}
```

`tools/list` liefert das volle Inventar; `GET` auf den Endpoint antwortet **405** — es gibt keinen Event-Stream zum Abonnieren.

## Die Tools

Zweiundzwanzig Tools, in drei Gruppen. Die Autoring-Tools nehmen ganze Automatisierungsdokumente und validieren alles selbst — ihre Schemas sind auf dem Draht offen, und `get_docs` ist die Referenz, die ein Modell zuerst liest. Die Verwaltungs- und Capability-Tools nehmen einfache Argumente und deklarieren echte JSON-Schemas.

### Autorieren

| Tool                  | Was es tut                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| `get_docs`            | Die Automatisierungsgrammatik und der Autoring-Leitfaden, als Text.      |
| `get_catalog`         | Jeder Knotentyp, den dieses Deployment ausführen kann.                   |
| `search_catalog`      | Den Knotentyp-Katalog per Stichwort durchsuchen.                         |
| `validate_automation` | Ein Automatisierungsdokument validieren, ohne es zu speichern.           |
| `run_automation`      | Ein Automatisierungsdokument direkt ausführen (Mock oder Live).          |
| `test_automation`     | Die eigenen Abnahmetests einer Automatisierung ausführen.                |
| `save_automation`     | Ein Automatisierungsdokument als neue unveränderliche Version speichern. |
| `get_automation`      | Eine gespeicherte Version lesen (ohne Angabe die neueste).               |
| `list_automations`    | Die Automatisierungen der Organisation mit ihren neuesten Versionen.     |
| `deploy_automation`   | Eine gespeicherte Version zur Live-Version befördern.                    |

### Lauf- & Trigger-Verwaltung

| Tool             | Was es tut                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Die deployte Version ausführen und auf das fertige Ergebnis WARTEN — Output, Trace und Effekte in einer Antwort.        |
| `start_run`      | Die deployte Version im Hintergrund starten und sofort einen Lauf-Handle zurückgeben; das Ergebnis über get_run pollen. |
| `list_runs`      | Die letzten Läufe, neueste zuerst — einer Automatisierung oder der ganzen Organisation.                                 |
| `get_run`        | Ein Lauf in voller Tiefe: Status, Output, Trace und Effekte.                                                            |
| `cancel_run`     | Einen Lauf an seiner nächsten Knotengrenze stoppen.                                                                     |
| `list_versions`  | Die unveränderliche Versionshistorie einer Automatisierung.                                                             |
| `list_triggers`  | Was die Automatisierungen startet (nie das Webhook-Geheimnis).                                                          |
| `delete_trigger` | Den Trigger einer Automatisierung lösen; Versionen und Laufhistorie bleiben.                                            |
| `set_trigger`    | Binden, was die Automatisierung startet (Zeitplan/Webhook/Event).                                                       |

Nimm `run_deployed`, wenn die Automatisierung schnell ist und du einen Aufruf mit der Antwort darin willst. Nimm `start_run`, wenn der Lauf Minuten dauern darf — er gibt sofort eine `runId` zurück, und `get_run` pollt sie. Beide laufen live.

`start_run` nimmt außerdem eine optionale `projectId` — das Projekt, in dem der Lauf arbeitet, sodass seine Aufgaben- und Dokument-Tools dort wirken. Lass sie weg für einen organisationsweiten Lauf oder, wenn die Automatisierung an ein einzelnes Projekt gebunden ist, für dieses. Eine gebundene Automatisierung akzeptiert nur ein Projekt, an das sie gebunden ist.

### Capabilities & Wissen

| Tool                  | Was es tut                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Alles durchsuchen, was diese Organisation kann — ihre Automatisierungen, Connectorsaktionen, Skills und Tools.                            |
| `invoke_capability`   | Eine Capability per id aufrufen. Eine Aktion, die die Organisation gated, antwortet mit einem Pending-Approval-Ergebnis, statt zu laufen. |
| `get_knowledge`       | Passagen aus dem Wissen der Organisation abrufen — ihren Dokumenten und ihren gecrawlten Webseiten.                                       |

Das ist dieselbe Registry, die ein Chat-Turn sieht: ein Namensraum über Builtins, Connectorsaktionen, Skills, Automatisierungen und verbundene MCP-Tools. Eine Capability, die die Organisation hinter eine Freigabe stellt, läuft nicht lautlos — `invoke_capability` antwortet mit einem Pending-Approval-Ergebnis, das das Modell weitergeben kann.

## Was der Schlüssel darf

Der Schlüssel beweist, wer anruft; die Rolle seines Besitzers entscheidet, was der Aufruf darf — genau wie im Produkt:

- **Jeder Mitglieds-Schlüssel** — jedes Lese-Tool, `run_automation` im Mock-Modus, `search_capabilities`, `get_knowledge`.
- **Entwickler-Fähigkeit nötig** — `save_automation`, `deploy_automation`, `set_trigger`, `delete_trigger`, `cancel_run` und Live-Ausführung (`run_deployed`, `start_run`, `run_automation` im Live-Modus).

Ein abgelehnter Aufruf ist kein Protokollfehler: das Tool antwortet mit einer lesbaren Ablehnung — `{"error": "...", "hint": "..."}` — damit das aufrufende Modell sich anpassen kann, statt abzustürzen. Diese Konvention gilt überall: Validierungsprobleme, fehlende Deployments und Rollenablehnungen kommen als Daten zurück; `isError` ist für Aufrufe reserviert, die wirklich geworfen haben.

## Wo das hingehört

Der MCP-Endpoint und die [REST-API](/de/develop/api-reference) sind eine Oberfläche in zwei Dialekten — derselbe Schlüssel, dieselbe Organisations-Scopung, dieselben Lauf-Objekte (`start_run` hier und `POST .../runs` dort erzeugen denselben durablen Lauf). Einen eigenen MCP-Server bauen, den Tale konsumiert, ist die Gegenrichtung — das sind [MCP-Server](/de/platform/connectors/mcp-servers) unter Connectors.
