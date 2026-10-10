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
| Protokollrevisionen | `2026-07-28`, von jeder Anfrage selbst mitgebracht; oder `2025-11-25`, `2025-06-18` bzw. `2025-03-26`, mit `initialize` eröffnet ([Protokollrevisionen](#protocol-revisions)) |

Der Client muss entfernte HTTP-Endpunkte mit eigenen Headern unterstützen. Es gibt keinen SSE-Ereignisstrom, keine Sitzung zum Löschen und keinen OAuth-Anmeldeablauf. OAuth-Discovery-URLs antworten mit JSON und `404`; ein Client, der diesen Ablauf voraussetzt, braucht eine andere Authentifizierungskonfiguration. Ein reiner stdio-Client kann diese URL nicht direkt nutzen. Fertige Konfigurationen für opencode und Claude Code findest du unter [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor).

Sende in wiederverwendbaren Integrationen immer den Organisations-Header. Er ist nur bei genau einer Mitgliedschaft optional. Ohne ihn führt ein Schlüsselinhaber mit mehreren Organisationen zu `400 ORG_SLUG_REQUIRED`. Ein unbekannter Slug liefert `404 ORG_SLUG_INVALID`, eine Organisation ohne Mitgliedschaft `403 ORG_FORBIDDEN`. Jede dieser Ablehnungen nennt in `data.organizations` die Slugs, die du senden kannst.

### Initialisieren und die Referenz abrufen

Die Beispiele setzen `TALE_URL`, `TALE_API_KEY` und `TALE_ORG_SLUG` in deiner Umgebung voraus. `TALE_URL` ist die Anwendungsadresse ohne `/api/v1`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"docs-client","version":"1.0.0"}}}'
```

Der Server meldet sich als `tale-platform` und nennt die Version des API-Vertrags als `serverInfo.version`. Seine `instructions` sind eine kurze Anleitung für die Arbeit mit Tale, die dein Client an sein Modell weitergeben kann. Lies `result.protocolVersion` und sende den ausgehandelten Wert bei späteren Aufrufen als `MCP-Protocol-Version`. Das nächste Beispiel verwendet `2025-11-25`; passe ihn an, falls eine ältere Revision ausgehandelt wurde. Eine Revision, die der Endpunkt nicht spricht, führt zu `400` mit JSON-RPC `-32022`, und `data.supported` nennt die Revisionen, die er spricht.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-11-25' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_docs","arguments":{}}}'
```

Bei Erfolg enthält `get_docs` die Automatisierungsreferenz als Text, ohne gesetztes Fehlerkennzeichen. Mit `"arguments":{"topic":"triggers"}` erhältst du die Trigger-Referenz (die Felder jeder Trigger-Art, die Eingabe, mit der ihre Läufe starten, und die Ereignisse), mit `"validation"` die Anleitung zum Lesen eines Validierungsergebnisses samt jedem Fehlercode, mit `"settings"` jede Art von Einstellung mit ihren Feldern ([Einstellungen über MCP](/de/develop/mcp-settings)) und mit `"skill"` den [Tale-Skill](/de/develop/use-tale-from-your-editor#tale-skill). Mit `method: "tools/list"` erhältst du stattdessen die Tool-Schemas. Bewahre die JSON-RPC-`id`, damit dein Client Antwort und Anfrage zuordnen kann.

### Transport und Sammelanfragen

| Anfrage | Antwort |
| --- | --- |
| Einzelne JSON-RPC-Nachricht | Ein JSON-RPC-Ergebnis oder -Fehler |
| Bis zu 20 Nachrichten im Batch (nur Revisionen von 2025) | Array mit Antworten; Benachrichtigungen erhalten keinen eigenen Eintrag |
| Nur Benachrichtigungen | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS`; kein Schlüssel nötig |
| Andere HTTP-Methode | HTTP `405`, `Allow: POST, OPTIONS` |

Jeder zusätzliche Tool-Aufruf, jede weitere Ressourcen-Abfrage oder -Liste und jeder weitere Prompt im Batch verbraucht dasselbe Anfragebudget wie ein eigener Aufruf. Ist das Budget erschöpft, enthält der betroffene Eintrag JSON-RPC `-32000` mit `data.retryAfterMs`. Die HTTP-Antwort bleibt `200` ohne `Retry-After`. Eine einzelne Anfrage, die bereits am HTTP-Eingang abgelehnt wird, erhält REST `429`. Behandle beide Fälle nach der [Referenz zu Ratenlimits](/de/develop/rate-limits).

Der Endpunkt liefert keine CORS-Header für API-Schlüssel in Webseiten. Bewahre den Schlüssel auf einem vertrauenswürdigen Server oder im Zugangsdaten-Speicher des MCP-Clients auf. Eine Anfrage, deren `Origin`-Kopfzeile eine Website nennt, die das Deployment nicht annimmt, wird protokolliert und mit `403` `ORIGIN_FORBIDDEN` abgelehnt, wo der Betreiber diese Prüfung durchsetzt ([Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#mcp-endpoint)). Coding-Agents im Terminal senden keinen `Origin`.

### Protokollrevisionen {#protocol-revisions}

Der Endpunkt bedient zwei Generationen des Protokolls unter derselben URL und mit demselben Schlüssel und entscheidet bei jeder Anfrage, welche vorliegt. Ein Client, der `2026-07-28` spricht, sendet kein `initialize`: Jede Anfrage bringt ihre Revision und die Fähigkeiten des Clients selbst mit, deshalb bleibt zwischen zwei Anfragen nichts gespeichert.

| | `2025-11-25`, `2025-06-18`, `2025-03-26` | `2026-07-28` |
| --- | --- | --- |
| Start | `initialize`, danach die ausgehandelte Revision in `MCP-Protocol-Version` | Kein Handshake; `server/discover` nennt, was der Server spricht |
| Jede Anfrage | Die JSON-RPC-Nachricht | `params._meta` mit `io.modelcontextprotocol/protocolVersion` und `io.modelcontextprotocol/clientCapabilities`; die Header `MCP-Protocol-Version` und `Mcp-Method`, bei `tools/call`, `resources/read` und `prompts/get` zusätzlich `Mcp-Name` |
| Batches | Bis zu 20 Nachrichten | Eine Nachricht pro Anfrage |
| Ergebnisse | Wie auf dieser Seite beschrieben | Zusätzlich `resultType: "complete"` und der Server unter `_meta["io.modelcontextprotocol/serverInfo"]`; `server/discover`, die Listen und `resources/read` ergänzen `ttlMs` und `cacheScope: "private"` |
| `initialize`, `ping` | Werden beantwortet | HTTP `404` mit JSON-RPC `-32601` |
| Eine Adresse, die nichts findet | `-32002` | `-32602` |

Nach den Regeln von `2026-07-28` bedient der Endpunkt eine Anfrage, wenn ihr `_meta` eine Revision nennt oder ihr Header `MCP-Protocol-Version` `2026-07-28` lautet. Ihre Header müssen wiederholen, was im Body steht. Fehlt ein Header oder nennt er eine andere Revision, eine andere Methode, ein anderes Tool, einen anderen Prompt oder eine andere Adresse, lehnt der Endpunkt die Anfrage mit HTTP `400` und JSON-RPC `-32020` ab, bevor etwas ausgeführt wird. Einen Wert für `Mcp-Name`, der kein reines ASCII ist, sendest du als `=?base64?<UTF-8-Text in Base64>?=`. Fehlt `_meta` oder ist es fehlerhaft, antwortet der Endpunkt mit `-32602` und HTTP `400` und nennt die betroffenen Einträge unter `data.missing` oder `data.malformed`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2026-07-28' \
  --header 'Mcp-Method: server/discover' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"docs-client","version":"1.0.0"}}}}'
```

Die Antwort nennt unter `supportedVersions` alle Revisionen und enthält dieselben Fähigkeiten und `instructions` wie `initialize`, dazu den Server unter `_meta`. `ttlMs` gibt an, wie lange dein Client eine Antwort wiederverwenden darf: eine Stunde für `server/discover`, die Listen der Tools, Prompts und Adressmuster sowie die Referenzen; eine Minute für `resources/list` und den Connector-Katalog; `0` für eine Automatisierung oder einen Lauf, weil sie sich mit dem nächsten Speichern deines Agents ändern können. Jede Antwort gehört zu dem Schlüssel, der gefragt hat; ein Cache darf sie deshalb nie mit einem anderen Schlüssel teilen. Der Name aus `io.modelcontextprotocol/clientInfo` wird mit jedem Aufruf und mit den Änderungen des Aufrufs gespeichert, sodass eine Version, die ein Agent speichert, den Client nennt, der sie gespeichert hat.

## Die Tools

`tools/list` liefert das Eingabeschema jedes Tools, und ein lesendes Tool beschreibt seine Antwort zusätzlich in `outputSchema`. Die Argumente werden vor der Ausführung geprüft: Fehlende, falsch typisierte, leere oder unerwartete Argumente lehnt der Endpunkt mit einem einzigen Tool-Ergebnis mit `isError` ab, dessen `code` `INVALID_ARGUMENTS` lautet und dessen `data.issues` jedes Problem mit `path`, `code` und `message` aufführt. Den Wert eines Arguments wiederholt die Ablehnung nie. Jedes Ergebnis trägt seine Antwort als kompakten JSON-Text, und die erfolgreiche Antwort eines lesenden Tools kommt zusätzlich als `structuredContent`, dasselbe Objekt. Das Dokument in `validate_automation`, `run_automation`, `test_automation` oder `save_automation` hat bewusst eine offene Hülle: `get_docs` erklärt die Grammatik, die Engine validiert den Inhalt.

Tools liefern außerdem `readOnlyHint`, `destructiveHint`, `idempotentHint` und `openWorldHint`. Ein Host kann damit einen Aufruf erklären; die Hinweise erteilen aber weder Rechte noch Sicherheitsgarantien. Lesezugriffe sind als solche markiert, Speichern schreibt eine Version, Live-Schalten, Löschen, Installieren, Triggeränderungen und Einstellungsänderungen können Bestehendes ersetzen. Live-Ausführungen und manche Einstellungsänderungen können echte Dienste ansprechen. Live-Schalten, Löschen, einen Trigger setzen, eine Automatisierung in Projekten installieren, die Frage eines Laufs beantworten und Einstellungen ändern tragen zusätzlich `_meta["anthropic/requiresUserInteraction"]`: Ein Client, der das beachtet, fragt die Person vor jedem solchen Aufruf.

### Automatisierungen entwickeln {#authoring}

| Tool                  | Was es tut                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| `get_docs` | Automatisierungsreferenz als Text abrufen: Grammatik, Knotentypen, Capability-Knoten und Methodentabelle für `tools/call`. |
| `get_catalog` | Unterstützte Knotentypen auflisten, mit Eingabeschema, Ausgabesignatur und `outputSchema` jeder Capability; `kind` filtert die Art, `compact: true` lässt die Schemas weg. |
| `search_catalog` | Knotenkatalog nach Stichwörtern durchsuchen. |
| `validate_automation` | Ein Automatisierungsdokument validieren, ohne es zu speichern: Fehler und Warnungen mit ihrer Stelle, dazu die Ablaufanalyse und die abgeleiteten Typen. |
| `run_automation`      | Ein Automatisierungsdokument direkt gegen die deterministischen Mocks ausführen. |
| `test_automation`     | Die eigenen Abnahmetests einer Automatisierung ausführen — eines Entwurfs (`automation`) oder einer gespeicherten Version (`name`, `version`), deren Ergebnis dann an der Version festgehalten wird. |
| `save_automation`     | Ein Automatisierungsdokument als neue unveränderliche Version speichern; die Antwort nennt seine Warnungen. Siehe [Speichern, ohne Arbeit zu verlieren](#save). |
| `get_automation`      | Eine gespeicherte Version lesen — ohne Angabe die neueste, `version: "deployed"` die live geschaltete (`AUTOMATION_VERSION_UNKNOWN`, solange nichts live geschaltet ist): das Dokument unter `automation`, dazu `settings`, `taskContract` und `presentation`, `latestVersion`, `deployedVersion`, wer sie gespeichert hat (`createdBy`), über welchen Weg (`createdVia`: `app`, `upload`, `mcp`, `managed` oder `system`; `null` bei einer Version, die vor dieser Erfassung gespeichert wurde) und mit welchem Client (`clientName`), ihre `projectIds` und ihr `trigger`. |
| `list_automations` | Automatisierungen mit neuester und bereitgestellter Version sowie Installationsprojekten (`projectIds`) auflisten. |
| `deploy_automation` | Eine gespeicherte Version live schalten; eine ältere schaltet zurück. `expectedDeployedVersion` (die Version, die du als live gelesen hast, `null` für keine) lehnt das Live-Schalten mit `AUTOMATION_DEPLOYMENT_STALE` ab, wenn inzwischen eine andere live gegangen ist; die Antwort nennt die `previousVersion`. |
| `delete_automation` | Eine Automatisierung löschen — alle Versionen, ihren Trigger und ihre Installationen; ihre Läufe bleiben. `expectedLatestVersion` muss die neueste Version sein, die du gelesen hast (sonst `AUTOMATION_VERSION_STALE`); ein noch laufender Lauf verhindert das Löschen (`AUTOMATION_HAS_ACTIVE_RUNS`). |

Arbeite in dieser Reihenfolge: Grammatik und Katalog lesen, Dokument validieren, mit Mocks ausführen, Akzeptanztests ausführen, Version speichern und dann bereitstellen. Ein erfolgreicher Mock-Test bestätigt den simulierten Ablauf. Er bestätigt keine echten Zugangsdaten, Netzwerkverbindungen oder Auswirkungen beim Anbieter.

#### Speichern, ohne Arbeit zu verlieren {#save}

Eine Version trägt neben dem Dokument das Einstellungsformular `settings`, das eine Aufgabe zeigt, den `taskContract` und die `presentation` in der Automatisierungsliste. Lässt ein Speichern eines davon weg, bleibt das der neuesten Version erhalten; `null` speichert keines (bei `presentation` zeigt die Liste dann weiter die neueste frühere); ein Wert wird gegen das Schema geprüft, mit dem die App ihn liest, und mit jedem Problem als `INVALID_ARGUMENTS` abgelehnt, wenn er nicht passt. `carried` in der Antwort nennt, was erhalten blieb.

Gib `baseVersion` mit, die Version, von der deine Änderung ausging. Hat inzwischen jemand eine neuere gespeichert, wird das Speichern mit `AUTOMATION_VERSION_STALE` und `data.latestVersion` abgelehnt; lies diese Version, übernimm deine Änderung und speichere erneut. Ohne `baseVersion` wird angehängt, und `baseVersionChecked: false` sagt, dass die Prüfung entfiel. Speichere eine neue Automatisierung mit `create: true`: Ein schon vorhandener Name wird abgelehnt (`AUTOMATION_NAME_TAKEN`), damit eine neue Automatisierung nie zur Version einer anderen wird. Ebenso abgelehnt wird ein Speichern, mit oder ohne `create`, wenn der Name zu einer Automatisierung gehört, die du nicht sehen kannst. `projectId` installiert eine neue Automatisierung mit ihrer ersten Version in einem Projekt, das du bearbeiten darfst; beim Speichern einer bestehenden Automatisierung wird es ignoriert.

#### Ein Validierungsergebnis lesen {#validation-result}

`validate_automation` antwortet mit `valid`, `errors`, `warnings`, `analysis` und `types`. Fehler verhindern Speichern und Bereitstellen, Warnungen nie. `save_automation` gibt die `warnings` der gespeicherten Version zurück, und ein abgelehntes Speichern nennt seine `warnings` neben den `errors`. So erfährst du beides schon während der Arbeit.

| Feld eines Problems | Inhalt |
| --- | --- |
| `code` | Der stabile Wert für Verzweigungen, etwa `REF_UNKNOWN_FIELD` oder `MAYBE_NULL` |
| `message`, `hint` | Englische Sätze, die zwischen Releases stabil bleiben; zeige sie an, aber verzweige über `code` |
| `nodeId` | Die betroffene Node, sofern es eine gibt |
| `at.pointer` | Ein JSON Pointer in das gesendete Dokument, etwa `/nodes/2/input/to`; `""` steht für das ganze Dokument |
| `at.range` | `[start, end)` in UTF-16-Codeeinheiten innerhalb des Strings an `at.pointer`, wenn das Problem ein einzelner Ausdruck in einem Template, einer Bedingung oder Code ist |
| `at.subject` | `key`, wenn der Pointer ein Feld nennt, das es nicht geben sollte; `missing`, wenn er eines nennt, das es geben müsste und das fehlt |
| `params` | Die Fakten, aus denen die Meldung besteht, etwa `node`, `field`, `ref`, `key` und `suggestion` |
| `related` | Weitere beteiligte Stellen: die Node, von der ein Lesezugriff abhängt, die Node, deren Bedingung oder Fehler das Problem verursacht, lesende Nodes oder die Glieder eines Kreises |

`analysis.nodes.<id>` sagt, ob eine Node erreichbar ist (`reachable`), ob sie immer läuft (`alwaysRuns`), wie sie übersprungen werden kann (`maySkip`) und ob ihr Fehler den Lauf anhält (`failureHandling: "halts"`) oder weiterlaufen lässt (`"continues"`). `analysis.paths` listet die Wege, die ein erfolgreicher Lauf nehmen kann — bis zu 32, mit `count` für alle — und nennt die Nodes, deren Fehler einen Lauf beendet. `types` liefert das JSON-Schema der Eingabe des Laufs, der Ausgabe jeder Node und des Ergebnisses der Automatisierung; `get_catalog` liefert das `outputSchema` jeder Capability auf dieselbe Weise. [Was Tale vor einem Lauf prüft](/de/platform/automations/concepts#checks) erklärt jede Gruppe von Prüfungen.

`detail` wählt, was neben den Problemen zurückkommt: `["analysis"]`, `["types"]` oder `[]` für die Probleme allein; ohne `detail` bekommst du beides. Manche Warnungen prüfen das Dokument nicht, sondern vergleichen es mit deiner Organisation: ein Skill, den kein Lauf der Automatisierung erreicht (`SKILL_UNKNOWN`), ein Connector, den niemand verbunden hat (`CONNECTOR_NOT_CONNECTED`), ein Secret, das niemand gespeichert hat (`SECRET_UNKNOWN`, nur für Inhaber, Admins und Entwickler), eine Agent-Laufzeit, die dieses Deployment nicht ausführen kann (`HARNESS_UNKNOWN`), und ein Event-Trigger, der auf ein Ereignis wartet, das Tale nicht auslöst (`EVENT_UNKNOWN`). Sie verhindern nie das Speichern; die [Tools zum Nachschlagen](#discovery) zeigen, was es gibt.

### Läufe und Trigger verwalten {#management}

| Tool             | Was es tut                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run_deployed` | Die bereitgestellte Version live ausführen und bis zu 30 Sekunden auf Ausgabe, Trace und Effekte warten. Läuft sie weiter, die zurückgegebene `runId` abfragen. Nimmt denselben optionalen `idempotencyKey` wie `start_run`, im selben Register wie die REST-Tür: eine Wiederholung antwortet mit dem ersten Lauf und `duplicate: true` und startet nichts — egal, welche Tür ihn gestartet hat. |
| `start_run` | Einen Lauf im Hintergrund starten; die zurückgegebene Lauf-ID mit `get_run` abfragen. `mode: "live"` (Standard) führt die live geschaltete Version echt aus; `mode: "mock"` führt eine beliebige gespeicherte Version — ohne `version` die neueste — gegen die deterministischen Mocks aus, und der Lauf steht wie ein in der App gestarteter in der Laufhistorie. Nimmt optional einen `idempotencyKey` — den `Idempotency-Key` der REST-Tür, dasselbe Register: derselbe Schlüssel mit denselben Argumenten antwortet mit dem Handle des ersten Laufs und `duplicate: true` und startet nichts, derselbe Schlüssel mit anderen Argumenten wird abgelehnt (`IDEMPOTENCY_KEY_REUSED`). Die HTTP-Kopfzeile `Idempotency-Key` weist dieser Endpoint ab (**400**, `INVALID_HEADER`) — ein Batch trägt bis zu 20 Aufrufe, der Schlüssel reist also in den Tool-Argumenten. |
| `list_runs` | Sichtbare Läufe einer Automatisierung oder über Projekte hinweg auflisten, neueste zuerst und jeweils mit `projectId`. `mode` und `statuses` filtern, und `nextCursor` (`null` auf der letzten Seite) ist der `cursor` der nächstälteren Seite; gib ihn unverändert mit denselben Filtern mit. |
| `get_run` | Status, Ausgabe, Trace, Effekte und `projectId` eines Laufs lesen. Die ID eines Projektlaufs passt zu `GET /api/v1/projects/{id}/runs/{runId}`. Wartet der Lauf auf die Antwort einer Person (`waitingFor: "ask"`), steht die Frage unter `ask`: ihre `askId` und die Frage selbst. `detail` wählt, was neben dem Status kommt; `detail: []` liefert nur den Status, zum Abfragen eines langen Laufs. |
| `cancel_run` | Einen Lauf beim nächsten Übergang zwischen Knoten stoppen. |
| `answer_run_ask` | Die Frage beantworten, die ein wartender Lauf einer Person gestellt hat (`get_run` liefert sie unter `ask`, mit der `askId`, die du übergibst); der Lauf geht mit der Antwort weiter, die als die des Schlüsselinhabers festgehalten wird. |
| `list_versions`  | Die unveränderliche Versionshistorie einer Automatisierung; jede Zeile sagt, ob sie die `deployed` ist, wer sie über welchen Weg gespeichert hat (`createdVia`, `clientName`), und `deployedVersion` nennt die live geschaltete neben der Liste (`null`, solange nichts live geschaltet ist). `deployments` listet, wann Versionen live gingen, neueste zuerst, mit der Version, die vorher live war. |
| `set_automation_projects` | Eine Automatisierung in einem Schritt in Projekten installieren (`add`) und aus anderen entfernen (`remove`); die Antwort nennt, was `added`, `removed` und `unchanged` ist. Das Entfernen aus einem Projekt, in dem sie nicht installiert ist, wird abgelehnt (`AUTOMATION_NOT_INSTALLED`). |
| `get_automation_metrics` | Die Laufzahlen der Organisation für 7, 30 oder 90 Tage (`periodDays`), standardmäßig Live-Läufe oder Mock-Läufe: Läufe nach Ergebnis, Erfolgsquote, durchschnittliche Dauer, eine Reihe pro Tag und die meistgenutzten Automatisierungen, jeweils im Vergleich zum Zeitraum davor. |
| `list_triggers` | Triggerbindungen lesen, ohne das Webhook-Geheimnis auszugeben. |
| `delete_trigger` | Einen Trigger entfernen; Versionen und Laufhistorie bleiben erhalten. |
| `set_trigger` | Einen Zeitplan-, Webhook- oder Event-Trigger einrichten. Das `token` eines Webhooks wird einmal beantwortet, hier, und nie wieder — bewahr es auf; `deployed` sagt, ob Zustellungen laufen werden: Ein Trigger an einer Automatisierung ohne deployte Version wird gespeichert und löst nichts aus, bis eine deployt ist. |

| Tool | Geeignet für |
| --- | --- |
| `run_automation` | Ungespeichertes Dokument mit deterministischen Mocks ausprobieren; `mode: "live"` wird abgelehnt |
| `run_deployed` | Bereitgestellte Version live ausführen und bis zu 30 Sekunden warten; danach gegebenenfalls die `runId` abfragen |
| `start_run` | Bereitgestellte Version im Hintergrund starten und mit `get_run` verfolgen; mit `idempotencyKey` wird eine Wiederholung sicher |
| `start_run` mit `mode: "mock"` | Eine gespeicherte Version — live geschaltet oder nicht — gegen die Mocks ausführen, mit einem Eintrag, den jede Person in der Laufhistorie öffnen kann |

Beide Tools für bereitgestellte Versionen verwenden denselben dauerhaften Runner mit denselben Berechtigungsprüfungen und Ausführungsdaten. `start_run` akzeptiert optional `projectId`. Eine projektgebundene Automatisierung darf nur in einem ihrer Installationsprojekte laufen; bei genau einer Bindung kann dieses automatisch gewählt werden. Ohne Bindungen bedeutet eine fehlende Angabe Organisationskontext. Lies `projectIds` aus `list_automations` und die tatsächliche `projectId` aus dem zurückgegebenen Handle, statt die REST-URL zum Abfragen zu erraten.

### Nachschlagen {#discovery}

| Tool | Was es tut |
| --- | --- |
| `list_models` | Die Modelle, die du verwenden darfst, gefiltert nach deinem Modellzugriff: jeweils mit `providerSlug` (eine `agent`-Node speichert ihn als `modelProvider`), `lane` (`direct`, wenn ein Anbieter es bereitstellt, `subscription` oder `broker`, wenn das Abo eines Mitglieds es bereitstellt), den passenden `nodeTypes` (eine `llm`-Node nimmt nur ein direkt bereitgestelltes Modell) und den Agent-Laufzeiten, denen es angeboten wird (`harnesses`). `nodeType` und `harness` filtern die Liste. |
| `list_harnesses` | Die Agent-Laufzeiten, die eine `agent`-Node als `harness` nennen kann, die Standard-Laufzeit (`default`), die läuft, wenn sie keine nennt, und ob ein Abo sie jeweils bedienen kann. |
| `list_skills` | Die Skills der Organisation; mit `projectId` auch die Team-Skills dieses Projekts, also die, die ein Lauf darin verwenden kann. Ein Projekt, das du nicht lesen darfst, antwortet `PROJECT_NOT_FOUND`. |
| `list_connectors` | Die Connectors, die dieses Deployment anbietet, ob deine Organisation sie jeweils verbunden hat (`connected`) und wie viele Aktionen sie haben; `query` filtert. `search_catalog` listet die Aktionen. |
| `list_agent_secrets` | Die Namen der Agent-Secrets der Organisation mit einer maskierten Vorschau (`preview`), nie ein Wert. Inhaber, Admins und Entwickler sehen sie; alle anderen bekommen eine leere Liste mit einem Hinweis (`note`). |
| `list_projects` | Die Projekte, die du lesen darfst: ob sie jeweils bearbeitbar (`writable`) oder archiviert (`archived`) sind und welche der darin installierten Automatisierungen du sehen darfst (`automations`). `query` filtert nach Name; `includeArchived` nimmt archivierte Projekte dazu. |
| `list_events` | Die Ereignisse, die Tale auslöst, jeweils mit dem Zeitpunkt, zu dem es eintritt: worauf ein Event-Trigger warten kann. |

Jede Antwort trägt einen `hint`, der das Tool oder die Einstellung nennt, mit der sie sich ändert.

### Einstellungen {#settings}

| Tool | Was es tut |
| --- | --- |
| `get_settings` | Ohne `kinds` der Katalog: jede Art von Einstellung mit dem, was sie ist, ihren Operationen (`ops`) und Aktionen (`acts`), ihrem `baseRisk`, den Einstellungsseiten, auf denen eine Person dieselbe Änderung vornimmt (`areas`), ob dieses Deployment sie über MCP bedient (`available`) und ob deine Rolle sie lesen (`read`) und ändern (`write`) darf. Mit `kinds` — für eine einzelne Art auch mit `ids` oder dem `cursor` ihrer nächsten Seite — jede Ressource, die du lesen darfst, mit ihrem `key`, ihrer `config` und ihrem `hash`. Eine Art, die du nicht lesen darfst, steht mit dem Grund unter `refused`. |
| `plan_settings` | Plant bis zu 32 Änderungen, ohne eine davon vorzunehmen. Jede nennt ihre `action` (`create`, `update`, `delete`, `act` oder `unchanged`), den `currentHash`, einen `diff` Feld für Feld, ihre `effects` und ihr `risk` (`low`, `high` oder `critical`) oder die Ablehnung (`refusal`), an der sie scheitert. |
| `apply_settings` | Nimmt die Änderungen vor. `expected` ordnet dem `key` jeder geänderten Ressource den Hash zu, den du gelesen hast, oder `null` für eine, die du anlegst. Wird eine Änderung abgelehnt oder hat sich eine Ressource seit dem Lesen geändert, wird nichts übernommen. Sonst laufen die Änderungen in einer festen Reihenfolge über die Arten hinweg, und die erste, die scheitert, hält die übrigen an: Die Antwort listet, was übernommen wurde (`applied`), was gescheitert ist (`failed`) und was übersprungen wurde (`skipped`). |

Eine Änderung nennt ihre Art (`kind`), die `id` der Ressource (entfällt bei einer Art mit nur einer Ressource) und ihre Operation (`op`): `set` ersetzt die Ressource durch die ganze `config` und legt sie an, wenn es sie noch nicht gibt; `delete` entfernt sie; `act` führt eine der Aktionen der Art mit ihren `args` aus. Plane zuerst, zeig der Person den Plan und nimm dann dieselben Änderungen vor: `apply_settings` fragt die Person vor jedem Aufruf und hat ein eigenes [Budget](/de/develop/rate-limits).

[Einstellungen über MCP](/de/develop/mcp-settings) listet jede Art von Einstellung, wer sie ändern darf und was in Tale bleibt.

Kein Secret geht durch diese Tools. Ein gespeichertes Secret erscheint als `{"masked": true, "preview": "…"}`; schick diesen Wert unverändert zurück, um es zu behalten. Eine Änderung mit einem anderen Wert an der Stelle eines Secrets oder mit Zugangsdaten irgendwo in ihrer Konfiguration wird mit `SECRET_ARGUMENT_REFUSED` abgelehnt; ein neues Secret gibt eine Person in Tale ein.

### Capabilities und Wissen {#capabilities}

| Tool                  | Was es tut                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Bereitgestellte Automatisierungen dieser Organisation nach Name und Beschreibung durchsuchen. |
| `invoke_capability` | Eine Capability über ihre `id` aufrufen: eine bereitgestellte Automatisierung, live ausgeführt wie mit `run_deployed`. Verlangt die Organisation für einen Schritt eine Genehmigung, wartet der Lauf, bis eine Person in Tale entscheidet. |
| `get_knowledge` | Passagen aus Dokumenten und gecrawlten Websites der Organisation abrufen. `corpus` ist `private` (Dokumente), `public-web` (gecrawlte Seiten) oder `all`; die REST-Schreibweisen `documents` und `web` gehen auch. `query` ist auf 2000 Zeichen begrenzt. Jede Passage trägt `text`, `source` (einen Titel), `ref`, `corpus`, `chunkIndex`, `score`, `similarity`, wenn der dichte Zweig sie gefunden hat, `url` bei einer Webseite und — bei einem Dokument — die `documentId`, die `GET /api/v1/documents/{id}` nimmt (bei einem Projekttreffer die Datei-ID), sowie seine `projectId`: dieselbe Quellenangabe, die die REST-Suche liefert. |

Das Capability-Verzeichnis enthält derzeit bereitgestellte Automatisierungen. Integrierte Tools, Connector-Aktionen, Skills und externe MCP-Server gehören nicht dazu. Eine bereitgestellte Automatisierung aufzurufen entspricht derselben Live-Operation wie `run_deployed` und wartet ebenso bis zu 30 Sekunden auf das Ende des Laufs. Braucht ein Schritt eine [Genehmigung](/de/platform/approvals/concepts), wartet der Lauf, bis eine Person in Tale entscheidet: `output` in der Antwort ist der Lauf mit `status: "waiting"`, und `get_run` zeigt `waitingFor: "approval"`. Kein Tool genehmigt oder lehnt sie ab, also sollte dein Client der Person Bescheid geben, statt es erneut zu versuchen. Brichst du den Lauf mit `cancel_run` ab, wird die Genehmigung zurückgezogen.

## Ressourcen und Prompts {#resources-and-prompts}

Neben Tools liefert der Endpunkt Ressourcen, die ein Client über ihre Adresse liest, und Prompts: vorbereitete Anfragen, mit denen eine Person eine Arbeit beginnt. Beide lesen, was ein Tool ohnehin beantwortet, für dieselbe Person und mit denselben Prüfungen.

### Über eine Adresse lesen {#resources}

`resources/list` nennt zuerst die festen Ressourcen und danach jede Automatisierung, die der Schlüsselinhaber sehen darf, 100 pro Seite; mit `nextCursor` holst du die nächste Seite. `resources/templates/list` liefert die Adressmuster, `resources/read` den Inhalt einer Ressource.

| Adresse | Inhalt | Liest sich wie |
| --- | --- | --- |
| `tale://docs/authoring`, `tale://docs/triggers`, `tale://docs/validation`, `tale://docs/settings`, `tale://docs/skill` | Die Referenzen als Markdown | `get_docs` mit diesem `topic` |
| `tale://catalog/{kind}` (`transform`, `llm`, `agent`, `subautomation`, `connector`) | Den Abschnitt der Referenz zu einer Kern-Knotenart oder die Connector-Aktionen | `get_catalog` mit diesem `kind` |
| `tale://automations/{name}` | Die zuletzt gespeicherte Version als JSON | `get_automation` |
| `tale://automations/{name}/versions/{version}` | Eine gespeicherte Version; `{version}` ist eine Nummer oder `deployed` | `get_automation` mit `version` |
| `tale://runs/{runId}` | Einen Lauf mit Ausgabe, Trace und Effekten | `get_run` |

Schreibe jeden `/` in einem Automatisierungsnamen als `%2F`: `tale://automations/billing%2Fdunning`. Eine Adresse, die nichts findet, liefert JSON-RPC `-32002` (unter `2026-07-28` `-32602`) mit dem Code der Ablehnung in `data.code`, etwa `AUTOMATION_NOT_FOUND`. Eine Automatisierung, die der Schlüsselinhaber nicht sehen darf, liefert denselben Fehler wie eine, die es nicht gibt. Eine fehlerhafte Adresse, etwa eine Version, die keine Zahl ist, liefert `-32602`.

### Mit einem Prompt beginnen {#prompts}

`prompts/list` nennt drei Prompts, und `prompts/get` liefert die Nachricht samt dem, worum es geht, als angehängte Ressource. Claude Code zeigt sie als `/tale:edit_automation` und so weiter.

| Prompt | Argumente | Was er den Agent tun lässt |
| --- | --- | --- |
| `edit_automation` | `name` (optional) | Die Automatisierung ändern oder neu anlegen, validieren, mit Mocks testen und mit `baseVersion` speichern; er schaltet nichts live |
| `debug_failed_run` | `runId` | Erklären, warum der Lauf fehlgeschlagen ist, den Fehler mit Mocks nachstellen und die kleinste Korrektur vorschlagen |
| `add_trigger` | `name`, `kind` (optional: `schedule`, `webhook` oder `event`) | Festlegen, was die Automatisierung startet, und vor `set_trigger` nachfragen |

Jedes Argument ist ein einzelnes Wort, weil Clients wie Claude Code die Argumente an Leerzeichen trennen. Ein leer gesendetes Argument gilt als weggelassen. Ein Prompt, dessen Lauf oder Automatisierung der Schlüsselinhaber nicht lesen darf, liefert `-32602` mit dem Code dieses Lesezugriffs.

## Was der Schlüssel darf

| Vorgang | Erforderlicher Zugriff |
| --- | --- |
| Lesen, Validierung, Mock-Ausführungen (auch `start_run` mit `mode: "mock"`) und Akzeptanztests, Capability-Suche, Wissensabruf | Mitgliedschaft plus normale Zugriffsregeln der Ressource |
| Die Frage eines Laufs beantworten | Mitgliedschaft; bei einem Lauf in einem Projekt Bearbeitungszugriff auf dieses Projekt |
| Namen der Agent-Secrets (`list_agent_secrets`) | Rolle Inhaber, Admin oder Entwickler; alle anderen bekommen eine leere Liste |
| Einstellungen lesen, planen und ändern (`get_settings`, `plan_settings`, `apply_settings`) | Was deine Rolle auf derselben Einstellungsseite darf; der Katalog sagt, was deine Rolle mit jeder Art tun darf |
| Speichern, live schalten, löschen, in Projekten installieren, Trigger setzen/löschen, Lauf abbrechen oder live ausführen | Entwicklerberechtigung plus normale Zugriffsregeln der Ressource |

Der Schlüssel identifiziert seinen Inhaber. Er erweitert weder dessen Rolle noch dessen Projektzugriff. Eine Automatisierung, die nur in Projekten installiert ist, die der Schlüsselinhaber nicht lesen darf, fehlt in `list_automations`, und jeder Lesezugriff auf sie antwortet `AUTOMATION_NOT_FOUND` wie bei einer, die es nicht gibt. Auch eine Live-Ausführung über `invoke_capability` durchläuft die Ausführungsprüfungen.

Jede Änderung, die ein MCP-Aufruf an einer Automatisierung vornimmt — eine gespeicherte Version, ein Live-Schalten, ein Löschen, ein gesetzter oder entfernter Trigger, eine hinzugefügte oder entfernte Installation —, steht im Audit-Log der Organisation, gekennzeichnet als über MCP gekommen, mit dem Tool und dem API-Schlüssel. In den Details des Ereignisses zeigt **Quelle** Coding-Agent, und **Client** nennt die App des Agents, wenn sie sich bei jedem Aufruf nennt, wie mit der Revision 2026-07-28; eine App mit einer 2025er-Revision nennt sich nur bei `initialize`, deshalb zeigen ihre Ereignisse keinen **Client** ([Audit-Logs](/de/platform/admin/governance/audit-logs)).

Lies vor dem Einrichten privilegierter Tools `GET /api/v1/me`: `capabilities.developer` nennt die aktuelle Rollenberechtigung. `deploymentEditor` gehört dagegen zu einer separaten Freigabeliste des Betreibers und erteilt keine MCP-Bearbeitungsrechte. Tool-Fehler verwenden weiterhin das unten beschriebene MCP-Format; die REST-Berechtigungsabfrage ändert die JSON-RPC-Fehlerbehandlung nicht.

### Protokollfehler und abgelehnte Tools unterscheiden

| Ergebnis | Umgang damit |
| --- | --- |
| JSON-RPC `-32601` | Unbekannte Methode korrigieren; unter `2026-07-28` kommt der Fehler mit HTTP `404`, auch für `initialize` und `ping` |
| JSON-RPC `-32602` | Tool-Name anhand von `tools/list`, Name oder Argumente eines Prompts anhand von `prompts/list` oder eine Ressourcenadresse korrigieren. Mit HTTP `400` das `_meta` unter `2026-07-28` um die Einträge aus `data.missing` oder `data.malformed` ergänzen |
| JSON-RPC `-32002` | Die Ressourcenadresse findet nichts; `data.code` nennt die Ablehnung, etwa `AUTOMATION_NOT_FOUND`. Unter `2026-07-28` trägt dieselbe Antwort den Code `-32602` |
| JSON-RPC `-32020` (HTTP `400`) | Die Header einer Anfrage unter `2026-07-28` wiederholen ihren Body nicht; `MCP-Protocol-Version`, `Mcp-Method` und `Mcp-Name` wie unter [Protokollrevisionen](#protocol-revisions) beschrieben senden |
| JSON-RPC `-32022` (HTTP `400`) | Eine der Revisionen aus `data.supported` senden: in `MCP-Protocol-Version` und unter `2026-07-28` auch in `_meta`. Eine Revision von 2025 wird mit `initialize` eröffnet |
| Tool-Ergebnis mit `isError: true` | Stabilen `code`, erklärenden `error` und Handlungshinweis `hint` im Textinhalt lesen; `data` kann Feldprobleme enthalten |
| `validate_automation` mit `valid: false` | Normales Validierungsergebnis; `errors` und ihre Stellen auswerten ([Ein Validierungsergebnis lesen](#validation-result)), obwohl `isError` false bleibt. Warnungen machen ein Dokument nie ungültig |
| Capability mit `status: "waiting"` in `output` | Der Lauf wartet, etwa auf eine Genehmigung, die eine Person in Tale erteilt; er ist weder fertig noch fehlgeschlagen. `get_run` abfragen und nicht erneut versuchen |
| Capability mit `refused` | Fehlerergebnis; die genannte Ursache beheben |

Zu den Tool-Codes gehören `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `AUTOMATION_VERSION_STALE`, `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_NAME_TAKEN`, `AUTOMATION_HAS_ACTIVE_RUNS`, `AUTOMATION_NOT_INSTALLED`, `HUMAN_ASK_NOT_FOUND`, `HUMAN_ASK_NOT_PENDING`, `HUMAN_ASK_EXPIRED`, `EMPTY_ANSWER`, `INVALID_CURSOR`, `LIVE_MODE_UNAVAILABLE` und `NOT_SUPPORTED`. Letzterer bedeutet, dass der Host den Vorgang für Läufe, Versionen oder Trigger nicht unterstützt. `start_run` lehnt einen wiederverwendeten `idempotencyKey` mit anderen Argumenten als `IDEMPOTENCY_KEY_REUSED` ab; `invoke_capability` lehnt eine ID, die das Register nicht führt — eine nur gespeicherte Automatisierung steht nicht darin —, als `CAPABILITY_NOT_FOUND` ab und Eingaben, die ihr Schema zurückweist, als `CAPABILITY_INPUT_INVALID`; `get_knowledge` reicht die eigenen Codes der Wissens-Tür durch (`KNOWLEDGE_UNAVAILABLE`, wenn die Suche selbst fehlgeschlagen ist). Plattformfehler behalten ihren eigenen Code, Hinweis und gegebenenfalls Daten; fehlender Entwicklerzugriff liefert etwa `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` führt jedes Argumentproblem auf; ein Wert außerhalb einer aufgezählten Menge wird abgelehnt, und die Meldung nennt die Menge. `RATE_LIMITED` bedeutet, dass das Tool eine Ausführung oder eine Einstellungsänderung gebraucht hätte und das [Budget](/de/develop/rate-limits) des Schlüsselinhabers dafür aufgebraucht ist: Warte `data.retryAfterMs` ab. `INTERNAL_ERROR` bedeutet, dass der Aufruf unerwartet fehlgeschlagen ist; nenne dem Betreiber des Deployments die `data.requestId`. Die Einstellungs-Tools ergänzen `SETTINGS_STALE` (eine Ressource hat sich seit dem Lesen geändert; `data.currentHash` ist ihr aktueller Hash), `SECRET_ARGUMENT_REFUSED` (eine Änderung enthielt ein Secret; `data.places` sagt, wo, nie, was), `SETTINGS_KIND_UNAVAILABLE` (dieses Deployment bedient diese Art nicht über MCP), `SETTINGS_NOT_FOUND` (eine Aktion auf einer Ressource, die es nicht gibt) und `SETTINGS_DUPLICATE` (eine Ressource wurde in einem Aufruf zweimal geändert).

Ein unbekannter Automatisierungsname ist auch bei `list_versions`, `list_runs` und `list_triggers` ein Fehler. Eine leere Liste bedeutet, dass eine vorhandene Automatisierung keine passenden Einträge hat. Die eine Ausnahme ist die Laufhistorie: Eine gelöschte Automatisierung behält ihre Läufe, `list_runs {name}` antwortet sie also, solange es sie gibt, und nur ein Name, der nie gelaufen ist, ergibt `AUTOMATION_NOT_FOUND`. `get_catalog`, auf eine Kern-Knotenart eingegrenzt (`transform`, `llm`, `agent`, `subautomation`), antwortet mit einer leeren Liste und einem `hint` auf `get_docs`, wie `search_catalog` auch, und liefert unter `reference` den Abschnitt der Referenz zu dieser Knotenart. Ungültige Dokumente für Tools, die ein gültiges Dokument benötigen, fehlgeschlagene Suchen und fehlende Bereitstellungen setzen `isError: true`. Nur das Validierungstool meldet ein ungültiges Dokument als normales Prüfergebnis.

## Wo das hingehört

REST und MCP teilen Schlüssel, Organisationskontext und dauerhafte Ausführungsobjekte. Verwende REST für ausdrückliche HTTP-Routen und MCP für Clients mit Tool-Erkennung und Tool-Aufrufen. Über diesen Endpunkt registriert oder ruft Tale keine externen MCP-Server auf.
