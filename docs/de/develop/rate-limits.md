---
title: Anfragelimits berücksichtigen
description: Plane REST-, MCP- und Webhook-Aufrufe, interpretiere Retry-After und wiederhole angenommene Arbeit ohne Duplikate.
---

Tale begrenzt API-Verkehr pro Schlüsselinhaber. Alle API-Schlüssel derselben Person teilen deren Budget; ein Schlüssel, den ein Inhaber oder Admin für ein Mitglied, ein Team, ein Projekt oder die Organisation erstellt hat, hat ein eigenes. Berücksichtige daher sämtliche Integrationen und Polling-Prozesse dieser Identität, statt jeden Schlüssel einzeln zu planen.

Die folgenden Grenzen gelten für das aktuelle Backend. Ein vorgeschalteter Proxy oder nachgelagerter Anbieter kann zusätzliche Limits setzen.

## Die Budgets

Ein Token-Bucket füllt sich kontinuierlich bis zu seiner Burst-Kapazität auf. Eine kurze Serie kann diese Reserve nutzen; die dauerhafte Anfragerate muss innerhalb der Auffüllrate bleiben.

| Verkehr | Dauerhafte Rate | Burst | Budget gilt für |
| --- | --- | --- | --- |
| Allgemeine `/api/v1`-Aufrufe einschließlich MCP und Modell-Endpunkten | 120/Minute | 200 | Schlüsselinhaber |
| Laufstarts, Modellnachrichten, Aufgabenstarts und MCP-Ausführungen | 20/Minute | 40 | Schlüsselinhaber |
| Einstellungsänderungen über MCP (`apply_settings`) | 30/Minute | 60 | Schlüsselinhaber |
| Upload-Freigabe und Dateizuordnung im Projekt | 240/Minute | 300 | Schlüsselinhaber |
| Fehlgeschlagene API-Schlüsselprüfung | 20/Minute | 40 | Quell-IP |
| Webhook-Zustellungen vor der Tokenprüfung | 120/Minute | 240 | Absenderadresse |
| Zustellungen an einen geprüften Webhook-Auslöser | 20/Minute | 40 | Auslöser |

REST-Ausführungen und Uploads verbrauchen zusätzlich das allgemeine Budget. Eine Projektdatei braucht beispielsweise eine Upload-Freigabe und eine anschließende Dateizuordnung. Beide Aufrufe zählen gegen allgemeines und Upload-Budget. Das größere Upload-Budget umgeht die allgemeine Grenze nicht.

Zur Ausführung gehören projektgebundene und globale Automatisierungsstarts, Thread-Nachrichten und ausdrückliche Aufgabenstarts. Die Aufgabenübernahme verbraucht ebenfalls Ausführungsbudget, wenn `runWorkflowSlug` gesetzt ist. Eine Arbeit-startende Anfrage wird belastet, sobald Body und Kopfzeilen die eigenen Prüfungen der Tür bestanden haben — eine `400 INVALID_BODY` oder `INVALID_HEADER` kostet nichts — und bevor irgendetwas nachgeschlagen wird, eine `404` für einen Thread, eine Aufgabe oder eine Automatisierung, die du nicht sehen kannst, kostet also ein Token, so wie eine `409`, die der Zustand antwortet. Manche Änderungen, etwa Aufgabenkommentare und Ordneränderungen, unterliegen weiteren Fachbereichslimits, die auch für die App gelten.

MCP-Batches rechnen zusätzliche Tool-Aufrufe als zusätzliche Anfragen ab. Der [MCP-Endpunkt](/de/develop/mcp-endpoint) erklärt den Unterschied zwischen HTTP `429` und einer einzelnen abgelehnten Batch-Nachricht. Ein MCP-Tool, das eine Automatisierung ausführt (`run_automation`, `test_automation`, `deploy_automation`, `run_deployed`, `start_run` und `invoke_capability`), verbraucht zusätzlich eine Ausführung, sobald die Rolle des Schlüsselinhabers den Aufruf erlaubt; ebenso `answer_run_ask`, dessen Antwort einen wartenden Lauf fortsetzt wie die Antwort über REST. Ist dieses Budget aufgebraucht, antwortet der Aufruf mit einem Tool-Ergebnis mit `code` `RATE_LIMITED`, dessen `data.retryAfterMs` die Wartezeit nennt, nicht mit HTTP `429`. Lesen, Prüfen und Speichern verbrauchen keine Ausführung. Eine Einstellungsänderung (`apply_settings`) verbraucht auf dieselbe Weise eine Einheit ihres eigenen Einstellungsbudgets und wird mit `RATE_LIMITED` beantwortet, sobald es aufgebraucht ist; Einstellungen lesen und planen verbraucht nichts davon. Webhooks haben getrennte Budgets; sowohl Absender- als auch Auslöserlimit müssen die Zustellung zulassen.

Aufrufe der [Modell-Endpunkte](/de/develop/api-reference#model-endpoints) unter `/api/v1/openai` und `/api/v1/anthropic` zählen nur gegen das allgemeine Budget, jeweils als eine Anfrage, ob gestreamt oder nicht; was ein Aufruf ausgeben darf, begrenzen die Budgetregeln gesondert. Außerdem dürfen eine Person und jeder API-Schlüssel acht dieser Aufrufe gleichzeitig laufen haben: Ein neunter erhält `429` mit `code` `MODEL_API_CONCURRENCY_EXCEEDED` und `Retry-After: 2`.

Das Ausführungsbudget begrenzt, wie schnell Nachrichten angenommen werden, nicht die Zahl gleichzeitig laufender Antworten. Angenommene Chatnachrichten teilen sich eine Warteschlange über alle Organisationen und Schlüssel der Instanz. Ein Worker verarbeitet pro Durchgang bis zu `WORKER_CONCURRENCY` Antwortläufe, standardmäßig 5. Sein nächster Durchgang beginnt erst, wenn der aktuelle abgeschlossen ist. Eine erfolgreich angenommene Nachricht kann deshalb hinter anderen Clients warten. Die API liefert weder Warteschlangenposition noch geschätzten Startzeitpunkt.

## Die Antwort 429

Bei einer HTTP-Limitüberschreitung nennt `Retry-After` die Wartezeit in ganzen Sekunden. Der JSON-Body enthält dieselbe Wartezeit in Millisekunden. Dieses Beispiel verlangt mindestens zwei Sekunden Pause:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{
  "error": "Too many requests — retry after 1500 ms",
  "code": "RATE_LIMITED",
  "requestId": "example-request-id",
  "data": {"retryAfterMs": 1500}
}
```

Entscheide anhand von `code`. `error` beschreibt die Wartezeit als Satz; `requestId` identifiziert die Anfrage für die Fehlersuche. Das ist das REST-Format. Bei `/api/app` und Webhook-Limits bleibt der maschinenlesbare Code in `error`; werte diesen Text daher nicht oberflächenübergreifend aus. Tale liefert keinen Restbudget-Zähler. Erfasse deinen Verkehr und beachte die vorgegebene Wartezeit.

1. Stoppe die unmittelbare Wiederholungsschleife.
2. Warte mindestens `Retry-After`. Teilen mehrere Prozesse die Identität, koordiniere ihre Pause.
3. Vergrößere bei weiteren Ablehnungen den Abstand exponentiell mit einer Obergrenze und einer zufälligen Streuung. Beispielsweise kann er von einer auf sechzig Sekunden wachsen; eine längere Servervorgabe hat Vorrang.
4. Behalte bei unterstützten Operationen den ursprünglichen Idempotenzschlüssel. Nach einem Timeout beim Laufstart kann der Lauf bereits angenommen worden sein.

Auch ein Ausgabenlimit antwortet mit `429`, dann mit `code` `BUDGET_EXCEEDED`: Eine Budgetregel, die für den Schlüsselinhaber gilt – seine eigene, die eines Teams, der Organisation oder des API-Schlüssels und, für Arbeit in einem Projekt, die des Projekts –, ist ausgeschöpft. Kurzes Warten hilft hier nicht. `Retry-After` nennt die Zeit bis zum Zurücksetzen des Zeitraums, und `data` beschreibt die Grenze: `scope`, `period`, `limitCode`, `used`, `limit` und `resetsAt` in Epoch-Millisekunden. Es wird nichts eingereiht. Pausiere die Arbeit bis `resetsAt` oder bitte eine Person mit Administratorrechten, das Limit unter [Richtlinien & Limits](/de/platform/admin/governance/policies-and-limits) zu erhöhen. An den Modell-Endpunkten kommen beide `429` im Fehlerformat von OpenAI oder Anthropic, mit demselben `code` und `Retry-After`. Ein ausgeschöpftes Budget nennt seine Grenze dort in der Meldung statt in `data` und trägt `x-should-retry: false`, damit die SDKs der Anbieter es nicht selbst erneut versuchen.

Andere `4xx`-Antworten erfordern meist korrigierte Daten, Zugangsdaten oder Berechtigungen. Behandle nicht jeden Fehler als Limitüberschreitung; nutze das [Fehlermodell](/de/develop/api-reference#fehlermodell).

## Polling und Wiederholungen planen

Auch eine `304`-Antwort auf eine `ETag`-Prüfung zählt als Anfrage. Sie spart Datenvolumen, kein Budget. Ein Lauf, den du alle fünf Sekunden abfragst, braucht zwölf Leseaufrufe pro Minute, noch ohne Wiederholungen oder andere Arbeit. Reserviere Kapazität für diese zusätzlichen Aufrufe.

Fordere nur benötigte Felder an, etwa `?fields=status,finishedAt` bei einem Lauf. Frage seltener ab, wenn ein Mensch entscheiden muss, und beende Polling bei abgeschlossenen Läufen. [Einen Lauf starten und abfragen](/de/develop/api-reference#einen-lauf-starten-dann-pollen) erklärt Zustände und idempotente Starts.

Nutze bei größeren Importen unterstützte Sammelaufrufe wie `POST /api/v1/contacts/bulk` und verteile die Batches zeitlich. Weitere Schlüssel derselben Person vergrößern das Budget nicht. Braucht ein Ablauf eine eigene Identität und ein eigenes Budget, nutze einen Schlüssel, den ein Inhaber oder Admin für ein Team, ein Projekt oder die Organisation erstellt. Schlüsselrotation ist keine Wiederholungsstrategie.
