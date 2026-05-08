---
title: Eine Automatisierung per Webhook auslösen
description: Ein externes System per signiertem Webhook an einen Tale-Workflow anbinden.
---

Webhook-Trigger machen aus jedem externen Ereignis — einem Formular-Submit, einem Hook eines Upstream-Systems, einem CI/CD-Schritt — einen Tale-Workflow-Lauf. Der externe Dienst POSTet JSON an eine URL, die du kontrollierst; der Workflow startet mit dem Payload als Eingabe. Dieses Tutorial geht durch: minimalen Workflow anlegen, Webhook freilegen, signierte Anfrage senden, Zustellung prüfen. Die Referenz steht unter [Webhooks](/de/develop/webhooks) und [Triggers](/de/platform/automations/triggers).

Du brauchst Entwickler-Zugriff. Eine funktionierende Tale-Instanz, die vom externen Caller über HTTPS erreichbar ist, genügt — sonst nichts.

## Schritt 1 — Einen Workflow mit Webhook-Trigger anlegen

Öffne **Automatisierungen** in der Seitenleiste und klicke **Neuer Workflow**. Gib ihm einen Namen (`incoming-order-intake`) und öffne den **Start**-Schritt. Füge unter **Triggers** einen **Webhook-Trigger** hinzu. Tale erzeugt eine eindeutige URL der Form:

```text
https://<deine-tale-instanz>/api/webhooks/workflow/<workflow-id>
```

Setze ein **Webhook-Secret** — einen beliebigen hochentropischen String. Das ist das gemeinsame Geheimnis zum Signieren und Prüfen der Anfragen. Leg es im Secret-Manager deines Callers ab.

## Schritt 2 — Einen Schritt hinzufügen, der den Payload nutzt

Der Webhook-Body wird zur Workflow-Eingabe. Füge nach Start einen **LLM**-Schritt ein und referenziere die Eingabe im Prompt:

```text
Klassifiziere diesen Auftragseingang als dringend, normal oder Nachfassen:

{{ trigger.body | json }}
```

Siehe [Workflows](/de/platform/automations/workflows) für die komplette Schritt-Palette und Variablen-Syntax.

Speichere den Workflow und schalte **Veröffentlichen**, damit der Webhook aktiv ist.

## Schritt 3 — Den Webhook von außen aufrufen

Tale signiert jede eingehende Anfrage mit HMAC-SHA-256, sofern ein Secret gesetzt ist. Der Caller muss dasselbe tun; Tale weist unsignierte oder falsch signierte Anfragen ab.

```bash
BODY='{"customerId":"c-42","priority":"high","lines":3}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/.* //')"

curl -X POST "https://<deine-tale-instanz>/api/webhooks/workflow/<workflow-id>" \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: $SIG" \
  -d "$BODY"
```

Antwort:

```json
{ "executionId": "exec_..." }
```

Der POST kehrt sofort mit einer Execution-ID zurück — der Workflow selbst läuft asynchron.

## Schritt 4 — Den Lauf prüfen

Öffne den Workflow und klicke den Tab **Executions**. Filtere nach Execution-ID oder Zeitstempel; du siehst den Trigger-Payload, Eingabe und Ausgabe jedes Schritts und die Gesamtlaufzeit. Hier debuggst du Fehler. Siehe [Execution logs](/de/platform/automations/execution-logs) für die volle Ansicht.

## Schritt 5 — Retries und Idempotenz (Hardening für Produktion)

- **Retries:** Tale wiederholt Nicht-2xx-Antworten mit exponentiellem Backoff bis zu fünf Versuchen. Wenn dein Caller selbst retry't, muss jede Wiederholung denselben Body senden — sonst passt die Signatur nicht.
- **Idempotenz:** lass im Body eine stabile Request-ID mitlaufen (`requestId`). Der erste Workflow-Schritt kann darauf verzweigen, ob diese ID schon gesehen wurde, damit doppelte Zustellungen keine doppelten Seiteneffekte verursachen.
- **Secret-Rotation:** ändere das Webhook-Secret in der Tale-UI, roll es in der Caller-Konfig aus, dann deploy den Caller neu. Ein kurzer Overlap ist unvermeidbar; kurzzeitig fail-open ist akzeptabel, wenn das passt.

## Troubleshooting

- **401 invalid signature** — der signierte Body ist nicht byte-identisch zu dem, was gesendet wurde (oft durch JSON-Pretty-Printing-Middleware).
- **404 workflow not found** — Workflow wurde gelöscht oder seine ID hat sich geändert; kopiere die URL erneut aus dem Start-Schritt.
- **5xx** — prüf den Tab Executions des Workflows auf einen scheiternden Schritt. Der HTTP-Response-Body enthält die Fehlerzusammenfassung.

## Weiter

- Quer-Referenz mit [Webhooks](/de/develop/webhooks) für Signaturprüfungs-Codebeispiele in Node und Python.
- Agent-Webhooks statt Workflow-Webhook nutzen, wenn du ohne die Automatisierungsschicht direkt eine Agent-Antwort willst: [Webhooks — Agent webhooks](/de/develop/webhooks#agent-webhooks).
