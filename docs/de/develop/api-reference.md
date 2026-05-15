---
title: API-Referenz
description: REST-Endpoints für Platform, RAG und Crawler — OpenAI-kompatibles Chat, Dokument-Indizierung und Crawler-Steuerung.
---

Die Tale-API ist die Oberfläche, die dein Code aufruft, wenn du die Konversation, die Indizierung oder das Crawling treibst, statt durch die UI zu klicken. Der Platform-Dienst spricht eine OpenAI-kompatible Chat-Completions-API unter `/api/v1/*`; RAG und Crawler exponieren je ihre eigene REST-Oberfläche am Dienst-Port. Diese Seite ist die einzige Quelle der Wahrheit für die Drahtform — jeder Endpunkt, jeder Pflicht-Header, jedes Anfrage- und Antwortfeld — und ergänzt das Tutorial unter [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) für den durchgespielten Ablauf.

Die Webhook-Oberfläche — Tale empfängt Anfragen von externen Systemen — liegt in [Webhooks](/de/develop/webhooks).

## Authentifizierung

Jede Platform-API-Anfrage trägt ein Bearer-Token, das in **Einstellungen > API-Schlüssel** erstellt wird:

```text
Authorization: Bearer tale_...
```

Tokens beginnen mit `tale_` und sind auf den erstellenden Nutzer begrenzt. Gehört dieser Nutzer zu mehr als einer Organisation, sende `X-Organization-Slug: <slug>`, um die Organisation zu wählen; Tale löst automatisch auf, wenn der Nutzer zu genau einer gehört. RAG und Crawler werden über das interne Docker-Netzwerk erreicht und brauchen für In-Cluster-Anrufer keine Auth — sie extern zu exponieren ist eine Operator-Entscheidung, dokumentiert in der Self-hosted-Konfigurations-Referenz.

## Interaktive API-Dokumentation

Die Python-Dienste liefern eine Swagger-UI zum Erkunden und Testen jedes Endpunkts:

| Dienst  | Swagger-UI                 | OpenAPI-JSON                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

Die Platform-API hat keine Swagger-UI — sie folgt der OpenAI-Chat-Completions-Spec, also gilt jede OpenAI-Client-Dokumentation.

## Platform-API — Chat-Completions

Die Platform exponiert eine OpenAI-kompatible Chat-Completions-Oberfläche unter `/api/v1/*`. Jeder Client oder jedes SDK, das mit OpenAIs `chat/completions` spricht, spricht mit Tale, indem du zwei Werte änderst: die Basis-URL und den Schlüssel.

### Durchgespieltes Beispiel — minimale lauffähige Anfrage

Die kleinste Anfrage, die etwas tut, ist eine einzelne Nutzernachricht an irgendein Modell, das deine Anbieter exponieren. Das Beispiel unten zeigt cURL, Python und Node nebeneinander; die Modell-ID kommt aus `GET /api/v1/models`.

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # aus Einstellungen > API-Schlüssel
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Hallo!"}],
)
print(response.choices[0].message.content)
```

```typescript Node.js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-tale-instance.com/api/v1',
  apiKey: 'tale_...',
  defaultHeaders: { 'X-Organization-Slug': 'default' },
});

const response = await client.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Hallo!' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hallo!"}]}'
```

</CodeGroup>

Die Antwort folgt der OpenAI-Form — `id`, `object: chat.completion`, `created`, `model`, `choices[].message.content`, `usage`. Streaming tauscht `chat.completion` gegen `chat.completion.chunk` und gibt einen Chunk pro Token aus.

### POST /api/v1/chat/completions

Sende eine Chat-Nachricht und empfange eine Antwort. Unterstützt Streaming, Tool-Calling und JSON-Modus.

**Header.** `Authorization` ist Pflicht; `X-Organization-Slug` nur für Multi-Org-Nutzer.

| Name                  | Typ    | Erforderlich         | Beschreibung                                                                    |
| --------------------- | ------ | -------------------- | ------------------------------------------------------------------------------- |
| `Authorization`       | string | Ja                   | `Bearer tale_...` — der API-Schlüssel aus **Einstellungen > API-Schlüssel**.    |
| `X-Organization-Slug` | string | nur Multi-Org-Nutzer | Organisations-Slug. Wird automatisch aufgelöst, wenn der Nutzer genau eine hat. |
| `Content-Type`        | string | Ja                   | `application/json` für den Request-Body.                                        |

**Request-Body.**

| Name                | Typ                | Erforderlich | Beschreibung                                                                                      |
| ------------------- | ------------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `model`             | string             | Ja           | Anbieter-Modell-ID, z. B. `openai/gpt-4o`. Auflisten mit `GET /api/v1/models`.                    |
| `messages`          | array              | Ja           | Konversationshistorie. Jeder Eintrag hat `role` und `content`; Tool-Calls folgen der OpenAI-Spec. |
| `stream`            | boolean            | Nein         | Antwort als Server-Sent Events streamen. Standard `false`.                                        |
| `temperature`       | number             | Nein         | Sampling-Temperatur, 0–2.                                                                         |
| `max_tokens`        | number             | Nein         | Maximale Tokens zur Generierung.                                                                  |
| `top_p`             | number             | Nein         | Nucleus-Sampling-Parameter.                                                                       |
| `frequency_penalty` | number             | Nein         | Wiederholte Tokens bestrafen.                                                                     |
| `presence_penalty`  | number             | Nein         | Bereits vorhandene Tokens bestrafen.                                                              |
| `stop`              | string oder array  | Nein         | Stoppsequenzen.                                                                                   |
| `response_format`   | object             | Nein         | Setze `{"type":"json_object"}` für JSON-Modus.                                                    |
| `tools`             | array              | Nein         | Tool-Definitionen für clientseitiges Tool-Calling.                                                |
| `tool_choice`       | string oder object | Nein         | `"auto"`, `"required"`, `"none"` oder `{"type":"function","function":{"name":"..."}}`.            |
| `stream_options`    | object             | Nein         | `{"include_usage": true}` fügt einer gestreamten Antwort einen finalen Usage-Chunk hinzu.         |
| `seed`              | number             | Nein         | Best-Effort-Determinismus-Hinweis. Anbieter-Verhalten variiert.                                   |

**Zwei Modi.** Ohne `tools` läuft die Anfrage im **Direct-Model-Modus** — Tale routet per Modell-ID und liefert die Completion des Modells unverändert zurück. Mit `tools` läuft die Anfrage im **Client-Tool-Modus** — das Modell liefert `tool_calls` statt einer finalen Antwort, der Client führt sie aus, und eine Folgeanfrage trägt die Ergebnisse als `role: "tool"`-Nachrichten zurück.

**Tool-Calling-Beispiel.**

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Liefert das aktuelle Wetter für eine Stadt.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]

# Erster Aufruf: das Modell entscheidet, das Tool zu rufen.
response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Wie ist das Wetter in Zürich?"}],
    tools=tools,
    tool_choice="required",
)
tc = response.choices[0].message.tool_calls[0]

# Zweiter Aufruf: das Tool-Ergebnis zurücksenden.
final = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Wie ist das Wetter in Zürich?"},
        response.choices[0].message.model_dump(),
        {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 18}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

### GET /api/v1/models

Listet jedes Modell, das die Anbieter der Organisation exponieren. Die Form passt zu OpenAIs `/v1/models`.

```json
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 1747325000,
      "owned_by": "openai-main"
    },
    {
      "id": "anthropic/claude-3-5-sonnet",
      "object": "model",
      "created": 1747325000,
      "owned_by": "anthropic-main"
    }
  ]
}
```

`owned_by` trägt den Anbieter-Slug — nützlich, um zwei Anbieter zu unterscheiden, die dieselbe Upstream-Modell-ID exponieren.

## RAG-API — Dokument-Indizierung und -Suche

Der RAG-Dienst übernimmt Dokument-Indizierung und Vektorsuche. Er ist die Engine hinter der Wissensdatenbank; die Platform-UI delegiert jede Suche und jeden Upload an diese Oberfläche. Der Dienst lauscht standardmäßig auf Port `8001`.

### Durchgespieltes Beispiel — indizieren und suchen

Ein minimaler End-to-End-Ablauf lädt ein Dokument hoch, wartet auf das Ende der Indizierung und führt eine Suche begrenzt auf dieses Dokument:

```bash
curl -X POST http://localhost:8001/api/v1/documents/upload \
  -F "file=@policy.pdf" \
  -F "file_id=policy-pdf-1" \
  -F "sync=true"

curl -X POST http://localhost:8001/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Wie ist unsere Rückgaberichtlinie?","file_ids":["policy-pdf-1"],"top_k":5}'
```

Der `sync=true`-Parameter lässt den Upload blockieren, bis die Indizierung abgeschlossen ist; ohne ihn kehrt die Antwort sofort zurück und das Dokument indiziert im Hintergrund.

### POST /api/v1/documents/upload

Lade ein Dokument zur Indizierung hoch. Multipart-form-data.

| Name       | Typ     | Erforderlich | Beschreibung                                             |
| ---------- | ------- | ------------ | -------------------------------------------------------- |
| `file`     | file    | Ja           | Die zu indizierende Binärdatei.                          |
| `file_id`  | string  | Ja           | Stabiler Identifier, den der Anrufer vergibt.            |
| `sync`     | boolean | Nein         | Auf das Ende der Indizierung warten. Standard `false`.   |
| `metadata` | string  | Nein         | JSON-kodierte Metadaten, neben dem Dokument gespeichert. |

### POST /api/v1/documents/statuses

Prüfe den Indizierungs-Status für ein oder mehrere Dokumente.

```json
{ "file_ids": ["policy-pdf-1", "manual-pdf-2"] }
```

Liefert jede `file_id` mit einem Status aus `queued`, `running`, `completed` oder `failed`.

### POST /api/v1/search

Führe eine Vektorsuche begrenzt auf bestimmte Dokumente aus.

| Name                   | Typ     | Erforderlich | Beschreibung                                                                          |
| ---------------------- | ------- | ------------ | ------------------------------------------------------------------------------------- |
| `query`                | string  | Ja           | Klartext-Anfrage.                                                                     |
| `file_ids`             | array   | Ja           | Dokumente, auf die die Suche begrenzt wird. Pflicht — es gibt kein implizites „alle". |
| `top_k`                | number  | Nein         | Maximale Chunks im Ergebnis. Standard `5`.                                            |
| `similarity_threshold` | number  | Nein         | Minimale Kosinus-Ähnlichkeit, 0–1.                                                    |
| `include_metadata`     | boolean | Nein         | Pro-Chunk-Metadaten in die Antwort aufnehmen.                                         |

### DELETE /api/v1/documents/{file_id}

Entferne ein Dokument und seine Index-Einträge.

### GET /api/v1/documents/{file_id}/content

Liefert den vollen extrahierten Text eines indizierten Dokuments.

### POST /api/v1/documents/compare

Vergleiche zwei indizierte Dokumente.

```json
{ "file_id_a": "policy-2024", "file_id_b": "policy-2025" }
```

## Crawler-API — Websites und On-Demand-Fetch

Der Crawler-Dienst registriert Websites für periodische Indizierung und exponiert einen On-Demand-URL-Fetch-Endpunkt. Er lauscht standardmäßig auf Port `8002`.

### Durchgespieltes Beispiel — registrieren und fetchen

```bash
curl -X POST http://localhost:8002/api/v1/websites \
  -H "Content-Type: application/json" \
  -d '{"domain":"https://docs.example.com","scan_interval":21600}'

curl -X POST http://localhost:8002/api/v1/urls/fetch \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://docs.example.com/guide"],"word_count_threshold":100}'
```

`scan_interval` ist in Sekunden; Minimum 60. Der Fetch-Endpunkt liefert gecachten Inhalt, wenn vorhanden, und fetcht live, wenn nicht.

### POST /api/v1/websites

Registriere eine Website für periodisches Crawling.

| Name            | Typ    | Erforderlich | Beschreibung                                                           |
| --------------- | ------ | ------------ | ---------------------------------------------------------------------- |
| `domain`        | string | Ja           | Voll qualifizierte URL der Site-Wurzel.                                |
| `scan_interval` | number | Nein         | Sekunden zwischen Scans. Minimum 60. Standard ist dienst-konfiguriert. |

### POST /api/v1/urls/fetch

Fetche eine oder mehrere URLs synchron.

| Name                   | Typ    | Erforderlich | Beschreibung                                                  |
| ---------------------- | ------ | ------------ | ------------------------------------------------------------- |
| `urls`                 | array  | Ja           | Zu fetchende URLs.                                            |
| `word_count_threshold` | number | Nein         | Lehnt Ergebnisse unter dieser Länge ab (filtert Menü-Seiten). |

### GET /api/v1/websites/{domain}

Liefert den Registrierungsdatensatz einer Website.

### DELETE /api/v1/websites/{domain}

Deregistriert eine Website. Bestehende indizierte Seiten bleiben durchsuchbar, bis sie ablaufen.

### GET /api/v1/websites/{domain}/urls

Listet jede URL, die der Crawler für die Site indiziert hat.

## Status-Endpoints

Die Plattform exponiert zwei öffentliche, nicht-authentifizierte Endpoints, die den Gesamt-Up/Down-Zustand melden. Beide teilen denselben In-Memory-Probe mit Fünf-Sekunden-Cache; sie unterscheiden sich nur in der Darstellung.

| Endpoint       | Verwendung                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/status`      | Menschen-lesbare HTML-Seite. Sprache aus `Accept-Language` gewählt (Englisch, Deutsch, Französisch).                                 |
| `/status.json` | Maschinen-lesbarer Feed für externe Monitore — BetterStack, UptimeRobot, Statuspage, Datadog, alles, was eine JSON-Oberfläche pollt. |

Beide liefern `200 OK` und `Cache-Control: public, max-age=5`. Die Plattform ist die Quelle der Wahrheit — kann ein Monitor `/status.json` überhaupt nicht erreichen, ist der Prozess nicht erreichbar und der eigene Timeout des Monitors ist das Signal. Die JSON-Form ist im Detail unter [Status-Seite](/de/develop/status-page) abgedeckt.

## Wo das einsetzt

Die API ist Tales ausgehende Oberfläche — was dein Code ruft, wenn du die Konversation, die Indizierung oder das Crawling treibst. Ihr eingehendes Gegenstück ist [Webhooks](/de/develop/webhooks): dieselbe Protokoll-Familie, dasselbe Audit-Log, mit Tale auf der Empfänger- statt der Anruferseite. Jeder Client, der mit OpenAIs `/chat/completions` spricht, spricht mit Tale durch das Ändern zweier Werte (Basis-URL und Schlüssel); jedes System, das JSON per POST an eine eindeutige URL schicken kann, kann einen Workflow treiben.

Für das Tutorial, das beide Richtungen end-to-end durchspielt, deckt [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) die API-Seite und [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) die eingehende Webhook-Seite ab.
