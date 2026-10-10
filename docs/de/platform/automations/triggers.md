---
title: Automatisierungen automatisch starten
description: Starte eine Automatisierung nach Zeitplan, per Webhook oder bei einem Plattform-Ereignis, prüfe, was jeder Lauf erhält, und finde heraus, warum ein Start ausgelassen wurde.
---

Im Abschnitt **Trigger** im Tab **Allgemein** einer Automatisierung legst du fest, wann sie selbstständig startet: nach Zeitplan, wenn ein anderes System eine Anfrage sendet, oder wenn in Tale etwas passiert. Jeder Trigger führt die Live-Version im Live-Modus aus. Bevor du einen Trigger einschaltest, prüfe, was seine Läufe erhalten und ob die externen Aktionen des Workflows bereit sind.

<Frame caption="Der Trigger eines mitgelieferten Pakets kommt ausgeschaltet an: Sein Zeitplan steht und die nächsten Läufe sind aufgelistet, aber es startet nichts, bis du ihn einschaltest.">

![Der Tab Allgemein von Triage the Gmail inbox mit ausgeschaltetem Schalter Enabled, Schedule als Trigger-Typ, dem Format Repeat mit einem Zeitplan alle 6 Stunden, der Zeitzone UTC, Start the latest one when Tale is back unter Missed runs und den nächsten Läufen unter Would run at.](/images/platform/automation-general-trigger.webp)

</Frame>

## Den Auslöser wählen

| Trigger-Typ | Geeignet für | Eingabe des Laufs |
| --- | --- | --- |
| **Zeitplan** | Wiederkehrende Arbeit zu festen Uhrzeiten oder in regelmäßigen Abständen. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | Zustellungen eines anderen Systems. | `{ trigger: "webhook", payload: … }` |
| **Plattform-Ereignis** | Etwas, das in der Organisation passiert, etwa eine neue Aufgabe. | `{ trigger: "event", event: "…", payload: … }` |

Jeder Typ kann außerdem eine [feste Eingabe](#feste-eingabe) mitgeben: Werte, die jeder Lauf zusätzlich zu diesen Feldern erhält, etwa das Repository, das eine geplante Triage liest.

Eine Automatisierung hat jeweils einen konfigurierten Trigger. Ein anderer Typ ersetzt die bisherige Bindung. Ersetzt du einen Webhook, wird seine URL sofort ungültig. Ein später angelegter Webhook stellt diese Zugangsdaten nicht wieder her.

API- und MCP-Clients können auch ohne Trigger starten. API-Schlüssel und Projektberechtigungen autorisieren den Aufruf; der Client übergibt die Workflow-Eingabe direkt. Näheres steht in der [API-Referenz](/de/develop/api-reference).

## Einen Zeitplan einrichten

<Steps>

<Step title="Trigger-Einstellungen öffnen">

Öffne die Automatisierung und darin den Tab **Allgemein**. Ohne Bindung steht im Abschnitt **Trigger**, dass die Automatisierung nur von Hand oder über die API läuft. Wähle **Trigger hinzufügen**. Ein neuer Trigger ist ein **Zeitplan**, der täglich um 9:00 Uhr in deiner Zeitzone läuft, und **Aktiv** ist ausgeschaltet. Lass ihn aus, solange der Workflow noch nicht selbstständig starten soll.

</Step>

<Step title="Eine Wiederholung wählen">

Lass **Format des Zeitplans** auf **Wiederholung** und öffne **Zeitplan**. Die Schnellauswahl bietet **Alle 15 Minuten**, **Stündlich** sowie tägliche, werktägliche, wöchentliche und monatliche Läufe zu einer Uhrzeit. Die wöchentliche und die monatliche Vorlage richten sich nach dem heutigen Wochentag und Monatstag, und jede Vorlage mit Uhrzeit übernimmt die früheste Uhrzeit des Zeitplans. Ein Klick auf eine Vorlage schließt das Popover und übernimmt sie ins Formular. Unter der Schnellauswahl und den benutzerdefinierten Ansichten zeigt das Popover die nächsten drei Läufe des Zeitplans, den du gerade zusammenstellst.

<Frame caption="Die Vorlagen, die eigene Zeile des gespeicherten Zeitplans mit ihrem Satz und die nächsten drei Läufe.">

![Das Popover Schedule im Tab General von Triage the Gmail inbox: die Vorlagen Every 15 minutes, Every hour, Daily at 9:00 AM, Every weekday at 9:00 AM, Weekly on Saturday at 9:00 AM und Monthly on day 10 at 9:00 AM; Custom interval, ausgewählt, mit Every 6 hours; Custom times; und die nächsten drei Läufe in UTC.](/images/platform/automation-trigger-schedule-presets.webp)

</Frame>

</Step>

<Step title="Oder selbst zusammenstellen">

Wähle **Benutzerdefinierte Uhrzeiten**, um zu festen Uhrzeiten zu starten: Wähle **Tag**, **Woche**, **Monat** oder **Jahr**, das Intervall (etwa alle 2 Wochen), die Wochentage oder den Tag und unter **Um** bis zu 12 Uhrzeiten. **Uhrzeit hinzufügen** ergänzt eine Uhrzeit eine Stunde nach der letzten. Eine Uhrzeit, die schon in der Liste steht, läuft nur einmal, und beim Speichern werden die Uhrzeiten sortiert.

<Frame caption="Benutzerdefinierte Uhrzeiten: werktags um 9:00 und 17:30 Uhr, mit den Läufen, die sich daraus ergeben.">

![Die Ansicht Custom times der Zeitplanauswahl: Week gewählt, every 1 week, Montag bis Freitag ausgewählt, die Uhrzeiten 9:00 AM und 5:30 PM mit Add time darunter, die nächsten drei Läufe in UTC sowie Cancel und Save.](/images/platform/automation-trigger-schedule-custom-times.webp)

</Frame>

Wähle **Benutzerdefiniertes Intervall**, um alle paar Minuten oder Stunden zu starten: bis zu alle 30 Minuten in Schritten, die eine Stunde teilen, oder bis zu alle 12 Stunden in Schritten, die einen Tag teilen, jeweils eine bestimmte Anzahl Minuten nach der vollen Stunde. Lass die Wochentage eingeschaltet, an denen es laufen soll, und beschränke es mit **Nur zwischen** auf die Stunden zwischen zwei Uhrzeiten. Unter den Uhrzeiten nennt die Auswahl den ersten und den letzten Lauf des Tages.

<Frame caption="Benutzerdefiniertes Intervall: alle 15 Minuten an Werktagen, nur zwischen 8:00 und 18:00 Uhr.">

![Die Ansicht Custom interval der Zeitplanauswahl: alle 15 Minuten, Montag bis Freitag ausgewählt, Only between angehakt von 8:00 AM bis 6:00 PM, die Zeile Each day, the first run starts at 8:00 AM and the last at 5:45 PM, die nächsten drei Läufe in UTC sowie Cancel und Save.](/images/platform/automation-trigger-schedule-interval.webp)

</Frame>

**Speichern**, Enter oder Strg+Enter (auf dem Mac Cmd+Enter) übernimmt den benutzerdefinierten Zeitplan; **Abbrechen** oder Escape verwirft ihn.

</Step>

<Step title="Die Zeitzone wählen">

Die Uhrzeiten des Zeitplans gelten in der Zone, die unter **Zeitzone** steht. Voreingestellt ist deine eigene; suche eine andere IANA-Zeitzone wie `Europe/Zurich`, wenn sich die Arbeit nach den Bürozeiten eines anderen Standorts richtet.

</Step>

<Step title="Die nächsten Läufe prüfen">

**Nächste Läufe** listet die nächsten fünf Starts in der Zeitzone des Zeitplans und, wenn deine eigene Zeitzone abweicht, denselben Zeitpunkt in deiner Zeitzone. Solange Änderungen nicht gespeichert sind, lautet die Überschrift **Nächste Läufe (nicht gespeichert)**. Ist der Trigger aus oder keine Version live, lautet sie **Würde laufen um**, und die Zeile darunter sagt, was fehlt.

</Step>

<Step title="Speichern und einschalten">

Klick neben den Tabs auf **Speichern**. Prüfe unter [Dieser Lauf erhält](#pruefen-was-ein-lauf-erhaelt), ob die Live-Version die Eingabe akzeptiert. Wenn alles bereit ist, schalte **Aktiv** ein und speichere erneut. Der nächste gestartete Lauf erscheint unter **Läufe**, und der Abschnitt **Trigger** zeigt ihn als letzten Lauf.

</Step>

</Steps>

**Benutzerdefiniertes Intervall** zählt ab Mitternacht Ortszeit: Alle 2 Stunden, 15 Minuten nach der vollen Stunde, startet also um 00:15, 02:15 und so weiter. **Nur zwischen** schließt den Beginn ein und hört vor dem Ende auf: Von 8:00 bis 18:00 läuft ein 15-Minuten-Intervall zuletzt um 17:45. Liegt das Ende vor dem Beginn, läuft es über Nacht, und die Stunden nach Mitternacht gehören zum Tag, an dem das Zeitfenster begann. Freitag von 22:00 bis 06:00 läuft also bis Samstagmorgen, aber nicht am Samstagabend. Ein Ende um 00:00 läuft bis Mitternacht, und gleicher Beginn und gleiches Ende bedeuten den ganzen Tag. Fällt zwischen die beiden Uhrzeiten kein einziger Lauf, etwa alle 6 Stunden von 8:00 bis 11:00, sagt die Auswahl das, und **Speichern** wartet, bis du den Zeitraum erweiterst oder das Intervall verkürzt.

### Bei der Zeitumstellung

Ein Zeitplan behält seine Ortszeiten über die Zeitumstellungen hinweg:

- Eine Uhrzeit, die an diesem Tag übersprungen wird, startet einmal, um die Dauer der Lücke später. In `Europe/Zurich` startet ein Lauf für 02:30 am 29. März 2026 um 03:30.
- Eine Uhrzeit, die zweimal vorkommt, startet einmal, beim ersten Mal.
- **Alle N Minuten** und **Alle N Stunden** behalten dagegen ihren echten Abstand: In der Stunde, die sich wiederholt, laufen sie doppelt, in der übersprungenen gar nicht.

**Nächste Läufe** markiert einen Start, der auf eine Umstellung trifft, mit **Zeitumstellung** und erklärt, was passiert.

### Bei verpassten Läufen

**Verpasste Läufe** bestimmt, was ein Zeitplan mit den Zeitpunkten macht, zu denen er fällig war, während Tale nicht verfügbar war, etwa während eines Updates:

| Auswahl | Was passiert, sobald Tale wieder läuft |
| --- | --- |
| **Den letzten nachholen, sobald Tale wieder läuft** (Standard) | Der letzte verpasste Zeitpunkt läuft einmal, egal wie spät. Frühere verpasste Zeitpunkte werden gezählt, nicht nachgeholt. |
| **Auslassen** | Ein Lauf, der mehr als 10 Minuten zu spät ist, startet nicht und wird als verpasst gezählt. |

Ein Beispiel: Ein Zeitplan läuft täglich um 09:00, und Tale ist von 08:30 bis 10:15 nicht erreichbar. Mit dem Standard startet um 10:15 ein Lauf für 09:00; mit **Auslassen** startet nichts, und der Abschnitt **Trigger** zeigt, dass 1 Lauf verpasst wurde. Sobald Läufe als verpasst zählen, zeigt der Abschnitt, wie viele es waren und zwischen welchen Zeitpunkten, gezählt bis 1.000. Mit dem Standard sind das die Zeitpunkte vor dem gestarteten Lauf, etwa die früheren Starts eines Zeitplans alle 15 Minuten während desselben Ausfalls. Die Zeit, in der der Zeitplan ausgeschaltet oder pausiert war, und die Zeit vor dem Speichern zählen nie als verpasst.

## Einen Cron-Ausdruck verwenden

Wechsle unter **Format des Zeitplans** zu **Cron (erweitert)**, wenn du schon einen Cron-Ausdruck hast oder ein Muster brauchst, das **Wiederholung** nicht anbietet. Die fünf Cron-Felder bedeuten Minute, Stunde, Tag des Monats, Monat und Wochentag.

```text
*/15 * * * *     alle fünfzehn Minuten
0 9 * * 1-5      werktags um 09:00 Uhr
0 6 1 * *        am Monatsersten um 06:00 Uhr
30 8 1 * 1       am Monatsersten und jeden Montag um 08:30 Uhr
```

Die Felder erlauben `*`, Zahlen, Bereiche, Schrittweiten und kommagetrennte Listen. 0 und 7 stehen beide für Sonntag. Sind Monatstag und Wochentag eingeschränkt, genügt eine Übereinstimmung; das letzte Beispiel läuft daher montags und am ersten Tag jedes Monats. Kann **Wiederholung** dasselbe ausdrücken, gibt die Zeile unter dem Feld es wieder, etwa „Bedeutet: Jeden Werktag um 09:00 Uhr“. Ist ein Ausdruck nicht lesbar oder nennt er ein Datum, das nie eintritt, etwa `0 0 30 2 *`, steht der Grund unter dem Feld; **Nächste Läufe** bleibt leer, und **Speichern** wartet, bis du ihn korrigierst.

Ein Cron-Ausdruck folgt denselben Regeln zur Zeitumstellung: Stehen Minute und Stunde als Zahlen da, nennt er Uhrzeiten; beginnt Minute oder Stunde mit `*`, behält er seinen echten Abstand.

Der Wechsel zwischen **Wiederholung** und **Cron (erweitert)** rechnet den Zeitplan um, wenn beide genau dasselbe sagen. Geht das nicht, etwa bei einem Zeitplan um 9:00 und 17:30 Uhr, sagt das Feld es, und beide Eingaben bleiben bis zum Speichern im Formular. Ein früher als Cron-Ausdruck gespeicherter Zeitplan öffnet unter **Wiederholung**, wenn eine Wiederholung genau dasselbe sagt, mit einem Hinweis auf den gespeicherten Ausdruck. Speicherst du ihn unverändert, bleibt der Cron-Ausdruck erhalten; ein geänderter Zeitplan wird als Wiederholung gespeichert. Einen Cron-Ausdruck, den **Wiederholung** nicht ausdrücken kann, öffnet Tale unter **Cron (erweitert)**.

## Einen Webhook empfangen

Wähle **Webhook** und speichere, um die URL zu erzeugen. **Webhook-URL — kopiere sie jetzt** zeigt sie genau einmal: eine URL für jedes Projekt, in dem die Automatisierung installiert ist, oder eine für die Organisation, wenn sie in keinem installiert ist. Kopiere jede URL, die du brauchst; der Token an ihrem Ende wird nur als Hash gespeichert. Danach listet der Abschnitt die Adressen mit verborgenem Token, unter **Projekt-URLs** oder, für die Organisation, unter **Webhook-Endpunkt**. **Token rotieren** erzeugt eine neue URL. Eine Automatisierung, die in Projekten installiert ist, läuft nur über eine Projekt-URL.

Unter **Testanfrage senden** steht ein fertiger `curl`-Befehl. Direkt nach dem Erzeugen enthält er die URL selbst; später liest er sie aus `TALE_WEBHOOK_URL`, der Variable, in der das sendende System sie aufbewahren sollte. Er sendet einen kleinen JSON-Inhalt mit einem `Idempotency-Key`. JSON landet als `payload` innerhalb der Eingabe, nicht unmittelbar auf deren oberster Ebene; andere Anfrageinhalte werden als Text weitergereicht. Die Grenze liegt bei 256 KiB; große Dokumente lädst du separat hoch. Eine angenommene Anfrage liefert die Lauf-ID, ohne auf das Ende des Laufs zu warten.

Die gesendete Nutzlast `{ "invoiceId": "inv-1" }` erreicht den Workflow beispielsweise so:

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Sende eine Zustellungs-ID, etwa `Idempotency-Key` oder einen unterstützten Header des Absenders. Dieselbe ID liefert innerhalb von 24 Stunden den ursprünglichen Lauf zurück. Ohne ID gilt ein identischer Inhalt an derselben URL innerhalb von zwei Minuten als Duplikat. Vergib unterschiedliche IDs, wenn identische Inhalte getrennte Arbeit bedeuten. [Webhooks](/de/develop/webhooks) beschreibt Header, Projektpfade, Fehler und Antwortformate.

**Letzte Zustellungen** listet die letzten zehn Läufe, die der Webhook gestartet hat, die neuesten zuerst, jeweils mit Status und **Lauf ansehen**. Solange sich Tale an eine Zustellung erinnert, sagt die Zeile auch, woran Tale eine Wiederholung erkennt: **ID aus** dem gelesenen Header oder **Ohne Zustell-ID**. Eine Anfrage, die Tale abgelehnt hat, hat keinen Lauf gestartet und steht nicht in der Liste; die Antwort an den Absender nennt den Grund.

<Frame caption="Ein Webhook, der in zwei Projekten installiert ist: eine URL pro Projekt, eine Testanfrage und die Zustellungen, die Läufe gestartet haben.">

![Der Abschnitt Trigger eines Webhooks: Der letzte Lauf war erfolgreich, Enabled ist eingeschaltet, Project URLs listet Website relaunch und Customer onboarding portal mit verborgenem Token, darunter Rotate token, eine curl-Testanfrage, die die URL aus TALE_WEBHOOK_URL liest, Recent deliveries mit zwei erfolgreichen Läufen, jeweils ID from idempotency-key, und This run receives mit dem payload.](/images/platform/automation-trigger-webhook.webp)

</Frame>

<Warning>

Die URL berechtigt zum Start. Bewahre sie wie Zugangsdaten auf und gib sie nur dem sendenden System. **Token rotieren** fragt nach einer Bestätigung, erzeugt dann einen Ersatz und macht die alte URL ungültig. Entfernen oder Ersetzen des Triggers widerruft sie ebenfalls. Aktualisiere den Absender nach einer Rotation.

</Warning>

## Auf ein Plattform-Ereignis reagieren

Wähle **Plattform-Ereignis** und dann unter **Ereignisname** das Ereignis. Die Liste gruppiert die Ereignisse nach ihrem Gegenstand und zeigt zu jedem Namen, ID und Anlass; tippe einen Teil davon, um zu suchen. Speichere und schalte **Aktiv** ein, wenn alles bereit ist.

<Frame caption="Die Ereignisse, gruppiert nach ihrem Gegenstand, jedes mit Name, ID und dem Moment, in dem es ausgelöst wird.">

![Die Liste Event name eines Triggers vom Typ Platform event: ein Suchfeld über den Gruppen Tasks mit Task created und Task status changed, Comments mit Comment added und Mentioned in a comment sowie Conversations, jedes Ereignis mit seiner ID und einem Satz, wann es ausgelöst wird.](/images/platform/automation-trigger-event.webp)

</Frame>

| Ereignis | ID | Ausgelöst, wenn | `payload` enthält |
| --- | --- | --- | --- |
| **Aufgabe erstellt** | `task.created` | Eine Aufgabe wird auf einem Board, über die API oder durch einen Import erstellt. | `taskId`, `projectId`, `actorType`, `actorId` |
| **Aufgabenstatus geändert** | `task.status_changed` | Eine Person verschiebt eine Aufgabe in einen anderen Status. Eigene Verschiebungen eines Agenten zählen nicht. | `taskId`, `projectId`, `fromStatus`, `toStatus`, `actorType`, `actorId` |
| **Kommentar hinzugefügt** | `comment.created` | Zu einer Aufgabe wird ein Kommentar geschrieben. | `comment` mit `body`, `taskId`, `projectId` und `mentions` |
| **In einem Kommentar erwähnt** | `comment.mentioned` | Ein Aufgabenkommentar erwähnt jemanden mit @. | `comment`, `taskId`, `mentions`, `actorType`, `actorId` |
| **Konversation gestartet** | `conversation.created` | Eine Konversation öffnet sich in der Inbox: Eine E-Mail trifft ein oder eine externe Konversation wird gespiegelt. | `conversationId`, `channel` |
| **Nachricht erhalten** | `conversation.message_received` | Eine Nachricht kommt in einer bestehenden Konversation an. | `conversationId`, `messageId`, `direction` |
| **Kontakt erstellt** | `contact.created` | Ein Kontakt wird über die API, die App oder einen Import angelegt. | `contactId` |
| **Kontakt geändert** | `contact.updated` | Die Angaben eines Kontakts ändern sich. | `contactId` |
| **Kontakt gelöscht** | `contact.deleted` | Ein Kontakt wird gelöscht. | `contactId` |
| **Projekt erstellt** | `project.created` | Ein Projekt wird erstellt. | `projectId`, `name`, `actorId` |

Die Nutzlast enthält IDs, keine vollständigen Datensätze: Braucht der Workflow mehr, liest er Aufgabe, Kommentar oder Kontakt mit einem Schritt. Eine neue Aufgabe erreicht den Workflow zum Beispiel so:

```json
{
  "trigger": "event",
  "event": "task.created",
  "payload": {
    "taskId": "5e2f9d34-8a71-4c6b-b0d2-91a7e3c4f815",
    "projectId": "0b9c6a52-5d1e-4f0a-9c3e-2f6d8a1b7e40",
    "actorType": "user",
    "actorId": "c41d7e88-2b3a-4f95-8e60-7d5a9b1c0f23"
  }
}
```

Ereignisse zu Aufgaben, Kommentaren und Projekten gehören zu einem Projekt, Ereignisse zu Kontakten und Konversationen nicht. Ein Ereignis eines Projekts startet die Automatisierungen, die in diesem Projekt oder in keinem Projekt installiert sind, und ihre Läufe gehören zu diesem Projekt. Eine Automatisierung, die nur in anderen Projekten installiert ist, reagiert nicht darauf. Ein Ereignis ohne Projekt startet eine Automatisierung, die in genau einem Projekt installiert ist, in diesem Projekt. Ist dieses Projekt archiviert oder lehnen die Eingaben der Automatisierung das Ereignis ab, startet kein Lauf, und der Trigger zeigt den Grund. Die anderen Automatisierungen, die auf das Ereignis warten, starten trotzdem. Unter **Ereignisname** sagt das Feld, welche Ereignisse diese Automatisierung starten.

Ein Ereignis, das ein Lauf einer Automatisierung auslöst, startet nie dieselbe Automatisierung, und ein Lauf, den ein Ereignis gestartet hat, startet keine weiteren Automatisierungen. So erzeugt ein Workflow durch seine eigenen Änderungen keine endlose Startschleife, weder allein noch mit einem anderen. Das gilt für alles, was der Lauf selbst tut: seine Schritte, seine Connector-Aufrufe und die Werkzeuge seines eigenen Agenten. Arbeit, die ein Schritt an einen Projektagenten übergibt, gehört diesem Agenten; ein Ereignis, das er auslöst, kann die Automatisierung also erneut starten. Achte darauf, dass solche Arbeit nicht das Ereignis auslöst, auf das die Automatisierung wartet.

## Prüfen, was ein Lauf erhält

**Dieser Lauf erhält** zeigt die Eingabe des nächsten Laufs genau so, wie der Trigger sie zusammensetzt: die eigenen Felder des Triggers, seine feste Eingabe und bei einem Webhook oder Ereignis eine Beispiel-`payload`. Bei einem Zeitplan ist `firedAt` der Fälligkeitszeitpunkt in Millisekunden seit 1970 (UTC). Mit **Eingabe kopieren** übernimmst du sie in einen Testlauf.

Darunter vergleicht der Abschnitt die Eingabe mit den Eingaben der Live-Version. Er meldet etwa **Version 3 akzeptiert diese Eingabe** oder warnt **Version 3 akzeptiert diese Eingabe nicht** und nennt einen Weg zur Lösung: die fehlenden Felder in der festen Eingabe ergänzen oder die Eingaben im Editor anpassen. Den Inhalt eines Webhooks kennt Tale erst, wenn eine Anfrage eintrifft; er zählt deshalb nie gegen die Version. Dieselbe Prüfung läuft beim Speichern eines Triggers und beim Live-Schalten einer Version; gespeichert wird trotzdem, und das Problem wird genannt.

### Feste Eingabe

Eine feste Eingabe gibt jedem Lauf, den der Trigger startet, dieselben Werte mit, etwa `owner` und `repo`, die eine geplante GitHub-Triage braucht. Öffne **Feste Eingabe hinzufügen** und gib ein JSON-Objekt mit höchstens 16 KiB ein. Die eigenen Felder des Triggers (`trigger`, `firedAt`, `event` und `payload`) überschreiben es, darum darf es sie nicht enthalten. Es sind reine Daten: Eine Vorlage wie `{{ input.owner }}` kommt als Text an, und beim Speichern warnt Tale davor.

Verlangt die Live-Version Felder, die der Trigger nicht sendet, ist der Abschnitt bereits geöffnet, und **Die 2 fehlenden Felder ergänzen** (oder entsprechend viele) schreibt für jedes Feld einen Platzhalter mit passendem Typ und setzt den Cursor in den ersten. Ersetze die Platzhalter und speichere. Ein geplanter Lauf erhält dann:

```json
{
  "owner": "acme",
  "repo": "website",
  "trigger": "schedule",
  "firedAt": 1791529200000
}
```

### Jetzt ausführen

**Jetzt ausführen** startet die Live-Version einmal im Live-Modus, mit der Eingabe, die der gespeicherte Trigger sendet, so wie der Trigger es täte. Bei einem Zeitplan siehst du zuerst diese Eingabe und bestätigst mit **Lauf starten**. Bei einem Webhook oder Ereignis öffnet sich der Lauf-Dialog mit dem Beispiel zum Bearbeiten. Die Schaltfläche wartet, bis eine Version live ist und deine Änderungen am Trigger gespeichert sind. Das Ergebnis erscheint unter der Schaltfläche: **Lauf gestartet.** mit **Lauf ansehen** oder der Grund, warum kein Lauf startete. Der Zeitplan und der letzte Lauf des Triggers bleiben, wie sie sind.

## Den Trigger nach dem Live-Schalten einschalten

Ein neuer Trigger ist zunächst ausgeschaltet, ebenso der Trigger eines mitgelieferten Pakets. Schaltest du eine Version live, im Editor oder durch das Hochladen eines Pakets, und ihr Trigger ist aus, meldet ein Hinweis **Ihr Trigger ist ausgeschaltet**. **Trigger einschalten** schaltet den gespeicherten Trigger unverändert ein, und der Hinweis lautet dann **Der Trigger ist eingeschaltet.**

Würde die Live-Version ablehnen, was der Trigger sendet, oder hat ein Webhook noch keine URL, bietet der Hinweis stattdessen **Trigger prüfen** an. Das öffnet den Abschnitt **Trigger** im Tab **Allgemein**, wo du zuerst die feste Eingabe ergänzt oder die URL erzeugst. Die mitgelieferten GitHub-Pakete sind ein Beispiel: Ihre Zeitpläne brauchen ein Repository, wie [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) erklärt.

## Einen Projektagenten nach Zeitplan starten

Ein Zeitplan kann einen der bestehenden Agenten eines Projekts an die Arbeit schicken: für eine Daueraufgabe, über die der Agent bei jedem Termin berichtet, oder für wiederkehrende Arbeit, die du sonst von Hand starten würdest. Installiere die Automatisierung im Projekt der Aufgabe, füge einen Schritt `task.start_agent` hinzu, der die Aufgabe nennt, und gib der Automatisierung einen Zeitplan. Jeder Termin startet den Agenten, der für die Aufgabe zuständig ist, oder weist die Aufgabe zuerst dem Agenten zu, den `agentId` nennt; dieser muss zum selben Projekt gehören. `feedback` ist die Nachricht, auf die der Lauf als Erstes eingeht, etwa die Angabe des Termins, für den er läuft:

```yaml
nodes:
  - id: start
    type: task.start_agent
    input:
      taskId: <ID der Aufgabe>
      moveToInProgress: false
      feedback: 'Scheduled occurrence {{ input.firedAt }}.'
```

Der Schritt liefert den gestarteten Lauf zurück, und die Zeitleiste der Aufgabe führt diesen Lauf als **Automatisierung** mit einem Link zum Automatisierungslauf. Ein Agent, der gerade an anderen Aufgaben arbeitet, wird trotzdem gestartet: Sein Lauf arbeitet in einem eigenen [Worker](/de/platform/projects/project-agents#run-one-agent-on-several-tasks), und sind alle Agenten-Worker deiner Organisation belegt, wartet er auf einen und startet von selbst. Startet der Schritt nichts, ist er trotzdem erfolgreich und nennt den Grund. So bleibt der Termin festgehalten, statt für später eingereiht zu werden:

| Antwort | Bedeutung |
| --- | --- |
| `started: true` | Der Lauf des Agenten wurde gestartet; `runId` nennt ihn. Mit `waitingReason` wartet der Lauf auf Platz, bevor er arbeitet: `org_limit`, wenn alle Agenten-Worker deiner Organisation belegt sind, `host`, wenn der Sandbox-Host voll ist, `destroy_pending`, wenn der Arbeitsbereich, den er nutzen würde, gerade gelöscht wird, `exec_limit`, wenn seine Sandbox noch einen früheren Prozess beendet. Er startet von selbst, sobald Platz frei wird. |
| `already_running` | Der vorherige Lauf der Aufgabe arbeitet noch und trägt die Arbeit weiter. Es startet nichts Neues, und der Termin wartet nicht darauf, dass dieser Lauf endet. |
| `in_review` | Mit `moveToInProgress: false` wartet die Karte auf ihren erfassten Prüfer, eine Person oder einen Agenten. Es wird nichts zugewiesen oder gestartet, und die Prüfung behält diesen Empfänger. |
| `closed` | Mit `moveToInProgress: false` steht die Karte auf **Erledigt** oder **Abgebrochen** (`taskStatus`). Es wird nichts zugewiesen oder gestartet. |
| `agent_busy` | Kommt nicht mehr vor: Ein Agent, der an einer anderen Aufgabe arbeitet, wird in einem eigenen Worker gestartet oder wartet auf einen. Ältere Läufe einer Automatisierung können die Antwort noch zeigen. |
| `blocked` | Eine Aufgabe, von der diese abhängt, ist noch offen (`blockedBy`). |
| `paused` | Die Aufgabe hat in der letzten Stunde schon drei Starts durch Automatisierungen und Agenten erhalten, gewöhnliche automatische Wiederholungen eingerechnet. Eine Broker-Wartezeit unmittelbar nach einem HTTP-429-Fehler desselben Agenten erhöht die Zahl nicht; aufeinanderfolgende Wartezeiten zählen weiterhin. `retryAfter` gibt an, wann die Stundengrenze einen weiteren Start zulässt; die übrigen Startprüfungen gelten weiterhin. |

Ein Lauf, den ein Zeitplan startet, arbeitet in niemandes Auftrag. Er nutzt die konfigurierten Anweisungen, Secrets und Tools des Agenten, und seine Kosten zählen als Automatisierungskosten gegen die Limits der Organisation. Connector-Aktionen, die er über die Plattform ausführen lässt, erfolgen in niemandes Namen und werden deshalb abgelehnt. Diese Befugnis behält er nur, solange der Zeitplan im Projekt handeln darf: Schaltest du den Zeitplan aus, entfernst du ihn oder deinstallierst du die Automatisierung aus dem Projekt, unterbleibt der nächste Start, ein noch nicht angelaufener Lauf schlägt fehl, und ein bereits arbeitender Lauf verliert die Tools seines Arbeitsbereichs. Startet eine Person die Automatisierung selbst, arbeitet der Lauf stattdessen in ihrem Auftrag, solange sie das Projekt bearbeiten darf. Ein Lauf, den ein Webhook oder ein Plattform-Ereignis gestartet hat, kann keine Agenten starten, und eine Automatisierung, die nicht im Projekt der Aufgabe installiert ist, erreicht dessen Agenten nicht.

`moveToInProgress` entscheidet, was mit der Karte geschieht. Standardmäßig wandert sie nach **In Bearbeitung**, und das Ergebnis wartet unter **In Prüfung** auf seinen [festgelegten Prüfer](/de/platform/projects/tasks#review-default), wie nach **Agent starten**; eine Prüfung, die zur früheren Arbeit noch offen ist, wird zurückgezogen, nie genehmigt. Mit `false` bleibt die Karte, wo sie ist, und der Lauf verlangt keine Prüfung; das passt zu einer Daueraufgabe unter **Zu erledigen**. Der Lauf behält diese Wahl bis zum Ende: Wenn er fertig ist, kommen sein Bericht und seine Dateien wie gewohnt an, und die Karte wird weder verschoben noch zur Prüfung geschickt, auch wenn sie inzwischen jemand nach **In Bearbeitung** verschoben hat. Ein solcher Start läuft nur unter offener Arbeit (**Backlog**, **Zu erledigen** oder **In Bearbeitung**): Eine Karte, die unter **In Prüfung** wartet, antwortet `in_review`, eine abgeschlossene `closed`. So stellt die Karte nie frühere Arbeit zur Beurteilung oder als erledigt dar, während darunter neue Arbeit läuft.

Bei dafür geeigneten Fehlern kann der Lauf automatisch wiederholt werden, solange Status und Zuweisung der Aufgabe unverändert bleiben und seit dem Start keine neue Status-, Zuweisungs-, Archivierungs- oder Prüfentscheidung getroffen wurde. Auch wenn du einen Wert änderst und danach zurücksetzt, endet diese Wiederholung; Kommentare beenden sie nicht. Die Grenzen für Wiederholungen, die Berechtigungen des Zeitplans und die Prüfungen des Arbeitsbereichs gelten weiterhin. Ein späterer Termin kann neue Arbeit starten, sobald die Voraussetzungen erfüllt sind.

### Den Zeitplan wecken, wenn ein Agent seinen Platz freigibt

Ein Zeitplan, der die Dauerrolle eines Projekts ausführt, etwa einen Manager, der Arbeit verteilt, kann zusätzlich auslösen, sobald ein Agent seines Projekts fertig ist und einer seiner regulären Worker frei wird, statt auf die nächste Cron-Minute zu warten. Du schaltest das mit `wakeOnSlotFreed: true` in der verwalteten Konfiguration des Zeitplans ein, die du mit der Tale CLI anwendest; nur ein aktivierter Zeitplan pro Projekt kann es haben – ein zweiter wird abgelehnt, ebenso die Installation seiner Automatisierung in einem Projekt, das bereits ein anderer Zeitplan weckt –, und die App hat dafür keinen Schalter. Jedes Wecken ist ein gewöhnlicher Termin mit der üblichen Eingabe `{ trigger: "schedule", firedAt }`, daher gelten die Antworten oben weiterhin. Mehrere Agenten, die fertig werden, während ein Wecken aussteht, ergeben zusammen ein Wecken. Ein Wecken wartet, solange auf der eigenen Karte des Managers noch ein Lauf aktiv ist oder automatisch wiederholt werden soll, die Karte den Start ablehnen würde oder nicht mehr dem Agenten zugewiesen ist, bis `retryAfter`, wenn die Aufgabe innerhalb der Stunde drei Starts hatte, und nach einem Termin, der nichts bewirkt hat, eine Minute, die sich bis zu einer Stunde verdoppelt, ohne Grenze für die Versuche. Andere Aufgaben desselben Agenten halten das Wecken nicht auf; der neue Lauf des Managers bekommt einen eigenen Worker oder wartet wie üblich auf Kapazität. Es gilt erst als erledigt, wenn der dadurch gestartete Lauf des Agenten begonnen und abgeschlossen hat. Solange der Zeitplan nach Fehlern pausiert, ausgeschaltet oder ohne `wakeOnSlotFreed` ist, wartet das Wecken und löst einmal aus, sobald der Zeitplan erneut gespeichert wird.

### Jedes Issue nach Zeitplan importieren

Ein Issue-Import liest pro Lauf höchstens einen Stapel mit bis zu 500 Issues und meldet, wo der nächste Stapel beginnt. Eine Person setzt ihn mit **Import fortsetzen** fort; ein Zeitplan merkt sich die Position stattdessen zwischen seinen Terminen. So importiert jeder Termin einen Stapel ab der Stelle, an der der vorherige aufgehört hat, bis alle offenen Issues gelesen sind, und der Termin danach beginnt den nächsten Durchgang. Lies die Position mit `task.get_import_cursor`, gib sie an den Import weiter und speichere dessen `nextCursor` mit `task.save_import_cursor`:

```yaml
nodes:
  - id: position
    type: task.get_import_cursor
    onError: continue
    input: { projectId: <the project's ID>, externalSystem: github, source: owner/repo }
  - id: issues
    type: subautomation
    automation: github-import-issues
    onError: continue
    input:
      projectId: <the project's ID>
      owner: owner
      repo: repo
      limit: 500
      cursor: '{{ nodes.position.output.cursor }}'
  - id: progress
    type: task.save_import_cursor
    onError: continue
    input:
      projectId: <the project's ID>
      externalSystem: github
      source: owner/repo
      revision: '{{ nodes.position.output.revision }}'
      next: '{{ nodes.issues.output.nextCursor ?? "" }}'
```

`source` ist dein Name für die Liste; Automatisierungen, die dieselbe Quelle nennen, teilen sich einen Durchgang. Das Lesen liefert außerdem `revision`, das Vergleichsmerkmal der Position, und das Speichern gibt es zurück: Die Position rückt nur vor, solange sie noch auf dieser Revision steht. Jeder gespeicherte Stapel, jeder Abschluss eines Durchgangs und jeder Neubeginn setzt eine neue Revision, und keine Revision wiederholt sich, auch wenn der Cursor-Text es tut. Ein fehlgeschlagener Import speichert nichts, also wiederholt der nächste Termin denselben Stapel. Ein Speichern mit einer früheren Revision wird abgelehnt (`conflict`) und schreibt nichts, ob es von einem überlappenden Lauf stammt, von einem Lauf, der sich über das Ende seines Durchgangs hinaus verspätet hat, oder von einem Lauf, der noch eine Position von vor einem Neubeginn hält. Nach drei Lesevorgängen einer Position ohne Speichern beginnt der nächste den Durchgang neu (`restarted`), statt eine Position zu wiederholen, die die Quelle immer wieder ablehnt, etwa nach der Umbenennung des Repositorys. Das Speichern meldet `batch` und `drained`, die ein Beleg angeben kann. Jeder Lauf aktualisiert außerdem bis zu 500 früher importierte Issues, die am längsten ungeprüften zuerst, sodass eine große Sammlung über mehrere Termine aktualisiert wird.

## Einen ausgebliebenen Start untersuchen

Oben im Abschnitt **Trigger** siehst du, wie es um den Trigger steht: wann er zuletzt einen Lauf gestartet hat, mit dessen Status und **Lauf ansehen**, oder **Hat noch keinen Lauf gestartet.** War der Trigger zuletzt fällig oder traf zuletzt ein Ereignis ein, ohne dass etwas startete, nennt ein Hinweis darunter den Grund, die Lösung und den Weg dorthin:

| Hinweis | Was passiert ist | Was du tust |
| --- | --- | --- |
| **Ausgelassen: keine Version bereitgestellt** | Der Trigger war fällig, aber es gibt nur Entwürfe. | **Editor öffnen** und eine getestete Version live schalten. |
| **Ausgelassen: Die Eingabe des Laufs wurde abgelehnt** | Die Live-Version hat abgelehnt, was der Trigger sendet. | Die fehlenden Felder in der [festen Eingabe](#feste-eingabe) ergänzen oder die Eingaben im Editor anpassen. |
| **Ausgelassen: Das Projekt kann keine Läufe starten** | Das Projekt ist archiviert, fehlt oder erlaubt die Automatisierung nicht mehr. | Mit **Projekte bearbeiten** die **Projekte** weiter unten anpassen. |
| **Ausgelassen: Der Lauf konnte nicht starten** | Der Start wurde aus einem anderen Grund abgelehnt. | **Technische Details** öffnen und Code und Meldung lesen. |
| **Ausgelassen: Der Zeitplan ist nicht lesbar** | Zeitplan oder Zeitzone waren nicht lesbar. Bis zur Korrektur startet nichts. | **Zeitplan bearbeiten** und speichern. |
| **3 Läufe wurden verpasst**, zum Beispiel | Läufe waren fällig, während Tale nicht verfügbar war. | Nichts; [Verpasste Läufe](#bei-verpassten-laeufen) hat entschieden, was startete. |
| **Nach wiederholten Fehlern pausiert** | Der Zeitplan hat sich selbst ausgeschaltet. | Siehe [Wenn sich ein Zeitplan selbst pausiert](#wenn-sich-ein-zeitplan-selbst-pausiert). |

**Technische Details** ist anfangs zugeklappt und enthält die rohen Fakten auf Englisch: den Code, die Version, die den Start abgelehnt hat, ihre Meldung und jedes Problem mit seinem Feld. Wurden auch frühere Läufe verpasst, nennt der Hinweis ihre Zahl. Über die API liest du dieselben Fakten als `lastSkipReason` und `lastSkipDetail`; siehe die [API-Referenz](/de/develop/api-reference#triggerzustand-pruefen-und-gezielt-pausieren).

<Frame caption="Ein abgelehnter Start: Der Hinweis sagt, warum, bietet die Behebung an und behält die rohen Fakten unter Technische Details.">

![Der Abschnitt Trigger eines eingeschalteten Zeitplans mit dem Hinweis Skipped: the run’s input was refused, der sagt, dass der Start am 10. Oktober 2026 um 11:00 fällig war, Version 1 aber ablehnte, was der Trigger sendet, dazu Add the 2 missing fields und Open the editor; Technical details ist geöffnet mit owner und repo, beide erforderlich, dem Code AUTOMATION_INPUT_INVALID und der Meldung. Darunter läuft der Zeitplan alle 30 Minuten, und This run receives endet mit der Warnung, dass Version 1 diese Eingabe nicht akzeptiert.](/images/platform/automation-trigger-skip-reason.webp)

</Frame>

Manche ausgebliebenen Starts zeigen keinen Hinweis:

- Eine Webhook-Anfrage, die Tale abgelehnt hat, hat keinen Lauf gestartet und am Trigger nichts verändert. Prüfe die Antwort an den Absender; [Webhooks](/de/develop/webhooks) listet die möglichen Antworten. Eine unbekannte oder ausgeschaltete URL erhält absichtlich dieselbe Ablehnung.
- Ein Lauf, der existiert, aber nicht fertig wurde, ist korrekt gestartet. Öffne ihn unter **Läufe**; die [Ausführungsprotokolle](/de/platform/automations/execution-logs) erklären, was darin passiert ist.

Der letzte Lauf ändert sich erst, wenn tatsächlich ein Lauf startet. Ein fälliger Trigger, der keinen starten kann, hält stattdessen den ausgelassenen Start fest. So unterscheidest du einen defekten Trigger von einem Workflow, der gestartet ist und später scheitert.

## Wenn sich ein Zeitplan selbst pausiert

Scheitern die Läufe eines Zeitplans bei jedem Termin auf dieselbe Weise, würde er sonst endlos weiter fehlschlagen. Tale zählt deshalb die Läufe eines Triggers, die an einem Fehler scheitern, den ein erneuter Versuch nicht behebt: am eigenen Code der Automatisierung (`node_error`), an einem Connector (`connector_error`), an einer Modellantwort, die nicht zu ihrem Schema passt (`llm_output_invalid`), oder am Modellanbieter der Organisation (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). Ein erfolgreicher Lauf setzt die Zählung zurück. Andere Fehler, etwa ein Ratenlimit oder ein nicht erreichbarer Anbieter, zählen nicht mit und setzen die Zählung auch nicht zurück. Hat sich ein Zeitplan bereits selbst pausiert, behält er die Zählung, die zur Pause geführt hat, auch wenn ein Lauf, der zu diesem Zeitpunkt noch lief, danach erfolgreich endet. Erst das Speichern des Triggers setzt die Zählung zurück.

Nach fünf solchen Fehlern in Folge schaltet der Zeitplan **Aktiv** aus und protokolliert `paused_after_failures`. Der Abschnitt **Trigger** zeigt dann die Pause, Code und Zeitpunkt des letzten Fehlers sowie **Lauf ansehen**, das diesen Lauf öffnet. Scheitern Läufe, während der Zeitplan noch aktiv ist, zeigt der Abschnitt, wie viele nacheinander fehlgeschlagen sind. Inhaber und Admins erhalten eine Benachrichtigung über die Glocke, per E-Mail zusätzlich, wenn die Organisation ein verbundenes Postfach hat; das Audit-Log hält die Pause fest. Unter **Einstellungen > Benachrichtigungen** können sie diese Hinweise mit **Automatisierungs-Warnungen** abschalten.

Öffne den fehlgeschlagenen Lauf, lies den Fehler und behebe ihn in der Automatisierung oder in ihrer Verbindung. Schalte danach **Aktiv** ein und speichere. Jedes Speichern des Triggers beginnt die Zählung neu, ob es den Zeitplan wieder einschaltet oder ausgeschaltet lässt, und markiert die Hinweise als gelesen.

Webhook- und Plattform-Ereignis-Trigger zählen Fehler genauso, werden aber nie pausiert. Ihre Läufe bringen eine Zustellung oder ein Ereignis mit, das ein pausierter Trigger verwerfen würde.

## Den Trigger pausieren oder ersetzen

Schalte **Aktiv** aus und speichere. Konfiguration und Laufhistorie bleiben erhalten; erneutes Einschalten setzt die Starts fort. **Trigger entfernen** löscht die Bindung und macht bei einem Webhook dessen URL unbrauchbar.

Trigger gehören zum Namen der Automatisierung, nicht zu einer Version. Live-Schaltung und Rollback behalten Zeitplan oder URL bei und ändern die Version künftiger Läufe. Eine Trigger-Änderung erzeugt keine Workflow-Version. Prüfe die Einstellungen daher auch bei einer Live-Schaltung, die erwartete Eingaben verändert.
