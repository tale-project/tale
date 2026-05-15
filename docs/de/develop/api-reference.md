---
title: API-Referenz
description: REST-API-Endpoints für RAG-, Crawler- und Platform-Dienste.
---

Jeder Tale-Dienst hat eine eigene REST-API. Sie werden intern zwischen Diensten genutzt, sind aber auch für die direkte Integration mit externen Systemen verfügbar.

## Interaktive API-Dokumentation

Alle Python-Dienste bieten eine Swagger-UI zum Erkunden und Testen:

| Dienst  | Swagger-UI-URL             | OpenAPI-JSON                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

## RAG-API

Die RAG-API übernimmt Dokumenten-Indizierung und -Suche. Sie ist die Engine hinter der Wissensdatenbank.

### Ein Dokument hochladen

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <binäre Datei>
file_id:   "unique-file-id"
sync:      "true"  (optional, auf das Ende der Indizierung warten)
metadata:  '{"source": "upload"}'  (optional JSON-String)
```

Die Dokument-Indizierung läuft standardmäßig im Hintergrund. Setze `sync=true`, um auf ihren Abschluss zu warten, bevor die Antwort zurückkehrt.

### Dokumenten-Status prüfen

```http
POST /api/v1/documents/statuses
```

```json
{
  "file_ids": ["file-id-1", "file-id-2"]
}
```

Liefert den Indizierungs-Status pro Dokument. Zustände: `queued`, `running`, `completed`, `failed`.

### In der Wissensdatenbank suchen

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "file_ids": ["file-id-1", "file-id-2"],
  "top_k": 5,
  "similarity_threshold": 0.0,
  "include_metadata": true
}
```

Der Parameter `file_ids` ist Pflicht und beschränkt die Suche auf bestimmte Dokumente.

### Ein Dokument löschen

```http
DELETE /api/v1/documents/{file_id}
```

### Dokument-Inhalt lesen

```http
GET /api/v1/documents/{file_id}/content
```

Liefert den vollständigen extrahierten Text eines indizierten Dokuments.

### Dokumente vergleichen

```http
POST /api/v1/documents/compare
```

```json
{
  "file_id_a": "file-id-1",
  "file_id_b": "file-id-2"
}
```

## Crawler-API

### Eine Website zum Crawling registrieren

```http
POST /api/v1/websites
```

```json
{
  "domain": "https://docs.example.com",
  "scan_interval": 21600
}
```

`scan_interval` ist in Sekunden. Minimum: 60.

### Seiteninhalt abrufen

```http
POST /api/v1/urls/fetch
```

```json
{
  "urls": ["https://docs.example.com/guide"],
  "word_count_threshold": 100
}
```

Liefert gecachten Inhalt, wenn vorhanden, sonst wird live gefetcht.

### Website-Info

```http
GET /api/v1/websites/{domain}
```

### Website deregistrieren

```http
DELETE /api/v1/websites/{domain}
```

### Website-URLs auflisten

```http
GET /api/v1/websites/{domain}/urls
```

## Platform-API

Der Platform-Dienst bietet eine öffentliche API unter `/api/v1/*` für programmatischen Zugriff auf deine Daten. Authentifiziere dich mit einem API-Schlüssel aus **Einstellungen > API-Schlüssel**.

### OpenAI-kompatible Chat-Completions

Die Plattform bietet ein Interface, das vollständig kompatibel mit der [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) ist. Jeder Client oder jedes SDK, das OpenAI unterstützt (Python, Node, curl, LiteLLM etc.), kann per `base_url` auf deine Tale-Instanz zeigen.

#### Quick Start

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # aus Einstellungen > API-Schlüssel
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="chat-agent",  # Agent-Slug von deiner Agents-Seite
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
  model: 'chat-agent',
  messages: [{ role: 'user', content: 'Hallo!' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat-agent","messages":[{"role":"user","content":"Hallo!"}]}'
```

</CodeGroup>

#### Authentifizierung

Alle Anfragen brauchen ein Bearer-Token im `Authorization`-Kopfzeile:

```text
Authorization: Bearer tale_...
```

API-Schlüssel erstellst du in der Plattform-UI unter **Einstellungen > API-Schlüssel**.

#### Kopfzeile

| Kopfzeile             | Pflicht | Beschreibung                                                                                   |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `Authorization`       | Ja      | `Bearer <api-key>`.                                                                            |
| `X-Organization-Slug` | Nein    | Organisations-Slug. Wird automatisch aufgelöst, wenn der Nutzer nur in einer Organisation ist. |
| `X-Thread-Id`         | Nein    | Einen Konversations-Thread über Anfragen hinweg wiederverwenden.                               |

#### Endpoints

##### POST /api/v1/chat/completions

Sendet eine Chat-Nachricht und erhält eine Antwort. Unterstützt Streaming und Tool-Calling.

**Anfrage-Body:**

| Feld                | Typ                | Beschreibung                                                                           |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `model`             | string             | **Pflicht.** Agent-Slug (z. B. `chat-agent`).                                          |
| `messages`          | array              | **Pflicht.** Konversations-Nachrichten mit `role` und `content`.                       |
| `stream`            | boolean            | SSE-Streaming aktivieren. Standard: `false`.                                           |
| `temperature`       | number             | Sampling-Temperatur (0–2).                                                             |
| `max_tokens`        | number             | maximale Tokens zum Erzeugen.                                                          |
| `top_p`             | number             | Nucleus-Sampling-Parameter.                                                            |
| `frequency_penalty` | number             | wiederholte Tokens bestrafen.                                                          |
| `presence_penalty`  | number             | bereits vorhandene Tokens bestrafen.                                                   |
| `stop`              | string oder array  | Stopp-Sequenzen.                                                                       |
| `response_format`   | object             | `{"type": "json_object"}` für JSON-Modus.                                              |
| `tools`             | array              | Tool-Definitionen für Client-seitiges Tool-Calling.                                    |
| `tool_choice`       | string oder object | `"auto"`, `"required"`, `"none"` oder `{"type":"function","function":{"name":"..."}}`. |

**Zwei Modi:**

- **Agent-Modus** (ohne `tools`): Der Agent nutzt seine vorkonfigurierten Server-Tools (RAG, Web-Suche etc.) und führt sie automatisch aus. Die Antwort enthält den Finaltext.
- **Client-Tool-Modus** (`tools` übergeben): Nur die client-definierten Tools sind verfügbar. Das Modell liefert `tool_calls` zur Ausführung durch den Client. Die Ergebnisse sendest du per `role: "tool"`-Nachrichten zurück.

**Tool-Calling-Beispiel:**

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Liefert Wetter für eine Stadt",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# Schritt 1: Tools senden
response = client.chat.completions.create(
    model="chat-agent",
    messages=[{"role": "user", "content": "Wie ist das Wetter?"}],
    tools=tools,
    tool_choice="required",
)

# Schritt 2: Tool ausführen und Ergebnis zurück schicken
tc = response.choices[0].message.tool_calls[0]
messages = [
    {"role": "user", "content": "Wie ist das Wetter?"},
    response.choices[0].message.model_dump(),
    {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 20}'},
]
final = client.chat.completions.create(
    model="chat-agent", messages=messages, tools=tools
)
print(final.choices[0].message.content)
```

##### GET /api/v1/models

Liste der verfügbaren Agents (Modelle).

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "workflow-assistant", "object": "model", "owned_by": "default" }
  ]
}
```

## Status-Endpoints

Zwei öffentliche, nicht authentifizierte Endpoints geben den Gesamt-Up/Down-Status der Plattform aus. Sie teilen sich denselben Probe (5-Sekunden-In-Memory-Cache) und unterscheiden sich nur in der Darstellung:

| Endpoint       | Verwendung                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Lesbare HTML-Statusseite. Wählt Englisch, Deutsch oder Französisch anhand von `Accept-Language`.                            |
| `/status.json` | Maschinenlesbarer Feed für externe Monitore (BetterStack, UptimeRobot, Atlassian Statuspage, Datadog Synthetics und andere) |

Beide Endpoints antworten immer mit `200 OK` und `Cache-Control: public, max-age=5`. Die Plattform selbst ist die Quelle der Wahrheit — wenn dein Monitor `/status.json` überhaupt nicht erreicht, ist der Plattformprozess nicht erreichbar, und das Timeout des Monitors ist das Signal.

### Wire-Format (`/status.json`)

```json
{
  "status": "operational",
  "checkedAt": "2026-05-11T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "outage" }
  ]
}
```

| Feld                  | Typ    | Werte                                                                                |
| --------------------- | ------ | ------------------------------------------------------------------------------------ |
| `status`              | string | `operational`, `degraded` (einige Komponenten ausgefallen) oder `outage` (alle aus). |
| `checkedAt`           | string | ISO-8601-Zeitstempel der letzten Probe-Runde.                                        |
| `components[].id`     | string | Stabile Komponenten-Kennung: `convex`, `rag` oder `crawler`.                         |
| `components[].status` | string | `operational` oder `outage` pro Komponente.                                          |

Keyword-basierte Uptime-Monitore können auf den groß-/kleinschreibungssensitiven Substring `"status":"outage"` reagieren.

## Wo das hingehört

Die API ist Tales ausgehende Oberfläche — was dein Code aufruft, wenn _du_ die Konversation, den Workflow oder den Datenzugriff treibst. Das eingehende Gegenstück ist [Webhooks](/de/develop/webhooks): dasselbe Protokoll, dasselbe Signatur-Schema, derselbe Audit-Log, mit Tale auf der rufenden statt der empfangenden Seite. Jeder Client, der mit OpenAIs `/chat/completions` spricht, spricht mit Tale, sobald du zwei Werte änderst (Base-URL und Schlüssel); jedes System, das eine signierte HTTPS-POST schicken kann, treibt einen Workflow.

Für das Tutorial, das beide Richtungen durchgeht, deckt [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) die API-Seite ab und [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) die eingehende Webhook-Seite.
