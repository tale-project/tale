---
title: Tale aus einem Skript aufrufen
description: Eine Chat-Anfrage an einen Agent aus cURL und Python über Tales OpenAI-kompatible API senden.
---

Tales öffentliche API ist OpenAI-kompatibel — jedes SDK, das mit `chat/completions` spricht, kann mit Tale sprechen, indem du zwei Werte änderst: Base-URL und API-Schlüssel. Dieses Tutorial zeigt einen minimalen cURL-Call, denselben Call in Python mit dem offiziellen `openai`-Client und den Wechsel auf Streaming-Antworten. Die vollständige Referenz steht in der [API-Referenz](/de/develop/api-reference).

Du brauchst Entwickler-Zugriff, um API-Schlüssel zu erstellen. Außerdem brauchst du einen Agent, den du per Slug ansprechen kannst — nutze den aus [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) oder einen der Standard-Agents.

## Schritt 1 — Einen API-Schlüssel anlegen

Navigiere zu **Einstellungen > API-Schlüssel** und klicke **Erstellen**. Gib dem Schlüssel einen sprechenden Namen (`cli-dev-laptop`), kopiere das Token — es beginnt mit `tale_` und wird nur einmal angezeigt — und leg es in deinem Passwort-Manager oder deinen Shell-Env ab.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<deine-tale-instanz>/api/v1"
```

## Schritt 2 — Verfügbare Agents auflisten

Jede Anfrage braucht ein `model`-Feld; die gültigen Werte sind die Agent-Slugs aus `GET /api/v1/models`.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Form der Antwort:

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "product-support", "object": "model", "owned_by": "default" }
  ]
}
```

Wähle einen Slug — für den Rest des Tutorials nehmen wir `product-support`.

## Schritt 3 — Eine Chat-Anfrage ohne Streaming senden

Ohne Streaming ist es am einfachsten: eine Anfrage, eine Antwort. Nutze das, wenn du nur den finalen Text willst.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "product-support",
    "messages": [
      { "role": "user", "content": "Fasse unsere Rückgabe-Richtlinie in 3 Stichpunkten zusammen." }
    ]
  }' | jq -r '.choices[0].message.content'
```

Dieselbe Anfrage in Python mit dem offiziellen SDK:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="product-support",
    messages=[
        {"role": "user", "content": "Fasse unsere Rückgabe-Richtlinie in 3 Stichpunkten zusammen."},
    ],
)
print(response.choices[0].message.content)
```

## Schritt 4 — Auf Streaming umstellen

Streaming gibt Tokens aus, sobald das Modell sie produziert — bessere UX in CLIs und Chat-UIs, gleiche Gesamtkosten. Setze `stream=True`:

```python
stream = client.chat.completions.create(
    model="product-support",
    messages=[
        {"role": "user", "content": "Fasse unsere Rückgabe-Richtlinie in 3 Stichpunkten zusammen."},
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
print()
```

Das Wire-Format ist Server-Sent Events (SSE); das SDK übernimmt das Parsen. Wenn du den Endpoint ohne SDK konsumierst, lies die [Streaming-Hinweise](/de/develop/api-reference) der Referenz.

## Schritt 5 — Einen Konversations-Thread wiederverwenden

Standardmäßig ist jede Anfrage ein eigenständiger Turn. Um eine Konversation über mehrere Anfragen fortzuführen, sende den optionalen Header `X-Thread-Id` mit einem Wert, den du kontrollierst. Dieselbe Thread-ID landet auf derselben Konversation in der Tale-UI, damit Endnutzer dort weitermachen können, wo dein Skript aufgehört hat.

```python
client_with_thread = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Thread-Id": "nightly-report-2026-04-20"},
)
```

Siehe [API-Referenz](/de/develop/api-reference) für alle Header.

## Troubleshooting

- **401 Unauthorized** — der `tale_`-Schlüssel wurde widerrufen, vertippt oder der `Bearer`-Prefix fehlt.
- **404 Not Found** bei `/chat/completions` — Base-URL fehlt das Suffix `/api/v1`.
- **400 model not found** — Agent-Slug existiert nicht oder ist anders geschrieben; prüf erneut `GET /models`.

## Weiter

- Denselben Call in eine Automatisierung einhängen: [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook).
- Tool Calling aus deinem Client nutzen: [API-Referenz — Tool Calling](/de/develop/api-reference).
