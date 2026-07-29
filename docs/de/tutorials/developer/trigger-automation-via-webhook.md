---
title: Eine Automatisierung per Webhook auslösen
description: Häng einen Webhook-Trigger an eine Automatisierung und POSTe von einem externen System auf seine URL, um einen Lauf der deployten Version zu starten.
---

Ein Webhook-Trigger macht aus einer Automatisierung etwas, das ein externes System per JSON-POST feuern kann. Tale gleicht das Token in der URL gegen den Trigger ab, und der gestartete Lauf gehört zur deployten Version der Automatisierung — nie zu einem Entwurf, an dem gerade jemand arbeitet. Dieser Durchlauf bringt eine Automatisierung von „ich will sie von außen feuern“ zu „ein Bestellereignis kommt an und der Lauf taucht auf“ auf einer einzelnen Instanz.

Du brauchst die Rolle Entwickler in der Organisation, eine Automatisierung mit deployter Version und eine Shell mit `curl`. Der vollständige eingehende Vertrag — Statuscodes, Body-Behandlung, Größenlimits — steht in [Webhooks](/de/develop/webhooks); dieser Durchlauf ist die kleinste vollständige Nutzung davon.

## Bevor du beginnst

Prüf zwei Dinge. Die Automatisierung, die du auslösen willst, hat eine **deployte** Version — eine gespeicherte Version reicht nicht, und deploybar wird eine Version erst, wenn ihre eigenen Tests grün sind; lass sie also zuerst laufen. Deine Rolle ist mindestens Entwickler; Trigger anlegen ist auf Entwickler und höher beschränkt. Hast du noch keine Automatisierung, ist die kanonische kleine „nimm das Payload auf und hör auf“ — bau sie über [Workflow mit Genehmigungen](/de/tutorials/editor/workflow-with-approvals) und lass für diesen Durchlauf den Genehmigungsknoten weg.

## Schritt 1 — Einen Webhook-Trigger anlegen

Der erste Zug ist, einen Webhook-Trigger an die Automatisierung zu binden. Ohne ihn läuft die Automatisierung nur aus der UI oder per Zeitplan; mit ihm bekommt sie eine URL, auf die jedes System POSTen kann.

Öffne den Tab **Trigger** der Automatisierung und leg einen Webhook an. Tale erzeugt eine URL, in deren Pfad der Berechtigungsnachweis als Token steckt — kein separater Schlüssel, kein Authorization-Header. Das Klartext-Token wird einmal angezeigt und nie gespeichert, kopier es also jetzt; abgelegt wird nur sein Hash, weshalb dir später niemand die URL zurückholen kann.

Der Trigger bindet an den **Namen** der Automatisierung, nicht an die Version, die du deployt hast. Deploy morgen eine neue Version und diese URL funktioniert weiter — genau dafür sind die beiden getrennt.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/automations/webhook/<token>"
```

## Schritt 2 — Ein Payload per curl POSTen

Die Webhook-URL ist ein gewöhnlicher POST-Endpunkt, und der Body wird die Eingabe des Laufs. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgelehnt — ein Anbieter, der formularkodiert postet, erreicht deinen ersten Knoten also trotzdem.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Ein angenommener Aufruf antwortet **202** mit `{ "runId": "..." }`. Der Lauf arbeitet nun asynchron; öffne die Lauf-Liste der Automatisierung und du siehst ihn dort mit deinem Payload als Eingabe.

## Schritt 3 — Die Fehlerfälle lesen

Vier Antworten decken alles ab, was der Endpunkt sagen kann, und jede zeigt auf eine andere Behebung.

**404** heißt: Das Token passt zu keinem aktiven Trigger — es ist falsch, es wurde gelöscht, oder der Trigger ist deaktiviert. Die Antwort sagt bewusst nie, welcher Fall zutrifft, damit jemand, der Tokens rät, aus dem Unterschied nichts lernt. **409** mit `{ "error": "automation has no deployed version" }` heißt: Die Automatisierung existiert, aber nichts ist live — deploy eine Version, deren Tests grün sind, und derselbe Aufruf läuft. **413** heißt: Der Body liegt über 256 KB; poste dann eine Referenz statt der Nutzlast. **202** ist der einzige Erfolg.

Retries verdienen einen eigenen Satz: Der Endpunkt dedupliziert nicht, ein wiederholter POST startet also einen zweiten Lauf. Sicher macht das der Lauf selbst — jeder abgeschlossene Knoten bekommt einen Checkpoint, ein nach einer Unterbrechung wiederaufgenommener Lauf wiederholt seine bereits erzeugten Seiteneffekte also nie. Wäre ein _doppelter_ Lauf trotzdem falsch, führ deine eigene Ereignis-ID im Payload mit und verzweig im ersten Knoten darauf.

## Wo das eingesetzt wird

Webhook-Trigger sind die eingehende Naht der Automatisierungs-Engine — das, worauf dein CRM, dein Bestellsystem oder dein Monitoring POSTet. Greif dazu, wenn der Satz lautet „das ist bei uns passiert, lass bitte etwas dazu laufen“; greif zur [API-Referenz](/de/develop/api-reference), wenn du stattdessen eine synchrone Antwort willst. Die Trigger-seitige Konfiguration und die anderen drei Arten, dieselbe Automatisierung zu starten, stehen unter [Workflow-Trigger](/de/platform/automations/triggers).
