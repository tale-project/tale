---
title: Webhooks
description: Eingehende Webhook-Trigger — poste an eine Token-URL und eine deployte Automatisierung läuft. Token-Handhabung, Rotation, Idempotenz und die Antwortcodes.
---

Ein Webhook-Trigger macht aus einem POST deines Systems einen Lauf einer deployten Automatisierung — kein API-Schlüssel, kein SDK, nur eine URL, die Tale beim Binden des Triggers erzeugt. Das ist die richtige Naht, wenn der Aufrufer ein Drittprodukt ist — ein Zahlungsanbieter, ein Formular-Tool, ein CI-Job — das nur einen HTTP-Request an eine URL feuern kann, die du ihm gibst.

Lies das, wenn du ein externes System verdrahtest, das Automatisierungen starten soll. Für Aufrufe, bei denen du einen Wert zurückwillst oder einen API-Schlüssel hast, ist die [API-Referenz](/de/develop/api-reference) die synchrone Hälfte.

## Ein Trigger, durchgespielt

Binde einen Webhook-Trigger an eine Automatisierung — im Editor der Automatisierung oder mit `PUT /api/v1/automations/{name}/triggers` und `{"kind": "webhook"}` — und Tale antwortet einmalig mit dem Token der Trigger-URL. Danach kann jedes System einen Lauf starten:

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

Der Body wird zum Input des Laufs. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen — manche Anbieter senden reinen Text — und alles über 256 KB wird mit **413** abgelehnt. Polle den Lauf wie jeden anderen über `GET /api/v1/runs/{runId}` mit einem API-Schlüssel, oder schau ihm im Produkt zu.

Das vollständige Antwortvokabular:

- **202** `{ "runId": "..." }` — der Lauf ist gestartet.
- **404** — unbekanntes, deaktiviertes oder vertipptes Token. Die Antwort unterscheidet die Fälle nie — wer rät, lernt nichts.
- **409** `{ "error": "automation has no deployed version" }` — deploye eine Version, deren Tests bestehen, und derselbe Aufruf läuft.
- **413** — der Body übersteigt 256 KB.

## Das Token ist die Berechtigung

Es gibt keine Signatur und keinen Authorization-Header: das Token in der URL ist die ganze Berechtigung — behandle die URL wie ein Passwort. Tale speichert nur einen Hash und vergleicht in konstanter Zeit; der Klartext existiert genau einmal, in der Antwort, die ihn erzeugt hat.

URL verloren oder geleakt? Rotiere sie — `PUT /api/v1/automations/{name}/triggers` mit `{"kind": "webhook", "rotateToken": true}` erzeugt ein frisches Token und antwortet es einmalig; die alte URL stirbt sofort. Das Lösen des Triggers (`DELETE .../triggers` oder im Editor) widerruft sie ganz; die Versionen und die Laufhistorie der Automatisierung bleiben.

## Idempotenz und Wiederholungen

Der Trigger-Endpoint dedupliziert nicht: ein wiederholter POST startet einen zweiten Lauf. Sicher machen Wiederholungen der Lauf selbst — ein Live-Lauf checkpointet jeden abgeschlossenen Knoten, ein nach einer Unterbrechung fortgesetzter Lauf wiederholt also nie einen Effekt, den er schon erzeugt hat. Wo ein _doppelter Lauf_ trotzdem falsch wäre, gib deinen eigenen Deduplizierungs-Schlüssel im Payload mit und verzweige darauf im ersten Knoten der Automatisierung.

Wiederholen ist Sache des Aufrufers: die Antwort sagt dir, ob der Lauf _gestartet_ ist, nicht ob er gelungen ist. Ein vernünftiger Aufrufer wiederholt Nicht-2xx-Antworten mit Backoff und behandelt 202 als erledigt.

## Wo das hingehört

Der Webhook ist der Weg hinein ohne Schlüssel; alles andere läuft über einen API-Schlüssel. Die [Trigger-Seite](/de/platform/automations/triggers) behandelt die Produktseite — Zeitpläne, Events und Webhooks, wie der Automatisierungs-Editor sie zeigt. Die [API-Referenz](/de/develop/api-reference) behandelt das Starten von Läufen mit Schlüssel (`POST /api/v1/automations/{name}/runs`) — die bessere Naht, wenn der Aufrufer dein eigener Code ist.
