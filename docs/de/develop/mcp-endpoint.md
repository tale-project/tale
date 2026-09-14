---
title: MCP-Endpoint
description: Verbinde einen MCP-Client, entdecke Tale-Tools, entwickle Automatisierungen und behandle Zugriffsprüfungen und Ausführungsergebnisse.
i18nLintExclude:
  - terminology-loanword
---

Verbinde einen MCP-Client, wenn ein Agent Tale-Tools entdecken, Wissen abrufen oder Automatisierungen entwickeln und ausführen soll. Die Verbindung verwendet denselben API-Schlüssel und Organisationskontext wie [REST](/de/develop/api-reference). Tale ist dabei der Server: Dein externer Client ruft Tale auf.

Beginne mit `initialize`, prüfe `tools/list` und rufe vor dem Schreiben einer Automatisierung `get_docs` auf. Deine Installation liefert ihre unterstützte Grammatik selbst. Der Client muss Knotentypen und Konfigurationsfelder deshalb nicht erraten.

## Einen Client verbinden

### Die Verbindung vorbereiten

Erstelle einen [API-Schlüssel](/de/platform/admin/api-keys) und hinterlege ihn in der sicheren Konfiguration deines Clients. Unter **Einstellungen > API > MCP** findest du Endpunkt, Organisations-Slug und eine kopierbare Anfrage zur Tool-Erkennung.

| Einstellung | Wert |
| --- | --- |
| Endpunkt | `https://your-host.example.com/api/v1/mcp` |
| Transport | HTTPS-POST mit JSON-RPC und normalen JSON-Antworten |
| Authentifizierung | `Authorization: Bearer <api-key>` |
| Organisation | `X-Organization-Slug: <slug>` |
| Protokollrevisionen | `2025-06-18` oder `2025-03-26`, wenn der Client diese vorschlägt |

Der Client muss entfernte HTTP-Endpunkte mit eigenen Headern unterstützen. Es gibt keinen SSE-Ereignisstrom, keine Sitzung zum Löschen und keinen OAuth-Anmeldeablauf. OAuth-Discovery-URLs antworten mit JSON und `404`; ein Client, der diesen Ablauf voraussetzt, braucht eine andere Authentifizierungskonfiguration. Ein reiner stdio-Client kann diese URL nicht direkt nutzen.

Sende in wiederverwendbaren Integrationen immer den Organisations-Header. Er ist nur bei genau einer Mitgliedschaft optional. Ohne ihn führt ein Schlüsselinhaber mit mehreren Organisationen zu `400 ORG_SLUG_REQUIRED`. Ein unbekannter Slug liefert `404 ORG_SLUG_INVALID`, eine Organisation ohne Mitgliedschaft `403 ORG_FORBIDDEN`.

### Initialisieren und die Referenz abrufen

Die Beispiele setzen `TALE_URL`, `TALE_API_KEY` und `TALE_ORG_SLUG` in deiner Umgebung voraus. `TALE_URL` ist die Anwendungsadresse ohne `/api/v1`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docs-client","version":"1.0.0"}}}'
```

Der Server meldet sich als `tale-platform`. Lies `result.protocolVersion` und sende den ausgehandelten Wert bei späteren Aufrufen als `MCP-Protocol-Version`. Das nächste Beispiel verwendet `2025-06-18`; passe ihn an, falls die ältere Revision ausgehandelt wurde. Ein nicht unterstützter Headerwert führt zu `400`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-06-18' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_docs","arguments":{}}}'
```

Bei Erfolg enthält `get_docs` die Automatisierungsreferenz als Text, ohne gesetztes Fehlerkennzeichen. Mit `method: "tools/list"` erhältst du stattdessen die Tool-Schemas. Der aktuelle Katalog umfasst 22 Tools. Bewahre die JSON-RPC-`id`, damit dein Client Antwort und Anfrage zuordnen kann.

### Transport und Sammelanfragen

| Anfrage | Antwort |
| --- | --- |
| Einzelne JSON-RPC-Nachricht | Ein JSON-RPC-Ergebnis oder -Fehler |
| Bis zu 20 Nachrichten im Batch | Array mit Antworten; Benachrichtigungen erhalten keinen eigenen Eintrag |
| Nur Benachrichtigungen | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS`; kein Schlüssel nötig |
| Andere HTTP-Methode | HTTP `405`, `Allow: POST, OPTIONS` |

Jeder zusätzliche Tool-Aufruf im Batch verbraucht dasselbe Anfragebudget wie ein eigener Aufruf. Ist das Budget erschöpft, enthält der betroffene Eintrag JSON-RPC `-32000` mit `data.retryAfterMs`. Die HTTP-Antwort bleibt `200` ohne `Retry-After`. Eine einzelne Anfrage, die bereits am HTTP-Eingang abgelehnt wird, erhält REST `429`. Behandle beide Fälle nach der [Referenz zu Ratenlimits](/de/develop/rate-limits).

Der Endpunkt liefert keine CORS-Header für API-Schlüssel in Webseiten. Bewahre den Schlüssel auf einem vertrauenswürdigen Server oder im Zugangsdaten-Speicher des MCP-Clients auf.

## Die Tools

`tools/list` liefert das Eingabeschema jedes Tools. Fehlende, falsch typisierte, leere oder unerwartete Argumente führen vor der Ausführung zu JSON-RPC `-32602`. Das Dokument in `validate_automation`, `run_automation`, `test_automation` oder `save_automation` hat bewusst eine offene Hülle: `get_docs` erklärt die Grammatik, die Engine validiert den Inhalt.

Tools liefern außerdem `readOnlyHint`, `destructiveHint`, `idempotentHint` und `openWorldHint`. Ein Host kann damit einen Aufruf erklären; die Hinweise erteilen aber weder Rechte noch Sicherheitsgarantien. Lesezugriffe sind als solche markiert, Speichern schreibt eine Version, Bereitstellung und Triggeränderungen können Bestehendes ersetzen. Live-Ausführungen können echte Dienste ansprechen.

### Automatisierungen entwickeln {#autorieren}

| Tool                  | Was es tut                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| `get_docs` | Automatisierungsreferenz als Text abrufen: Grammatik, Knotentypen, Capability-Knoten und Methodentabelle für `tools/call`. |
| `get_catalog` | Unterstützte Knotentypen auflisten; `kind` filtert die Art, `compact: true` lässt Eingabeschemas weg. |
| `search_catalog` | Knotenkatalog nach Stichwörtern durchsuchen. |
| `validate_automation` | Ein Automatisierungsdokument validieren, ohne es zu speichern.           |
| `run_automation`      | Ein Automatisierungsdokument direkt gegen die deterministischen Mocks ausführen. |
| `test_automation`     | Die eigenen Abnahmetests einer Automatisierung ausführen.                |
| `save_automation`     | Ein Automatisierungsdokument als neue unveränderliche Version speichern. |
| `get_automation`      | Eine gespeicherte Version lesen (ohne Angabe die neueste).               |
| `list_automations` | Automatisierungen mit neuester und bereitgestellter Version sowie Installationsprojekten (`projectIds`) auflisten. |
| `deploy_automation` | Eine gespeicherte Version für Live-Ausführungen bereitstellen. |

Arbeite in dieser Reihenfolge: Grammatik und Katalog lesen, Dokument validieren, mit Mocks ausführen, Akzeptanztests ausführen, Version speichern und dann bereitstellen. Ein erfolgreicher Mock-Test bestätigt den simulierten Ablauf. Er bestätigt keine echten Zugangsdaten, Netzwerkverbindungen oder Auswirkungen beim Anbieter.

### Läufe und Trigger verwalten

| Tool             | Was es tut                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run_deployed` | Die bereitgestellte Version live ausführen und bis zu 30 Sekunden auf Ausgabe, Trace und Effekte warten. Läuft sie weiter, die zurückgegebene `runId` abfragen. |
| `start_run` | Die bereitgestellte Version im Hintergrund starten; die zurückgegebene Lauf-ID mit `get_run` abfragen. |
| `list_runs` | Sichtbare Läufe einer Automatisierung oder über Projekte hinweg auflisten, neueste zuerst und jeweils mit `projectId`. |
| `get_run` | Status, Ausgabe, Trace, Effekte und `projectId` eines Laufs lesen. Die ID eines Projektlaufs passt zu `GET /api/v1/projects/{id}/runs/{runId}`. |
| `cancel_run` | Einen Lauf beim nächsten Übergang zwischen Knoten stoppen. |
| `list_versions`  | Die unveränderliche Versionshistorie einer Automatisierung.                                                             |
| `list_triggers` | Triggerbindungen lesen, ohne das Webhook-Geheimnis auszugeben. |
| `delete_trigger` | Einen Trigger entfernen; Versionen und Laufhistorie bleiben erhalten. |
| `set_trigger` | Einen Zeitplan-, Webhook- oder Event-Trigger einrichten. |

| Tool | Geeignet für |
| --- | --- |
| `run_automation` | Ungespeichertes Dokument mit deterministischen Mocks ausprobieren; `mode: "live"` wird abgelehnt |
| `run_deployed` | Bereitgestellte Version live ausführen und bis zu 30 Sekunden warten; danach gegebenenfalls die `runId` abfragen |
| `start_run` | Bereitgestellte Version im Hintergrund starten und mit `get_run` verfolgen |

Beide Tools für bereitgestellte Versionen verwenden denselben dauerhaften Runner mit denselben Berechtigungsprüfungen und Ausführungsdaten. `start_run` akzeptiert optional `projectId`. Eine projektgebundene Automatisierung darf nur in einem ihrer Installationsprojekte laufen; bei genau einer Bindung kann dieses automatisch gewählt werden. Ohne Bindungen bedeutet eine fehlende Angabe Organisationskontext. Lies `projectIds` aus `list_automations` und die tatsächliche `projectId` aus dem zurückgegebenen Handle, statt die REST-URL zum Abfragen zu erraten.

### Capabilities und Wissen

| Tool                  | Was es tut                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Bereitgestellte Automatisierungen dieser Organisation nach Name und Beschreibung durchsuchen. |
| `invoke_capability` | Eine Capability über ihre `id` aufrufen. Ist eine Genehmigung erforderlich, liefert das Tool einen wartenden Genehmigungszustand, statt die Aktion auszuführen. |
| `get_knowledge` | Passagen aus Dokumenten und gecrawlten Websites der Organisation abrufen. |

Das Capability-Verzeichnis enthält derzeit bereitgestellte Automatisierungen. Integrierte Tools, Connector-Aktionen, Skills und externe MCP-Server gehören nicht dazu. Eine bereitgestellte Automatisierung aufzurufen entspricht derselben Live-Operation wie `run_deployed`. Wenn eine Genehmigung nötig ist, kann der Client anhand von `pending` erklären, dass zuerst ein Mensch entscheiden muss.

## Was der Schlüssel darf

| Vorgang | Erforderlicher Zugriff |
| --- | --- |
| Lesen, Validierung, Mock-Ausführungen und Akzeptanztests, Capability-Suche, Wissensabruf | Mitgliedschaft plus normale Zugriffsregeln der Ressource |
| Speichern, Bereitstellen, Trigger setzen/löschen, Lauf abbrechen oder live ausführen | Entwicklerberechtigung plus normale Zugriffsregeln der Ressource |

Der Schlüssel identifiziert seinen Inhaber. Er erweitert weder dessen Rolle noch dessen Projektzugriff. Auch eine Live-Ausführung über `invoke_capability` durchläuft die Ausführungsprüfungen.

### Protokollfehler und abgelehnte Tools unterscheiden

| Ergebnis | Umgang damit |
| --- | --- |
| JSON-RPC `-32601` | Unbekannte Methode korrigieren |
| JSON-RPC `-32602` | Tool-Name oder Argumente anhand von `tools/list` korrigieren |
| Tool-Ergebnis mit `isError: true` | Stabilen `code`, erklärenden `error` und Handlungshinweis `hint` im Textinhalt lesen; `data` kann Feldprobleme enthalten |
| `validate_automation` mit `valid: false` | Normales Validierungsergebnis; `errors` auswerten, obwohl `isError` false bleibt |
| Capability mit `pending` | Normales Genehmigungsergebnis; weder als fertig noch als erneut zu versuchenden Fehler behandeln |
| Capability mit `refused` | Fehlerergebnis; die genannte Ursache beheben |

Zu den Tool-Codes gehören `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `LIVE_MODE_UNAVAILABLE` und `NOT_SUPPORTED`. Letzterer bedeutet, dass der Host den Vorgang für Läufe, Versionen oder Trigger nicht unterstützt. Plattformfehler behalten ihren eigenen Code, Hinweis und gegebenenfalls Daten; fehlender Entwicklerzugriff liefert etwa `FORBIDDEN_DEVELOPER_SETTINGS`.

Ein unbekannter Automatisierungsname ist auch bei `list_versions`, `list_runs` und `list_triggers` ein Fehler. Eine leere Liste bedeutet, dass eine vorhandene Automatisierung keine passenden Einträge hat. Ungültige Dokumente für Tools, die ein gültiges Dokument benötigen, fehlgeschlagene Suchen und fehlende Bereitstellungen setzen `isError: true`. Nur das Validierungstool meldet ein ungültiges Dokument als normales Prüfergebnis.

## Wo das hingehört

REST und MCP teilen Schlüssel, Organisationskontext und dauerhafte Ausführungsobjekte. Verwende REST für ausdrückliche HTTP-Routen und MCP für Clients mit Tool-Erkennung und Tool-Aufrufen. Über diesen Endpunkt registriert oder ruft Tale keine externen MCP-Server auf.
