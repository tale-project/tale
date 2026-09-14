---
title: Webhooks
description: Eingehende Webhook-Trigger — poste an eine Token-URL und eine deployte Automatisierung läuft. Token-Handhabung, Rotation, Idempotenz und die Antwortcodes.
---

Über einen Webhook startet ein externes System eine bereitgestellte Automatisierung, indem es an eine geheime URL sendet. Das eignet sich für Bestellereignisse, Formularübermittlungen und andere Benachrichtigungen mit festem Ziel. `202` bestätigt die Annahme und liefert eine Lauf-ID, aber noch keinen abgeschlossenen Lauf.

Für die erste Einrichtung nutze das [Webhook-Tutorial](/de/tutorials/developer/trigger-automation-via-webhook). Diese Referenz beschreibt Zustellung, Geltungsbereich, Token-Verwaltung und Wiederholungen.

## Ein Trigger, durchgespielt

### Eine bereitgestellte Automatisierung vorbereiten

Speichere eine Automatisierung, deren Tests bestehen, und stelle sie bereit. Binde im Editor einen Webhook oder sende mit einem berechtigten API-Schlüssel `PUT /api/v1/automations/{name}/triggers` und `{"kind":"webhook"}`. Kopiere das neu erzeugte Token sofort; es wird nur einmal ausgegeben.

Wähle die URL passend zum Geltungsbereich:

| Gewünschter Lauf | URL | Voraussetzung |
| --- | --- | --- |
| Projektlauf | `/api/projects/{id}/automations/webhook/{token}` | Aktives Projekt in der Organisation des Tokens, mit installierter Automatisierung |
| Organisationslauf | `/api/automations/webhook/{token}` | Automatisierung ohne Projektbindungen |

Eine projektgebundene Automatisierung lehnt die globale URL mit `409 AUTOMATION_PROJECT_SCOPE_REQUIRED` ab. Hänge keinen Query-Parameter `projectId` an: Beide URLs liefern dafür `400 INVALID_QUERY`. Ein Feld im Anbieter-Body ist Eingabe, keine Projektauswahl.

### Eine Zustellung senden

Hinterlege die vollständige geheime URL über die sichere Konfiguration des Senders in `TALE_WEBHOOK_URL`. Die folgende Anfrage verwendet eine stabile ID für ein fachliches Ereignis:

```bash
curl --fail-with-body --request POST "$TALE_WEBHOOK_URL" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: order-12345-paid' \
  --data '{"orderId":"12345","status":"paid"}'
```

Die Annahme liefert HTTP `202` mit der Form `{"runId":"..."}`. Speichere die Lauf-ID zusammen mit der Zustellungs-ID des Senders. Tale übergibt den Body in dieser Hülle:

```json
{
  "trigger": "webhook",
  "payload": { "orderId": "12345", "status": "paid" }
}
```

Lies die Bestellung über `input.payload.orderId`. Ein deklariertes `inputs`-Schema muss diese Hülle beschreiben. Ein Body ohne gültiges JSON wird als Text in `payload` übergeben. Die Grenze beträgt 256 KiB (262.144 Bytes), während des Empfangs gezählt; größere Anfragen erhalten `413`.

### Das Ergebnis verfolgen

| Geltungsbereich | Authentifizierte Abfrageroute |
| --- | --- |
| Projekt | `GET /api/v1/projects/{id}/runs/{runId}` |
| Organisation | `GET /api/v1/runs/{runId}` |

Frage mit einem API-Schlüssel ab, dessen Inhaber den Bereich lesen darf, oder öffne den Lauf in Tale. Das Webhook-Token erlaubt Zustellungen, aber keine REST-Ergebnisabfragen. Melde den Vorgang erst als erfolgreich, wenn der Lauf einen entsprechenden Endstatus erreicht hat.

### Antworten auf Zustellungen auswerten

| Status | Code/Ergebnis | Nächster Schritt |
| --- | --- | --- |
| `202` | `runId` | Angenommen; Lauf verfolgen |
| `202` | `runId`, `duplicate: true` | Bereits angenommen; ursprünglichen Lauf verfolgen, kein neuer Lauf |
| `400` | `INVALID_QUERY` | `projectId` aus dem Query-String entfernen |
| `400` | `AUTOMATION_INPUT_INVALID` | Hülle und Schema anhand von `data.issues` korrigieren |
| `403` | `AUTOMATION_PROJECT_FORBIDDEN` | Aktives Projekt, richtige Organisation und Installation prüfen |
| `404` | Unbekanntes, deaktiviertes oder falsch geschriebenes Token; auch jede Methode außer POST | Gespeicherte URL und Triggerstatus prüfen |
| `409` | `AUTOMATION_NOT_DEPLOYED` | Version mit erfolgreichen Tests bereitstellen |
| `409` | `AUTOMATION_PROJECT_SCOPE_REQUIRED` | URL des Installationsprojekts verwenden |
| `409` | `AUTOMATION_DELIVERY_SCOPE_MISMATCH` | Geltungsbereich der ursprünglichen Zustellungs-ID prüfen |
| `413` | Body zu groß | Nutzdaten auf unter 256 KiB reduzieren |
| `429` | Sender- oder Triggerbudget erschöpft | Mindestens `Retry-After` abwarten |

Abgelehnte Eingaben erstellen keinen Lauf. Projektfehler unterscheiden absichtlich nicht zwischen fehlendem, archiviertem oder nicht passend installiertem Projekt und nennen keinen Automatisierungsnamen. `GET`, `HEAD` und `OPTIONS` erhalten dieselbe `404` wie ein ungültiges Token, ohne `Allow`-Header.

## Das Token ist die Berechtigung

Das Geheimnis in der URL berechtigt zur Zustellung. Dieser Endpunkt prüft keine HMAC-Signatur des Anbieters und verwendet keinen `Authorization`-Header. Die URL gehört nicht in öffentliche Fehlermeldungen, gemeinsam genutzte Logs oder Screenshots. Tale speichert ihren Hash und vergleicht in konstanter Zeit; Klartext wird nur beim Erzeugen ausgegeben.

| Änderung | Auswirkung auf das Token |
| --- | --- |
| Webhook per `PUT` mit `rotateToken: true` | Neues Token einmalig ausgegeben; alte URL sofort ungültig |
| Trigger löschen/lösen | Token widerrufen; Versionen und Laufhistorie bleiben |
| Webhook durch Zeitplan/Ereignis ersetzen | Token widerrufen; Antwort enthält `revoked: "webhook"` |
| Danach erneut einen Webhook binden | Neues Token; das ursprüngliche kehrt nicht zurück |
| `enabled: false` setzen | URL mit `404` ausgesetzt, Token bleibt erhalten |
| Wieder aktivieren, auch durch späteres `PUT` ohne `enabled` | Dieselbe ausgesetzte URL wird wieder aktiv |

<Warning>

Rotiere oder entferne den Trigger nach einem Leak. Deaktivieren setzt den Zugriff nur vorübergehend aus. Stimme eine Rotation mit dem Sender ab und ersetze dessen gespeicherte URL, bevor die Zustellung weitergeht.

</Warning>

Werte bei skriptgesteuerten Triggeränderungen `revoked` aus. So unterbricht ein geänderter Triggertyp nicht unbemerkt einen Partner, der weiter die alte URL nutzt.

## Idempotenz und Wiederholungen

Die Deduplizierung gilt je Trigger und Projekt in der URL. Dieselbe Zustellungs-ID kann in jedem Installationsprojekt einen Lauf starten. Tale prüft Projektaktivität und Installation auch vor der Rückgabe eines gespeicherten Duplikats.

| Identität | Zeitfenster | Was gleich bleiben muss |
| --- | --- | --- |
| Header mit Zustellungs-ID | 24 Stunden | ID-Wert und Geltungsbereich; ein anderer Body zählt trotzdem als dieselbe Zustellung |
| Ohne Zustellungs-ID | 2 Minuten | Bytegleicher Body und dieselbe URL |

Bei Headern gewinnt der erste vorhandene Eintrag dieser Prioritätsfolge:

```text
Idempotency-Key
X-Idempotency-Key
webhook-id
X-GitHub-Delivery
X-Gitlab-Event-UUID
X-Shopify-Webhook-Id
Linear-Delivery
X-Atlassian-Webhook-Identifier
X-Request-UUID
I-Twilio-Idempotency-Token
X-Webhook-Id
```

Die Headernamen sind Alternativen, keine getrennten Namensräume. Eine Anbieter-ID unter `Idempotency-Key` bleibt dieselbe Identität. Ohne ID verändern schon andere JSON-Leerzeichen die Bytes und können eine neue Zustellung erzeugen. Nutze nach Möglichkeit eine ausdrückliche, stabile Ereignis-ID.

Wiederholst du die Beispielanfrage innerhalb von 24 Stunden, erhältst du die ursprüngliche `runId` mit `duplicate: true`. Eine fehlgeschlagene Automatisierung wird dadurch nicht erneut ausgeführt. Entscheide gezielt, wie du den fehlgeschlagenen Lauf behebst, statt beliebig die Zustellungs-ID zu ändern.

Wiederhole Netzwerkfehler und vorübergehende `5xx`-Antworten mit begrenzten, exponentiell wachsenden Wartezeiten. Beachte bei `429` den Header `Retry-After`. Behalte die ID bei, wenn eine Antwort verloren gegangen sein könnte. Andere `4xx`-Ursachen musst du zuerst beheben. Die Deduplizierung verhindert zusätzliche Läufe innerhalb ihres Fensters, garantiert aber keine genau einmal angewendeten Auswirkungen in externen Diensten.

## Budgets

| Budget | Auffüllung | Kurzzeitmaximum | Belastet |
| --- | --- | --- | --- |
| Sender-IP laut vertrauenswürdigen Proxys | 120/Minute | 240 | Vor der Token-Prüfung |
| Verifizierter Trigger | 20/Minute | 40 | Bei der Zulassung der Zustellung |

Jedes Budget kann `429` mit `Retry-After` in ganzen Sekunden und der normalen Fehlerhülle auslösen. Das Token berechtigt zum Triggerzugriff; es gibt aber keine zusätzliche Senderkonto-Identität für ein eigenes Budget. Nutze die [Ratenlimit-Referenz](/de/develop/rate-limits) und behalte beim Warten dieselbe Zustellungs-ID.

## Webhook oder API-Schlüssel wählen

Verwende einen Webhook für Sender mit fester Ereignis-URL. Nutze einen API-Schlüssel, wenn dein Client zusätzlich Automatisierungen finden, Projekte auswählen oder Ergebnisse lesen muss. [Trigger](/de/platform/automations/triggers) erklärt die Einrichtung in der App; die [API-Referenz](/de/develop/api-reference) beschreibt authentifizierte Starts und Abfragen.
