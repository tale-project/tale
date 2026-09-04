---
title: Rate-Limits
description: REST- und MCP-Rate-Limits — die Buckets, die 429-Antwort mit ihrem Retry-After und wie du wiederholst, ohne es schlimmer zu machen.
---

Die API limitiert mit Token-Buckets, die am Schlüsselinhaber hängen — dem Benutzer, als der dein API-Schlüssel handelt. Ein Budget gehört so immer einem erkennbaren Aufrufer, und kein Netzwerk-Header kann ein frisches prägen: Bursts gehen durch, Dauerfeuer antwortet **429**. Jeder Schlüssel, den ein Benutzer erstellt, zieht aus dem Budget dieses Benutzers; eine Worker-Flotte, die ein eigenes Budget braucht, bekommt einen eigenen Maschinenbenutzer. Ein Schlüssel, der sich nicht authentifizieren lässt, wird stattdessen pro Quell-IP gedrosselt (20 Anfragen pro Minute, Burst 40) — Fremde ziehen also nie aus dem Budget eines Schlüsselinhabers, und eine Anfrage ohne Schlüssel kostet gar nichts. Die Budgets sind so bemessen, dass eine normale Connector sie nie sieht — wenn ein bisher gesunder Client 429 zu treffen beginnt, fehlt fast immer ein Backoff oder eine Schleife läuft heiß, nicht die Kapazität.

Lies das, wenn du einen Client verdrahtest, der die API nach Zeitplan oder unter Last aufruft.

## Die Buckets

| Oberfläche                                                                                                                        | Budget              | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Lesen und CRUD — jeder `/api/v1`-Endpoint, der unten nicht steht, einschließlich `POST /api/v1/mcp`                               | 120 Anfragen / Min. | 200   |
| Arbeit starten — `POST /api/v1/automations/{name}/runs`, `POST /api/v1/threads/{id}/messages` und `POST /api/v1/tasks/{id}/start` | 20 Anfragen / Min.  | 40    |
| Der Projekt-Upload-Fluss — der Upload-Handoff und das Datei-Binden (`POST .../uploads` und `POST .../files`)                      | 240 Anfragen / Min. | 300   |

Der zweite Bucket ist mit Absicht klein: jede dieser Anfragen kostet einen ganzen durablen Lauf oder einen Modell-Turn, keinen Datenbank-Read. Der dritte ist mit Absicht geräumig: eine Datei kostet hier mindestens zwei Aufrufe — Handoff holen, Datei binden — das Budget deckt also die ganze Choreografie. Jede Anfrage zählt zusätzlich gegen das allgemeine Budget — es ist die Tür — ein Arbeit-startender oder Upload-POST zieht also aus zwei Spuren zugleich, und die engere bestimmt; plane gegen sie. Ein Ordner-Anlegen ist ein einfacher Schreibzugriff und zieht allein aus dem allgemeinen Budget. Ein Token-Bucket füllt sich kontinuierlich — die Burst-Kapazität schluckt einen Stapel, danach gilt die Dauerrate.

Manche Schreibzugriffe durchlaufen zusätzlich dieselben Budgets pro Benutzer oder Organisation wie ihre Zwillinge in der App — ein Aufgaben-Kommentar, eine Ordner-Änderung — und antworten jenseits davon mit derselben 429.

## Die 429

Eine Überschreitung antwortet mit dem gewöhnlichen Fehlerumschlag der API, plus einem `Retry-After`-Header, der die Wartezeit in ganzen Sekunden nennt (aufgerundet):

```json
{ "error": "Rate limit exceeded" }
```

Warte mindestens `Retry-After`, bevor du es erneut versuchst. Restbudget-Zähler gibt es keine — darüber hinaus backe blind zurück: starte bei einer Sekunde, verdopple pro aufeinanderfolgendem 429, deckle bei sechzig, und füge Jitter hinzu, damit parallele Worker nicht im Gleichschritt wiederholen. Weil ein Lauf-Start mit **202** antwortet, bevor die Arbeit passiert, ist eine verlorene Antwort billig zu erkennen — liste die letzten Läufe der Automatisierung, bevor du erneut feuerst, statt Schreibzugriffe auf Verdacht zu wiederholen.

## Wo das hingehört

Die [API-Referenz](/de/develop/api-reference) nennt die 429 im Fehlermodell und zeigt hierher. Braucht dein Workload wirklich mehr, als die Budgets erlauben, bündle auf deiner Seite — `POST /api/v1/contacts/bulk` existiert genau dafür — oder strecke den Zeitplan; die Buckets gelten pro Schlüsselinhaber — Traffic auf mehrere Schlüssel desselben Benutzers zu verteilen ändert nichts. Eine Integration, die wirklich ein eigenes Budget braucht, bekommt einen eigenen Maschinenbenutzer.
