---
title: Tale aus einem Skript aufrufen
description: Erstelle einen API-Schlüssel, wähle ein verfügbares Modell und gib eine fertige Antwort mit Python aus.
---
Sende eine Nachricht an Tale und gib die Antwort im Terminal aus. Diese Anleitung erstellt einen persönlichen Chat-Thread, prüft jede HTTP-Antwort und wartet auf den Abschluss. Du brauchst Python 3 mit seiner Standardbibliothek und curl; zusätzliche Python-Pakete sind nicht nötig.

## Zugriff vorbereiten

Du brauchst eine erreichbare Tale-Instanz, die Berechtigung zum Erstellen eines API-Schlüssels, den Slug deiner Organisation und ein direkt aufrufbares Modell. Admins und Entwickler können Schlüssel erstellen. Ein aufgelistetes Modell kann trotzdem scheitern, wenn dem Anbieterkonto Guthaben oder die nötige Freischaltung fehlt.

Öffne **Einstellungen > API > REST**, wähle **API-Schlüssel erstellen**, vergib einen Namen wie `Reporting script` und wähle ein Ablaufdatum. Wähle **Schlüssel erstellen** und kopiere den einmal angezeigten Wert. Lade ihn über deinen Secret-Manager oder eine private Shell-Umgebung in `TALE_API_KEY`; speichere ihn weder im Python-Skript noch in Git.

<Frame caption="Gib dem Schlüssel einen erkennbaren Zweck, damit du ihn gezielt widerrufen kannst.">

![Im Dialog zum Erstellen eines API-Schlüssels legst du vor der Erstellung einen Namen und die Gültigkeitsdauer fest.](/images/get-started/settings-api-keys.webp)

</Frame>

Setze die folgenden nicht geheimen Verbindungswerte. Verwende den Slug, nicht die Organisations-ID. Sende die Kopfzeile bei jeder Anfrage, damit das Ziel auch nach dem Beitritt zu einer weiteren Organisation eindeutig bleibt.

```bash
export TALE_BASE_URL="https://your-host.example.com"
export TALE_ORG_SLUG="your-org-slug"
export TALE_MODEL="model-id-from-the-catalog"
```

## Ein aufrufbares Modell finden

Liste die für den Schlüsselinhaber verfügbaren Modelle auf:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Eine `200`-Antwort enthält ein Array `models`. Setze `TALE_MODEL` auf die `id` eines Eintrags. Erscheint dieselbe ID bei mehreren Anbietern, setze zusätzlich `TALE_PROVIDER` auf den gewünschten `providerSlug`. Ein leeres Array bedeutet, dass dieses Konto kein direkt aufrufbares Modell hat. Bitte einen Admin, Zugangsdaten und Modellzugriff zu prüfen.

## Eine Nachricht senden und abwarten

Speichere den Code als `tale-chat.py` und starte `python3 tale-chat.py` in der vorbereiteten Umgebung. Das Skript erstellt einen Eintrag in deinem persönlichen Chatverlauf und kann Kosten für Modellnutzung verursachen.

```python
import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ["TALE_BASE_URL"].rstrip("/")
headers = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
    "Content-Type": "application/json",
}

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(f"{base}/api/v1{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error

models = request("GET", "/models")["models"]
model_id = os.environ["TALE_MODEL"]
provider = os.environ.get("TALE_PROVIDER")
candidates = [m for m in models if m["id"] == model_id
              and (not provider or m["providerSlug"] == provider)]
if len(candidates) != 1:
    raise SystemExit("Choose one available model/provider pair from GET /api/v1/models")

thread = request("POST", "/threads", {})
path = f"/threads/{thread['id']}"
sent = request("POST", f"{path}/messages", {
    "content": "In one sentence: what is Tale?",
    "model": candidates[0]["id"],
    "providerSlug": candidates[0]["providerSlug"],
})
reply_id = sent["messageId"]
deadline = time.monotonic() + 600
while True:
    generation = request("GET", f"{path}/generation")
    if generation["status"] == "idle":
        break
    if time.monotonic() >= deadline:
        request("DELETE", f"{path}/generation")
        raise SystemExit("Stopped the turn after the local 10-minute deadline")
    time.sleep(2)

if generation.get("lastMessageId") != reply_id:
    raise SystemExit("The accepted turn did not finish in this thread scope")
reply = request("GET", f"{path}/messages/{reply_id}")
if reply["status"] != "complete":
    raise SystemExit(f"Turn {reply['status']}: {reply.get('errorCode', '')} {reply.get('error', '')}")
if reply.get("finishReason") == "length":
    raise SystemExit("The reply reached its output limit; inspect it before using it")
text = "".join(part["text"] for part in reply["parts"] if part.get("type") == "text")
if not text:
    raise SystemExit("The turn completed without a text answer")
print(text)
```

Der Nachrichtenendpunkt liefert `202` und eine `messageId`, bevor die Generierung endet. Der Zustand `idle` bestätigt nur, dass der Vorgang beendet ist. Das Skript liest danach genau diese Assistentennachricht und prüft Status, Ausgabelimit und Text vor der Ausgabe.

<Tip>

Bewahre für eine weiterführende Integration die Thread-ID auf. Sende spätere Nachrichten an denselben Thread, um den Gesprächskontext zu erhalten. Ein neuer Thread bei jedem Aufruf beginnt ein neues Gespräch.

</Tip>

## Fehlgeschlagene Anfragen eingrenzen

| Ergebnis | Nächste Aktion |
| --- | --- |
| `401` | Prüfe, ob der Schlüssel abgelaufen, widerrufen oder falsch kopiert ist. |
| `400` mit `ORG_SLUG_REQUIRED` | Gib den Slug der gewünschten Organisation an. |
| `403` | Prüfe Mitgliedschaft und Rechte des Schlüsselinhabers. |
| Kein passendes Modell | Lies `/models` erneut und wähle das genaue Paar aus Modell-ID und Anbieter. |
| `429` | Beachte `Retry-After`; siehe [Ratenlimits](/de/develop/rate-limits). |
| Nachrichtenstatus `failed` | Prüfe `errorCode` und behebe Konto- oder Modellprobleme vor einem erneuten Versuch. |
| Netzwerkzeitüberschreitung | Prüfe Instanz und vorhandenen Thread, bevor du erneut sendest. |

Ein POST mit Zeitüberschreitung kann bereits angenommen worden sein. Sende ihn nicht ungeprüft erneut, sondern lies zuerst Generierungsstatus und Nachrichten des Threads.

Die Frist von zehn Minuten ist eine Entscheidung dieses Beispiels, kein Serverlimit. Ein eingereihter Antwortlauf kann hinter anderen Clients warten; Reasoning kann das Modell schon vor sichtbarem Text aktiv halten. Das Skript wiederholt einen fehlgeschlagenen Versand nicht automatisch. Für unbeaufsichtigte Wiederholungen speicherst du einen `Idempotency-Key` mit 1–255 druckbaren ASCII-Zeichen zusammen mit dem Body, verwendest nach einer verlorenen Antwort beides erneut und beachtest bei `429` den Header `Retry-After`. Siehe [Nachrichten sicher erneut senden](/de/develop/api-reference#eine-nachricht-sicher-erneut-senden).

## Die Integration erweitern

Verwende für Projektgespräche durchgehend `/api/v1/projects/{id}/threads`: beim Erstellen sowie für Nachrichten, Generierungsstatus und Lesezugriffe. Du brauchst Zugriff auf das aktive Projekt. Ein `projectId` im Inhalt einer persönlichen Thread-Anfrage ändert den Geltungsbereich nicht.

Die [API-Referenz](/de/develop/api-reference) beschreibt Projektzugriff, Nachrichtenteile und Automationsläufe. Für Arbeit, die durch externe Ereignisse startet, lies [Eine Automation per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook).
