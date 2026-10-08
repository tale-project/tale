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
| Protokollrevisionen | `2025-11-25`, oder `2025-06-18` bzw. `2025-03-26`, wenn der Client diese vorschlägt |

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

Der Endpunkt liefert keine CORS-Header für API-Schlüssel in Webseiten. Bewahre den Schlüssel auf einem vertrauenswürdigen Server oder im Zugangsdaten-Speicher des MCP-Clients auf. Eine Anfrage, deren `Origin`-Kopfzeile eine Website nennt, die das Deployment nicht annimmt, wird protokolliert und mit `403` `ORIGIN_FORBIDDEN` abgelehnt, wo der Betreiber diese Prüfung durchsetzt ([Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#mcp-endpoint)). Coding-Agents im Terminal senden keinen `Origin`.

## Die Tools

`tools/list` liefert das Eingabeschema jedes Tools, und ein lesendes Tool beschreibt seine Antwort zusätzlich in `outputSchema`. Die Argumente werden vor der Ausführung geprüft: Fehlende, falsch typisierte, leere oder unerwartete Argumente lehnt der Endpunkt mit einem einzigen Tool-Ergebnis mit `isError` ab, dessen `code` `INVALID_ARGUMENTS` lautet und dessen `data.issues` jedes Problem mit `path`, `code` und `message` aufführt. Den Wert eines Arguments wiederholt die Ablehnung nie. Jedes Ergebnis trägt seine Antwort als kompakten JSON-Text, und die erfolgreiche Antwort eines lesenden Tools kommt zusätzlich als `structuredContent`, dasselbe Objekt. Das Dokument in `validate_automation`, `run_automation`, `test_automation` oder `save_automation` hat bewusst eine offene Hülle: `get_docs` erklärt die Grammatik, die Engine validiert den Inhalt.

Tools liefern außerdem `readOnlyHint`, `destructiveHint`, `idempotentHint` und `openWorldHint`. Ein Host kann damit einen Aufruf erklären; die Hinweise erteilen aber weder Rechte noch Sicherheitsgarantien. Lesezugriffe sind als solche markiert, Speichern schreibt eine Version, Live-Schalten, Löschen, Installieren und Triggeränderungen können Bestehendes ersetzen. Live-Ausführungen können echte Dienste ansprechen. Live-Schalten, Löschen, einen Trigger setzen, eine Automatisierung in Projekten installieren und die Frage eines Laufs beantworten tragen zusätzlich `_meta["anthropic/requiresUserInteraction"]`: Ein Client, der das beachtet, fragt die Person vor jedem solchen Aufruf.

### Automatisierungen entwickeln {#autorieren}

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

Gib `baseVersion` mit, die Version, von der deine Änderung ausging. Hat inzwischen jemand eine neuere gespeichert, wird das Speichern mit `AUTOMATION_VERSION_STALE` und `data.latestVersion` abgelehnt; lies diese Version, übernimm deine Änderung und speichere erneut. Ohne `baseVersion` wird angehängt, und `baseVersionChecked: false` sagt, dass die Prüfung entfiel. `create: true` lehnt einen schon vorhandenen Namen ab (`AUTOMATION_NAME_TAKEN`), und `projectId` installiert eine neue Automatisierung mit ihrer ersten Version in einem Projekt, das du bearbeiten darfst.

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

### Läufe und Trigger verwalten

| Tool             | Was es tut                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run_deployed` | Die bereitgestellte Version live ausführen und bis zu 30 Sekunden auf Ausgabe, Trace und Effekte warten. Läuft sie weiter, die zurückgegebene `runId` abfragen. Nimmt denselben optionalen `idempotencyKey` wie `start_run`, im selben Register wie die REST-Tür: eine Wiederholung antwortet mit dem ersten Lauf und `duplicate: true` und startet nichts — egal, welche Tür ihn gestartet hat. |
| `start_run` | Einen Lauf im Hintergrund starten; die zurückgegebene Lauf-ID mit `get_run` abfragen. `mode: "live"` (Standard) führt die live geschaltete Version echt aus; `mode: "mock"` führt eine beliebige gespeicherte Version — ohne `version` die neueste — gegen die deterministischen Mocks aus, und der Lauf steht wie ein in der App gestarteter in der Laufhistorie. Nimmt optional einen `idempotencyKey` — den `Idempotency-Key` der REST-Tür, dasselbe Register: derselbe Schlüssel mit denselben Argumenten antwortet mit dem Handle des ersten Laufs und `duplicate: true` und startet nichts, derselbe Schlüssel mit anderen Argumenten wird abgelehnt (`IDEMPOTENCY_KEY_REUSED`). Die HTTP-Kopfzeile `Idempotency-Key` weist dieser Endpoint ab (**400**, `INVALID_HEADER`) — ein Batch trägt bis zu 20 Aufrufe, der Schlüssel reist also in den Tool-Argumenten. |
| `list_runs` | Sichtbare Läufe einer Automatisierung oder über Projekte hinweg auflisten, neueste zuerst und jeweils mit `projectId`. `mode` und `statuses` filtern, und `nextCursor` (`null` auf der letzten Seite) ist der `cursor` der nächstälteren Seite; gib ihn unverändert mit denselben Filtern mit. |
| `get_run` | Status, Ausgabe, Trace, Effekte und `projectId` eines Laufs lesen. Die ID eines Projektlaufs passt zu `GET /api/v1/projects/{id}/runs/{runId}`. |
| `cancel_run` | Einen Lauf beim nächsten Übergang zwischen Knoten stoppen. |
| `answer_run_ask` | Die Frage beantworten, die ein wartender Lauf einer Person gestellt hat (`get_run` zeigt `waitingFor: "ask"`); der Lauf geht mit der Antwort weiter, die als die des Schlüsselinhabers festgehalten wird. |
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

### Capabilities und Wissen

| Tool                  | Was es tut                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Bereitgestellte Automatisierungen dieser Organisation nach Name und Beschreibung durchsuchen. |
| `invoke_capability` | Eine Capability über ihre `id` aufrufen. Ist eine Genehmigung erforderlich, liefert das Tool einen wartenden Genehmigungszustand, statt die Aktion auszuführen. |
| `get_knowledge` | Passagen aus Dokumenten und gecrawlten Websites der Organisation abrufen. `corpus` ist `private` (Dokumente), `public-web` (gecrawlte Seiten) oder `all`; die REST-Schreibweisen `documents` und `web` gehen auch. `query` ist auf 2000 Zeichen begrenzt. Jede Passage trägt `text`, `source` (einen Titel), `ref`, `corpus`, `chunkIndex`, `score`, `similarity`, wenn der dichte Zweig sie gefunden hat, `url` bei einer Webseite und — bei einem Dokument — die `documentId`, die `GET /api/v1/documents/{id}` nimmt (bei einem Projekttreffer die Datei-ID), sowie seine `projectId`: dieselbe Quellenangabe, die die REST-Suche liefert. |

Das Capability-Verzeichnis enthält derzeit bereitgestellte Automatisierungen. Integrierte Tools, Connector-Aktionen, Skills und externe MCP-Server gehören nicht dazu. Eine bereitgestellte Automatisierung aufzurufen entspricht derselben Live-Operation wie `run_deployed`. Wenn eine Genehmigung nötig ist, kann der Client anhand von `pending` erklären, dass zuerst ein Mensch entscheiden muss.

## Was der Schlüssel darf

| Vorgang | Erforderlicher Zugriff |
| --- | --- |
| Lesen, Validierung, Mock-Ausführungen (auch `start_run` mit `mode: "mock"`) und Akzeptanztests, Capability-Suche, Wissensabruf | Mitgliedschaft plus normale Zugriffsregeln der Ressource |
| Die Frage eines Laufs beantworten | Mitgliedschaft; bei einem Lauf in einem Projekt Bearbeitungszugriff auf dieses Projekt |
| Namen der Agent-Secrets (`list_agent_secrets`) | Rolle Inhaber, Admin oder Entwickler; alle anderen bekommen eine leere Liste |
| Speichern, live schalten, löschen, in Projekten installieren, Trigger setzen/löschen, Lauf abbrechen oder live ausführen | Entwicklerberechtigung plus normale Zugriffsregeln der Ressource |

Der Schlüssel identifiziert seinen Inhaber. Er erweitert weder dessen Rolle noch dessen Projektzugriff. Eine Automatisierung, die nur in Projekten installiert ist, die der Schlüsselinhaber nicht lesen darf, fehlt in `list_automations`, und jeder Lesezugriff auf sie antwortet `AUTOMATION_NOT_FOUND` wie bei einer, die es nicht gibt. Auch eine Live-Ausführung über `invoke_capability` durchläuft die Ausführungsprüfungen.

Jede Änderung, die ein MCP-Aufruf an einer Automatisierung vornimmt — eine gespeicherte Version, ein Live-Schalten, ein Löschen, ein gesetzter oder entfernter Trigger, eine hinzugefügte oder entfernte Installation —, steht im Audit-Log der Organisation, gekennzeichnet als über MCP gekommen, mit dem Tool und dem API-Schlüssel.

Lies vor dem Einrichten privilegierter Tools `GET /api/v1/me`: `capabilities.developer` nennt die aktuelle Rollenberechtigung. `deploymentEditor` gehört dagegen zu einer separaten Freigabeliste des Betreibers und erteilt keine MCP-Bearbeitungsrechte. Tool-Fehler verwenden weiterhin das unten beschriebene MCP-Format; die REST-Berechtigungsabfrage ändert die JSON-RPC-Fehlerbehandlung nicht.

### Protokollfehler und abgelehnte Tools unterscheiden

| Ergebnis | Umgang damit |
| --- | --- |
| JSON-RPC `-32601` | Unbekannte Methode korrigieren |
| JSON-RPC `-32602` | Tool-Name anhand von `tools/list` korrigieren |
| JSON-RPC `-32022` (HTTP `400`) | `MCP-Protocol-Version` mit einer der Revisionen aus `data.supported` senden |
| Tool-Ergebnis mit `isError: true` | Stabilen `code`, erklärenden `error` und Handlungshinweis `hint` im Textinhalt lesen; `data` kann Feldprobleme enthalten |
| `validate_automation` mit `valid: false` | Normales Validierungsergebnis; `errors` und ihre Stellen auswerten ([Ein Validierungsergebnis lesen](#validation-result)), obwohl `isError` false bleibt. Warnungen machen ein Dokument nie ungültig |
| Capability mit `pending` | Normales Genehmigungsergebnis; weder als fertig noch als erneut zu versuchenden Fehler behandeln |
| Capability mit `refused` | Fehlerergebnis; die genannte Ursache beheben |

Zu den Tool-Codes gehören `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `AUTOMATION_VERSION_STALE`, `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_NAME_TAKEN`, `AUTOMATION_HAS_ACTIVE_RUNS`, `AUTOMATION_NOT_INSTALLED`, `HUMAN_ASK_NOT_FOUND`, `HUMAN_ASK_NOT_PENDING`, `HUMAN_ASK_EXPIRED`, `EMPTY_ANSWER`, `INVALID_CURSOR`, `LIVE_MODE_UNAVAILABLE` und `NOT_SUPPORTED`. Letzterer bedeutet, dass der Host den Vorgang für Läufe, Versionen oder Trigger nicht unterstützt. `start_run` lehnt einen wiederverwendeten `idempotencyKey` mit anderen Argumenten als `IDEMPOTENCY_KEY_REUSED` ab; `invoke_capability` lehnt eine ID, die das Register nicht führt — eine nur gespeicherte Automatisierung steht nicht darin —, als `CAPABILITY_NOT_FOUND` ab und Eingaben, die ihr Schema zurückweist, als `CAPABILITY_INPUT_INVALID`; `get_knowledge` reicht die eigenen Codes der Wissens-Tür durch (`KNOWLEDGE_UNAVAILABLE`, wenn die Suche selbst fehlgeschlagen ist). Plattformfehler behalten ihren eigenen Code, Hinweis und gegebenenfalls Daten; fehlender Entwicklerzugriff liefert etwa `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` führt jedes Argumentproblem auf; ein Wert außerhalb einer aufgezählten Menge wird abgelehnt, und die Meldung nennt die Menge. `RATE_LIMITED` bedeutet, dass das Tool eine Ausführung gebraucht hätte und das [Ausführungsbudget](/de/develop/rate-limits) des Schlüsselinhabers aufgebraucht ist: Warte `data.retryAfterMs` ab. `INTERNAL_ERROR` bedeutet, dass der Aufruf unerwartet fehlgeschlagen ist; nenne dem Betreiber des Deployments die `data.requestId`.

Ein unbekannter Automatisierungsname ist auch bei `list_versions`, `list_runs` und `list_triggers` ein Fehler. Eine leere Liste bedeutet, dass eine vorhandene Automatisierung keine passenden Einträge hat. Die eine Ausnahme ist die Laufhistorie: Eine gelöschte Automatisierung behält ihre Läufe, `list_runs {name}` antwortet sie also, solange es sie gibt, und nur ein Name, der nie gelaufen ist, ergibt `AUTOMATION_NOT_FOUND`. `get_catalog`, auf eine Kern-Knotenart eingegrenzt (`transform`, `llm`, `agent`, `subautomation`), antwortet mit einer leeren Liste und einem `hint` auf `get_docs`, wie `search_catalog` auch. Ungültige Dokumente für Tools, die ein gültiges Dokument benötigen, fehlgeschlagene Suchen und fehlende Bereitstellungen setzen `isError: true`. Nur das Validierungstool meldet ein ungültiges Dokument als normales Prüfergebnis.

## Wo das hingehört

REST und MCP teilen Schlüssel, Organisationskontext und dauerhafte Ausführungsobjekte. Verwende REST für ausdrückliche HTTP-Routen und MCP für Clients mit Tool-Erkennung und Tool-Aufrufen. Über diesen Endpunkt registriert oder ruft Tale keine externen MCP-Server auf.
