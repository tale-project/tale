---
title: Eine Automation per Webhook auslösen
description: Installiere eine veröffentlichte Automation im Projekt, sende eine Webhook-Zustellung und prüfe den fertigen Lauf.
---
Verbinde ein externes Ereignis mit einer veröffentlichten Automation und prüfe Annahme und fertigen Lauf. Diese Anleitung verwendet einen Projekt-Webhook, einen API-Schlüssel für Einrichtung und Abfragen sowie curl für die Zustellung. Das externe System braucht nur die Webhook-URL.

## Eine unkritische Testautomation vorbereiten

Wähle eine veröffentlichte Automation mit bestandenen Tests, deren erster Lauf weder Nachrichten sendet noch Kundendaten verändert oder andere externe Folgen hat. Eine Transformation, die ihre Eingabe zurückgibt, reicht aus. Erstelle und veröffentliche sie in der App oder über [MCP](/de/develop/mcp-endpoint). REST erstellt und veröffentlicht keine Automationsdefinitionen.

Nutze ein aktives Projekt mit Bearbeitungszugriff und einen API-Schlüssel mit Entwicklerrechten. Setze `TALE_BASE_URL`, `TALE_API_KEY`, `TALE_ORG_SLUG`, `TALE_PROJECT_ID` und `TALE_AUTOMATION`. Der Organisationswert ist ein Slug, der Projektwert eine ID. Ersetze `/` innerhalb von Automationsnamen in URLs durch `__`.

## Die Automation im Projekt installieren

Für Webhook-Zustellungen muss die Automation in dem Projekt installiert sein, das die URL nennt. Installiere sie mit dem Namen im Pfad und einem leeren Anfrageinhalt:

```bash
curl --fail-with-body --silent --show-error --request POST \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/$TALE_AUTOMATION" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{}'
```

Die erste Installation liefert `201`, eine Wiederholung `200`. Eine Anfrage an die Sammlung `/automations` installiert nichts. Lies vor der Zustellung den Eingabevertrag der veröffentlichten Version.

## Den Trigger erstellen und schützen

Binde für die neue Testautomation einen Webhook-Trigger:

```bash
curl --fail-with-body --silent --show-error --request PUT \
  "$TALE_BASE_URL/api/v1/automations/$TALE_AUTOMATION/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{"kind":"webhook"}'
```

Kopiere das zurückgegebene `token` in die private Umgebungsvariable `TALE_WEBHOOK_TOKEN`. Tale zeigt den Klartext nur beim Erstellen oder Rotieren. Ein späterer Lesezugriff kann ihn nicht wiederherstellen.

<Warning>

Die URL ist ein Zugangsmittel. Wer sie kennt, kann Zustellungen senden. Halte sie aus Quellcode, Screenshots und öffentlichen Protokollen heraus. Ein Webhook ersetzt eine vorhandene Trigger-Art derselben Automation; verwende dafür die ausgewählte Testautomation.

</Warning>

Der Trigger folgt dem Automationsnamen und nutzt die veröffentlichte Version. Ein späterer Release kann deshalb ändern, was dieselbe URL ausführt. Rotiere oder entferne einen geleakten Trigger. Deaktivieren pausiert ihn nur; erneutes Aktivieren stellt dasselbe Token wieder her.

## Eine Zustellung senden

Sende das Testereignis mit einer stabilen Zustellungs-ID:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/projects/$TALE_PROJECT_ID/automations/webhook/$TALE_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  --data '{"orderId":"12345","amount":199.0}'
```

Die Annahme liefert `202` mit `runId`. Speichere die ID als `TALE_RUN_ID`. Die Automation erhält `{"trigger":"webhook","payload":<body>}`; die Bestell-ID liegt also unter `input.payload.orderId`. Ein Eingabeschema muss diese Hülle beschreiben.

Wiederhole denselben Befehl. Innerhalb des Deduplizierungsfensters bleibt `runId` gleich und `duplicate: true` kommt hinzu; kein zweiter Lauf startet. IDs bleiben 24 Stunden gespeichert. Ohne ID-Kopfzeile werden identische Anfragebytes nur innerhalb von zwei Minuten zusammengefasst. Verwende für ein neues Ereignis eine neue ID.

## Das Laufergebnis prüfen

Lies den Lauf mit deinem API-Schlüssel im selben Projekt:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$TALE_RUN_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Warte auf einen Endstatus und prüfe `output` und `trace`. Bei der Testautomation, die Eingaben zurückgibt, müssen Bestell-ID und Betrag mit deiner Zustellung übereinstimmen. Die `202`-Antwort allein bestätigt dieses Ergebnis nicht.

Lies bei einem fehlgeschlagenen Lauf `failureCode` und `detail`, den betroffenen Knoten sowie bereits ausgeführte Aktionen. Dieselbe Zustellungs-ID liefert den ursprünglichen Lauf zurück, auch wenn er fehlgeschlagen ist; sie wiederholt seine Arbeit nicht. Eine andere ID startet neue Arbeit. Prüfe deshalb zuerst, ob bereits abgeschlossene Knoten gefahrlos erneut laufen dürfen.

## Zustellungen wiederaufnehmen

| Antwort | Behebung |
| --- | --- |
| `400` | Lies `code` und Eingabeprobleme. Korrigiere die Datenhülle oder entferne einen Query-Parameter `projectId`. |
| `403` | Prüfe aktives Projekt und Installation der Automation darin. |
| `404` | Prüfe Token und Aktivierung. Der Endpunkt verrät nicht, welches davon falsch ist. |
| `409` | Lies `code`: Veröffentliche eine Version, korrigiere den URL-Kontext oder löse den Zustellungskonflikt. |
| `413` | Verkleinere den Inhalt auf unter 256 KiB oder sende eine Referenz. |
| `429` | Warte gemäß `Retry-After` und wiederhole mit derselben Zustellungs-ID. |

Wiederhole Netzwerkfehler und vorübergehende Serverfehler mit begrenztem Backoff und derselben ID. Behebe andere Clientfehler zuerst; wiederholte ungültige Anfragen reparieren keine Konfiguration. Entferne den Testtrigger, wenn du seine URL nicht mehr brauchst. Die [Webhook-Referenz](/de/develop/webhooks) nennt alle ID-Kopfzeilen, Rotationsregeln und Limits.
