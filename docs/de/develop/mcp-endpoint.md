---
title: MCP-Endpoint
description: Verbinde einen MCP-Client mit Tale — ein Endpoint, 22 Tools für das Autorieren von Automatisierungen, Lauf- und Trigger-Verwaltung und die Capability-Oberfläche der Organisation.
i18nLintExclude:
  - terminology-loanword
---

Tale ist selbst ein MCP-Server. Richte einen beliebigen MCP-Client — ein Agent-Harness, eine IDE, deine eigene SDK-Schleife — auf einen Endpoint, und er kann Automatisierungen autorieren und betreiben, durchsuchen, was die Organisation kann, eine Capability aufrufen und Wissen abrufen — mit demselben API-Schlüssel wie die REST-Oberfläche. Wo REST die Connectorsnaht für deinen Code ist, ist der MCP-Endpoint die Naht für _Modelle_: jedes Tool antwortet Text, den ein Modell lesen und verwerten kann.

Lies das, um einen Client zu verbinden und das Tool-Inventar zu verstehen. Die Grammatik zum Autorieren von Automatisierungen ist hier bewusst nicht dupliziert — der Endpoint lehrt sie selbst, über `get_docs`.

## Einen Client verbinden

Der Endpoint spricht MCP-Protokoll `2025-06-18` (oder `2025-03-26`, wenn der Client es vorschlägt) als JSON-RPC über HTTPS — reine JSON-Antworten, kein SSE-Stream. Schick eine Nachricht pro Request oder einen JSON-RPC-Batch mit höchstens 20 Nachrichten: Der kommt als Array zurück, ein Batch aus lauter Notifications mit 202, und jeder Tool-Aufruf im Batch nach dem ersten zählt gegen dasselbe Request-Budget wie ein eigener Request. Authentifiziere mit einem Organisations-API-Schlüssel ([API-Schlüssel](/de/platform/admin/api-keys) beschreibt das Erzeugen) — Schlüssel sind die einzige Berechtigung, die dieser Endpoint nimmt: eine OAuth-Discovery gibt es hier nicht, ein Client, der auf dem MCP-Autorisierungsfluss besteht, findet unter den Discovery-URLs also eine JSON-**404** und muss mit den Kopfzeilen unten konfiguriert werden. Gehört der Schlüsselinhaber mehreren Organisationen an, muss jede Anfrage zusätzlich sagen, welche gemeint ist — über `X-Organization-Slug`, gegen die Mitgliedschaft geprüft. Ohne diesen Wert antwortet so eine Anfrage mit **400** `ORG_SLUG_REQUIRED`, statt aus dem Dashboard zu raten; ein Slug, der keine Organisation benennt, antwortet **404** `ORG_SLUG_INVALID`, einer, dessen Organisation der Schlüsselinhaber nicht angehört, **403** `ORG_FORBIDDEN`; ein Schlüssel mit nur einer Organisation kann ihn weglassen. Schick in späteren Anfragen die Revision, die das `initialize`-Ergebnis ausgehandelt hat, in der Kopfzeile `MCP-Protocol-Version` — nie die, die du vorgeschlagen hast —, denn ein unbekannter Wert antwortet **400**.

```json
// POST https://your-host.example.com/api/v1/mcp
// Authorization: Bearer <api-key>
// X-Organization-Slug: acme
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "my-client", "version": "1.0.0" }
  }
}
```

Der Server identifiziert sich als `tale-platform`. In einem Client mit Config-Block reichen diese beiden Einträge — diese Form ist mit Clients geprüft, die einen `headers`-Block nehmen; ein Host, der nur stdio spricht, braucht eine Remote-Bridge wie `mcp-remote` vor der URL:

```json
{
  "mcpServers": {
    "tale": {
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer <api-key>",
        "X-Organization-Slug": "acme"
      }
    }
  }
}
```

`tools/list` liefert das volle Inventar; jedes Verb außer `POST` antwortet **405** mit einer `Allow: POST, OPTIONS`-Kopfzeile (ein `OPTIONS` antwortet **204** mit derselben Liste) — es gibt keinen Event-Stream zum Abonnieren und keine Session zum Löschen — und der Endpoint sendet keine CORS-Kopfzeilen: er ist für serverseitige Clients gedacht, nie für eine Browser-Seite, die einen Schlüssel hält. Die Endpoint-URL deines Deployments, den Organisations-Slug, dasselbe Inventar in seinen drei Gruppen und eine kopierbare `tools/list`-Anfrage mit beiden Werten findest du unter **Einstellungen > API > MCP**.

## Die Tools

Zweiundzwanzig Tools, in drei Gruppen, jedes mit einem echten JSON-Schema, an dem der Endpoint jeden Aufruf festhält — Argumente, die nicht passen, ergeben den JSON-RPC-Fehler `-32602` mit dem Feldnamen, nie ein stillschweigend leeres Ergebnis. Die vier Tools, die ein ganzes Automatisierungsdokument nehmen — validate, run, test, save — deklarieren ihren Aufruf-Umschlag (`automation`, dazu `input`, `mode` oder `message`, wo sie gelten) und lassen das Dokument selbst offen: Seine Grammatik lehrt `get_docs`, und die Engine validiert es im Band. Jedes Tool trägt außerdem die vier MCP-`annotations` — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` —, damit ein Host eine „immer erlauben"-Entscheidung daran festmachen kann: die Lese-Tools sind `readOnlyHint: true`; `save_automation` schreibt, ohne etwas zu zerstören; `deploy_automation`, `set_trigger`, `delete_trigger` und `cancel_run` ersetzen oder entfernen Bestehendes; `run_deployed`, `start_run` und `invoke_capability` laufen live gegen echte Backends (`openWorldHint: true`); `run_automation` und `test_automation` laufen gegen die Mocks. Hinweise, keine Garantien — die Rollenprüfung unten bleibt der Rückhalt.

### Autorieren

| Tool                  | Was es tut                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| `get_docs`            | Die Autoring-Referenz für Automatisierungen — Grammatik, Knotenarten, Capability-Knoten und die Methodentabelle im `tools/call`-Dialekt dieses Endpoints — als Text. |
| `get_catalog`         | Jeder Knotentyp, den dieses Deployment ausführen kann; `kind` engt auf eine Knotenart ein, `compact: true` lässt die Eingabeschemas weg. |
| `search_catalog`      | Den Knotentyp-Katalog per Stichwort durchsuchen.                         |
| `validate_automation` | Ein Automatisierungsdokument validieren, ohne es zu speichern.           |
| `run_automation`      | Ein Automatisierungsdokument direkt gegen die deterministischen Mocks ausführen. |
| `test_automation`     | Die eigenen Abnahmetests einer Automatisierung ausführen.                |
| `save_automation`     | Ein Automatisierungsdokument als neue unveränderliche Version speichern. |
| `get_automation`      | Eine gespeicherte Version lesen (ohne Angabe die neueste).               |
| `list_automations`    | Die Automatisierungen der Organisation mit ihrer neuesten und ihrer deployten Version und den Projekten, in denen jede installiert ist (`projectIds`). |
| `deploy_automation`   | Eine gespeicherte Version zur Live-Version befördern.                    |

### Lauf- & Trigger-Verwaltung

| Tool             | Was es tut                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run_deployed`   | Die deployte Version live ausführen und auf das fertige Ergebnis WARTEN — Output, Trace und Effekte in einer Antwort; ein Lauf, der länger braucht, antwortet mit seiner `runId` zum Pollen. |
| `start_run`      | Die deployte Version im Hintergrund starten und sofort einen Lauf-Handle zurückgeben; das Ergebnis über get_run pollen. |
| `list_runs`      | Die letzten Läufe, die der Schlüssel lesen darf, neueste zuerst — einer Automatisierung oder über die Projekte der Organisation hinweg; jeder nennt seine `projectId`. |
| `get_run`        | Ein Lauf in voller Tiefe: Status, Output, Trace, Effekte und `projectId` — die ID eines Projektlaufs ist die, die `GET /api/v1/projects/{id}/runs/{runId}` nimmt. |
| `cancel_run`     | Einen Lauf an seiner nächsten Knotengrenze stoppen.                                                                     |
| `list_versions`  | Die unveränderliche Versionshistorie einer Automatisierung.                                                             |
| `list_triggers`  | Was die Automatisierungen startet (nie das Webhook-Geheimnis).                                                          |
| `delete_trigger` | Den Trigger einer Automatisierung lösen; Versionen und Laufhistorie bleiben.                                            |
| `set_trigger`    | Binden, was die Automatisierung startet (Zeitplan/Webhook/Event).                                                       |

Nimm `run_deployed`, wenn die Automatisierung schnell ist und du einen Aufruf mit der Antwort darin willst — es wartet bis zu 30 Sekunden auf den Lauf und gibt dir danach die `runId` statt eines halbfertigen Ergebnisses. Nimm `start_run`, wenn der Lauf Minuten dauern darf — er gibt sofort eine `runId` zurück, und `get_run` pollt sie. Beide laufen live auf demselben dauerhaften Runner, autorisieren, führen aus und protokollieren den Lauf also identisch. `run_automation` ist das Tool der Authoring-Schleife: Es führt ein ungespeichertes Dokument gegen die deterministischen Mocks aus, und `mode: "live"` antwortet mit einer Ablehnung, die auf `run_deployed` zeigt — ein ungespeichertes Dokument hat keinen Live-Pfad.

`start_run` nimmt außerdem eine optionale `projectId` — das Projekt, in dem der Lauf arbeitet, sodass seine Aufgaben- und Dokument-Tools dort wirken. Lass sie weg für einen organisationsweiten Lauf oder, wenn die Automatisierung an ein einzelnes Projekt gebunden ist, für dieses. Eine gebundene Automatisierung akzeptiert nur ein Projekt, an das sie gebunden ist. Der zurückgegebene Handle nennt die `projectId`, die der Lauf bekommen hat, und `list_automations` zeigt die `projectIds` jeder Automatisierung — ein Client muss also nie raten, welche Projekt-URL den Lauf auf der REST-Seite zurückliest.

### Capabilities & Wissen

| Tool                  | Was es tut                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Alles durchsuchen, was diese Organisation kann — ihre deployten Automatisierungen, nach Name und Beschreibung.                            |
| `invoke_capability`   | Eine Capability per id aufrufen. Eine Aktion, die die Organisation gated, antwortet mit einem Pending-Approval-Ergebnis, statt zu laufen. |
| `get_knowledge`       | Passagen aus dem Wissen der Organisation abrufen — ihren Dokumenten und ihren gecrawlten Webseiten.                                       |

In dieser Version hält die Registry die deployten Automatisierungen der Organisation — `invoke_capability` auf einer davon ist derselbe Akt wie `run_deployed`. Builtin-Tools, Connector-Aktionen, Skills und externe MCP-Server gehören nicht zu dieser Registry; eine id, die keine deployte Automatisierung ist, bekommt eine lesbare Ablehnung, keinen Fehler. Eine Capability, die die Organisation hinter eine Freigabe stellt, läuft nicht lautlos — `invoke_capability` antwortet mit einem Pending-Approval-Ergebnis, das das Modell weitergeben kann.

## Was der Schlüssel darf

Der Schlüssel beweist, wer anruft; die Rolle seines Besitzers entscheidet, was der Aufruf darf — genau wie im Produkt:

- **Jeder Mitglieds-Schlüssel** — jedes Lese-Tool, `run_automation` (immer gegen die Mocks), `search_capabilities`, `get_knowledge`.
- **Entwickler-Fähigkeit nötig** — `save_automation`, `deploy_automation`, `set_trigger`, `delete_trigger`, `cancel_run` und Live-Ausführung (`run_deployed`, `start_run`).

Ein abgelehnter Aufruf ist kein Protokollfehler: das Tool antwortet mit einer lesbaren Ablehnung — `{"error": "...", "code": "...", "hint": "..."}`, wobei `code` der stabile Wert zum Verzweigen ist und `hint` sagt, was zu tun ist — damit das aufrufende Modell sich anpassen kann, statt abzustürzen, und das Ergebnis trägt `isError: true`, damit ein generischer Client den Fehlschlag erkennt, ohne den Text zu lesen. Die Codes, die die Tools selbst prägen, sind `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID` (das Dokument besteht die Validierung nicht, wo ein gültiges gebraucht wird), `AUTOMATION_TESTS_FAILING` (das Deploy-Gate), `LIVE_MODE_UNAVAILABLE`, `NOT_SUPPORTED` (der Host hält keine Läufe, Versionen oder Trigger), `INVALID_PARAMS` und `UNKNOWN_METHOD`; eine Ablehnung, die die Plattform darunter erhebt — ein Name, den ein anderer Besitzer hält, eine Lauf-Eingabe, die das `inputs`-Schema der Automatisierung ablehnt — kommt mit ihrem eigenen `code`, ihrem `hint` und, wo sie eines hat, ihrem `data` (etwa die Schemaprobleme) unverändert durch. `list_versions`, `list_runs` und `list_triggers` lehnen einen unbekannten Automatisierungsnamen mit `AUTOMATION_NOT_FOUND` ab, genau wie `get_automation`, nie mit einer leeren Liste. Diese Konvention gilt überall: ein Dokument, das die Validierung nicht besteht, wo ein Tool ein gültiges braucht (`save_automation`, `deploy_automation`, `run_automation`, `test_automation`), fehlende Deployments, Rollenablehnungen und eine Wissensdatenbank, die sich nicht durchsuchen ließ, kommen als Daten mit gesetztem Flag zurück — genau wie ein Aufruf, der wirklich geworfen hat. `validate_automation` ist das eine Tool, dessen Aufgabe das Urteil selbst ist: es antwortet `{ "valid": false, "errors": [...] }` als gewöhnliches Ergebnis — lies `valid`, das Flag bleibt aus. Eine Capability, die `pending` antwortet — eine Erinnerung, die auf die Freigabe eines Menschen wartet —, ist ein Ergebnis, kein Fehlschlag, und lässt `isError` auf false; eine `refused` Capability (unbekannte ID, Argumente, die ihr Schema ablehnt, kein Deployment) ist ein Fehlschlag und trägt das Flag.

## Wo das hingehört

Der MCP-Endpoint und die [REST-API](/de/develop/api-reference) sind eine Oberfläche in zwei Dialekten — derselbe Schlüssel, dieselbe Organisations-Scopung, dieselben Lauf-Objekte (`start_run` hier und `POST .../runs` dort erzeugen denselben durablen Lauf). Eigene MCP-Server bindet Tale in dieser Version nicht an — der Endpoint ist seine einzige MCP-Oberfläche, und die Richtung ist immer nach innen: Dein Client steuert Tale.
