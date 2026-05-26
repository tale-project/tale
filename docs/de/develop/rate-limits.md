---
title: Rate-Limits
description: REST-API-Rate-Limits — Standard-Budgets pro Schlüssel, Org-Obergrenzen, die Form der 429-Antwort und wie du wiederholst, ohne es schlimmer zu machen.
---

Tales REST-API ist pro Schlüssel und pro Org rate-limitiert. Die Defaults sind auf normalen Anwendungsverkehr ausgelegt — Bursts sind in Ordnung, anhaltendes Hämmern gibt 429 zurück. Wenn du ein Limit triffst, trägt die Antwort die Header, die du brauchst, um sauber zurückzuschalten; der falsche Zug (Retry ohne Verzögerung, Retry für immer) verschärft die Drosselung nur.

Lies das, wenn du einen Client verdrahtest, der die API geplant oder unter Last aufruft. Komm zurück, wenn eine bisher gesunde Integration plötzlich 429 zurückgibt — die Antwort ist meist ein fehlendes Backoff, nicht eine fehlende Kapazitätszuteilung.

## Ein durchgespielter 429

Die kürzeste nützliche Interaktion ist eine Anfrage, die ihr Schlüssel-Budget überschreitet. Der Server gibt zurück:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717000060

{ "error": { "code": "rate_limited", "message": "Rate limit exceeded. Try again in 12 seconds." } }
```

`Retry-After` ist das massgebliche Warten — schlaf mindestens so lange vor dem nächsten Versuch. `X-RateLimit-Reset` ist der Unix-Timestamp, an dem das Fenster nachfüllt. Der Code im Body ist `rate_limited`; Clients sollen auf den Code verzweigen, nicht die Message parsen.

## Standard-Limits

| Oberfläche                       | Budget                            | Bucket           |
| -------------------------------- | --------------------------------- | ---------------- |
| REST-API (`/api/v1/*`)           | 120 Anfragen / Minute / Schlüssel | Token, Burst 200 |
| OpenAI-kompatibler Chat          | 30 Anfragen / Minute / Schlüssel  | Token, Burst 50  |
| OpenAI-kompatibles Model-Listing | 120 Anfragen / Minute / Schlüssel | Token, Burst 200 |
| Workflow-Trigger-Webhooks        | 60 Anfragen / Minute / Schlüssel  | Token, Burst 100 |
| Agent-Webhooks                   | 30 Anfragen / Minute / Schlüssel  | Token, Burst 50  |
| Datei-Upload                     | 50 Anfragen / Minute / Mitglied   | Festes Fenster   |
| E-Mail-Versand                   | 100 Nachrichten / Stunde / Org    | Token, Burst 120 |

Token-Buckets erlauben einen kurzen Burst über die Rate hinaus — nützlich für Batch-Importe — und pegeln sich dann auf die nachhaltige Rate ein. Feste Fenster füllen an der Minuten-Grenze nach; eine Anfrage um 14:59:59 und eine um 15:00:00 passieren beide. Wähl die Buckets passend: ein UI, das einmal pro Minute mountet, liest als ein Token, nicht als 60 über ein Fenster.

## Org-Obergrenzen

Tale Cloud legt eine weiche Obergrenze pro Org über die Schlüssel-Budgets, skaliert auf den Plan der Org. Die Obergrenze schützt gegen einen entlaufenen Schlüssel, indem sie verhindert, dass ein Client das gesamte Budget der Org verbraucht. Selbst gehostete Instanzen haben standardmässig keine Org-Obergrenze — die Schlüssel-Budgets oben sind der einzige Boden.

Wenn du auf Cloud ein höheres Budget pro Schlüssel für eine bekannte Last brauchst, frag den Support mit dem Schlüssel-Namen und der erwarteten nachhaltigen Rate. Kapazitätszuteilungen gelten pro Schlüssel, nicht pro Org.

## Retry-Strategie

Die richtige Strategie ist exponentielles Backoff mit Jitter, gedeckelt auf den `Retry-After`-Wert, wenn vorhanden:

1. Bei 429 lies `Retry-After` und schlaf mindestens so lange.
2. Wenn `Retry-After` fehlt (unüblich), starte bei 1 s und verdoppele bei jedem weiteren 429, gedeckelt bei 60 s.
3. Füg bis zu 25 % Jitter hinzu, damit parallele Clients nicht im Gleichschritt wiederholen.
4. Gib nach dem achten Versuch auf und melde den Fehler — der Bucket ist gesättigt, weitere Wiederholungen helfen nicht.

Idempotenz zählt hier: jeder Schreib-Endpoint akzeptiert einen `Idempotency-Key`-Header. Setz einen stabilen Key pro logischer Operation, damit Retries nicht doppelt feuern, wenn die ursprüngliche Anfrage erfolgreich war, die Antwort aber verloren ging. Siehe [API-Referenz](/de/develop/api-reference) für das Idempotenz-Fenster.

## Wo das hingehört

Rate-Limits sind, wie Tale verfügbar bleibt, wenn ein Client sich danebenbenimmt. Die [API-Referenz](/de/develop/api-reference) nennt den 429 im Error-Modell und verweist zurück hierher für die Regeln; die [Webhooks-Referenz](/de/develop/webhooks) deckt die passende Retry-Richtlinie für ausgehende Auslieferungen ab. Wenn dein Verkehr für die Defaults falsch geformt ist und eine Support-Zuteilung nicht reicht, ist der Reiter [Self-hosted](/de/self-hosted/overview) die andere Antwort — die Plattform selbst zu betreiben, hebt die Cloud-Obergrenzen auf.
