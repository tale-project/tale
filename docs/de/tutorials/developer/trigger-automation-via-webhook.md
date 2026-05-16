---
title: Eine Automatisierung per Webhook auslösen
description: Ein externes System per Token-Webhook an einen Tale-Workflow anbinden.
---

Webhook-Trigger verwandeln jedes externe Ereignis — eine Formular-Einreichung, einen Upstream-Hook, einen CI-Schritt, einen Slack-Slash-Command — in einen Tale-Workflow-Lauf. Der externe Dienst sendet JSON per POST an eine URL, die ein eindeutiges Token enthält; das Token ist die Anmeldeberechtigung, und der Workflow startet mit diesem JSON als Eingabe. Dieses Tutorial führt das Erstellen eines minimalen Workflows durch, exponiert seinen Webhook, sendet eine Anfrage und verifiziert die Zustellung. Die Referenz liegt in [Webhooks](/de/develop/webhooks) und [Triggers](/de/platform/automations/triggers).

Das Ergebnis am Ende ist ein extern aufrufbarer Workflow, den du von jedem HTTPS-Client treiben kannst.

## Bevor du beginnst

Du brauchst eine Rolle, die Workflows erstellen und veröffentlichen darf — Inhaber, Admin oder Entwickler qualifizieren sich. Du brauchst außerdem eine Tale-Instanz, die per HTTPS erreichbar ist von dort, wo das externe aufrufende System läuft; für einen lokalen Test ist der Client dein Laptop, in Produktion das Upstream-System, das den POST macht. Kein externes Dienstkonto, kein API-Schlüssel — das Webhook-Token ist seine eigene Anmeldeberechtigung.

## Schritt 1 — Einen Workflow mit Webhook-Trigger erstellen

Öffne **Automatisierungen** in der Seitenleiste und klicke **Workflow erstellen**. Gib ihm einen Slug (`incoming-order-intake`) — Slugs sind URL-tauglich und faktisch dauerhaft, da die Webhook-URL nichts anderes enthält, das den Workflow identifiziert. Öffne das **Triggers**-Panel und füge einen **Webhook**-Trigger hinzu. Tale generiert eine eindeutige URL der Form:

```text
https://<deine-tale-instanz>/api/workflows/wh/<TOKEN>
```

Das Token besteht aus 64 Hex-Zeichen und ist die einzige Anmeldeberechtigung — wer die URL hält, kann Ereignisse an den Workflow posten. Behandle sie, wie du einen API-Schlüssel behandeln würdest: in den Secret-Manager des aufrufenden Systems, niemals committen.

Der Schritt hat funktioniert, wenn das Trigger-Panel die URL und einen „Kopieren"-Knopf daneben zeigt.

## Schritt 2 — Die Payload in einem Schritt referenzieren

Der POST-Body wird zur Workflow-Eingabe, adressierbar als `{{ trigger.body }}` in jedem Schritt. Füge nach dem Trigger einen **LLM**-Schritt hinzu und referenziere die Eingabe im Prompt:

```text
Klassifiziere diese Order-Aufnahme als dringend, normal oder Follow-up.

Payload:
{{ trigger.body | json }}
```

Der `| json`-Filter rendert den ganzen Body als JSON-String, den das Modell lesen kann. Die volle Filter- und Variablen-Syntax liegt in [Workflows](/de/platform/automations/workflows).

Der Schritt hat funktioniert, wenn die Vorschau des Schritts den Prompt mit dem noch sichtbaren Platzhalter zeigt (der Body löst zur Ausführungszeit auf, nicht zur Vorschauzeit).

## Schritt 3 — Veröffentlichen und den Webhook aufrufen

Speichere den Workflow und schalte **Veröffentlichen** ein, damit der Trigger live ist; unveröffentlichte Workflows weisen Webhook-POSTs mit `403` ab. Rufe dann die URL aus deinem Client auf:

```bash
curl -X POST "https://<deine-tale-instanz>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

Der POST liefert sofort `200 OK` mit einem kleinen Body zurück:

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

Der Workflow selbst läuft asynchron. Tale plant den Lauf auf einer Hintergrund-Queue; das aufrufende System wartet nie auf den Output des Workflows.

Der Schritt hat funktioniert, wenn der Response-Status `200` ist und der Body der Form oben entspricht.

## Schritt 4 — Den Lauf verifizieren

Öffne den **Ausführungen**-Tab des Workflows, um den Lauf zu sehen. Jede Zeile zeigt die Trigger-Payload, Eingabe und Ausgabe jedes Schritts und die Gesamt-Laufzeit. Filtere nach Zeitstempel oder Status, um einen bestimmten Lauf zu finden. Dieser Tab ist die kanonische Debug-Oberfläche — wenn ein Schritt fehlschlägt, stehen Fehlermeldung und Stack-Trace hier, nicht in der HTTP-Antwort.

Der Schritt hat funktioniert, wenn der Ausführungen-Tab eine neue Zeile mit der gesendeten Payload und grünem `succeeded`-Status zeigt.

## Schritt 5 — Idempotenz für sichere Wiederholungen ergänzen

Wenn dein Client von sich aus wiederholt — flackerndes Netzwerk, ein CI-Schritt, der zweimal läuft, ein Stripe-Webhook, der mehr als einmal zustellt — lösen doppelte POSTs doppelte Workflow-Läufe aus. Sende eine stabile `X-Idempotency-Key`-Kopfzeile, um Wiederholungen sicher zu machen; Tale erkennt die zweite Zustellung und liefert die ursprüngliche Ausführung zurück, ohne einen neuen Lauf zu starten.

```bash
curl -X POST "https://<deine-tale-instanz>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-2026-05-15-42" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

Eine doppelte Zustellung liefert:

```json
{ "status": "duplicate", "executionId": "exec_..." }
```

Wähle einen Schlüssel, der über Wiederholungen hinweg stabil und über verschiedene Ereignisse hinweg eindeutig ist — die meisten Clients nutzen die eigene Ereignis-ID des Upstream.

Der Schritt hat funktioniert, wenn ein zweiter POST mit demselben Schlüssel `status: "duplicate"` zurückgibt und keine neue Zeile in **Ausführungen** erscheint.

## Fehlerbehebung

- **404 Invalid webhook token** — das Token in der URL ist falsch, oder der Trigger wurde gelöscht und neu erstellt (Neugenerierung prägt ein neues Token). Kopiere die URL erneut aus dem Triggers-Panel des Workflows.
- **403 Webhook is disabled** — der Toggle des Triggers ist aus, oder der Workflow selbst ist nicht veröffentlicht. Schalte beides im Triggers-Panel des Workflows ein.
- **400 Invalid JSON payload** — der Anfrage-Body ist kein gültiges JSON, oft weil Middleware auf der Client-Seite Anführungszeichen entfernt oder einen formularkodierten Body gesendet hat. Sende rohes JSON mit `Content-Type: application/json`.
- **429 Rate limit exceeded** — die Client-IP hat das Pro-IP-Webhook-Limit überschritten. Drossle den Client oder verteile auf mehr Workflows.

## Wo das einsetzt

Du hast jetzt ein externes System, das einen Tale-Workflow treiben kann: einen HTTPS-Endpunkt, eine Token-basierte Anmeldeberechtigung, einen asynchronen Lauf und einen Ausführungen-Tab, in dem jeder Schritt debugbar ist. Dieselbe Form — Token-in-URL, sofortige `202`-artige Antwort, asynchroner Lauf — gilt für jede Quelle, die du anschließen kannst, vom Stripe-Webhook über einen CI-Job bis zum Slack-Slash-Command, indem du nur den Client änderst.

Brauchst du eine direkte Agent-Antwort statt eines Workflow-Laufs, gilt dasselbe Protokoll für Agent-Webhooks unter [Webhooks — Agent-Webhooks](/de/develop/webhooks#agent-webhooks). Für ausgehende Webhooks aus Tale in deinen eigenen Dienst deckt [Webhooks](/de/develop/webhooks) die Empfänger-Seite ab.
