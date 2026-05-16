---
title: Webhooks
description: Workflows und Agents aus externen Systemen über Token-HTTP-Endpoints aufrufen.
---

Tale exponiert zwei eingehende Webhook-Oberflächen: **Workflow-Webhooks** (ein externer POST startet einen Workflow-Lauf) und **Agent-Webhooks** (ein externer POST schickt eine Nachricht an einen Agent und holt die Antwort). Beide nutzen eine Token-URL, in der das Token die Anmeldeberechtigung ist — keine separate HMAC-Signatur, kein gemeinsames Geheimnis zu rotieren, kein Signier-Code auf der Client-Seite zu schreiben. Diese Seite ist die Drahtreferenz für beide Oberflächen; für den durchgespielten Ablauf deckt [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook) die Workflow-Seite ab.

Das Publikum sind Integratoren, die ein externes System an Tale anbinden. Das Gegenstück — Tales ausgehende API, das was dein Code ruft — liegt unter [API-Referenz](/de/develop/api-reference).

## Durchgespieltes Beispiel — einen Workflow-Webhook auslösen

Der kleinstmögliche Workflow-Trigger aus cURL:

```bash
curl -X POST "https://your-tale-instance.com/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

Die Antwort kehrt sofort zurück, bevor der Workflow läuft:

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

Der Workflow läuft asynchron; das aufrufende System wartet nie auf den Output. Status und Schritt-Ergebnisse liegen im **Ausführungen**-Tab des Workflows — siehe [Ausführungslogs](/de/platform/automations/execution-logs).

## Workflow-Webhooks

Jeder Workflow mit einem Webhook-Trigger hat eine eindeutige URL der Form:

```text
https://<deine-tale-instanz>/api/workflows/wh/<TOKEN>
```

Das Token besteht aus 64 Hex-Zeichen und wird beim Hinzufügen des Triggers in **Automatisierungen > <workflow> > Triggers** generiert. Es ist die einzige Anmeldeberechtigung — wer die URL hält, kann Ereignisse an den Workflow posten.

### POST /api/workflows/wh/{token}

Starte einen Workflow-Lauf. Der POST-Body wird zur Workflow-Eingabe, adressierbar als `{{ trigger.body }}` in jedem Schritt.

| Name                | Typ    | Erforderlich | Beschreibung                                                                                                                                  |
| ------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`      | string | Ja           | `application/json`. Andere Content-Types werden abgelehnt.                                                                                    |
| `X-Idempotency-Key` | string | Nein         | Stabiler Identifier für sichere Wiederholungen. Doppelte Zustellungen liefern die ursprüngliche Ausführung statt einen neuen Lauf zu starten. |
| _Anfrage-Body_      | object | Ja           | Beliebiges JSON. Der ganze Body wird als Eingabe an den Workflow übergeben.                                                                   |

**Antwort — erste Zustellung:**

```json
{ "status": "accepted", "workflowSlug": "<workflow-slug>" }
```

**Antwort — doppelte Zustellung (gleicher `X-Idempotency-Key`):**

```json
{ "status": "duplicate", "executionId": "<id>" }
```

Der Duplikat-Pfad liefert die ID der ursprünglichen Ausführung zurück, damit der Aufrufer den bestehenden Lauf nachschlagen kann, statt zu raten, ob die Wiederholung griff.

### Status-Codes

| Code | Bedeutung                                                                               |
| ---- | --------------------------------------------------------------------------------------- |
| 200  | Akzeptiert (oder Duplikat). Der Body unterscheidet die zwei Fälle.                      |
| 400  | Ungültige JSON-Payload, fehlendes Token oder ungültiges Token-Format.                   |
| 403  | Webhook ist deaktiviert oder der Workflow ist nicht veröffentlicht / nicht installiert. |
| 404  | Token passt zu keinem Webhook.                                                          |
| 429  | Pro-IP-Rate-Limit überschritten.                                                        |

## Agent-Webhooks

Jeder Agent mit aktivem Webhook hat eine eindeutige URL:

```text
https://<deine-tale-instanz>/api/agents/wh/<TOKEN>
```

Tokens folgen demselben 64-Hex-Zeichen-Format wie Workflow-Tokens; erstelle oder widerrufe sie im **Webhook**-Tab des Agents. Der Endpunkt exponiert zwei Drahtformate — eine Tale-eigene Legacy-Form und einen OpenAI-kompatiblen Subpfad — sodass ein bestehender OpenAI-Client einen Agent adressieren kann, ohne die Anfrage neu zu schreiben.

### POST /api/agents/wh/{token} — Tale-eigene Form

Sende eine einzelne Nutzernachricht an den Agent. Die Antwort pollt, bis der Agent fertig generiert hat, oder streamt Server-Sent Events, wenn `stream: true`.

| Name       | Typ     | Erforderlich | Beschreibung                                                                                         |
| ---------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `message`  | string  | Ja           | Die Nutzernachricht. Klartext.                                                                       |
| `threadId` | string  | Nein         | Einen bestehenden Konversations-Thread wiederverwenden. Wird weggelassen, entsteht ein neuer Thread. |
| `stream`   | boolean | Nein         | Antwort als SSE streamen. Standard `false`.                                                          |

Der Body kann auch als `multipart/form-data` gesendet werden, um eine Datei neben der Nachricht anzuhängen — Felder sind `message`, `threadId`, `stream` und `file`.

**Antwort — ohne Streaming:**

```json
{
  "threadId": "<id>",
  "message": "<die Antwort des Agents>",
  "status": "done"
}
```

### POST /api/agents/wh/{token}/chat/completions — OpenAI-kompatibel

Derselbe Agent ist als OpenAI-Chat-Completions-Endpunkt adressierbar. Der Subpfad lässt jeden OpenAI-Client mit dem Agent sprechen, ohne ihn neu zu schreiben:

```bash
curl -X POST "https://<deine-tale-instanz>/api/agents/wh/<TOKEN>/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hallo!"}]
  }'
```

Das `model`-Feld ist optional — wenn vorhanden, validiert Tale es gegen die `supportedModels` des Agents und fällt stillschweigend auf den Standard des Agents zurück, wenn das angefragte Modell nicht erlaubt ist. Die Antwortform entspricht OpenAIs `/v1/chat/completions`.

### Status-Codes (beide Formen)

| Code | Bedeutung                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------- |
| 200  | Antwort geliefert.                                                                             |
| 400  | Ungültiger Body (fehlende `message`, fehlerhaftes JSON, leeres messages-Array).                |
| 401  | Ungültiges Webhook-Token.                                                                      |
| 403  | Webhook ist deaktiviert.                                                                       |
| 404  | Token passt zu keinem Agent-Webhook.                                                           |
| 429  | Pro-IP-Rate-Limit überschritten.                                                               |
| 413  | Verketteter Client-`system`-Text überschreitet 50 000 Zeichen (nur OpenAI-Subpfad).            |
| 504  | Antwort lief in den Timeout (der Agent wurde nicht innerhalb der 9-Minuten-Obergrenze fertig). |

## Token-Rotation

Es gibt kein Signatur-Geheimnis zu rotieren — die Anmeldeberechtigung ist das Token selbst. Zum Rotieren:

1. Öffne das **Triggers**-Panel des Workflows oder den **Webhook**-Tab des Agents.
2. Klicke **Neu generieren**. Tale prägt ein neues Token; das alte nimmt sofort keine Anfragen mehr an.
3. Aktualisiere die gespeicherte URL des aufrufenden Systems auf das neue Token.

Es gibt kein Überlappungsfenster: Neugenerierung ist sofortig, also sollten Updates auf der Client-Seite im selben Änderungsfenster landen. Für automatisierte Rotations-Abläufe behandle die Token-Rotation wie eine API-Schlüssel-Rotation — halte beide URLs kurz gültig, indem du einen zweiten Trigger hinzufügst, bevor du den alten zurückziehst.

## Wiederholungen und Idempotenz

Bei **Workflow-Webhooks** ist das aufrufende System für Wiederholungen verantwortlich. Tale wiederholt den eingehenden POST selbst nicht — die schrittspezifischen Wiederholungen des Workflows behandeln interne Fehler, aber eine Nicht-2xx-HTTP-Antwort liegt in der Verantwortung des Aufrufers. Nutze `X-Idempotency-Key`, um Wiederholungen auf der Client-Seite sicher zu machen.

Bei **Agent-Webhooks** ist die Anfrage synchron — der Aufrufer wartet auf die Antwort des Agents — und ein Wiederholen wiederholt den Modell-Aufruf. Setze einen sinnvollen Client-seitigen Timeout (lang genug für ein langsames Modell, kurz genug, dass hängende Verbindungen sich nicht stapeln) und vermeide Wiederholungen auf `200`-Antworten.

## Vertrauensgrenze

Was in jeder Richtung über das Netz geht:

- **Vom aufrufenden System zu Tale**: der POST-Body und die Kopfzeilen, einschließlich des Tokens in der URL. HTTPS schützt alles in Transit; das Token wird nicht als Kopfzeile gesendet, also bleibt es aus Standard-`Authorization`-Log-Zeilen heraus, erscheint aber in der URL jedes Access-Logs, das der Client schreibt. Behandle es entsprechend.
- **Von Tale zum aufrufenden System**: der Antwort-Body. Agent-Webhooks liefern die volle Antwort des Modells; Workflow-Webhooks liefern nur `accepted` / `duplicate` plus den Workflow-Slug oder die Execution-ID — nicht den Output des Workflows.
- **Was Tale mit der Payload tut**: der JSON-Body landet im Ausführungslog des Workflows oder in der Konversationshistorie des Agents, gesteuert von den Aufbewahrungs- und Audit-Richtlinien deiner Organisation. Es gibt keine separate externe Persistenz.

## Wo das einsetzt

Webhooks sind das eingehende Gegenstück zu Tales ausgehender API. Die API ist, was dein Code ruft, wenn du die Konversation treibst; Webhooks sind, was Tale exponiert, damit ein externes System einen Workflow treiben oder einen Agent adressieren kann, ohne in der Chat-UI zu sitzen. Beide Oberflächen teilen dasselbe Audit-Log, also deckt ein einziges Observability-Setup alles ab, was Tale empfängt.

Für die verwandten Teile: [API-Referenz](/de/develop/api-reference) ist die ausgehende Seite derselben Protokoll-Familie, [Triggers](/de/platform/automations/triggers) deckt ab, wie ein Workflow einen Webhook-Trigger einschaltet, und der [Agent-Webhook-Tab](/de/platform/agents/create#webhook-tab) führt durch das Pro-Agent-Setup.
