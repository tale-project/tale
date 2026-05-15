---
title: Tale aus einem Skript aufrufen
description: Eine Chat-Anfrage aus cURL und Python über Tales OpenAI-kompatible API senden.
---

Tales öffentliche API ist OpenAI-kompatibel — jedes SDK, das mit `/chat/completions` spricht, spricht mit Tale, indem du zwei Werte änderst: die Basis-URL und den API-Schlüssel. Dieses Tutorial läuft einen minimalen cURL-Aufruf durch, denselben Aufruf in Python mit dem offiziellen `openai`-Client und den Wechsel auf Streaming. Die volle Oberfläche — jeder Header, jeder Parameter, jeder Fehlercode — liegt in der [API-Referenz](/de/develop/api-reference).

Das Ergebnis am Ende ist ein lauffähiges Skript, das deine Tale-Instanz von deinem Laptop oder einem CI-Job aus trifft.

## Bevor du beginnst

Du brauchst ein Konto mit Berechtigung, API-Schlüssel zu erstellen — Inhaber-, Admin- oder Entwickler-Rollen qualifizieren sich. Du brauchst außerdem eine Tale-Instanz, die per HTTPS erreichbar ist von dort, wo dein Skript läuft (Laptop, CI-Runner, Server). Für Python ist die `openai`-Bibliothek die einzige Abhängigkeit; `pip install openai` deckt das ab. Für cURL reicht jede aktuelle `curl`-Version.

Agent-seitig ist keine Konfiguration nötig — der API-Schlüssel routet über deine Organisation und nutzt das Modell, das du per ID adressierst.

## Schritt 1 — Einen API-Schlüssel erstellen

Öffne **Einstellungen > API-Schlüssel** und klicke **Erstellen**. Gib dem Schlüssel einen beschreibenden Namen (`cli-dev-laptop`, `ci-runner`), damit du ihn widerrufen kannst, ohne andere Anrufer zu treffen, und kopiere dann das Token. Das Token beginnt mit `tale_` und wird genau einmal angezeigt — speichere es in deinem Passwort-Manager oder einer Shell-Env-Variablen. Schließt du den Dialog ohne zu kopieren, musst du neu generieren.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<deine-tale-instanz>/api/v1"
```

Der Schritt hat funktioniert, wenn die API-Schlüssel-Liste den neuen Schlüssel mit dem Namen zeigt, den du vergeben hast, und einen Letzte-Nutzung-Zeitstempel von „Nie".

## Schritt 2 — Verfügbare Modelle auflisten

Jede Anfrage braucht ein `model`-Feld; die gültigen Werte kommen aus `GET /api/v1/models`, das jedes Modell auflistet, das die Anbieter deiner Organisation exponieren. Die Form passt zu OpenAIs `/v1/models`, also lesen OpenAI-SDKs sie ohne Änderung.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Die Antwort ist eine JSON-Liste:

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

Wähle eine Modell-ID — der Rest des Tutorials geht von `openai/gpt-4o` aus.

Der Schritt hat funktioniert, wenn die Antwort mindestens ein Modell listet und das ID-Format zu dem passt, was du in **Einstellungen > KI-Anbieter** siehst.

## Schritt 3 — Eine Chat-Anfrage ohne Streaming senden

Eine Anfrage ohne Streaming liefert die ganze Completion in einer Antwort. Nutze sie, wenn das Skript keine Tokens während des Eintreffens darstellt und du nur den finalen Text brauchst.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "user", "content": "Fasse unsere Rückgaberichtlinie in 3 Punkten zusammen." }
    ]
  }' | jq -r '.choices[0].message.content'
```

Dieselbe Anfrage aus Python mit dem OpenAI-SDK:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Fasse unsere Rückgaberichtlinie in 3 Punkten zusammen."},
    ],
)
print(response.choices[0].message.content)
```

Der Schritt hat funktioniert, wenn das Skript eine zusammenhängende Antwort ausgibt und deine **Nutzungs-Analyse**-Seite in Tale die Anfrage gegen den API-Schlüssel verbucht zeigt.

## Schritt 4 — Auf Streaming umschalten

Streaming druckt Tokens, sobald das Modell sie produziert — das fühlt sich in einer CLI oder einem Chat-UI für jede Antwort länger als ein Satz deutlich besser an. Das Drahtformat ist Server-Sent Events; das OpenAI-SDK parst das für dich.

```python
stream = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Fasse unsere Rückgaberichtlinie in 3 Punkten zusammen."},
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
print()
```

Gesamtkosten und Endinhalt sind identisch zur Variante ohne Streaming — Streaming ändert das Drahtformat, nicht das Modell.

Der Schritt hat funktioniert, wenn Zeichen schrittweise in deinem Terminal erscheinen statt alle auf einmal.

## Schritt 5 — Die richtige Organisation wählen, wenn du in mehreren bist

Ein einzelner API-Schlüssel ist auf einen Nutzer begrenzt, und dieser Nutzer kann zu mehr als einer Organisation gehören. Gehört der Nutzer zu genau einer Organisation, löst Tale automatisch auf; sonst musst du sie mit dem `X-Organization-Slug`-Header benennen — der Wert ist der Org-Slug, der in deiner URL nach `/dashboard/` steht.

```python
client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
```

Der Schritt hat funktioniert, wenn eine Anfrage von einem Multi-Org-Nutzer den `Failed to resolve organization`-Fehler nicht mehr zurückgibt.

## Fehlerbehebung

- **401 Unauthorized** — der `tale_`-Schlüssel wurde widerrufen, falsch getippt, oder der Anfrage fehlt das `Bearer `-Präfix. Prüfe **Einstellungen > API-Schlüssel** und den `Authorization`-Header erneut.
- **404 Not Found auf `/chat/completions`** — der Basis-URL fehlt das `/api/v1`-Suffix, oder das Deployment serviert kein HTTPS auf dem Host, den du aufrufst.
- **400 missing model** — der Request-Body hat kein `model`-Feld. Übergib eine ID aus `GET /api/v1/models`.
- **400 Failed to resolve organization** — der Nutzer hinter dem API-Schlüssel gehört zu mehr als einer Organisation. Sende `X-Organization-Slug` wie in Schritt 5.

## Wo das einsetzt

Jeder OpenAI-kompatible Client spricht mit Tale, sobald du ihn auf die richtige Basis-URL zeigst und ein Modell aus den Anbietern deiner Organisation wählst — es gibt kein Tale-spezifisches SDK, und eine bestehende OpenAI-Integration zu tauschen bedeutet, zwei Strings zu ändern. Der Streaming-Schalter ist identisch zu OpenAIs, und der `X-Organization-Slug`-Header ist die einzige Tale-spezifische Eigenheit, die du typischerweise brauchst.

Zwei häufige nächste Schritte: denselben Aufruf in eine Automatisierung verdrahten, die ohne expliziten Skript-Aufruf läuft — [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) — oder den Client um Tool-Calling erweitern, abgedeckt in der [API-Referenz](/de/develop/api-reference).
