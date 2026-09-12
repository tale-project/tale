---
title: Eine Automatisierung per Webhook auslösen
description: Häng einen Webhook-Trigger an eine Automatisierung und POSTe von einem externen System auf seine URL, um einen Lauf der deployten Version zu starten.
---

Ein Webhook-Trigger macht aus einer Automatisierung etwas, das ein externes System per JSON-POST feuern kann. Tale gleicht das Token in der URL gegen den Trigger ab, und der gestartete Lauf gehört zur deployten Version der Automatisierung — nie zu einem Entwurf, an dem gerade jemand arbeitet. Dieser Durchlauf bringt eine Automatisierung von „ich will sie von außen feuern“ zu „ein Bestellereignis kommt an und der Lauf taucht auf“ auf einer einzelnen Instanz.

Du brauchst die Rolle Entwickler in der Organisation, eine Automatisierung mit deployter Version und eine Shell mit `curl`. Der vollständige eingehende Vertrag — Statuscodes, Body-Behandlung, Größenlimits — steht in [Webhooks](/de/develop/webhooks); dieser Durchlauf ist die kleinste vollständige Nutzung davon.

## Bevor du beginnst

Prüf zwei Dinge. Die Automatisierung, die du auslösen willst, hat eine **deployte** Version — eine gespeicherte Version reicht nicht, und deploybar wird eine Version erst, wenn ihre eigenen Tests grün sind; lass sie also zuerst laufen. Deine Rolle ist mindestens Entwickler; Trigger anlegen ist auf Entwickler und höher beschränkt. Hast du noch keine Automatisierung, ist die kanonische kleine „nimm das Payload auf und hör auf“ — eine einzelne `transform`-Node, auf dem Canvas gebaut, wie [Der Workflow-Editor](/de/platform/automations/editor) es beschreibt.

Wähle für die folgende Projektzustellung ein aktives Projekt, in dem die Automatisierung installiert ist. Projekt und Trigger müssen zur selben Organisation gehören. Die [API-Referenz](/de/develop/api-reference) erklärt das Installieren in einem Projekt.

## Schritt 1 — Einen Webhook-Trigger anlegen

Der erste Zug ist, einen Webhook-Trigger an die Automatisierung zu binden. Ohne ihn läuft die Automatisierung nur aus der UI oder per Zeitplan; mit ihm bekommt sie eine URL, auf die jedes System POSTen kann.

Öffne die Detailseite der Automatisierung und suche rechts im Einstellungsbereich **Trigger**. Auf schmalen Bildschirmen liegt dieser Bereich unter dem Canvas. Wähle unter **Trigger-Typ** die Option **Webhook** und klicke auf **Einstellungen speichern**. Kopiere das Token, sobald es erscheint: Tale zeigt es nur einmal. Das Token in der URL berechtigt zur Zustellung; Tale speichert nur seinen Hash. Aus einem Skript ist dieselbe Bindung `PUT /api/v1/automations/{name}/triggers` mit `{"kind": "webhook"}` — die **200** trägt `token` genau einmal; ein späteres `{"kind": "webhook", "rotateToken": true}` erzeugt ein neues und tötet die alte URL, und einen Zeitplan oder ein Event darüber zu binden tötet die URL ebenfalls (die Antwort sagt `"revoked": "webhook"`).

Der Trigger bindet an den **Namen** der Automatisierung, nicht an die Version, die du deployt hast. Deploy morgen eine neue Version und diese URL funktioniert weiter — genau dafür sind die beiden getrennt.

Setze das gerade erzeugte Token in die Projekt-URL unten ein. Das Projekt steht im Pfad, nicht in den Daten des Anbieters oder einem Abfrageparameter `projectId`. Eine Zustellung ohne Projekt verwendet `/api/automations/webhook/{token}` und verlangt eine Automatisierung ganz ohne Projektbindungen.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>"
```

## Schritt 2 — Ein Payload per curl POSTen

Sende die Daten des Anbieters an die Projekt-URL. Der Lauf erhält `{ "trigger": "webhook", "payload": <body> }`; die Bestell-ID des Beispiels steht also unter `input.payload.orderId`. Ein definiertes `inputs`-Schema muss dieses umschließende Objekt beschreiben. Inhalte ohne JSON gelangen als Text zum Lauf.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Ein angenommener Aufruf antwortet mit **202** und `{ "runId": "..." }`. Der Lauf arbeitet im benannten Projekt weiter. Lies seinen Status über `GET /api/v1/projects/{id}/runs/{runId}` mit einem API-Schlüssel, der das Projekt lesen darf, oder öffne die Laufliste der Automatisierung im Produkt.

## Schritt 3 — Die Fehlerfälle lesen

Sieben Status decken diesen Ablauf ab, und jede Ablehnung trägt einen stabilen `code` — verzweige auf `code`, nie auf den Satz: Der ist für Menschen geschrieben und kann sich ändern.

- **202** — der Lauf ist gestartet (`{ "runId": "..." }`), oder diese Zustellung war schon angenommen und dieselbe `runId` kommt mit `"duplicate": true` zurück; einen zweiten Lauf gibt es nicht. Das ist der einzige Erfolg.
- **400** `INVALID_QUERY` — ein Abfrageparameter `projectId`; das Projekt kommt aus dem URL-Pfad. **400** `AUTOMATION_INPUT_INVALID` — der Body passt nicht zum deklarierten `inputs`-Schema der Automatisierung; `data.issues` nennt jedes Problem. Korrigiere die Anfrage; kein Lauf ist gestartet.
- **403** `AUTOMATION_PROJECT_FORBIDDEN` — die Automatisierung kann im URL-Projekt nicht laufen: Es existiert nicht, ist archiviert, oder die Automatisierung ist dort nicht installiert. Eine Antwort für alle drei, und sie nennt die Automatisierung nie, damit eine geleakte URL deine Projekt-ids nicht abtasten kann. Korrigiere die URL oder die Installation; ein erneuter Versuch ändert nichts.
- **404** `NOT_FOUND` — das Token passt zu keinem aktiven Trigger: Es ist falsch, es wurde gelöscht oder widerrufen, oder der Trigger ist deaktiviert. Die Antwort sagt bewusst nie, welcher Fall zutrifft, damit jemand, der Tokens rät, aus dem Unterschied nichts lernt.
- **409** `AUTOMATION_NOT_DEPLOYED` — die Automatisierung existiert, aber nichts ist live: Deploy eine Version, deren Tests grün sind, und derselbe Aufruf läuft. **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED` — eine projektgebundene Automatisierung wurde über die globale URL `/api/automations/webhook/{token}` aufgerufen; nimm ihre Projekt-URL. **409** `AUTOMATION_DELIVERY_SCOPE_MISMATCH` — diese Zustellungs-id wurde zuerst über einen anderen URL-Scope angenommen.
- **413** `BODY_TOO_LARGE` — der Body liegt über 256 KiB (262.144 Bytes); poste eine Referenz statt der Nutzlast.
- **429** `RATE_LIMITED` — das Budget des Senders oder des Triggers ist aufgebraucht; warte die Sekunden aus `Retry-After` ab und sende mit derselben Zustellungs-id erneut, damit der Retry dieselbe Zustellung ist und kein zweiter Lauf.

Retries verdienen einen eigenen Satz: Der Endpunkt dedupliziert, ein wiederholter POST startet also keinen zweiten Lauf. Schick eine Zustellungs-ID mit — `Idempotency-Key` oder den eigenen Header deines Anbieters wie `X-GitHub-Delivery` — und eine Wiederholung innerhalb von 24 Stunden antwortet mit dem Lauf, den der erste Versuch gestartet hat, markiert mit `duplicate: true`; ohne ID gilt dasselbe für einen byteidentischen Body innerhalb von zwei Minuten. Halte die ID über alle Versuche stabil, dann ist eine hängende Anfrage gefahrlos wiederholbar. Der Lauf selbst setzt zusätzlich nach jedem abgeschlossenen Knoten einen Checkpoint, ein nach einer Unterbrechung wiederaufgenommener Lauf wiederholt einen bereits erzeugten Seiteneffekt also nie. Zustellungs-IDs und identische Inhalte werden innerhalb derselben Projekt-URL verglichen. Ein anderes installiertes Projekt hat eigene Zustellungen. Entfernst du die Bindung oder archivierst das Projekt, verweigert Tale weitere Zustellungen, auch gespeicherte Duplikatantworten.

## Wo das eingesetzt wird

Webhook-Trigger sind die eingehende Naht der Automatisierungs-Engine — das, worauf dein CRM, dein Bestellsystem oder dein Monitoring POSTet. Greif dazu, wenn der Satz lautet „das ist bei uns passiert, lass bitte etwas dazu laufen“; greif zur [API-Referenz](/de/develop/api-reference), wenn du stattdessen eine synchrone Antwort willst. Die Trigger-seitige Konfiguration und die anderen drei Arten, dieselbe Automatisierung zu starten, stehen unter [Workflow-Trigger](/de/platform/automations/triggers).
