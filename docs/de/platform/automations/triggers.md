---
title: Trigger
description: Wie Automatisierungen starten — Zeitpläne, Webhooks, Ereignisse und manuelle Ausführungen.
---

Ein Trigger benennt den Moment, in dem eine Automatisierung startet, und den Input, mit dem sie startet. Tale liefert vier Arten — Zeitpläne, Webhooks, Ereignisse und manuelle Ausführungen — und eine Automatisierung kann jede Mischung davon tragen, sodass derselbe Fan-out auf einem nächtlichen Zeitplan und bei jedem eingehenden Webhook eines externen Systems laufen kann. Diese Seite ist für den Entwickler oder höher gedacht, der eine Automatisierung verdrahtet; die Konfigurationsoberfläche ist der Tab **Trigger** auf jeder Automatisierung.

## Zeitpläne

Ein Zeitplan lässt die Automatisierung nach der Uhr laufen. Öffne **Trigger > Zeitpläne > Zeitplan hinzufügen** und gib entweder direkt einen Cron-Ausdruck ein (`0 9 * * 1-5` läuft an Werktagen um 09:00) oder beschreibe in natürlicher Sprache, was du willst — „jeden Werktag um 9 Uhr" — und lass den KI-Assistenten übersetzen. Die fünf Schnellvorlagen (alle 5 Minuten, stündlich, täglich, wöchentlich, monatlich) decken die üblichen Fälle ab, ohne zu tippen.

Jeder Zeitplan läuft in **UTC**. Wenn dein Team in einer anderen Zeitzone denkt, rechne vor dem Speichern um — `0 9 * * 1-5` ist 09:00 UTC, das sind 10:00 in Zürich im Winter und 11:00 im Sommer. Das Feld **Workflow-Variablen** im Zeitplan-Formular lässt dich ein JSON-Payload pinnen, mit dem die Ausführung startet; es ist aus dem Eingabeschema der Automatisierung vorausgefüllt, sodass im Normalfall Werte angepasst werden statt die Struktur neu zu schreiben.

## Webhooks

Ein Webhook gibt der Automatisierung eine URL, auf die externe Aufrufer einen POST schicken können. Öffne **Trigger > Webhooks > Webhook hinzufügen** und Tale erzeugt eine URL der Form:

```text
https://<dein-tale-host>/api/workflows/wh/<token>
```

Das Token in der URL ist die Zugangsberechtigung — wer es besitzt, kann die Automatisierung feuern, behandle es also wie einen API-Schlüssel. Lege es im Secret-Store des aufrufenden Systems ab, rotiere es durch Löschen und Neu-Anlegen des Webhooks und prüfe es bei Auffälligkeiten über das [Audit-Log](/de/platform/admin/governance#audit-log). Es gibt keine separate Signatur-Kopfzeile.

Ein funktionierender Aufruf sieht so aus:

```bash
curl -X POST https://your-tale-host/api/workflows/wh/abc123def456 \
  -H "Content-Type: application/json" \
  -d '{"orderId": "ord_42", "amount": 199.00}'
```

Der Body wird als JSON geparst und steht der Automatisierung als Input zur Verfügung. Die Antwort ist `{ "status": "accepted", "workflowSlug": "..." }` bei einem frischen Aufruf. Schick eine Kopfzeile `X-Idempotency-Key` mit einem eindeutigen Wert mit, falls das aufrufende System dieselbe Anfrage wiederholen könnte — Tale erkennt den Retry und antwortet mit `{ "status": "duplicate", "executionId": "..." }`, statt einen zweiten Lauf zu starten.

Webhooks sind pro Quell-IP ratenbegrenzt, damit ein lärmender Aufrufer die Engine nicht erschöpft; Aufrufe jenseits des Limits geben `429` zurück. Die vollständige Anfrage-/Antwort-Referenz, inklusive Signaturen für das alte Tale-signierte Schema auf älteren Webhook-Formen, liegt unter [Webhooks](/de/develop/webhooks).

## Ereignisse

Ein Ereignis-Trigger lässt die Automatisierung laufen, wenn innerhalb von Tale etwas passiert. Öffne **Trigger > Ereignisse > Ereignis-Trigger hinzufügen**, wähle einen Ereignistyp und füge einen Filter hinzu, falls das Ereignis einen braucht.

| Ereignistyp                     | Feuert, wenn                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `customer.created`              | Ein Kundendatensatz wird angelegt (manuell, per Import oder über die API).   |
| `customer.updated`              | Ein Kundendatensatz wird geändert.                                           |
| `customer.deleted`              | Ein Kundendatensatz wird gelöscht.                                           |
| `conversation.created`          | Eine neue Konversation wird im Posteingang eröffnet.                         |
| `conversation.message_received` | Eine Antwort trifft auf einer bestehenden Konversation ein.                  |
| `conversation.closed`           | Eine Konversation wird als geschlossen markiert.                             |
| `workflow.completed`            | Eine andere Automatisierung beendet sich erfolgreich. Nach Quelle filterbar. |

Der Filter wird ausgewertet, bevor die Automatisierung startet — nicht passende Ereignisse werden übersprungen, ohne dass ein Lauf auf dem Tab **Ausführungen** zurückbleibt. Insbesondere das Ereignis `workflow.completed` ist der Weg, Automatisierungen zu verketten: eine endet, eine andere greift ihren Output auf und führt die Arbeit fort.

## Manuelle Ausführungen

Der Button **Automatisierung testen** im Editor und die Aktion **Ausführen** auf einer veröffentlichten Automatisierung feuern beide eine einmalige Ausführung mit dem Input, den du angibst. Manuelle Ausführungen teilen sich die Engine mit geplanten und Webhook-Ausführungen, tauchen aber auf dem Tab **Ausführungen** mit der Trigger-Quelle `manual` auf — nützlich, um eine neue Automatisierung vor dem Planen auszuprobieren, für einmalige Nachzieher und um ein Payload aus einem vergangenen Fehllauf nach dem Beheben des Fehlers erneut zu spielen.

## Mehrere Trigger auf einer Automatisierung

Eine Automatisierung mit zwei Triggern — etwa einem nächtlichen Zeitplan und einem eingehenden Webhook — läuft einmal pro feuerndem Trigger. Jeder Lauf hält fest, welcher Trigger ihn gestartet hat, sodass der Tab **Ausführungen** und das Metriken-Dashboard beide die Quellenverteilung zeigen, ohne die Spur pro Lauf zu verlieren. Trigger zu mischen ist der richtige Schritt, wenn dieselbe Arbeit nach Uhr und auf Abruf laufen muss; dupliziere die Automatisierung nicht, nur um einen anderen Trigger zuzuweisen.

## Wo das hingehört

Trigger sind die Grenze zwischen Tale und allem, was eine Automatisierung starten will. Die vier Arten decken nahezu jede Form von „jetzt starten" ab: regelmäßige Arbeit nach Zeitplan, reaktive Arbeit auf ein Ereignis, integrierte Arbeit auf einen Webhook, Ausnahmen auf eine manuelle Ausführung. Die entwicklungsseitige Referenz für die Webhook-URL-Form, Idempotenz und Ratenlimits ist [Webhooks](/de/develop/webhooks); die Spur pro Lauf, die jeder Trigger hinterlässt, sind die [Ausführungsprotokolle](/de/platform/automations/execution-logs).
