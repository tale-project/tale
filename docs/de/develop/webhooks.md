---
title: Webhooks
description: Eingehende Webhook-Trigger — poste an eine Token-URL und eine deployte Automatisierung läuft. Token-Handhabung, Rotation, Idempotenz und die Antwortcodes.
---

Eine Webhook-URL lässt ein externes System eine veröffentlichte Automation per HTTP-POST starten. Nutze sie für Ereignisse wie eine Bestellmeldung oder ein abgesendetes Formular. Das geheime Token in der URL autorisiert die Zustellung.

Die Antwort bestätigt die Annahme und nennt eine Lauf-ID. Sie enthält noch kein fertiges Automationsergebnis. Sowohl Webhook- als auch API-Schlüssel-Aufrufe starten Läufe asynchron. Für die erste Zustellung folge der [Webhook-Anleitung](/de/tutorials/developer/trigger-automation-via-webhook).

## Ein Trigger, durchgespielt

Binde einen Webhook-Trigger an eine Automatisierung — im Editor der Automatisierung oder mit `PUT /api/v1/automations/{name}/triggers` und `{"kind": "webhook"}` — und Tale antwortet einmalig mit dem Token der Trigger-URL. Danach kann jedes System einen Lauf starten:

Wähle die URL passend zum gewünschten Lauf. Für einen Projektlauf verwendest du wie im Beispiel `/api/projects/{id}/automations/webhook/{token}`. Die Automatisierung muss in diesem aktiven Projekt installiert sein; Projekt und Token müssen zur selben Organisation gehören. Das Token berechtigt zum Aufruf, kann aber kein ungebundenes Projekt auswählen. Für einen Lauf ohne Projekt verwendest du `/api/automations/webhook/{token}` mit einer Automatisierung ohne Projektbindungen. Eine gebundene Automatisierung verweigert diese globale URL mit **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED`. Der Abfrageparameter `projectId` ergibt auf beiden URLs **400**. Der Anfrageinhalt des Anbieters geht als Daten an die Automatisierung und wählt kein Projekt aus.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

Der Lauf erhält `{ "trigger": "webhook", "payload": <body> }`. Lies die Bestell-ID aus dem Beispiel über `input.payload.orderId`. Ein definiertes `inputs`-Schema beschreibt dieses umschließende Objekt. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen — manche Anbieter senden reinen Text — und alles über 256 KiB (262.144 Bytes) wird mit **413** abgelehnt — die Grenze zählt Bytes, während der Body eintrifft, eine zu große Zustellung wird also abgewiesen statt gepuffert. Polle den Lauf wie jeden anderen über `GET /api/v1/projects/{id}/runs/{runId}` mit einem API-Schlüssel, oder schau ihm im Produkt zu. Einen Lauf ohne Projekt liest du stattdessen mit `GET /api/v1/runs/{runId}`. Ein Projektlauf verlangt seine Projekt-URL und einen API-Schlüssel mit Leserechten auf dieses Projekt.

Das vollständige Antwortvokabular:

- **202** `{ "runId": "..." }` — der Lauf ist gestartet.
- **202** `{ "runId": "...", "duplicate": true }` — eine erneute Zustellung einer bereits angenommenen; `runId` ist der Lauf, den die erste gestartet hat, einen zweiten gibt es nicht.
- **400** — ein Abfrageparameter `projectId` (`INVALID_QUERY`) oder eine Eingabe, die nicht zum `inputs`-Schema der Automatisierung passt (`AUTOMATION_INPUT_INVALID`, jedes Problem unter `data.issues`); es startet kein Lauf.
- **403** `AUTOMATION_PROJECT_FORBIDDEN` — die Automatisierung kann im Projekt der URL nicht laufen: es existiert nicht, es ist archiviert, oder die Automatisierung ist dort nicht installiert. Die Antwort sagt nie, was davon zutrifft, und nennt die Automatisierung nicht — eine geleakte URL ist kein Orakel für die Projekt-IDs der Organisation.
- **404** — unbekanntes, deaktiviertes oder vertipptes Token. Die Antwort unterscheidet die Fälle nie — wer rät, lernt nichts. Die Tür nimmt nur `POST`: `GET`, `HEAD` und `OPTIONS` antworten mit derselben **404** — nie mit einer 405 und nie mit einer `Allow`-Kopfzeile —, das Verb ist also ebenfalls kein Orakel.
- **409** — `AUTOMATION_NOT_DEPLOYED` (deploye eine Version, deren Tests bestehen, und derselbe Aufruf läuft), `AUTOMATION_PROJECT_SCOPE_REQUIRED` (eine gebundene Automatisierung an der globalen URL — nimm ihre Projekt-URL) oder `AUTOMATION_DELIVERY_SCOPE_MISMATCH` (diese Zustellungs-ID wurde zuerst über einen anderen URL-Bereich angenommen).
- **413** — der Body übersteigt 256 KiB (262.144 Bytes).
- **429** — das Budget des Absenders oder des Triggers ist aufgebraucht; `Retry-After` nennt die Wartezeit. Die Budgets stehen unten.

## Das Token ist die Berechtigung

Es gibt keine Signatur und keinen Authorization-Header: das Token in der URL ist die ganze Berechtigung — behandle die URL wie ein Passwort. Tale speichert nur einen Hash und vergleicht in konstanter Zeit; der Klartext existiert genau einmal, in der Antwort, die ihn erzeugt hat.

URL verloren oder geleakt? Rotiere sie — `PUT /api/v1/automations/{name}/triggers` mit `{"kind": "webhook", "rotateToken": true}` erzeugt ein frisches Token und antwortet es einmalig; die alte URL stirbt sofort. Das Lösen des Triggers (`DELETE .../triggers` oder im Editor) widerruft sie ganz; die Versionen und die Laufhistorie der Automatisierung bleiben. Eine andere Art darüber zu binden tut dasselbe: Ein `PUT` mit `{"kind": "schedule", ...}` auf eine Automatisierung mit lebendem Webhook antwortet **200** mit `"revoked": "webhook"` neben dem Namen, die alte URL antwortet von diesem Moment an 404, und ein späteres erneutes Binden von `webhook` erzeugt ein anderes Token — lies also `revoked` bei jedem Bind, den du skriptest, und binde nie auf eine andere Art um, solange ein Partner noch an die URL postet. Den Trigger zu deaktivieren (`"enabled": false` oder der Schalter im Editor) legt die URL nur still: sie antwortet mit derselben **404** wie ein Token, das es nie gab, aber das Token ruht, es ist nicht tot — wer es wieder aktiviert, auch mit einem späteren `PUT`, das `enabled` bloß weglässt, erweckt dieselbe URL wieder. Nach einem Leak rotierst du oder löst den Trigger; verlass dich nie auf den Schalter.

## Idempotenz und Wiederholungen

Der Endpunkt erkennt wiederholte Zustellungen. Die Erkennung gilt jeweils für den Trigger und das Projekt seiner URL: Dieselbe Zustellungs-ID kann in jedem installierten Projekt einen Lauf starten. Auch vor einer gespeicherten Duplikatantwort prüft Tale, ob die Projektbindung noch besteht und das Projekt aktiv ist. Zwei Dinge identifizieren eine Zustellung:

- **Eine Zustellungs-ID, die du mitschickst.** Der erste dieser Header, der vorhanden ist, zählt: `Idempotency-Key`, `X-Idempotency-Key`, das `webhook-id` der Standard Webhooks, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. Die ID zählt nach ihrem Wert, egal welche dieser Kopfzeilen sie trug — ein Gateway, das die Zustellungs-ID eines Anbieters unter `Idempotency-Key` neu stempelt, liefert dieselbe Zustellung, keine zweite. Eine Wiederholung mit derselben ID innerhalb von 24 Stunden antwortet **202** mit dem ursprünglichen Lauf und `"duplicate": true` — egal, was im Body steht.
- **Der Anfrageinhalt selbst.** Ohne ID-Kopfzeile gilt ein byteidentischer Inhalt an derselben URL innerhalb von zwei Minuten als dieselbe Zustellung. Danach ist er eine neue. Ein Heartbeat, der alle paar Minuten denselben Inhalt sendet, startet also weitere Läufe.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# dieselbe Anfrage noch einmal, beliebig oft, in den nächsten 24 Stunden:
# → 202 { "runId": "run_a", "duplicate": true }
```

Wiederhole Netzwerkfehler und vorübergehende **5xx**-Antworten mit begrenzten, zunehmend längeren Pausen. Warte bei **429** mindestens die Zeit aus `Retry-After`. Behalte die Zustellungs-ID bei: Geht nur die Antwort verloren, entsteht innerhalb des Deduplizierungsfensters kein zweiter Lauf. Behebe bei **4xx** zuerst die Ursache: `AUTOMATION_NOT_DEPLOYED` braucht eine bereitgestellte Version, `AUTOMATION_PROJECT_SCOPE_REQUIRED` die Projekt-URL. Jede **202**-Antwort bestätigt die Annahme; den Erfolg erfährst du durch Abfragen des zurückgegebenen Laufs. Die Deduplizierung verhindert innerhalb ihres Zeitfensters einen zweiten Lauf für dieselbe Zustellung. Sie garantiert nicht, dass ein externes System jede Änderung genau einmal ausführt.

## Budgets

Nichts authentifiziert einen Absender, also ist die Tür doppelt budgetiert. Jede Absenderadresse — wie die vertrauenswürdigen Proxys des Deployments sie melden — bekommt 120 Zustellungen pro Minute mit einem Burst von 240, belastet, bevor das Token überhaupt geprüft wird; eine Flut geratener URLs kostet die Tür darüber hinaus also nichts. Jeder verifizierte Trigger bekommt 20 Zustellungen pro Minute mit einem Burst von 40: eine Zustellung kostet einen ganzen durablen Lauf, denselben Preis, den ein Start mit Schlüssel zahlt. Darüber hinaus antwortet die Tür mit **429**, `Retry-After` in ganzen Sekunden und dem gewöhnlichen Fehlerumschlag; backe zurück, wie es die [Rate-Limits](/de/develop/rate-limits)-Seite beschreibt, halte die Zustellungs-ID über die Versuche stabil, und die Wiederholung liest sich als das Duplikat, das sie ist, statt als zweiter Lauf.

## Webhook oder API-Schlüssel wählen

Nutze einen Webhook, wenn der Absender eine feste URL für Ereignisse unterstützt. Ein API-Schlüssel eignet sich für eigene Programme, die zusätzlich Automatisierungen auflisten, Projekte auswählen oder Ergebnisse lesen. Halte beide Zugangsdaten geheim. [Auslöser](/platform/automations/triggers) erklärt die Einrichtung in der Oberfläche; die [API-Referenz](/develop/api-reference) beschreibt Laufstarts und Statusabfragen mit API-Schlüssel.
