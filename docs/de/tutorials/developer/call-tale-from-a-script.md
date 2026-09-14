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
export TALE_API_KEY="<api-key>"
export TALE_BASE_URL="https://your-host.example.com"
export TALE_ORG_SLUG="<org-slug>"
```

Der Schlüssel handelt als du in der Organisation aus `TALE_ORG_SLUG`; Mitgliedschaft und Rolle bestimmen seine Rechte. Gehörst du mehreren Organisationen an, ist die Organisationskopfzeile bei jeder Anfrage Pflicht, Lesezugriffe eingeschlossen — ohne sie antwortet die API mit `400` und `"code": "ORG_SLUG_REQUIRED"` und listet die Slugs, die du senden darfst. Bewahre den Schlüssel wie ein Passwort auf.

## Schritt 2 — Rauchtest mit curl

Der kleinste End-to-End-Check ist das Auflisten der Automatisierungen der Organisation. Funktioniert das, stimmen Auth, Netzwerk und API; scheitert es, sagt dir die Fehlerart, welches der drei kaputt ist.

```bash
curl -sS --compressed "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq
```

Eine 200 mit einem `{ "automations": [...] }`-Body bestätigt die Runde. Eine 401 heißt: der Schlüssel ist falsch; alles andere heißt: die Instanz ist unerreichbar oder der Pfad vertippt.

## Schritt 3 — Ein Modell fragen und die Antwort lesen

API-Chat läuft asynchron: Sende eine Nachricht, frage den Status während des Turns ab und lies danach die Antwort. Dieses Beispiel erstellt einen persönlichen Thread ohne Projekt. Für einen Projektchat setzt du `threads_url` auf `f"{base}/api/v1/projects/{os.environ['TALE_PROJECT_ID']}/threads"`. Alle weiteren Aufrufe bleiben in diesem Projekt, ohne `projectId` im Anfrageinhalt. Du brauchst Leserechte auf das aktive Projekt; die Rolle Mitglied genügt dafür.

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
}
threads_url = f"{base}/api/v1/threads"

# 1. Ein eigener Thread
thread = requests.post(threads_url, headers=auth, json={}, timeout=30).json()
thread_url = f"{threads_url}/{thread['id']}"

# 2. Nachricht senden — nenn ein Modell, das deine Organisation konfiguriert hat.
#    Die 202 nennt die Antwort, bevor das Modell ein Wort gesagt hat: behalte ihre ID.
sent = requests.post(
    f"{thread_url}/messages",
    headers=auth,
    json={"content": "In einem Satz: Was ist Tale?", "model": "<dein-modell>"},
    timeout=30,
)
sent.raise_for_status()
reply_id = sent.json()["messageId"]

# 3. Bis idle pollen. Ein Turn hat keine feste Frist, also begrenze die Schleife
#    selbst und stoppe einen Turn, den du aufgegeben hast.
deadline = time.monotonic() + 600
while True:
    poll = requests.get(f"{thread_url}/generation", headers=auth, timeout=30).json()
    if poll["status"] == "idle":
        break
    if time.monotonic() > deadline:
        requests.delete(f"{thread_url}/generation", headers=auth, timeout=30)
        raise SystemExit("der Turn ist nicht rechtzeitig abgeschlossen")
    time.sleep(2)
if poll.get("lastMessageId") != reply_id:
    raise SystemExit("der Turn ist nie gelaufen — prüfe das Projekt des Threads und deinen Zugriff")

# 4. Die Antwort über ihre ID lesen und prüfen, wie sie abgeschlossen wurde, bevor du ihr traust
reply = requests.get(f"{thread_url}/messages/{reply_id}", headers=auth, timeout=30).json()
if reply["status"] != "complete":
    raise SystemExit(f"Turn {reply['status']}: {reply.get('error', '')} {reply.get('errorCode', '')}")
print("".join(p["text"] for p in reply["parts"] if p.get("type") == "text"))
```

Das Senden antwortet mit **202**, bevor die Arbeit fertig ist, und nennt die Antwort: `messageId` ist die Assistenten-Nachricht, in der die Antwort landet, und der Poll antwortet `idle` mit `lastMessageId`, sobald dieser Turn abgeschlossen ist. Lies die Nachricht über ihre ID und prüfe `status`, bevor du irgendetwas ausgibst: `complete` trägt den Text, `failed` trägt `error` und `errorCode` (ein Modell, das der Tarif des Anbieters nicht abdeckt, ein aufgebrauchtes Guthaben — auch ein gelistetes Modell kann scheitern), und `cancelled` das, was vor einem Stopp gestreamt war. Ein Turn hat keine feste Frist, die Schleife begrenzt sich also selbst und bricht einen Turn, den sie aufgegeben hat, mit `DELETE .../generation` ab. Entfällt dein Zugriff oder verschiebst du den Thread, bevor der wartende Turn öffnet, verweigert der Worker ihn, und der Poll landet bei `idle` ohne deine ID; die [API-Referenz](/de/develop/api-reference) erklärt die Projektgrenzen.

## Schritt 4 — Einen Automatisierungslauf starten

Wähle ein aktives Projekt, das du bearbeiten darfst, und eine dafür bereitgestellte Automatisierung. Setze unten dessen `TALE_PROJECT_ID`. Das Beispiel verwendet `billing/dunning`: Namen mit `/` verwenden in URLs `__`, hier also `billing__dunning`. Start und Statusabfrage benennen dasselbe Projekt:

```bash
export TALE_PROJECT_ID="<projectId>"
RUN=$(curl -sS --compressed -X POST "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS --compressed "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$RUN?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq .status
```

Ein Live-Lauf verlangt deine Entwickler-Rolle und Bearbeitungsrechte auf das Projekt. Mit `{"mode": "mock"}` nutzt du deterministische Mocks; die Projektbearbeitungsrechte bleiben nötig. Eine 409 bedeutet, dass für diesen Aufruf keine bereitgestellte Version verfügbar ist. Hat die Automatisierung Projektbindungen, muss dein Projekt dazugehören; installiere sie dort bei Bedarf zuerst. Die [API-Referenz](/de/develop/api-reference) erklärt das Installieren und Läufe ohne Projekt.

## Wo das hingehört

Ein Skript ist der Weg, wenn die Datenebene JSON ist, kein Bildschirm — Cron-Jobs, CI-Checks, interne Portale. Der API-Schlüssel trägt deine Rolle, und alles, was echte Arbeit startet, antwortet 202 und gibt dir etwas zum Pollen.

Für eingehende Trigger — ein Drittsystem postet in eine Tale-Automatisierung — siehe [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook). Für einen modellgetriebenen Client statt eines Skripts öffnet der [MCP-Endpoint](/de/develop/mcp-endpoint) dieselbe Plattform als Tools. Für das volle Endpoint-Inventar und das Fehlermodell ist die [API-Referenz](/de/develop/api-reference) die einzige Quelle der Wahrheit.
