---
title: Tale aus einem Skript aufrufen
description: Erzeug einen API-Schlüssel und ruf die Tale-REST-API aus einem Bash-, Python- oder Node-Skript auf — der kürzeste End-to-End-Pfad vom Terminal zur Agent-Antwort.
---

Tale aus einem Skript aufzurufen ist der Pfad, zu dem du greifst, wenn du einen Wert von einem Agent oder einem Workflow zurück willst, ohne die UI zu öffnen. Die Tale-API spricht JSON über HTTPS und akzeptiert ein Bearer-Token in der `Authorization`-Kopfzeile; von dort an ist jede Endpoint-Gruppe ein normaler REST-Call. Dieser Spaziergang führt dich von „ich will Tale skripten" zu einer in dein Terminal gestreamten Antwort in einer Sitzung.

Du brauchst eine Developer-Rolle (um API-Schlüssel zu erzeugen), die URL deiner Tale-Instanz und eine Shell mit `curl`, Python oder Node. Die volle API-Oberfläche lebt in der [API-Referenz](/de/develop/api-reference); diese Seite ist der kürzeste End-to-End-Spaziergang dadurch.

## Bevor du beginnst

Bestätige drei Dinge. Deine Instanz ist über HTTPS erreichbar — öffne `https://your-host.example.com` und prüf, dass das Dashboard lädt. Deine Rolle ist mindestens Developer — der Eintrag **Einstellungen > API-Schlüssel** ist für Member und Editor versteckt. Du hast mindestens einen veröffentlichten Agent — das Listen der Agenten gibt auf einer brandneuen Instanz ein leeres Array zurück, was den Rauch-Test mehrdeutig macht.

## Schritt 1 — Einen API-Schlüssel erzeugen

Der erste Zug ist, einen API-Schlüssel zu erstellen, der auf deinen Nutzer skopiert ist. Der Schlüssel ist das, was jeder Skript-Call mitführt; ohne ihn gibt die API 401 zurück, und du kannst den Schlüssel nach der Erstellung nicht mehr lesen.

Öffne **Einstellungen > API-Schlüssel** und klick **Neuer Schlüssel**. Gib ihm einen Namen (`local-script-test`), wähl einen Ablauf und klick **Erstellen**. Kopier den Schlüssel, den das Panel zeigt — Tale zeigt ihn einmal und nie wieder. Leg ihn für den Rest des Spaziergangs als Environment-Variable ab:

```bash
export TALE_API_KEY="tk_..."
export TALE_BASE_URL="https://your-host.example.com"
```

Der Schlüssel erbt deine Rolle; behandle ihn wie ein Passwort.

## Schritt 2 — Rauchtest mit curl

Der kleinste End-to-End-Check ist das Listen der für deinen Schlüssel sichtbaren Agenten. Klappt das, sind Auth, Netzwerk und API in Ordnung; bricht es ab, sagt der Fehler-Modus, welches Stück kaputt ist.

```bash
curl -sS "$TALE_BASE_URL/api/v1/agents" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json" | jq
```

Eine 200 mit einem JSON-Body wie `{ "agents": [ ... ] }` bestätigt den Round-trip. Eine 401 heisst, der Schlüssel ist falsch; eine 403 heisst, der Schlüssel ist gültig, die Rolle aber zu niedrig; alles andere heisst, die Instanz ist nicht erreichbar oder der Pfad ist falsch. Pick eine Agent-ID aus der Antwort — du brauchst sie für Schritt 3.

## Schritt 3 — Einen Agent aus Python oder Node aufrufen

Das Listen der Agenten ist read-only; die nützliche Arbeit passiert, wenn du einen Agent um eine Antwort bittest. Der OpenAI-kompatible Endpoint ist der einfachste Einstieg, weil bestehende SDKs unverändert laufen:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=f"{os.environ['TALE_BASE_URL']}/api/v1",
    api_key=os.environ["TALE_API_KEY"],
)
reply = client.chat.completions.create(
    model="agt_your_agent_id_here",
    messages=[{"role": "user", "content": "Summarise the last quarter's revenue."}],
)
print(reply.choices[0].message.content)
```

Das Feld `model` ist die ID des Agenten; die Instruktionen, das Wissen und die Tools des Agenten laufen wie konfiguriert. Dieselbe Form in Node nutzt `openai` aus npm mit derselben `baseURL` und demselben `apiKey`. Streaming geht mit `stream=True` und Server-Sent Events.

## Wo das eingesetzt wird

Ein Skript ist der Pfad, den du nimmst, wenn die Daten-Ebene JSON ist, kein Bildschirm — Cronjobs, CI-Checks, interne Portale. Der API-Schlüssel führt deine Rolle, der OpenAI-kompatible Endpoint ist die reibungsärmste Form, und jeder List-Endpoint gibt denselben `{ resource: [...] }`-Umschlag zurück.

Für eingehende Trigger — dein System POSTet in einen Tale-Workflow — siehe [Eine Automation per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook). Für die volle Endpoint-Liste und das Fehler-Modell ist die [API-Referenz](/de/develop/api-reference) die einzige Quelle der Wahrheit.
