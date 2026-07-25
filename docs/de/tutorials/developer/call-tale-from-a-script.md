---
title: Tale aus einem Skript aufrufen
description: Erzeug einen API-Schlüssel und ruf die Tale-REST-API aus einem Bash- oder Python-Skript auf — der kürzeste End-to-End-Pfad vom Terminal zur Assistenten-Antwort.
---

Tale aus einem Skript aufzurufen ist der Weg, wenn du einen Wert von der Plattform willst, ohne die UI zu öffnen. Die Tale-API spricht JSON über HTTPS und nimmt ein Bearer-Token im `Authorization`-Header; von da an ist jede Endpoint-Gruppe ein normaler REST-Aufruf. Dieser Walk bringt dich in einer Sitzung von „ich will Tale skripten" zu einer Assistenten-Antwort in deinem Terminal.

Du brauchst eine Entwickler-Rolle (für API-Schlüssel), die URL deiner Tale-Instanz und eine Shell mit `curl` und Python. Die volle API-Oberfläche steht in der [API-Referenz](/de/develop/api-reference); diese Seite ist der kleinste End-to-End-Gang hindurch.

## Bevor du anfängst

Prüfe drei Dinge. Deine Instanz ist über HTTPS erreichbar — öffne `https://your-host.example.com` und schau, ob das Dashboard lädt. Deine Rolle ist mindestens Entwickler — [API-Schlüssel](/de/platform/admin/api-keys) verwalten Admin- und Entwickler-Rollen. Du kennst ein Modell, das deine Organisation konfiguriert hat — die API wählt nie automatisch eins, jeder Chat-Aufruf nennt sein Modell explizit.

## Schritt 1 — API-Schlüssel erzeugen

Der erste Zug ist ein API-Schlüssel. Ihn trägt jeder Skript-Aufruf; ohne ihn antwortet die API 401, und nach der Erstellung kannst du ihn nicht mehr auslesen.

Erzeuge einen Schlüssel im [API-Schlüssel](/de/platform/admin/api-keys)-Panel und kopiere, was es zeigt — Tale zeigt ihn einmal und nie wieder. Leg ihn für den Rest dieses Walks als Umgebungsvariable ab:

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://your-host.example.com"
```

Der Schlüssel gehört dir und deiner Organisation; was er darf, folgt deiner Rolle. Behandle ihn wie ein Passwort.

## Schritt 2 — Rauchtest mit curl

Der kleinste End-to-End-Check ist das Auflisten der Automatisierungen der Organisation. Funktioniert das, stimmen Auth, Netzwerk und API; scheitert es, sagt dir die Fehlerart, welches der drei kaputt ist.

```bash
curl -sS "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq
```

Eine 200 mit einem `{ "page": [...], "isDone": true, ... }`-Body bestätigt die Runde — jeder Listen-Endpoint antwortet mit genau diesem paginierten Umschlag. Eine 401 heißt: der Schlüssel ist falsch; alles andere heißt: die Instanz ist unerreichbar oder der Pfad vertippt.

## Schritt 3 — Ein Modell fragen und die Antwort lesen

Chat über die API ist asynchron: du postest eine Nachricht, der Turn läuft im Hintergrund, und du pollst, bis er fertig ist. Drei Aufrufe, eine Schleife:

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {"Authorization": f"Bearer {os.environ['TALE_API_KEY']}"}

# 1. Ein eigener Thread
thread = requests.post(f"{base}/api/v1/threads", headers=auth, json={}).json()

# 2. Nachricht senden — nenn ein Modell, das deine Organisation konfiguriert hat
requests.post(
    f"{base}/api/v1/threads/{thread['id']}/messages",
    headers=auth,
    json={"content": "In einem Satz: Was ist Tale?", "model": "<dein-modell>"},
).raise_for_status()

# 3. Bis idle pollen, dann die letzte Nachricht lesen
while True:
    status = requests.get(
        f"{base}/api/v1/threads/{thread['id']}/generation", headers=auth
    ).json()["status"]
    if status == "idle":
        break
    time.sleep(1)

messages = requests.get(
    f"{base}/api/v1/threads/{thread['id']}/messages", headers=auth
).json()["page"]
print(messages[-1]["content"])
```

`{"status": "idle"}` heißt: der Turn ist fertig — auch ein gescheiterter, der als Assistenten-Nachricht mit dem Fehler landet, statt zu verschwinden. Der Sende-Aufruf antwortet sofort **202**; die Antwort existiert erst, wenn die Poll-Schleife `queued`/`streaming` verlässt.

## Schritt 4 — Einen Automatisierungslauf starten

Dieselbe 202-dann-pollen-Form startet echte Arbeit. Automatisierungsnamen sind `/`-Pfade und stehen in URLs mit `__` — `billing/dunning` reist als `billing__dunning`:

```bash
RUN=$(curl -sS -X POST "$TALE_BASE_URL/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS "$TALE_BASE_URL/api/v1/runs/$RUN" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq .status
```

Ein Live-Lauf braucht deine Entwickler-Rolle; mit `{"mode": "mock"}` probst du gegen deterministische Mocks, mit jedem Mitglieds-Schlüssel. Eine 409 heißt: die Automatisierung hat noch keine deployte Version.

## Wo das hingehört

Ein Skript ist der Weg, wenn die Datenebene JSON ist, kein Bildschirm — Cron-Jobs, CI-Checks, interne Portale. Der API-Schlüssel trägt deine Rolle, jeder Listen-Endpoint antwortet mit demselben paginierten Umschlag, und alles, was echte Arbeit startet, antwortet 202 und gibt dir etwas zum Pollen.

Für eingehende Trigger — ein Drittsystem postet in eine Tale-Automatisierung — siehe [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook). Für einen modellgetriebenen Client statt eines Skripts öffnet der [MCP-Endpoint](/de/develop/mcp-endpoint) dieselbe Plattform als Tools. Für das volle Endpoint-Inventar und das Fehlermodell ist die [API-Referenz](/de/develop/api-reference) die einzige Quelle der Wahrheit.
