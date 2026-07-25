---
title: Rate-Limits
description: REST- und MCP-Rate-Limits — die zwei Buckets, die 429-Antwort und wie du wiederholst, ohne es schlimmer zu machen.
---

Die API ist pro Schlüssel mit Token-Buckets limitiert: Bursts gehen durch, Dauerfeuer antwortet **429**. Die Budgets sind so bemessen, dass eine normale Integration sie nie sieht — wenn ein bisher gesunder Client 429 zu treffen beginnt, fehlt fast immer ein Backoff oder eine Schleife läuft heiß, nicht die Kapazität.

Lies das, wenn du einen Client verdrahtest, der die API nach Zeitplan oder unter Last aufruft.

## Die Buckets

| Oberfläche                                                                                          | Budget              | Burst |
| --------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Lesen und CRUD — jeder `/api/v1`-Endpoint, der unten nicht steht, einschließlich `POST /api/v1/mcp` | 120 Anfragen / Min. | 200   |
| Arbeit starten — `POST /api/v1/automations/{name}/runs` und `POST /api/v1/threads/{id}/messages`    | 20 Anfragen / Min.  | 40    |

Der zweite Bucket ist mit Absicht klein: jede dieser Anfragen kostet einen ganzen durablen Lauf oder einen Modell-Turn, keinen Datenbank-Read. Ein Token-Bucket füllt sich kontinuierlich — die Burst-Kapazität schluckt einen Stapel, danach gilt die Dauerrate.

## Die 429

Eine Überschreitung antwortet mit dem gewöhnlichen Fehlerumschlag der API — nichts zu parsen außer dem Status:

```json
{ "error": "Rate limit exceeded" }
```

Es gibt keine Rate-Limit-Header — kein `Retry-After`, keine Restbudget-Zähler. Backe blind zurück: starte bei einer Sekunde, verdopple pro aufeinanderfolgendem 429, deckle bei sechzig, und füge Jitter hinzu, damit parallele Worker nicht im Gleichschritt wiederholen. Weil ein Lauf-Start mit **202** antwortet, bevor die Arbeit passiert, ist eine verlorene Antwort billig zu erkennen — liste die letzten Läufe der Automatisierung, bevor du erneut feuerst, statt Schreibzugriffe auf Verdacht zu wiederholen.

## Wo das hingehört

Die [API-Referenz](/de/develop/api-reference) nennt die 429 im Fehlermodell und zeigt hierher. Braucht dein Workload wirklich mehr, als die Budgets erlauben, bündle auf deiner Seite — `POST /api/v1/contacts/bulk` existiert genau dafür — oder strecke den Zeitplan; die Buckets gelten pro Schlüssel, zwei Schlüssel teilen sich also kein Budget.
