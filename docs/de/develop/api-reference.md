---
title: API-Referenz
description: Wie du Tale von außen aufrufst — Authentifizierung, das Endpoint-Inventar, Pagination, die asynchronen Lauf- und Turn-Schleifen und das Fehlermodell.
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

Eine erfolgreiche Antwort ist eine benannte Liste: `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. Die Listenform hängt von der Familie ab: die meisten antworten mit einem benannten Array wie diesem, während die Wissens- und Chat-Ressourcen — Kontakte, Produkte, Dokumente, Wissenseinträge, Threads, Websites — mit einem `{ "page": [...], "isDone": ..., "continueCursor": ... }`-Umschlag antworten. Wo ein Umschlag paginiert, gib `continueCursor` als `?cursor=` zurück und begrenze die Seite mit `?limit=`: Kontakte, Produkte, Dokumente, Wissenseinträge, Threads und Websites paginieren alle so bis zur letzten Seite (`isDone: true` mit leerem `continueCursor`). Die Run-Liste einer Automation ist stattdessen ein begrenztes Fenster — `?limit=` (1..200, Standard 50) bestimmt, wie viele der neuesten Runs du bekommst. Der Maschinenzugang unter Projekte reist noch leichter — sein Abschnitt zeigt jene Formen.

## Authentifizierung

API-Schlüssel erzeugt jeder mit Admin- oder Entwickler-Berechtigungen im Produkt — [API-Schlüssel](/de/platform/admin/api-keys) beschreibt das Panel. Ein Schlüssel wird bei der Erstellung genau einmal gezeigt und nie wieder; er gehört dem Benutzer, der ihn erzeugt hat — jeder Aufruf handelt als dieser Benutzer.

Sende den Schlüssel als Bearer-Token: `Authorization: Bearer <key>`. Jeder Aufruf handelt als sein Besitzer in einer Organisation, der dieser angehört. Die Kopfzeile `X-Organization-Slug` wählt die Organisation; Tale prüft die Mitgliedschaft auch bei einer expliziten Auswahl. Bei einer einzigen Mitgliedschaft kannst du sie weglassen. Bei mehreren ist sie für jedes Schreiben und jeden Aufruf unter `/api/v1/projects/...` Pflicht, auch beim Lesen; fehlt sie, lautet die Antwort **400**. Andere Lesezugriffe können die zuletzt im Dashboard aktive Organisation verwenden. Die nötigen Rechte hängen von Projekt und Aktion ab: Projektleser dürfen chatten und kommentieren, Änderungen an Projektressourcen und Aufgabenstarts verlangen Bearbeitungsrechte. Frei gestartete Live-Läufe brauchen zusätzlich die Entwickler-Fähigkeit. Die Abschnitte unten nennen die Regeln je Aktion.

## Mit Tale bei einer Anwendung anmelden

Tale ist auch ein OpenID-Connect-Aussteller. Eine registrierte Anwendung führt dich durch die native Anmeldung und Einwilligung in Tale. Sie erhält eine signierte Identität mit bestätigter E-Mail-Adresse und der Mitgliedschaft in genau der Organisation, an die ihr Client gebunden ist. Ein API-Schlüssel ersetzt in diesem Ablauf keine persönliche Anmeldung.

Registriere die Anwendung mit einer aktiven Owner- oder Admin-Sitzung, deren ausgewählte Organisation `TALE_ORG_ID` entspricht. `TALE_ORIGIN` ist der Ursprung deiner Tale-Instanz, `TALE_SESSION_COOKIE` der Cookie-Header dieser Sitzung. Verwende die genaue HTTPS-Callback-URL der Anwendung; HTTP ist nur auf Loopback für die lokale Entwicklung erlaubt:

```bash
curl -sS -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

Die erste Antwort lautet **201** mit `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Speichere das Geheimnis in der geheimen Umgebungskonfiguration der Anwendung. Derselbe Schlüssel mit unveränderter Konfiguration liefert bei Wiederholung **200**, `created: false` und dieselbe Client-ID ohne Geheimnis. Eine geänderte Callback-URL oder Richtlinie führt zu **409**. Ein erneuter Lauf kann eine bestehende Integration so nicht unbemerkt umleiten.

| Zweck | Endpoint oder Anforderung |
| --- | --- |
| Aussteller | `https://your-host.example.com/api/auth` |
| Discovery | `GET /api/auth/.well-known/openid-configuration` |
| Autorisierung | `GET /api/auth/oauth2/authorize` |
| Code-Austausch | `POST /api/auth/oauth2/token`, `client_secret_post` |
| Signaturschlüssel | `GET /api/auth/jwks` |
| Aktuelle Identität | `GET /api/auth/oauth2/userinfo`, Bearer-Zugriffstoken |
| Angeforderte Scopes | `openid profile email tale:organization` |

Verwende einen gepflegten OIDC-Client mit Authorization Code Flow, S256 PKCE, einmaligem State und Nonce. Prüfe Aussteller, Zielgruppe, RS256-Signatur, Ablaufzeit und Nonce des ID-Tokens und verlange `email_verified: true`. Der Claim `https://tale.dev/organization` enthält `{ "id", "slug", "role" }` für die registrierte Organisation. Tale prüft vor der Token-Ausgabe und beim Abruf von Userinfo die aktuelle Mitgliedschaft und die native MFA-Pflicht erneut. Die Anwendung bleibt für ihre eigene Zugangsrichtlinie verantwortlich. Codes laufen nach 60 Sekunden ab und lassen sich einmal einlösen; Zugriffs- und ID-Tokens laufen nach fünf Minuten ab. Dynamische Registrierung, Implicit Grants und Refresh Tokens sind deaktiviert.

Zugriffstokens gelten nur für die native Userinfo-Schnittstelle; externe Ressourcenzielgruppen sind deaktiviert. Verwende für REST-Anfragen native API-Schlüssel.

Für einen geprüften Client-Schlüssel liefert `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` mit `{}` einmalig ein neues `client_secret` und macht das alte ungültig. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` mit `{ "disabled": true }` sperrt neue Autorisierungen; `false` aktiviert denselben Client wieder. Beide Aufrufe benötigen wie die Registrierung dieselbe aktuelle Organisation, eine Admin-Sitzung, den Origin-Header und JSON als Inhaltstyp. Beim Löschen einer Organisation werden ihre Clients und Einwilligungen entfernt.

## Endpoint-Gruppen

Bei Projektressourcen unter `/api/v1` steht die Projekt-ID in der URL. Ein `projectId` im Anfrageinhalt ergibt hier **400**, weil die Schemas unbekannte Felder ablehnen. Die Ressource muss zum benannten Projekt gehören und für den Schlüsselbesitzer sichtbar sein; andernfalls antwortet Tale mit **404**. Antworten dürfen `projectId` als Metadatum enthalten. Organisationskataloge wie Automatisierungsdefinitionen und Skill-Bundles behalten ihre Organisationspfade.

| Gruppe            | Pfad                                    | Was sie abdeckt                                                                                                                      |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Automatisierungen | `/api/v1/automations/...` | Definitionen, Versionen und Trigger der Organisation; Läufe ohne Projekt starten und auflisten. |
| Projekt-Automatisierungen | `/api/v1/projects/{id}/automations/...` | Installierte Automatisierungen auflisten, eine installieren und Läufe dieses Projekts starten oder lesen. |
| Läufe | `/api/v1/projects/{id}/runs/{runId}` oder `/api/v1/runs/{runId}` | Status, Ausgabe, Trace, Effekte und `POST .../cancel`; Projektläufe verwenden den Projektpfad. |
| Threads | `/api/v1/projects/{id}/threads/...` oder `/api/v1/threads/...` | Eigene Chats innerhalb eines Projekts oder ohne Projekt: auflisten, anlegen, lesen, Nachrichten senden und den Status abfragen. |
| Modelle | `GET /api/v1/models` | Konfigurierte Chat-Modelle, die dem Schlüsselbesitzer in dieser Organisation zur Verfügung stehen. |
| Agenten | `/api/v1/projects/{id}/agents/...` | Agenten im angegebenen Projekt auflisten, lesen, anlegen, ändern und löschen. |
| Skills | `/api/v1/skills/...` | Skill-Bundles der Organisation auflisten, lesen, anlegen oder ändern und löschen. |
| Wissenseinträge   | `/api/v1/knowledge-entries/...`         | Themen-Fakten: auflisten, anlegen, ablösen, löschen.                                                                                 |
| Wissenssuche | `POST /api/v1/projects/{id}/knowledge/search` oder `POST /api/v1/knowledge/search` | Indexierte Dateien eines Projekts oder sichtbare Dokumente der Wissensdatenbank ohne Projektzuordnung und Websites durchsuchen. |
| Dokumente         | `/api/v1/documents/...`                 | Dokumente der Wissensdatenbank: CRUD plus `POST .../retry-indexing`. Projektdateien tauchen hier nie auf — sie leben unter Projekte. |
| Websites          | `/api/v1/websites/...`                  | Gecrawlte Quellen: CRUD plus `.../pages`, `.../sync`, `.../search`.                                                                  |
| Browser-Sessions  | `/api/v1/browser-sessions/...`          | Der vorgewärmte Cookie-Pool hinter der [Video-Ingestion](/de/self-hosted/configuration/video-ingestion): maskierte Liste, `POST .../import` für Operatoren auf der Allowlist. |
| Produkte          | `/api/v1/products/...`                  | Produktkatalog-Einträge: CRUD.                                                                                                       |
| Kontakte          | `/api/v1/contacts/...`                  | Kontaktdaten: CRUD plus `POST /api/v1/contacts/bulk`.                                                                                |
| Gespräche | `/api/v1/conversations/...` | Externe Gespräche in den Posteingang spiegeln, Nachrichten lesen, Antworten abrufen und die Zustellung bestätigen; genaue Schemas stehen unter `/docs` der laufenden Instanz. |
| Projekte          | `/api/v1/projects/...`                  | Der Maschinenzugang für externe Worker: per externer ID nachschlagen, anlegen, Ordner vorbereiten, Dateien hochladen.                |
| Aufgaben | `/api/v1/projects/{id}/tasks/...` | Aufgaben aus externen Referenzen idempotent anlegen, Status lesen, Workflows starten und kommentieren, jeweils im benannten Projekt. |
| MCP               | `POST /api/v1/mcp`                      | Der [MCP-Endpoint](/de/develop/mcp-endpoint) — derselbe Schlüssel, JSON-RPC statt REST.                                              |
| Webhook-Trigger | `POST /api/projects/{id}/automations/webhook/{token}` oder `POST /api/automations/webhook/{token}` | Eine bereitgestellte Automatisierung per Token starten; [Webhooks](/de/develop/webhooks) erklärt URLs mit und ohne Projekt. |

Übergib bei Kontaktänderungen den zuletzt gelesenen Wert `updatedAt` als optionales `expectedUpdatedAt` an `PATCH /api/v1/contacts/{id}`. Eine zwischenzeitliche Änderung liefert **409**, `CONTACT_STALE`; lade den Kontakt erneut und führe deine Änderungen vor dem nächsten Versuch zusammen.

Skills unterstützen die Sichtbarkeit `org` und `team`; `teams` muss Teams dieser Organisation benennen. Die Sichtbarkeit `private` gibt es für Skills nicht mehr.

Sende für ein Dokument der Wissensdatenbank den Inhalt als `content` an `POST /api/v1/documents`. Inline-Inhalt bleibt gespeichert und lesbar, landet aber nie im Suchindex: Die Wissenssuche findet nur Dokumente, hinter denen eine hochgeladene Datei steht, und `POST .../retry-indexing` antwortet für ein Dokument ohne Datei mit `{"status": "skipped", "reason": "content-only"}` (die anderen Gründe sind `untracked-blob` und `rag-opt-out`). Die Alternative `fileId` verlangt einen noch ungebundenen Upload für die Wissensdatenbank, den der Schlüsselbesitzer selbst in der ausgewählten Organisation über die App angelegt hat. REST erstellt keinen solchen Upload. Bereits an ein Dokument, einen Thread oder ein Gespräch gebundene Uploads lassen sich hier nicht erneut verwenden. Fehlende Uploads, Uploads anderer Benutzer und gebundene Uploads ergeben **404**, `FILE_NOT_FOUND`. Projekt-, Chat- und Gesprächsuploads können über diese Route nicht zu Dokumenten der Wissensdatenbank werden. Gelöschte oder abgelaufene Dokumente, auch Dateien eines gelöschten Projekts, erscheinen hier nicht. Die Inhalte von `POST` und `PATCH` sind strikt: Ein `projectId` ergibt **400**. Projektdateien legst du über die Upload- und Dateirouten des Projekts an.

## Agenten eines Projekts verwalten

Jeder Agent gehört zu einem Projekt. Die Projekt-ID steht bei jeder Operation verpflichtend in der URL; die Antwort enthält `projectId` und die `id` des Agenten. API und Projekt-Tab **Agenten** verwalten dieselben Datensätze mit denselben Zugriffsrechten.

| Operation | Route | Erfolg |
| --- | --- | --- |
| Agenten auflisten | `GET /api/v1/projects/{id}/agents` | `200 {agents}` |
| Anlegen | `POST /api/v1/projects/{id}/agents` | `201 {agent}` |
| Lesen | `GET /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Gesamte Konfiguration speichern | `PUT /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Löschen | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204` |

Wähle ein vorhandenes Projekt und ein Modell, das der gewählte Harness bedienen kann. Das Beispiel legt einen Claude-Code-Agenten an und liest seine Konfiguration zurück; eine Aufgabe startet es nicht.

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

`POST` und `PUT` verlangen `name`, `harness`, `model`, `skills` und `connectors`. Optional sind `modelProvider`, `tools`, `secrets` und `instructions`. Ein `PUT` speichert die gesamte Konfiguration: Ausgelassene Anbieter- und Anweisungsfelder werden `null`, ausgelassene Tool- und Secret-Listen werden leer. Die Agenten-ID muss bereits existieren; ein `PUT` legt keinen neuen Agenten an.

Ein Projekt fasst höchstens 50 Agenten. Namen müssen innerhalb des Projekts unabhängig von Groß- und Kleinschreibung eindeutig sein und dürfen bis zu 120 Zeichen lang sein; jede Ausstattungsliste erlaubt 25 Einträge, Anweisungen 20.000 Zeichen. Ungültige Konfiguration, ein belegter Name oder eine überschrittene Grenze ergibt **400**. `secrets` enthält Namen von Organisationsgeheimnissen, niemals deren Werte; unbekannte Namen entfallen. Nur Inhaber und Admins der Organisation dürfen die Freigaben ändern. Ein Redakteur muss vorhandene Freigaben beim Speichern beibehalten.

Projektleser dürfen die Agenten lesen; Änderungen verlangen Bearbeitungsrechte und ein aktives Projekt. Ein unsichtbares oder fehlendes Projekt sowie eine Agenten-ID aus einem anderen Projekt ergibt **404**. Bei Mitgliedschaft in mehreren Organisationen muss jede Lese- und Schreibanfrage `X-Organization-Slug` enthalten. [Projekt-Agenten](/de/platform/projects/project-agents) erklärt die Arbeit an Aufgaben; der direkte Chat verwendet weiterhin den eingebauten Assistenten.

## Automatisierungsnamen in URLs

Der Name einer Automatisierung ist ein `/`-Pfad — `billing/dunning` — und ein Pfad passt nicht in ein einzelnes URL-Segment. Schreib den Namen in jeder `.../automations/{name}/...`-URL mit `__` an Stelle jedes `/`:

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Antworten tragen immer den echten Namen (`"name": "billing/dunning"`); die `__`-Form existiert nur in URLs. Skill-Slugs sind flach und brauchen keine Kodierung. Projekt-Agenten verwenden die Projekt-ID und die Agenten-ID.

## Einen Lauf starten, dann pollen

Ein Lauf ist durabel und darf Minuten dauern — der Start antwortet deshalb mit **202** und der Identität des Laufs, nicht mit seinem Ergebnis:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Polle `GET /api/v1/projects/{id}/runs/{runId}`, bis `status` `queued`/`running`/`waiting` verlässt; der fertige Lauf trägt `output`, den `trace` pro Knoten und die `effects`, die er erzeugt hat. `POST /api/v1/projects/{id}/runs/{runId}/cancel` stoppt einen Lauf an seiner nächsten Knotengrenze — was ein Knoten schon getan hat, wird nicht rückgängig gemacht.

`mode` ist standardmäßig `live`. Frei gestartete Live-Läufe und das Abbrechen von Läufen verlangen die Entwickler-Fähigkeit. Für Projektläufe brauchst du außerdem Bearbeitungsrechte auf ein aktives Projekt, auch mit `mode: "mock"`. Mock-Läufe verwenden deterministische Mocks; ohne Projekt genügt dafür eine Mitgliedschaft. Ein Trigger ist für den Start nicht nötig. Ohne bereitgestellte Version antwortet Tale mit **409**, sofern du nicht ausdrücklich eine gespeicherte Version für einen Mock-Lauf auswählst.

Eine unbekannte Automatisierung antwortet mit **404**. Ein Live-Lauf darf nur die deployte `version` verwenden; eine andere gespeicherte Version ergibt **409**. Teste diese mit `mode: "mock"`. Ohne Body gilt `{}`; fehlerhaftes JSON ergibt **400** und startet nichts. Definiert die Automatisierung ein `inputs`-Schema, muss die Eingabe dazu passen, bevor ein Lauf entsteht.

Das Projekt in der URL bestimmt den Kontext der Aufgaben- und Dokumentwerkzeuge des Laufs. Hat die Automatisierung Projektbindungen, darf sie nur in einem dieser Projekte laufen. `GET /api/v1/projects/{id}/automations/{name}/runs` liest die Historie dieses Projekts. Eine Automatisierung ohne Bindungen kannst du mit `POST /api/v1/automations/{name}/runs` ohne Projekt starten; eine gebundene Automatisierung ergibt dort **409**. Globale Lauflisten und `/api/v1/runs/{runId}` zeigen ausschließlich Läufe ohne Projekt. Zum Lesen und Abbrechen eines Projektlaufs brauchst du dessen Projekt-URL.

## Eine Nachricht senden, dann den Turn pollen

Projektchats folgen ebenfalls dem Ablauf 202, dann Statusabfrage. Wähle ein Projekt, das du lesen darfst, lege einen Thread an, sende eine Nachricht, frage den Status ab und lies die Antwort:

Rufe vor dem Senden die Modelle ab. Übernimm `id` als `model` und `providerSlug` für die Auswahl des Anbieters. Die Liste berücksichtigt die Modellzugriffsregeln der Organisation und enthält nur Modelle, die REST direkt aufrufen kann. Ist sie leer, steht dem Schlüsselbesitzer kein Chat-Modell zur Verfügung. Das Paar wird beim Senden geprüft: Ein `providerSlug`, den die Liste nicht kennt, ergibt **400**, `CHAT_PROVIDER_UNKNOWN`; einer, der das gewählte `model` nicht bedient, **400**, `CHAT_MODEL_NOT_ON_PROVIDER` — der Turn weicht nie stillschweigend auf einen anderen Anbieter aus.

```bash
curl -sS "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# Kein Modell verfügbar → 200 { "models": [] }
```

```bash
# 1. Ein eigener Thread
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Nachricht senden — auf dieser API ist das Modell immer explizit, nie automatisch gewählt
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Fasse mir dieses Quartal zusammen.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Bis idle pollen, dann lesen
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "streaming" } … dann { "status": "idle" }
```

`{"status": "idle"}` bedeutet, dass gerade kein Turn läuft. Lies die Antwort mit `GET /api/v1/projects/{id}/threads/{threadId}/messages`. Listen, Threaddetails, Nachrichten und Statusabfragen zeigen nur die eigenen Threads des Schlüsselbesitzers in diesem Projekt. Die Threads anderer Benutzer bleiben unsichtbar, auch im gemeinsamen Projekt. `GET /api/v1/projects/{id}/threads` listet deine Threads; `GET /api/v1/projects/{id}/threads/{threadId}` liest einen davon.

Für persönliche Chats ohne Projekt verwendest du `/api/v1/threads` sowie die zugehörigen Detail-, Nachrichten- und Statuspfade. Projektthreads sind dort nicht erreichbar. Ein falsches Projekt in der URL ergibt **404**. Beide Chatarten verwenden den eingebauten Assistenten; `projectId`, `agentSlug` oder `agentId` beim Anlegen oder Senden ergibt **400**. Projektleser einschließlich Mitgliedern dürfen Threads anlegen und Nachrichten senden. Ein archiviertes Projekt verweigert diese Aufrufe mit **403**, ein archivierter Thread das Senden mit **409**.

Ein Modellfehler kann als Assistenten-Nachricht mit lesbarem `error` und, wenn verfügbar, `errorCode` erscheinen. Die Modellliste ist der konfigurierte Katalog der Organisation, kein Versprechen des Anbieterkontos — zwei Codes meinen deshalb das Konto, nicht die Anfrage: `credit_exhausted` (Guthaben aufgebraucht) und `model_not_entitled` (der Tarif des Anbieters enthält dieses Modell nicht). Wähl ein anderes Modell oder bring das Konto in Ordnung — Warten ändert nichts, und keiner von beiden ist ein `rate_limited`. Vor dem Öffnen des Turns prüft der Worker den angenommenen Thread und den Projektzugriff erneut. Wechselt der Thread während der Wartezeit das Projekt oder entfällt der Zugriff, führt er den Turn nicht aus und schreibt auch keine Fehlermeldung in den neuen Kontext.

## Die Dateien eines Projekts durchsuchen

Verwende die Projekt-URL, wenn alle Treffer aus einem Projekt stammen sollen. Die Suche erfasst ausschließlich dessen indexierte Dateien und verlangt Leserechte, auch bei einem archivierten Projekt. Dokumente der Wissensdatenbank oder von Teams, andere Projekte, Websites und E-Mail-Anhänge bleiben außen vor. Lass `corpus` weg oder setze es auf `"documents"`. Ein anderer Korpus oder `projectId` im Anfrageinhalt ergibt **400**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Frist für die Q1-Meldung", "limit": 10 }'
```

Pflicht ist `query`; optional sind `limit` (1–50) und `minSimilarity` (0–1). Ohne Embedding-Modell lautet die Antwort **409**, `EMBEDDING_NOT_CONFIGURED`. Dieselbe **409** kommt als `EMBEDDING_CREDIT_EXHAUSTED`, wenn der Embedding-Anbieter aus Kontogründen ablehnt — Guthaben aufgebraucht, Ausgabenlimit erreicht oder ein Tarif, der das Modell nicht enthält. Lehnt der Anbieter den Schlüssel ab oder verweigert ihm das Modell, lautet sie **409**, `EMBEDDING_CREDENTIAL_REJECTED` — dann sind die Anbieter-Einstellungen zu korrigieren. Beides ist kein Rate-Limit: Warten hilft nicht, ein Admin muss handeln. Jeder andere Fehler beim Anbieter ergibt **503**, `EMBEDDING_UPSTREAM_ERROR` mit `Retry-After` — den wiederholst du mit Backoff. Für sichtbare Dokumente der Wissensdatenbank und von Teams ohne Projektzuordnung sowie registrierte Websites verwendest du `POST /api/v1/knowledge/search`. Dort akzeptiert `corpus` die Werte `"documents"`, `"web"` und `"all"` als Standard. Projektdateien und E-Mail-Anhänge sind von dieser Suche ausgeschlossen. Beide Suchen finden nur Dokumente mit einer Datei dahinter — Inline-`content` landet nie im Index.

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

Ein expliziter Projekt-`key` besteht aus 2–6 Buchstaben oder Ziffern und landet in Großbuchstaben. Ungültige Werte ergeben **400**, ohne Kürzung. Lässt sich aus dem Namen kein gültiger Key ableiten, entsteht das Projekt ohne Key. Bei einem belegten Key folgt **409**; sende einen freien Key mit.

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
# → 200 { "uploadId": "...", "url": "https://...", "method": "PUT", "s3Ref": "...", "expiresAt": 1774... }
```

Jeder Blob liegt im Objektspeicher, daher ist `url` immer ein vorsignierter `PUT`: sende die Bytes mit dieser Methode dorthin, mit einem `Content-Type`-Header, der exakt dem beim Minten deklarierten `contentType` entspricht — der deklarierte Typ ist in die URL signiert, ein abweichender Header wird vom Bucket abgelehnt (ohne `contentType` beim Minten stellt der PUT keine Header-Anforderung) — und binde dann die `s3Ref` aus dem Handoff als `fileId`. Das Binden schließt den Upload ab:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

Die `uploadId` ist einmalig verwendbar und läuft nach 30 Minuten ab — ein Worker, der mitten im Upload abgestürzt ist, holt einen frischen Handoff, statt den alten zu wiederholen. Beim Binden gilt die Upload-Policy: ein zu großer Blob oder ein Typ außerhalb der erlaubten Liste wird mit **400** und einem Reason-Code abgewiesen.

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

Die Aufgabenrouten machen aus einem externen Datensatz eine Aufgabe auf dem Projektboard, starten einen bereitgestellten Workflow und liefern die Ergebnisse zurück. Eine projektgebundene Automatisierung muss zuvor in diesem Projekt installiert sein. Das Installieren ist idempotent: **201** beim ersten Aufruf, **200** bei vorhandener Bindung. Es verlangt die Entwickler-Fähigkeit und Bearbeitungsrechte auf ein aktives Projekt. Fehlen dem Worker diese Rechte, richte die Bindung vorher ein:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` listet die in diesem Projekt installierten Automatisierungen. Eine Automatisierung ganz ohne Projektbindungen darf ebenfalls in einem zugänglichen Projekt laufen, wenn der Aufrufer die nötigen Bearbeitungsrechte hat; in der Liste der installierten Automatisierungen erscheint sie jedoch nicht. Bindungen entfernst du weiterhin im Dashboard.

Das Anlegen einer Aufgabe ist pro `(projectId, externalSystem, externalId)` idempotent: Der erste Aufruf legt sie an (**201**, `created: true`), ein erneuter liefert dieselbe Aufgabe (**200**, `created: false`). Die `projectId` kommt aus der URL; im Anfrageinhalt ergibt sie **400**. Zum Anlegen brauchst du Bearbeitungsrechte auf ein aktives Projekt.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Ein erneuter Aufruf mit derselben externen Referenz einer aktiven Aufgabe aktualisiert Titel und Beschreibung. Ohne `description` wird die Beschreibung gelöscht; Labels ändern sich nur, wenn du sie mitsendest. Archivierte Aufgaben bleiben unverändert. Die Aufgaben-ID bleibt gleich; `runWorkflowSlug` startet dabei keinen weiteren Lauf. Sende beim Wiederholen nach einer verlorenen Antwort dieselben Daten.

`description`, `labels` und `externalUrl` sind optional. Schick `automationSlug` mit, wenn die Aufgabe einer Automatisierung gehört: sie wird zum Assignee, und daran hängt das Arbeits-Panel des Aufgaben-Dialogs — der Start-Button, der Lauf-Fortschritt und die Fragen, die ein Lauf an den Operator stellt (ein späterer Re-Pick füllt eine fehlende Zuordnung nach, überschreibt aber nie einen Assignee). `runWorkflowSlug` startet im selben Aufruf einen deployten Workflow auf einer frisch angelegten Aufgabe — der Lauf startet inline, sodass die Antwort seine `executionId` trägt (die zu pollende Lauf-ID), oder `executionId: null`, wenn der Slug keine deployte Automatisierung benennt. Starte stattdessen explizit, wenn du den Workflow in einem eigenen Aufruf benennen willst. Die zuständige `automationSlug` muss eine bereitgestellte Automatisierung benennen, sonst lautet die Antwort **404**. Ein Workflow, der nur an andere Projekte gebunden ist, ergibt **403**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

Zum Starten brauchst du Bearbeitungsrechte auf ein aktives Projekt und eine aktive Aufgabe. Der Lauf erhält die Aufgabe als `{task: ...}`; eine zusätzliche Entwickler-Fähigkeit ist dafür nicht nötig. Das Laufprotokoll ordnet den Start deinem Schlüssel zu. Frage `GET /api/v1/projects/{id}/runs/{runId}` ab. Bei `started: false` liefert `reason: "already_running"` die `executionId` des bereits laufenden Laufs. `reason: "not_started"` bedeutet, dass der Slug keine bereitgestellte Automatisierung benennt.

Melde zurück und lies den Zustand — der Kommentar erscheint als der Benutzer, der den Schlüssel erzeugt hat, ununterscheidbar von derselben Person in der App, @-Erwähnungen eingeschlossen. Projektleser einschließlich Mitgliedern dürfen eine aktive Aufgabe in einem aktiven Projekt kommentieren. Nach der Archivierung bleiben Aufgabe und Kommentare lesbar. Jede Aufgaben-URL prüft die Zugehörigkeit zum benannten Projekt.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

Und hol die Ergebnisse. Was die Automatisierung zurückgemeldet hat, steht in der Diskussion der Aufgabe; was sie abgelegt hat, liegt als Dateien im Quartalsordner — beides liest du durch denselben Zugang. Die Diskussion kommt seitenweise, die neueste Seite zuerst (`limit`, Standard 200, höchstens 500), innerhalb der Seite chronologisch; solange `isDone` auf `false` steht, gibst du `continueCursor` als `cursor` zurück und liest die älteren Kommentare. Der Content-Endpoint antwortet mit **302** auf eine kurzlebige präsignierte URL für den gespeicherten Blob, folge also Redirects:

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "…", ... } ], "isDone": false, "continueCursor": "312" }

curl -sSL "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -o report.md
# → die Datei-Bytes (Content-Disposition trägt den Dateinamen)
```

## Fehlermodell

Jede Nicht-2xx-Antwort trägt einen flachen Umschlag:

```json
{ "error": "Automation not found" }
```

Verzweige auf den HTTP-Status; die Meldung ist für Menschen:

- **400** — fehlerhafte Anfrage: fehlendes Pflichtfeld, falscher Typ, nicht parsebarer Body — oder ein Multi-Org-Schlüssel, der seine Organisation nicht benannt hat (erforderlich bei jedem Schreiben und auf allen Projekt- und Aufgaben-Routen).
- **401** — fehlender oder ungültiger API-Schlüssel.
- **403** — die Rolle oder Projektbearbeitungsrechte fehlen, die gewünschte Änderung betrifft ein archiviertes Projekt oder eine archivierte Aufgabe, oder die Automatisierung darf in diesem Projekt nicht laufen.
- **404** — die Ressource fehlt, ist für den Schlüsselbesitzer unsichtbar, gehört einem anderen Threadbenutzer oder liegt in einem anderen Projekt als dem der URL.
- **409** — der Zustand verhindert die Aktion: keine bereitgestellte Version, eine gebundene Automatisierung ohne Projekt-URL, ein archivierter Thread oder laufender Turn, ein doppeltes Thema, eine doppelte E-Mail oder `externalItemId`, oder eine Suche ohne Embedding-Modell.
- **413** — der Body ist zu groß; nur der Webhook-Trigger gibt ihn zurück, bei seiner 256-KB-Grenze. Eine hochgeladene Datei, die die Größen- oder Typ-Policy verletzt, wird beim Binden stattdessen mit **400** und einem Reason-Code abgewiesen.
- **429** — Rate-Limit erreicht; die Antwort trägt `Retry-After` in ganzen Sekunden — siehe [Rate-Limits](/de/develop/rate-limits).
- **500** — interner Fehler.

Das Lösen eines Triggers einer vorhandenen Automatisierung (`DELETE .../triggers`) antwortet mit **204**, auch wenn kein Trigger gebunden war. Eine unbekannte Automatisierung ergibt **404**. Das Löschen einer fehlenden Ressource ergibt ebenfalls **404**, auch bei einem Kontakt im Papierkorb oder einem bereits gelöschten Wissenseintrag. Ein unbekannter Lauf ergibt beim Abbrechen **404**; `{cancelled: false}` bedeutet, dass der Lauf existiert und bereits beendet ist.

## Versionierung

Der aktuelle REST-Präfix lautet `/api/v1/`. Das OpenAPI-Dokument unter `/docs` beschreibt die Routen sowie Anfrage- und Antwortschemas der laufenden Instanz. Verwende es als Vertrag für deinen Client.

## Wo das hingehört

Diese Seite ist die REST-Hälfte der Außenfläche. Der [MCP-Endpoint](/de/develop/mcp-endpoint) öffnet dieselbe Plattform für MCP-Clients — das Autorieren von Automatisierungen lebt dort, nicht in REST. Die [Webhooks-Seite](/de/develop/webhooks) behandelt den eingehenden Trigger, der Läufe ohne Schlüssel startet. Baust du innerhalb des Produkts — Projekt-Agenten, Automatisierungen — ist der [Platform-Tab](/de/platform) dein Alltag; diese Seite ist für draußen.
