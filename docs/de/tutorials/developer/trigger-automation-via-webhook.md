---
title: Einen Workflow per Webhook auslösen
description: Erzeug in einem Tale-Workflow einen Trigger-Schlüssel und POSTe von einem externen System auf die Trigger-URL, um mit Idempotenz einen Lauf zu starten.
---

Ein Webhook-Trigger macht aus einem Tale-Workflow etwas, das ein externes System per POSTen von JSON auslöst. Tale verifiziert das Bearer-Token, speichert den Idempotenz-Schlüssel, startet einen Lauf und gibt eine Execution-ID zurück — dieselbe Form, die jeder eingehende Webhook braucht, um wiederholungssicher zu sein. Dieser Spaziergang führt einen neuen Workflow von „ich will ihn von aussen feuern" zu „ein Order-Event POSTet und der Workflow läuft" auf einer Instanz.

Du brauchst eine Developer-Rolle in der Org, einen vorhandenen Workflow (oder den leeren Starter) und eine Shell mit `curl`. Der volle Webhook-Vertrag — Signierung, Idempotenz, Wiederholungen — lebt in [Webhooks](/de/develop/webhooks); dieser Spaziergang ist die kleinste End-to-End-Nutzung der eingehenden Seite.

## Bevor du beginnst

Bestätige zwei Dinge. Der Workflow, den du auslöst, existiert und ist veröffentlicht — Entwürfe lassen sich nicht triggern. Deine Rolle ist mindestens Developer — Trigger-Schlüssel zu erzeugen ist auf Developer und höher beschränkt. Hast du noch keinen Workflow, ist der kanonisch kleine „log das Payload in den Execution-Record"; erstell ihn über [Workflow mit Genehmigungen](/de/tutorials/editor/workflow-with-approvals) und entferne den Genehmigungs-Schritt für diesen Spaziergang.

## Schritt 1 — Einen Webhook-Trigger an den Workflow binden

Der erste Zug ist, einen Webhook-Trigger an den Workflow zu binden. Ohne Trigger lässt sich der Workflow nur aus der UI aufrufen; mit einem bekommt er eine URL und einen Schlüssel.

Öffne den Workflow-Editor, klick oben auf den Trigger-Knoten und wähl **Webhook**. Gib dem Trigger einen Namen (`order-created`) — die von Tale generierte URL nutzt diesen Namen. Speichern. Das rechte Panel zeigt jetzt zwei Dinge, die du brauchst: die **Trigger-URL** und den **Trigger-Schlüssel**.

Tale zeigt den Trigger-Schlüssel einmal, wie jeden anderen API-Schlüssel. Kopier ihn; du wirst ihn nicht mehr sehen.

```bash
export TALE_TRIGGER_KEY="tk_trigger_..."
export TALE_TRIGGER_URL="https://your-host.example.com/api/v1/workflows/triggers/order-created"
```

## Schritt 2 — Ein Payload per curl POSTen

Eine Trigger-URL ist ein normaler POST-Endpoint. Der Body wird zum Input des ersten Schritts des Workflows; die Antwort trägt die Execution-ID, damit der Aufrufer Läufe korrelieren kann.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Authorization: Bearer $TALE_TRIGGER_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Eine 200 gibt `{ "executionId": "exe_..." }` zurück. Der Workflow läuft jetzt asynchron; öffne den Tab **Executions** des Workflows und du solltest einen laufenden Run mit deinem Payload als Trigger-Input sehen.

Eine 401 heisst, der Schlüssel ist falsch; eine 404 heisst, der Trigger-Name in der URL passt zu keinem veröffentlichten Workflow; eine 422 heisst, der Workflow ist archiviert oder der Trigger deaktiviert.

## Schritt 3 — Wiederholungen mit Idempotenz absichern

Externe Systeme wiederholen bei Timeouts und 5xx-Fehlern; ohne Idempotenz feuert eine Wiederholung den Workflow doppelt. Die Kopfzeile `Idempotency-Key` aus Schritt 2 ist die Lösung: Tale speichert den Schlüssel 24 Stunden und gibt bei jeder Wiederholung mit demselben Schlüssel die ursprüngliche Execution zurück.

Test das, indem du dieselbe curl-Anfrage oben erneut laufen lässt. Die Antwort trägt dieselbe `executionId` wie der erste Call, und der Tab **Executions** zeigt weiterhin einen Lauf. Ändere den Schlüssel auf `order-12346` und curl erneut — der feuert einen zweiten Lauf.

Das Quell-System muss pro logischem Event einen stabilen, deterministischen Schlüssel verwenden. Ein verbreitetes Muster ist `<event-type>-<event-id>`; nutze nie eine zur Wiederholungszeit generierte zufällige UUID, sonst erzeugt jede Wiederholung einen neuen Lauf.

## Wo das eingesetzt wird

Webhook-Trigger sind die eingehende Hälfte von Tales Workflow-API — die Naht, in die dein CRM, dein Order-System oder dein Monitoring-Tool POSTet. Nimm sie für „das ist in unserer Welt passiert, bitte lass dazu einen Tale-Workflow laufen"; greif zur [API-Referenz](/de/develop/api-reference), wenn du stattdessen eine synchrone Antwort willst.

Für die ausgehende Hälfte — Tale POSTet auf deine URL, wenn ein Tale-Event passiert — und für den vollen Signier- und Wiederholungs-Vertrag siehe [Webhooks](/de/develop/webhooks). Die Workflow-seitige Konfiguration des Triggers lebt auf der Seite [Workflow-Konzepte](/de/platform/workflows/concepts).
