---
title: Rate-Limits
description: REST- und MCP-Rate-Limits — die Buckets, die 429-Antwort mit ihrem Retry-After und wie du wiederholst, ohne es schlimmer zu machen.
---

Die API ist pro Client-IP mit Token-Buckets limitiert — vor der Authentifizierung, das Budget hält also auch unauthentifiziertem Dauerfeuer stand: Bursts gehen durch, Dauerfeuer antwortet **429**. Eine Worker-Flotte hinter einem NAT-Egress kommt als eine IP an und teilt sich ein Budget. Die Budgets sind so bemessen, dass eine normale Connector sie nie sieht — wenn ein bisher gesunder Client 429 zu treffen beginnt, fehlt fast immer ein Backoff oder eine Schleife läuft heiß, nicht die Kapazität.

Lies das, wenn du einen Client verdrahtest, der die API nach Zeitplan oder unter Last aufruft.

## Die Buckets

| Oberfläche                                                                                                                        | Budget              | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Lesen und CRUD — jeder `/api/v1`-Endpoint, der unten nicht steht, einschließlich `POST /api/v1/mcp`                               | 120 Anfragen / Min. | 200   |
| Arbeit starten — `POST /api/v1/automations/{name}/runs`, `POST /api/v1/threads/{id}/messages` und `POST /api/v1/tasks/{id}/start` | 20 Anfragen / Min.  | 40    |
| Der Projekt-Upload-Fluss — jeder `POST` unter `/api/v1/projects/{id}/...` (Ordner, Upload-Handoffs, Datei-Bindungen)              | 240 Anfragen / Min. | 300   |

Der zweite Bucket ist mit Absicht klein: jede dieser Anfragen kostet einen ganzen durablen Lauf oder einen Modell-Turn, keinen Datenbank-Read. Der dritte ist mit Absicht geräumig: eine Datei kostet hier mindestens zwei Aufrufe — Handoff holen, Datei binden — das Budget deckt also die ganze Choreografie. Zwei Aufrufe ziehen aus mehr als einer Spur: der Ordner-Aufruf zählt auch gegen das allgemeine Budget, der Aufgaben-Start gegen das allgemeine und das Arbeit-starten-Budget — plane gegen die engere Spur. Ein Token-Bucket füllt sich kontinuierlich — die Burst-Kapazität schluckt einen Stapel, danach gilt die Dauerrate.

Manche Schreibzugriffe durchlaufen zusätzlich dieselben Budgets pro Benutzer oder Organisation wie ihre Zwillinge in der App — ein Aufgaben-Kommentar, eine Ordner-Änderung — und antworten jenseits davon mit derselben 429.

## Die 429

Eine Überschreitung antwortet mit dem gewöhnlichen Fehlerumschlag der API, plus einem `Retry-After`-Header, der die Wartezeit in ganzen Sekunden nennt (aufgerundet):

```json
{ "error": "Rate limit exceeded" }
```

Warte mindestens `Retry-After`, bevor du es erneut versuchst. Restbudget-Zähler gibt es keine — darüber hinaus backe blind zurück: starte bei einer Sekunde, verdopple pro aufeinanderfolgendem 429, deckle bei sechzig, und füge Jitter hinzu, damit parallele Worker nicht im Gleichschritt wiederholen. Weil ein Lauf-Start mit **202** antwortet, bevor die Arbeit passiert, ist eine verlorene Antwort billig zu erkennen — liste die letzten Läufe der Automatisierung, bevor du erneut feuerst, statt Schreibzugriffe auf Verdacht zu wiederholen.

## Wo das hingehört

Die [API-Referenz](/de/develop/api-reference) nennt die 429 im Fehlermodell und zeigt hierher. Braucht dein Workload wirklich mehr, als die Budgets erlauben, bündle auf deiner Seite — `POST /api/v1/contacts/bulk` existiert genau dafür — oder strecke den Zeitplan; die Buckets gelten pro IP — Traffic auf mehrere Schlüssel zu verteilen ändert nichts, eine Flotte teilt sich das Budget ihres NAT-Egress.
