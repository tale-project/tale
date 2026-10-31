---
title: MCP-Endpoint
description: Verbinde einen MCP-Client, entdecke Tale-Tools, entwickle Automatisierungen und behandle Zugriffsprüfungen und Ausführungsergebnisse.
i18nLintExclude:
  - terminology-loanword
---

Verbinde einen MCP-Client, wenn ein Agent Tale-Tools entdecken, Wissen abrufen oder Automatisierungen entwickeln und ausführen soll. Eine Person verbindet den Agent, indem sie sich im Agent anmeldet, oder der Agent nutzt einen API-Schlüssel, wie ihn auch [REST](/de/develop/api-reference) annimmt; so oder so arbeitet er in einer Organisation und darf nie mehr, als die Person hinter ihm darf. Tale ist dabei der Server: Dein externer Client ruft Tale auf.

Beginne mit `initialize`, prüfe `tools/list` und rufe vor dem Schreiben einer Automatisierung `get_docs` auf. Deine Installation liefert ihre unterstützte Grammatik selbst. Der Client muss Knotentypen und Konfigurationsfelder deshalb nicht erraten.

## Einen Client verbinden

### Die Verbindung vorbereiten

Es gibt zwei Wege zum Endpunkt, und du kannst für verschiedene Clients beide nutzen:

- **Im Agent anmelden.** Der Agent findet die Anmeldung von Tale selbst und öffnet deinen Browser; du wählst die Organisation und wie viel er darf. Nichts wird von Hand kopiert, und du kannst den Agent später trennen. [Im Agent anmelden](#sign-in) beschreibt den Ablauf. Dieser Weg steht zur Verfügung, solange dein Betreiber ihn nicht abgeschaltet hat.
- **Ein API-Schlüssel.** [Erstelle einen](/de/platform/admin/api-keys) und hinterlege ihn in der sicheren Konfiguration deines Clients. Er eignet sich für Skripte und Clients, die keinen Browser öffnen können. Ein Schlüssel handelt im Namen seines Inhabers und hat keine eigenen Zugriffsstufen.

Unter **Einstellungen > API > MCP** findest du die Befehle, die Claude Code oder Codex verbinden, den Endpunkt, den Organisations-Slug und eine kopierbare Anfrage zur Tool-Erkennung.

| Einstellung | Wert |
| --- | --- |
| Endpunkt | `https://your-host.example.com/api/v1/mcp` |
| Transport | HTTPS-POST mit JSON-RPC und normalen JSON-Antworten |
| Authentifizierung | `Authorization: Bearer <api-key>` oder das Zugriffstoken, das ein Agent bei der Anmeldung durch eine Person erhalten hat |
| Organisation | `X-Organization-Slug: <slug>` bei einem Schlüssel; ein angemeldeter Agent arbeitet in der Organisation, die die Person beim Verbinden gewählt hat |
| Protokollrevisionen | `2026-07-28`, von jeder Anfrage selbst mitgebracht; oder `2025-11-25`, `2025-06-18` bzw. `2025-03-26`, mit `initialize` eröffnet ([Protokollrevisionen](#protocol-revisions)) |

Der Client muss entfernte HTTP-Endpunkte unterstützen. Ein Client, der sich selbst anmeldet, braucht keine eigenen Header; einer, der einen Schlüssel sendet, braucht sie. Es gibt keinen SSE-Ereignisstrom und keine Sitzung zum Löschen. Ein reiner stdio-Client kann diese URL nicht direkt nutzen. Fertige Konfigurationen für Claude Code, Codex, opencode und andere findest du unter [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor).

Sende bei einem Schlüssel in wiederverwendbaren Integrationen immer den Organisations-Header. Er ist nur bei genau einer Mitgliedschaft optional. Ohne ihn führt ein Schlüsselinhaber mit mehreren Organisationen zu `400 ORG_SLUG_REQUIRED`. Ein unbekannter Slug liefert `404 ORG_SLUG_INVALID`, eine Organisation ohne Mitgliedschaft `403 ORG_FORBIDDEN`. Jede dieser Ablehnungen nennt in `data.organizations` die Slugs, die du senden kannst. Ein angemeldeter Agent arbeitet in der einen Organisation, die die Person beim Verbinden gewählt hat, und braucht keinen Header; nennt er eine andere, antwortet `403 ORG_MISMATCH` ([Im Agent anmelden](#sign-in)).

### Im Agent anmelden {#sign-in}

Ein Agent, der MCP-Autorisierung unterstützt, meldet sich selbst an. Die Person, die ihn verbindet, entscheidet über Organisation und Zugriff, Tale speichert die Verbindung, und der Agent besitzt nie einen Schlüssel. Dein Betreiber kann das abschalten. Solange es aus ist, antworten die unten genannten Discovery-Dokumente mit JSON und `404`, und nur ein Schlüssel öffnet den Endpunkt; [Coding-Agents anmelden lassen](/de/self-hosted/configuration/authentication#coding-agent-sign-in) sagt Betreibern, was sie prüfen sollten, bevor sie es eingeschaltet lassen.

1. **Der Agent fragt ohne Zugangsdaten an.** Der Endpunkt antwortet mit `401` und einer `WWW-Authenticate: Bearer`-Challenge. Ihr `resource_metadata` nennt, wo der Endpunkt sich selbst beschreibt, und ihr `scope` führt jeden Scope auf, den der Endpunkt kennt.
2. **Der Agent liest die Metadaten.** `/.well-known/oauth-protected-resource/api/v1/mcp` sagt, welcher Server Agents anmeldet, und `/.well-known/oauth-authorization-server/api/auth` beschreibt diesen Server: seine Endpunkte für Autorisierung, Token und Registrierung, PKCE mit `S256` und den Refresh-Grant.
3. **Der Agent weist sich aus.** Entweder durch die HTTPS-Adresse eines Client-Metadatendokuments, das er selbst veröffentlicht, wie es Claude Code und Codex tun, oder indem er sich beim Anmeldeserver selbst registriert. Ein selbst registrierter Agent darf auf eine Loopback-Adresse oder auf eine Webadresse eines Hosts weiterleiten, den der Betreiber erlaubt.
4. **Eine Person verbindet ihn.** Der Agent öffnet Tale im Browser. Die Person meldet sich an, wählt die Organisation, in der der Agent arbeiten soll, und den Zugriff, den sie ihm gibt, und klickt auf der Zustimmungsseite auf **Verbinden**; die Seite nennt die App und sagt, ob ihre Domain bestätigt ist. Wer in dieser Organisation keinen Agent verbinden darf, erfährt es dort.
5. **Der Agent ruft den Endpunkt auf.** Er erhält ein Zugriffstoken, das fünf Minuten gilt, und ein Refresh-Token, das dreißig Tage ohne Nutzung gültig bleibt und bei jeder Nutzung ersetzt wird; das Zugriffstoken erneuert er selbst. Jeder Aufruf enthält `Authorization: Bearer <access token>`.

Ein Agent, der mehr verlangt, als der Endpunkt vergibt, wird dafür nicht abgelehnt: Codex verlangt neben den Agent-Scopes `openid`, `profile`, `email` und `tale:organization`, und Tale lässt diese weg, weil ein Agent nie einen Identitäts-Scope erhält. Ein Agent, der nur Identitäts-Scopes verlangt, verlangt nichts, was der Endpunkt vergibt, und wird mit `invalid_scope` abgelehnt.

#### Wer einen Agent verbinden darf {#who-may-connect}

Inhaber, Admins und Entwickler dürfen einen Agent mit der Organisation verbinden und ihm jeden Zugriff geben. Ein Mitglied darf einen nur mit einem Recht verbinden, das mit einem Schlüssel genutzt wird, und darf ihm **Lesen und testen** sowie **Einstellungen lesen** geben. Allen anderen sagt die Zustimmungsseite, dass sie in dieser Organisation keinen Agent verbinden dürfen. Alles, was über **Lesen und testen** und **Einstellungen lesen** hinausgeht, braucht eine Anmeldung aus den letzten 24 Stunden, deshalb fragt die Seite zuerst nach dem Passwort.

#### Zugriffsstufen {#access-levels}

Die Zustimmungsseite bietet drei Stufen an, von denen jede zur vorigen hinzukommt, und drei weitere Wahlmöglichkeiten. Was die Person erlaubt, wird zu den Scopes im Token des Agents, und der Endpunkt prüft sie bei jedem Aufruf zusätzlich zur Rolle der Person: Ein Aufruf braucht beides, und zuerst wird die Rolle geprüft. Ein Scope erweitert nie eine Rolle.

Jede Wahl unten nennt ihren Scope und die Tools, die sie freischaltet:

- **Lesen und testen** (`tale:mcp`): `get_docs`, `get_catalog`, `search_catalog`, `validate_automation`, `run_automation`, `test_automation`, `get_automation`, `list_automations`, `list_runs`, `get_run`, `get_run_node`, `compare_runs`, `list_versions`, `list_triggers`, `get_automation_metrics`, `list_models`, `list_harnesses`, `list_skills`, `list_connectors`, `list_agent_secrets`, `list_projects`, `list_events`, `search_capabilities`, `get_knowledge`
- **Automatisierungen bearbeiten** (`tale:automations.write`): `save_automation`
- **Bearbeiten und live schalten** (`tale:automations.deploy`): `deploy_automation`, `delete_automation`, `set_trigger`, `run_deployed`, `start_run`, `replay_run`, `cancel_run`, `answer_run_ask`, `set_automation_projects`, `delete_trigger`, `invoke_capability`
- **Einstellungen lesen** (`tale:settings.read`): `get_settings`, `plan_settings`
- **Einstellungen ändern** (`tale:settings.write`): `apply_settings`
- **KI-Abos verbinden** (`tale:subscriptions.connect`): Noch kein Tool nutzt diese Wahl.

Ein Mock-Lauf (`start_run` mit `mode: "mock"`) und der Plan eines Replays brauchen nur **Lesen und testen**; ein Live-Start und ein Live-Replay brauchen **Bearbeiten und live schalten**. `get_settings` und `plan_settings` akzeptieren statt **Einstellungen lesen** auch **Einstellungen ändern**. Eine Verbindung hat den Zugriff, den die Person beim Verbinden erlaubt hat: Erlaubt die Person dieselbe App erneut, ändert das diese Verbindung und fügt keine zweite hinzu, und eine App, die getrennt war und wieder erlaubt wird, bildet eine neue Verbindung.

Ein Aufruf, den der Zugriff der Verbindung nicht abdeckt, wird abgelehnt, bevor etwas läuft. Der Endpunkt antwortet mit `403` und dem Code `INSUFFICIENT_SCOPE`: `data.requiredScopes` nennt den Zugriff, den der Agent anfragen soll, `data.grantedScopes` das, was die Verbindung hat, und eine `WWW-Authenticate`-Challenge fragt beides zusammen an, damit erneutes Anfragen nie Zugriff wegnimmt, den der Agent hatte. Eine Sammelanfrage wird als Ganzes abgelehnt, sie wird also nie halb ausgeführt. Ein Aufruf, den die Rolle der Person nie erlauben könnte, wird so nicht abgelehnt; er ist ein Tool-Fehler mit demselben Code und dem Hinweis, die Person zu informieren, weil erneutes Verbinden nichts ändern würde.

#### Eine Organisation {#one-organization}

Eine Verbindung arbeitet in der Organisation, für die sie gemacht wurde, egal welchen Organisationen die Person angehört. Ein Aufruf, der mit `X-Organization-Slug` eine andere Organisation nennt, wird mit `403` `ORG_MISMATCH` abgelehnt, und `data.organization` nennt die Organisation, für die die Verbindung gilt. Wer einen Agent in zwei Organisationen nutzen will, verbindet ihn mit jeder.

#### Eine Verbindung beenden {#disconnect}

Unter **Einstellungen > API > Verbundene Agenten** ([Verbundene Agenten](/de/platform/admin/connected-agents)) beendet eine Person ihre eigene Verbindung, und Inhaber oder Admins beenden jede. Der nächste Aufruf des Agents wird mit `401` abgelehnt, und er kann seine Anmeldung nicht erneuern. Eine Verbindung endet auch, ohne dass jemand darum bittet: wenn die Person die Organisation verlässt, gelöscht wird, ihr Passwort ändert oder durch das Zurücksetzen eines Admins einen Passkey oder die Zwei-Faktor-Authentifizierung verliert, und wenn ein Refresh-Token zweimal verwendet wird, was jede Verbindung dieser App für diese Person beendet. Bei einer Trennung, die sie nicht selbst vorgenommen hat, findet die Person einen Hinweis in ihren Benachrichtigungen.

### Initialisieren und die Referenz abrufen

Die Beispiele setzen `TALE_URL`, `TALE_API_KEY` und `TALE_ORG_SLUG` in deiner Umgebung voraus. `TALE_URL` ist die Anwendungsadresse ohne `/api/v1`. Ein angemeldeter Agent sendet sein Zugriffstoken im selben Header.

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
| `run_automation`      | Ein Automatisierungsdokument direkt gegen die deterministischen Mocks ausführen. Simulierte Ausgaben und Fehler (`mocks`, `failures`) ersetzen Nodes, und `upTo`, `only` und `item` führen nur einen Teil aus: siehe [Einen Entwurf ausprobieren und Tests ausführen](#testing). |
| `test_automation`     | Die eigenen Abnahmetests einer Automatisierung ausführen — alle oder die in `tests` genannten — eines Entwurfs (`automation`) oder einer gespeicherten Version (`name`, `version`), deren Gesamtergebnis dann an der Version festgehalten wird. `detail` ergänzt, was jeder Lauf zurückgab, tat und durchlief: siehe [Einen Entwurf ausprobieren und Tests ausführen](#testing). |
| `save_automation`     | Ein Automatisierungsdokument als neue unveränderliche Version speichern; die Antwort nennt seine Warnungen. Siehe [Speichern, ohne Arbeit zu verlieren](#save); mit `name` und `restoreVersion` statt eines Dokuments holt es eine ältere Version zurück, siehe [Vergleichen, wiederherstellen und zurückschalten](#versions). |
| `get_automation`      | Eine gespeicherte Version lesen — ohne Angabe die neueste, `version: "deployed"` die live geschaltete (`AUTOMATION_VERSION_UNKNOWN`, solange nichts live geschaltet ist): das Dokument unter `automation`, dazu `settings`, `taskContract` und `presentation`, `latestVersion`, `deployedVersion`, wer sie gespeichert hat (`createdBy`), über welchen Weg (`createdVia`: `app`, `upload`, `mcp`, `managed` oder `system`; `null` bei einer Version, die vor dieser Erfassung gespeichert wurde) und mit welchem Client (`clientName`), ihre `projectIds` und ihr `trigger`. Mit `against` trägt die Antwort außerdem einen `diff` dessen, was die Version gegenüber einer anderen geändert hat: siehe [Vergleichen, wiederherstellen und zurückschalten](#versions). |
| `list_automations` | Automatisierungen mit neuester und bereitgestellter Version sowie Installationsprojekten (`projectIds`) auflisten. |
| `deploy_automation` | Eine gespeicherte Version live schalten; eine ältere schaltet zurück. `expectedDeployedVersion` (die Version, die du als live gelesen hast, `null` für keine) lehnt das Live-Schalten mit `AUTOMATION_DEPLOYMENT_STALE` ab, wenn inzwischen eine andere live gegangen ist; die Antwort nennt die `previousVersion` und ihre `kind`: `rollback` bei einer älteren Version, `unchanged`, wenn diese Version schon live war, sonst `deploy`. |
| `delete_automation` | Eine Automatisierung löschen — alle Versionen, ihren Trigger und ihre Installationen; ihre Läufe bleiben. `expectedLatestVersion` muss die neueste Version sein, die du gelesen hast (sonst `AUTOMATION_VERSION_STALE`); ein noch laufender Lauf verhindert das Löschen (`AUTOMATION_HAS_ACTIVE_RUNS`). |

Arbeite in dieser Reihenfolge: Grammatik und Katalog lesen, Dokument validieren, mit Mocks ausführen, Akzeptanztests ausführen, Version speichern und dann bereitstellen. Ein erfolgreicher Mock-Test bestätigt den simulierten Ablauf. Er bestätigt keine echten Zugangsdaten, Netzwerkverbindungen oder Auswirkungen beim Anbieter.

#### Speichern, ohne Arbeit zu verlieren {#save}

Eine Version trägt neben dem Dokument das Einstellungsformular `settings`, das eine Aufgabe zeigt, den `taskContract` und die `presentation` in der Automatisierungsliste. Lässt ein Speichern eines davon weg, bleibt das der neuesten Version erhalten; `null` speichert keines (bei `presentation` zeigt die Liste dann weiter die neueste frühere); ein Wert wird gegen das Schema geprüft, mit dem die App ihn liest, und mit jedem Problem als `INVALID_ARGUMENTS` abgelehnt, wenn er nicht passt. `carried` in der Antwort nennt, was erhalten blieb.

Gib `baseVersion` mit, die Version, von der deine Änderung ausging. Hat inzwischen jemand eine neuere gespeichert, wird das Speichern mit `AUTOMATION_VERSION_STALE` und `data.latestVersion` abgelehnt; lies diese Version, übernimm deine Änderung und speichere erneut. Ohne `baseVersion` wird angehängt, und `baseVersionChecked: false` sagt, dass die Prüfung entfiel. Speichere eine neue Automatisierung mit `create: true`: Ein schon vorhandener Name wird abgelehnt (`AUTOMATION_NAME_TAKEN`), damit eine neue Automatisierung nie zur Version einer anderen wird. Ebenso abgelehnt wird ein Speichern, mit oder ohne `create`, wenn der Name zu einer Automatisierung gehört, die du nicht sehen kannst. `projectId` installiert eine neue Automatisierung mit ihrer ersten Version in einem Projekt, das du bearbeiten darfst; beim Speichern einer bestehenden Automatisierung wird es ignoriert.

#### Vergleichen, wiederherstellen und zurückschalten {#versions}

Jedes Speichern fügt eine Version hinzu. Ihr Dokument und ihre Paketdaten bleiben unverändert, solange sie aufbewahrt wird. Das Löschen der Automatisierung oder eine Aufbewahrungsrichtlinie kann Versionen entfernen; nur eine aufbewahrte Version lässt sich lesen, vergleichen und zurückholen. Ohne `limit` antwortet `list_versions` mit allen aufbewahrten Versionen, neueste zuerst. Mit `limit` kommt eine Seite, und `nextBefore` ist das `before` der nächsten. Jede Zeile sagt, wer die Version über welchen Weg und mit welchem Client gespeichert hat, auf welcher Version sie beruht und welche sie wiederherstellt, was sie geändert hat, wie ihre Tests ausgingen und ob sie live ist.

Sieh dir vor dem Live-Schalten an, was eine Version ändert. `get_automation` mit `against` antwortet mit der Version und daneben einem `diff` gegen eine andere: `"previous"` (die davor gespeicherte, der Standard), `"deployed"` (die live geschaltete), `"latest"` oder eine Nummer. Der Diff listet, was sich Node für Node, im Schema der Eingabe, in der Ausgabe, in der Beschreibung und in den Tests geändert hat; mit `diffFormat: "unified"` kommt stattdessen ein Patch über das YAML beider Versionen, mit `"both"` beides.

Zurückgehen kannst du auf zwei Wegen, und beide lassen den Verlauf unangetastet. `save_automation` mit `name` und `restoreVersion` speichert den Inhalt einer älteren Version als neueste Version, nach den Prüfungen und Tests jedes Speicherns; die live geschaltete bleibt live. Enthält die neueste Version diesen Inhalt schon, wird nichts gespeichert, und die Antwort sagt `unchanged: true`. `deploy_automation` mit einer älteren Version schaltet die Live-Version zurück: Die Antwort trägt `kind: "rollback"` und die `previousVersion`, die du erneut live schalten kannst. Gib `expectedDeployedVersion` mit, damit ein Live-Schalten nie das einer Kollegin oder eines Kollegen rückgängig macht.

#### Einen Entwurf ausprobieren und Tests ausführen {#testing}

`run_automation` führt ein Dokument aus, das du nicht gespeichert hast, mit den deterministischen Mocks: Nichts verlässt Tale, und nichts wird gespeichert. Neben `input` nimmt es entgegen, was auch die [Tests](/de/platform/automations/testing) und das Testen einzelner Nodes im Editor verwenden:

- `mocks` ordnet der ID einer Node eine simulierte Ausgabe zu, die an die Stelle ihres Aufrufs tritt – des Aufrufs eines Connectors, eines Modells, eines Agenten, einer aufgerufenen Automatisierung oder des Codes der Node. Die Eingabe der Node wird trotzdem berechnet und ihre Wirkung festgehalten, der Lauf zeigt also, was die Node senden würde. Bei einer Node, die einmal pro Element läuft (`forEach`), gibst du eine Liste mit einer Ausgabe pro Element an.
- `failures` ordnet der ID einer Node eine Meldung zu, mit der sie fehlschlägt – so siehst du, was der Rest der Automatisierung daraus macht.
- `upTo` führt eine Node samt allem aus, was sie braucht, und lässt den Rest weg.
- `only` führt eine einzelne Node allein aus, auf den Daten, die du in `mocks` für jede Node festlegst, die sie liest; `item` wählt bei einer so ausgeführten `forEach`-Node ein einzelnes Element, ab 0 gezählt.

Die Antwort sagt, wo der Lauf stand (`focus`), und welche simulierten Ausgaben er nie verwendet hat (`unusedMocks`), weil ihre Node übersprungen, weggelassen oder nie erreicht wurde. Simulierte Ausgaben oder eine Beschränkung, die das Dokument nicht annehmen kann, werden als `BENCH_INVALID` abgelehnt – eine Node, die es im Dokument nicht gibt (die Ablehnung nennt die ähnlichste), oder Beschränkungen, die sich nicht kombinieren lassen, etwa `item` ohne `only` –, mit der Erklärung der Engine unter `data.issue`. Eine simulierte Ausgabe über 64 KB oder mehrere über 512 KB zusammen werden als `INVALID_ARGUMENTS` abgelehnt. Ein Lauf wird vor seinem nächsten Schritt angehalten, sobald er 20 Sekunden gelaufen ist, und antwortet mit `stoppedBy: "time_limit"`.

`test_automation` führt die Tests aus dem Block `tests:` des Dokuments aus, dieselben, die [der Editor ausführt](/de/platform/automations/testing). Lässt du `tests` weg, laufen alle; mit einer Liste von Namen laufen nur diese, so benannt, wie das Dokument sie nennt. Ein Name, den kein Test trägt, wird mit `INVALID_PARAMS` und den vorhandenen Namen abgelehnt; ebenso ein Name, den mehrere Tests tragen, mit den Stellen, an denen sie stehen. Jedes Ergebnis sagt, ob sein Test bestanden hat, und bei einem, der es nicht hat, was abwich und wo (`failures`). `detail` ergänzt jedes Ergebnis um das, was sein Lauf zurückgab (`"output"`), getan hätte (`"effects"`) und durchlief (`"trace"`, der Lauf Schritt für Schritt). Ein Lauf über 256 KB und Läufe über 384 KB zusammen werden weggelassen und mit `detailOmitted` markiert; führe diesen Test dann allein aus. Ein Test endet nach 10 Sekunden, eine Suite nach 60.

Die ganze Testsuite einer gespeicherten Version, bis zum Ende ausgeführt, wird an der Version als ihr Ergebnis festgehalten, als von Hand ausgeführt: Die Antwort sagt `recorded`, und `list_versions` zeigt es. Ein Teil der Suite, ein Entwurf und eine Suite, deren Zeit abgelaufen ist, halten nichts fest.

Beide laufen in Tale und verbrauchen das Budget der Organisation für Läufe, die nie gespeichert werden – eine Einheit pro Lauf oder Test, dasselbe Budget wie bei den Versuchen und Testläufen der App –, zusätzlich zum [Ausführungsbudget](/de/develop/rate-limits) des Schlüsselinhabers. Ist eines davon aufgebraucht oder führt der Server schon so viele aus, wie er kann, wird der Aufruf mit `RATE_LIMITED` und `data.retryAfterMs` abgelehnt.

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
| `get_run` | Status, Ausgabe, Trace, Effekte und `projectId` eines Laufs lesen. Die ID eines Projektlaufs passt zu `GET /api/v1/projects/{id}/runs/{runId}`. Wartet der Lauf auf die Antwort einer Person (`waitingFor: "ask"`), steht die Frage unter `ask`: ihre `askId` und die Frage selbst. `detail` wählt, was neben dem Status kommt; `detail: []` liefert nur den Status, zum Abfragen eines langen Laufs. `include: ["record"]` fügt den Lauf Schritt für Schritt unter `record` an: den Status jedes Schritts, warum er lief oder übersprungen wurde – jede Bedingung erklärt mit den Werten, die sie gelesen hat –, warum er fehlschlug (`failure.reason` und seine Erklärung) und Einblicke in seine Werte; `include: ["travels"]` fügt die Daten an, die zwischen den Schritten flossen. |
| `get_run_node` | Einen Schritt eines Laufs ganz lesen – oder eines seiner Elemente oder Durchläufe (`item`, `pass`): was er erhielt und zurückgab, Geheimnisse zurückgehalten; wo der Text jeder `{{ }}`-Einheit landete; was er aus früheren Schritten las; wie sich seine Ausgabe von seiner Eingabe unterscheidet; und sein Aufruf eines Connectors oder Modells. Einen Schritt, den die Aufzeichnung nicht enthält, lehnt das Tool ab (`NODE_RUN_NOT_FOUND`). |
| `compare_runs` | Zwei Läufe einer Automatisierung nebeneinander (`a`, der frühere, und `b`): was sich an der Version änderte, wie sich Ein- und Ausgabe unterscheiden, Status und Entscheidungen jedes Schritts und der erste Schritt, an dem die Läufe auseinandergingen, mit den Werten, die seine Bedingung kippten. Läufe verschiedener Automatisierungen lehnt das Tool ab (`RUN_COMPARE_MISMATCH`). |
| `replay_run` | Einen Lauf erneut ausführen, in seinem eigenen Projekt: mit seiner eigenen Eingabe (`kind: "again"`), mit einer bearbeiteten `input` (`"edited"`) oder ab einem Schritt (`"from"` mit `from`) – die Schritte, die er außerhalb dieses Schritts und dessen, was er speist, beendet hat, werden wiederverwendet, der Rest läuft neu. `version` wählt die Version (standardmäßig die des Laufs), `mode` den Modus (der des Laufs; ein Fork eines Mock-Laufs bleibt Mock). `dryRun: true` liefert stattdessen den Plan – was wiederverwendet wird, was erneut läuft und wie viele Schreibvorgänge ein zweites Mal hinausgehen. Ein Live-Lauf braucht die Entwicklerrolle und die bereitgestellte Version; Ablehnungen: `REPLAY_RUN_NOT_FINISHED`, `REPLAY_NODE_UNKNOWN`, `REPLAY_GRAPH_CHANGED` (mit `data.nodes`), `REPLAY_MODE_MISMATCH`, `REPLAY_PROGRESS_UNREADABLE`, `REPLAY_INPUT_UNAVAILABLE`. Nimmt `idempotencyKey` wie `start_run`. |
| `cancel_run` | Einen Lauf beim nächsten Übergang zwischen Knoten stoppen. |
| `answer_run_ask` | Die Frage beantworten, die ein wartender Lauf einer Person gestellt hat (`get_run` liefert sie unter `ask`, mit der `askId`, die du übergibst); der Lauf geht mit der Antwort weiter, die als die des Schlüsselinhabers festgehalten wird. |
| `list_versions`  | Die unveränderliche Versionshistorie einer Automatisierung, neueste zuerst; jede Zeile sagt, ob sie die `deployed` ist, wer sie gespeichert hat (`createdBy`, und `createdByName`, solange die Person Mitglied ist) über welchen Weg (`createdVia`, `clientName`), auf welcher Version sie beruht (`basedOnVersion`) und welche sie wiederherstellt (`restoredFromVersion`), was sie geändert hat (`changes`), wie ihre Tests ausgingen (`tests`) und wann sie zuletzt live ging (`lastDeployedAt`). `limit` fragt eine Seite an, und `nextBefore` (`null` auf der letzten) ist das `before` der nächsten; `deployedVersion` und `latestVersion` nennen die live geschaltete und die neueste Version neben der Liste (`null`, solange es keine gibt). `deployments` listet, wann Versionen live gingen, neueste zuerst, mit der Version, die vorher live war. |
| `set_automation_projects` | Eine Automatisierung in einem Schritt in Projekten installieren (`add`) und aus anderen entfernen (`remove`); die Antwort nennt, was `added`, `removed` und `unchanged` ist. Das Entfernen aus einem Projekt, in dem sie nicht installiert ist, wird abgelehnt (`AUTOMATION_NOT_INSTALLED`). |
| `get_automation_metrics` | Die Laufzahlen der Organisation für 7, 30 oder 90 Tage (`periodDays`), standardmäßig Live-Läufe oder Mock-Läufe: Läufe nach Ergebnis, Erfolgsquote, durchschnittliche Dauer, eine Reihe pro Tag und die meistgenutzten Automatisierungen, jeweils im Vergleich zum Zeitraum davor. |
| `list_triggers` | Triggerbindungen lesen, ohne das Webhook-Geheimnis auszugeben. |
| `delete_trigger` | Einen Trigger entfernen; Versionen und Laufhistorie bleiben erhalten. |
| `set_trigger` | Festlegen, was die Automatisierung startet: einen Zeitplan (eine Wiederholungsregel oder einen Cron-Ausdruck, in einer Zeitzone), einen Webhook oder ein Plattform-Ereignis, jeweils mit optionaler fester Eingabe `input`. Der Aufruf ersetzt den ganzen Trigger; sende also `startDate` und `input` zurück, die `list_triggers` liest, um sie zu behalten. Das `token` eines Webhooks wird einmal beantwortet, hier, und nie wieder — bewahr es auf; `deployed` sagt, ob Zustellungen laufen werden: Ein Trigger an einer Automatisierung ohne deployte Version wird gespeichert und löst nichts aus, bis eine deployt ist. `warnings` sagt, was die deployte Version mit der Eingabe des Triggers anfangen würde. |

| Tool | Geeignet für |
| --- | --- |
| `run_automation` | Ungespeichertes Dokument mit deterministischen Mocks ausprobieren, auf Wunsch mit simulierten Ausgaben für einzelne Schritte; `mode: "live"` wird abgelehnt |
| `run_deployed` | Bereitgestellte Version live ausführen und bis zu 30 Sekunden warten; danach gegebenenfalls die `runId` abfragen |
| `start_run` | Bereitgestellte Version im Hintergrund starten und mit `get_run` verfolgen; mit `idempotencyKey` wird eine Wiederholung sicher |
| `start_run` mit `mode: "mock"` | Eine gespeicherte Version — live geschaltet oder nicht — gegen die Mocks ausführen, mit einem Eintrag, den jede Person in der Laufhistorie öffnen kann |

Um einen fehlgeschlagenen Lauf zu beheben, lies ihn mit `get_run {runId, include: ["record"]}`: Der `failure.reason` des fehlgeschlagenen Schritts nennt, was schiefging, und seine Erklärung zeigt die Werte, die der Ausdruck gelesen hat. `get_run_node` liest diesen Schritt ganz. Korrigiere das Dokument, probiere es mit `run_automation` auf der Eingabe des Laufs aus, und sobald ein neuer Lauf fertig ist, zeigt `compare_runs`, wo er einen anderen Weg nahm.

Beide Tools für bereitgestellte Versionen verwenden denselben dauerhaften Runner mit denselben Berechtigungsprüfungen und Ausführungsdaten. `start_run` akzeptiert optional `projectId`. Eine projektgebundene Automatisierung darf nur in einem ihrer Installationsprojekte laufen; bei genau einer Bindung kann dieses automatisch gewählt werden. Ohne Bindungen bedeutet eine fehlende Angabe Organisationskontext. Lies `projectIds` aus `list_automations` und die tatsächliche `projectId` aus dem zurückgegebenen Handle, statt die REST-URL zum Abfragen zu erraten.

### Nachschlagen {#discovery}

| Tool | Was es tut |
| --- | --- |
| `list_models` | Die Modelle, die du verwenden darfst, gefiltert nach deinem Modellzugriff: jeweils mit `providerSlug` (eine `agent`-Node speichert ihn als `modelProvider`), `lane` (`direct`, wenn ein Anbieter es bereitstellt, `subscription` oder `broker`, wenn das Abo eines Mitglieds es bereitstellt), den passenden `nodeTypes` (eine `llm`-Node nimmt nur ein direkt bereitgestelltes Modell) und den Agent-Laufzeiten, denen es angeboten wird (`harnesses`). `nodeType` und `harness` filtern die Liste. |
| `list_harnesses` | Die Agent-Laufzeiten, die eine `agent`-Node als `harness` nennen kann, die Standard-Laufzeit (`default`), die läuft, wenn sie keine nennt, und ob ein Abo sie jeweils bedienen kann. |
| `list_skills` | Die Skills der Organisation; mit `projectId` auch die Team-Skills dieses Projekts, also die, die ein Lauf darin verwenden kann. Ein Projekt, das du nicht lesen darfst, antwortet `PROJECT_NOT_FOUND`. |
| `list_connectors` | Die Connectors, die dieses Deployment anbietet, ob deine Organisation sie jeweils verbunden hat (`connected`) und wie viele Aktionen sie haben; `query` filtert. Ein Connector, dessen Zugangsdaten auch Git-Remotes öffnen, nennt den Host als `gitHost`: `github.com` oder `endpoint` für den Host der Instanzadresse der jeweiligen Zugangsdaten. `search_catalog` listet die Aktionen. |
| `list_agent_secrets` | Die Namen der Agent-Secrets der Organisation mit einer maskierten Vorschau (`preview`), nie ein Wert. Inhaber, Admins und Entwickler sehen sie; alle anderen bekommen eine leere Liste mit einem Hinweis (`note`). |
| `list_projects` | Die Projekte, die du lesen darfst: ob sie jeweils bearbeitbar (`writable`) oder archiviert (`archived`) sind und welche der darin installierten Automatisierungen du sehen darfst (`automations`). `query` filtert nach Name; `includeArchived` nimmt archivierte Projekte dazu. |
| `list_events` | Die Ereignisse, die Tale auslöst, jeweils mit dem Zeitpunkt, zu dem es eintritt: worauf ein Event-Trigger warten kann. |

Jede Antwort trägt einen `hint`, der das Tool oder die Einstellung nennt, mit der sie sich ändert.

### Einstellungen {#settings}

| Tool | Was es tut |
| --- | --- |
| `get_settings` | Ohne `kinds` der Katalog: jede Art von Einstellung mit dem, was sie ist, ihren Operationen (`ops`) und Aktionen (`acts`), ihrem `baseRisk`, den Einstellungsseiten, auf denen eine Person dieselbe Änderung vornimmt (`areas`), ob dieses Deployment sie über MCP bedient (`available`) und ob deine Rolle sie lesen (`read`) und ändern (`write`) darf. Mit `kinds` — für eine einzelne Art auch mit `ids` oder dem `cursor` ihrer nächsten Seite — jede Ressource, die du lesen darfst, mit ihrem `key`, ihrer `config` und ihrem `hash`. Eine Art, die du nicht lesen darfst, steht mit dem Grund unter `refused`. Hat eine Auflistung weitere Seiten, antwortet sie mit dem Cursor jeder solchen Art unter `cursors` (nach dem Lesen einer einzelnen Art auch als `nextCursor`): Gib ihn mit genau dieser Art zurück, nur diese Art liest ihn. Eine Seite endet, sobald das, was sie enthält, die Antwort zu groß machen würde; eine Art mit langen Anweisungen braucht deshalb mehr Seiten. |
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

## Was ein Schlüssel oder ein verbundener Agent darf {#what-it-may-do}

| Vorgang | Erforderlicher Zugriff |
| --- | --- |
| Lesen, Validierung, Mock-Ausführungen (auch `start_run` mit `mode: "mock"`) und Akzeptanztests, Capability-Suche, Wissensabruf | Mitgliedschaft plus normale Zugriffsregeln der Ressource |
| Die Frage eines Laufs beantworten | Mitgliedschaft; bei einem Lauf in einem Projekt Bearbeitungszugriff auf dieses Projekt |
| Namen der Agent-Secrets (`list_agent_secrets`) | Rolle Inhaber, Admin oder Entwickler; alle anderen bekommen eine leere Liste |
| Einstellungen lesen, planen und ändern (`get_settings`, `plan_settings`, `apply_settings`) | Was deine Rolle auf derselben Einstellungsseite darf; der Katalog sagt, was deine Rolle mit jeder Art tun darf |
| Speichern, live schalten, löschen, in Projekten installieren, Trigger setzen/löschen, Lauf abbrechen oder live ausführen | Entwicklerberechtigung plus normale Zugriffsregeln der Ressource |

Ein Schlüssel identifiziert seinen Inhaber und ein verbundener Agent die Person, die ihn angemeldet hat; keiner von beiden erweitert deren Rolle oder Projektzugriff, und ein Agent bleibt zusätzlich innerhalb des Zugriffs, den sie erlaubt hat ([Zugriffsstufen](#access-levels)). Eine Automatisierung, die nur in Projekten installiert ist, die der Schlüsselinhaber nicht lesen darf, fehlt in `list_automations`, und jeder Lesezugriff auf sie antwortet `AUTOMATION_NOT_FOUND` wie bei einer, die es nicht gibt. Auch eine Live-Ausführung über `invoke_capability` durchläuft die Ausführungsprüfungen.

Jede Änderung, die ein MCP-Aufruf an einer Automatisierung vornimmt — eine gespeicherte Version, ein Live-Schalten, ein Löschen, ein gesetzter oder entfernter Trigger, eine hinzugefügte oder entfernte Installation —, steht im Audit-Log der Organisation, gekennzeichnet als über MCP gekommen, mit dem Tool und dem API-Schlüssel oder der Verbindung des Agents. In den Details des Ereignisses zeigt **Quelle** Coding-Agent, und **Client** nennt die App des Agents, wenn sie sich bei jedem Aufruf nennt, wie mit der Revision 2026-07-28; eine App mit einer 2025er-Revision nennt sich nur bei `initialize`, deshalb zeigen ihre Ereignisse keinen **Client** ([Audit-Logs](/de/platform/admin/governance/audit-logs)).

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
| HTTP `401` mit einer `WWW-Authenticate: Bearer`-Challenge | Keine Zugangsdaten oder solche, die der Endpunkt ablehnt. `error="invalid_token"` sagt, dass Zugangsdaten vorgelegt wurden: Ein abgelaufenes Zugriffstoken wird mit dem Refresh-Token erneuert, und bei einer getrennten Verbindung oder einer Person, die die Organisation verlassen hat, muss der Agent neu angemeldet werden. Ohne `error` die Anmeldung starten, auf die die Challenge verweist |
| HTTP `403` `INSUFFICIENT_SCOPE` | Der Verbindung fehlt Zugriff, den ein Aufruf der Anfrage braucht und den die Person erlauben könnte; nichts aus der Anfrage ist gelaufen. `data.requiredScopes` nennt, was anzufragen ist, `data.grantedScopes`, was sie hat ([Zugriffsstufen](#access-levels)) |
| HTTP `403` `ORG_MISMATCH` | Der Aufruf nennt eine andere Organisation als die, für die die Verbindung angelegt wurde; `data.organization` nennt diese ([Eine Organisation](#one-organization)) |
| Tool-Ergebnis `INSUFFICIENT_SCOPE` | Der Aufruf braucht Zugriff, den die Rolle der Person nie erlauben kann; sag es der Person, denn erneutes Verbinden würde nichts ändern |

Zu den Tool-Codes gehören `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `AUTOMATION_VERSION_STALE`, `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_NAME_TAKEN`, `AUTOMATION_HAS_ACTIVE_RUNS`, `AUTOMATION_NOT_INSTALLED`, `HUMAN_ASK_NOT_FOUND`, `HUMAN_ASK_NOT_PENDING`, `HUMAN_ASK_EXPIRED`, `EMPTY_ANSWER`, `INVALID_CURSOR`, `BENCH_INVALID`, `LIVE_MODE_UNAVAILABLE` und `NOT_SUPPORTED`. Letzterer bedeutet, dass der Host den Vorgang für Läufe, Versionen oder Trigger nicht unterstützt. `start_run` lehnt einen wiederverwendeten `idempotencyKey` mit anderen Argumenten als `IDEMPOTENCY_KEY_REUSED` ab; `invoke_capability` lehnt eine ID, die das Register nicht führt — eine nur gespeicherte Automatisierung steht nicht darin —, als `CAPABILITY_NOT_FOUND` ab und Eingaben, die ihr Schema zurückweist, als `CAPABILITY_INPUT_INVALID`; `get_knowledge` reicht die eigenen Codes der Wissens-Tür durch (`KNOWLEDGE_UNAVAILABLE`, wenn die Suche selbst fehlgeschlagen ist). Plattformfehler behalten ihren eigenen Code, Hinweis und gegebenenfalls Daten; fehlender Entwicklerzugriff liefert etwa `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` führt jedes Argumentproblem auf; ein Wert außerhalb einer aufgezählten Menge wird abgelehnt, und die Meldung nennt die Menge. `RATE_LIMITED` bedeutet, dass das Tool eine Ausführung oder eine Einstellungsänderung gebraucht hätte und das [Budget](/de/develop/rate-limits) des Schlüsselinhabers dafür aufgebraucht ist: Warte `data.retryAfterMs` ab. `run_automation` und `test_automation` werden genauso abgelehnt, wenn das Budget der Organisation für nie gespeicherte Läufe aufgebraucht ist. `INTERNAL_ERROR` bedeutet, dass der Aufruf unerwartet fehlgeschlagen ist; nenne dem Betreiber des Deployments die `data.requestId`. `DATABASE_UNAVAILABLE` bedeutet, dass die Datenbank der Plattform gerade neu startet oder nicht erreichbar ist: warte `data.retryAfterMs` (fünf Sekunden, wie das `Retry-After` der REST-API) und rufe dann erneut auf; `apply_settings` nennt dabei, was bereits übernommen wurde. Ein Lesezugriff auf eine Ressource oder ein Prompt antwortet in diesem Fall mit JSON-RPC `-32603`, mit `data.code` und `data.retryAfterMs`. `KNOWLEDGE_DATABASE_UNAVAILABLE` bedeutet, dass eine Wissensdatenbank, die der Aufruf brauchte — die des Deployments oder die eigene der Organisation —, gerade neu startet oder nicht erreichbar ist, etwa bei `get_knowledge`: Warte ebenfalls `data.retryAfterMs` und rufe dann erneut auf. Die Datenbank der Plattform meint dieser Code nie. Die Einstellungs-Tools ergänzen `SETTINGS_STALE` (eine Ressource hat sich seit dem Lesen geändert; `data.currentHash` ist ihr aktueller Hash), `SECRET_ARGUMENT_REFUSED` (eine Änderung enthielt ein Secret; `data.places` sagt, wo, nie, was), `SETTINGS_KIND_UNAVAILABLE` (dieses Deployment bedient diese Art nicht über MCP), `SETTINGS_NOT_FOUND` (eine Aktion auf einer Ressource, die es nicht gibt) und `SETTINGS_DUPLICATE` (eine Ressource wurde in einem Aufruf zweimal geändert).

Ein unbekannter Automatisierungsname ist auch bei `list_versions`, `list_runs` und `list_triggers` ein Fehler. Eine leere Liste bedeutet, dass eine vorhandene Automatisierung keine passenden Einträge hat. Die eine Ausnahme ist die Laufhistorie: Eine gelöschte Automatisierung behält ihre Läufe, `list_runs {name}` antwortet sie also, solange es sie gibt, und nur ein Name, der nie gelaufen ist, ergibt `AUTOMATION_NOT_FOUND`. `get_catalog`, auf eine Kern-Knotenart eingegrenzt (`transform`, `llm`, `agent`, `subautomation`), antwortet mit einer leeren Liste und einem `hint` auf `get_docs`, wie `search_catalog` auch, und liefert unter `reference` den Abschnitt der Referenz zu dieser Knotenart. Ungültige Dokumente für Tools, die ein gültiges Dokument benötigen, fehlgeschlagene Suchen und fehlende Bereitstellungen setzen `isError: true`. Nur das Validierungstool meldet ein ungültiges Dokument als normales Prüfergebnis.

## Wo das hingehört

REST und MCP teilen Schlüssel, Organisationskontext und dauerhafte Ausführungsobjekte. Verwende REST für ausdrückliche HTTP-Routen und MCP für Clients mit Tool-Erkennung und Tool-Aufrufen. Über diesen Endpunkt registriert oder ruft Tale keine externen MCP-Server auf. Die Anmeldung eines Agents gilt nur für den MCP-Endpunkt: Jede andere Route nimmt API-Schlüssel an, und ein Token dieser Form wird dort als API-Schlüssel behandelt und abgelehnt.
