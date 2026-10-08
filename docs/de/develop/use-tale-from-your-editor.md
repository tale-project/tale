---
title: Tale aus deinem Editor oder einem Skript nutzen
description: Rufe die Modelle deiner Organisation aus opencode, Claude Code oder den OpenAI- und Anthropic-SDKs auf, nutze den REST-Chat oder die MCP-Tools von Tale.
i18nLintExclude:
  - terminology-loanword
---

Tale lässt sich auf vier Wegen in deine Entwicklungsarbeit einbinden. Sie unterscheiden sich darin, welches Sprachmodell läuft und wie viel der Arbeit Tale steuert:

| Du möchtest | Weg | Modell | Was Tale steuert |
| --- | --- | --- | --- |
| Die Modelle deiner Organisation als Modellanbieter von opencode, Claude Code oder einem SDK-Skript | [Die Modell-Endpunkte](#model-endpoints) | Ein Modell der Organisation, das du in jeder Anfrage mit seiner ID nennst | Jeden Modellaufruf: Modellzugriff, Eingabe-Guardrails, Budgets, Verbrauch unter deinem Namen und Schlüssel; nicht die Antworten |
| Den eingebauten Assistenten aus einem Skript fragen | [Die REST-Chat-API](#die-rest-chat-api-aus-einem-skript-nutzen) | Ein Modell der Organisation, das du in jeder Anfrage nennst | Den ganzen Turn: Modellzugriff, Budgets, Verbrauch unter deinem Namen |
| Wissen und Automatisierungs-Tools von Tale in opencode oder Claude Code | [Der MCP-Endpoint](#opencode-oder-claude-code-verbinden) | Das Modell, das in deinem Editor eingerichtet ist | Nur die Tool-Aufrufe; die Modellaufrufe des Editors laufen an Tale vorbei |
| Ein Skript mit den Modellen deiner Organisation bearbeiten lassen | [Ein Projektagent an einer Aufgabe](#skripte-von-einem-projektagenten-bearbeiten-lassen) | Das Modell der Organisation, mit dem der Agent eingerichtet ist | Den ganzen Lauf: Sandbox, Budgets, Verbrauch, Prüfung |

Ein Editor kann zwei davon mit demselben Schlüssel nutzen: die Modell-Endpunkte als Modellanbieter und den MCP-Endpoint für das Wissen von Tale. [Der letzte Abschnitt](#was-aus-dem-openai-kompatiblen-endpunkt-wurde) erklärt, worin sich die Modell-Endpunkte von der OpenAI-kompatiblen Schicht aus Tale 0.3 unterscheiden.

## Einen API-Schlüssel erstellen

Jeder Zugriff von außerhalb der App beginnt mit einem persönlichen API-Schlüssel. Inhaber, Admins und Entwickler erstellen ihn unter **Einstellungen > API > REST** mit **API-Schlüssel erstellen** und legen dabei Namen und Ablaufzeit fest. Das kann auch ein Mitglied, dem ein Admin eine Kompetenz zugewiesen hat, die mit einem Schlüssel genutzt wird, etwa **Modelle über die API aufrufen**. Der geheime Wert erscheint nur einmal. Kopiere ihn in deinen Secret-Speicher oder eine private Shell-Umgebung, bevor du den Dialog schließt. [API-Schlüssel](/de/platform/admin/api-keys) beschreibt Erstellen, Rotieren und Widerrufen.

Ein Schlüssel handelt in deinem Namen. Er trägt deine aktuelle Rolle und deinen Projektzugriff, und der Verbrauch, den er verursacht, wird dir zugeordnet. Chat-Turns, Modellaufrufe und Automatisierungsläufe, die du mit dem Schlüssel startest, erfassen zusätzlich den Schlüssel, sodass auch API-Schlüssellimits für sie gelten. Ein Lauf eines Projektagenten wird nur dir zugeordnet. Ein Admin kann deine Ausgaben mit einem persönlichen, Team- oder Rollenbudget unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) begrenzen. Eine Anfrage über der Grenze lehnt Tale mit `429 BUDGET_EXCEEDED` ab.

Die Beispiele auf dieser Seite lesen drei Umgebungsvariablen. `TALE_URL` ist der Ursprung deiner Instanz ohne `/api/v1`. `TALE_ORG_SLUG` ist der Slug der Organisation; du findest ihn unter **Einstellungen > API > MCP**, unter **Einstellungen > API > Modelle**, sobald die Modell-Endpunkte eingeschaltet sind, und in der Antwort von `GET /api/v1/me`. Exportiere alle drei in deiner Shell. `TALE_API_KEY` gehört in keine Datei, die du committest.

## Die Modelle deiner Organisation aus deinen Tools nutzen {#model-endpoints}

Mit den Modell-Endpunkten verwenden opencode, Claude Code und Skripte, die auf den SDKs von OpenAI oder Anthropic aufbauen, die freigegebenen Modelle deiner Organisation als Modellanbieter. Tale spricht die Schnittstellen OpenAI Chat Completions und Anthropic Messages, die diese Tools ohnehin nutzen. Du änderst also Basis-URL, Schlüssel und Modellnamen, nicht deinen Code. Jede Anfrage ist ein reiner Modellaufruf: Weder der eingebaute Assistent noch ein Thread noch ein Tool von Tale ist beteiligt, und die Antwort kommt so zurück, wie das Modell sie geschickt hat.

### Voraussetzungen

Die Endpunkte sind ausgeschaltet, bis ein Admin unter **Einstellungen > Richtlinien > Modelle** den Schalter **Modell-Endpunkte für API-Schlüssel** einschaltet; [Modelle](/de/platform/admin/governance/content-models#model-endpoints) beschreibt ihn. Danach dürfen Inhaber, Admins und Entwickler sie über ihre Rolle aufrufen. Jedes andere Mitglied braucht die Kompetenz **Modelle über die API aufrufen**, die ein Admin unter [Kompetenzen](/de/platform/admin/governance/competences) zuweist. `GET /api/v1/me` antwortet mit `capabilities.modelApi: true`, sobald dein Schlüssel sie aufrufen darf.

**Einstellungen > API > Modelle** bündelt, was deine Tools brauchen: beide Basis-URLs, den Organisations-Slug, die Modelle, die du aufrufen kannst, mit einer Kopierschaltfläche für jede ID, und Konfigurationen zum Kopieren für opencode, Claude Code und das OpenAI-SDK für Python. Solange deine Organisation die Endpunkte nicht eingeschaltet hat, zeigt der Tab **Die Modell-Endpunkte sind für deine Organisation nicht aktiviert**; Inhaber und Admins finden dort **Modellzugriff öffnen**.

<Frame caption="Einstellungen > API > Modelle — die Basis-URLs, der Organisations-Slug und die Modelle, die du aufrufen kannst.">

![Der Tab Modelle unter Einstellungen > API mit den OpenAI- und Anthropic-kompatiblen Basis-URLs, dem Authorization-Header für einen API-Schlüssel, dem Organisations-Slug northlight-labs und fünf Modell-IDs mit je einem Kopierknopf.](/images/develop/settings-api-models.webp)

</Frame>

### Verbindungsdaten

| Angabe | Wert |
| --- | --- |
| OpenAI-kompatible Basis-URL | `https://<host>/api/v1/openai`; die OpenAI-SDKs und opencode hängen `/chat/completions` an |
| Anthropic-kompatible Basis-URL | `https://<host>/api/v1/anthropic`; die Anthropic-SDKs und Claude Code hängen `/v1/messages` an |
| Schlüssel | Dein persönlicher API-Schlüssel als `Authorization: Bearer <key>`. Tale lehnt den Header `x-api-key` mit `401` ab; ein Anthropic-Client muss den Schlüssel deshalb als Auth-Token senden |
| Organisation | `X-Organization-Slug: <slug>`, nötig, wenn du mehreren Organisationen angehörst |
| Modell | `<providerSlug>/<modelId>`: der Slug des Anbieters, ein Schrägstrich und die ID des Modells im Katalog dieses Anbieters, etwa `openrouter/anthropic/claude-sonnet-4.6` oder `deepseek/deepseek-v4-flash` |

Dieselbe ID gilt an beiden Endpunkten. Prüfe den Schlüssel und liste die IDs, die du aufrufen darfst; setze dabei deinen Host und deinen Slug statt `tale.example.com` und `acme` ein:

```bash
curl https://tale.example.com/api/v1/openai/models \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: acme"
```

Die Antwort ist eine Modellliste im OpenAI-Format: `owned_by` ist der Slug des Anbieters, `created` ist immer `0`. Sie sieht etwa so aus, mit den IDs, die deine Organisation dir anbietet:

```json
{
  "object": "list",
  "data": [
    { "id": "openrouter/anthropic/claude-sonnet-4.6", "object": "model", "created": 0, "owned_by": "openrouter" },
    { "id": "deepseek/deepseek-v4-flash", "object": "model", "created": 0, "owned_by": "deepseek" }
  ]
}
```

Die Liste enthält die Chatmodelle deiner Organisation, die Anbieter-Zugangsdaten vom Typ **API-Schlüssel** oder **Umgebungsvariable** bereitstellen, eingeschränkt durch die erlaubten Modelle der jeweiligen Zugangsdaten und durch deinen Modellzugriff. Modelle, die über Abonnement-Zugangsdaten laufen, fehlen darin, ebenso Modelle eines Anbieters, dessen Endpunkt je Zugangsdaten-Eintrag festgelegt wird, etwa Azure, und Modelle, die Tools nur über die Responses-API von OpenAI aufrufen, etwa GPT-6.1 Sol, denn diese Endpunkte leiten sie nicht weiter. `GET /api/v1/models` nennt für jedes dieser Modelle Kontextfenster, Fähigkeiten und Preise, unter demselben `providerSlug` und derselben `id`.

### opencode auf Tale ausrichten

Trag Tale als Anbieter in deine globale `opencode.json` oder in die des Projekts ein. opencode erreicht Tale über sein OpenAI-kompatibles Paket und liest den Schlüssel aus `TALE_API_KEY`. Führe unter `models` jedes Modell, das du wählen willst, mit seiner ID auf; `model` legt den Standard fest, als `tale/` gefolgt von dieser ID.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "tale": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Tale",
      "options": {
        "baseURL": "https://tale.example.com/api/v1/openai",
        "apiKey": "{env:TALE_API_KEY}",
        "headers": { "X-Organization-Slug": "acme" }
      },
      "models": {
        "openrouter/anthropic/claude-sonnet-4.6": { "name": "Claude Sonnet 4.6" }
      }
    }
  },
  "model": "tale/openrouter/anthropic/claude-sonnet-4.6"
}
```

Der Block `provider` kann in derselben Datei neben dem Block `mcp` aus der [MCP-Konfiguration](#opencode) stehen. Starte opencode aus einer Shell, in der `TALE_API_KEY` gesetzt ist.

### Claude Code auf Tale ausrichten

Claude Code liest seinen Modellanbieter aus Umgebungsvariablen. Setze sie in der Shell, aus der du es startest:

```bash
export ANTHROPIC_BASE_URL="https://tale.example.com/api/v1/anthropic"
export ANTHROPIC_AUTH_TOKEN="$TALE_API_KEY"
export ANTHROPIC_CUSTOM_HEADERS="X-Organization-Slug: acme"
export ANTHROPIC_MODEL="openrouter/anthropic/claude-sonnet-4.6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="openrouter/anthropic/claude-haiku-4.5"
unset ANTHROPIC_API_KEY
claude
```

`ANTHROPIC_AUTH_TOKEN` sendet den Schlüssel als Bearer-Token. Lass `ANTHROPIC_API_KEY` ungesetzt: Claude Code würde ihn als `x-api-key` senden, und diesen Header lehnt Tale ab. `ANTHROPIC_DEFAULT_HAIKU_MODEL` ist das Modell, das Claude Code für Hintergrundaufgaben nutzt; beide Modellvariablen müssen IDs aus deiner Liste nennen. Das Tool WebSearch von Claude Code lässt die Suche vom Modellanbieter selbst ausführen, deshalb lehnt Tale solche Anfragen ab. Die Tools, die Claude Code auf deinem Rechner ausführt, funktionieren wie gewohnt.

### Die Modelle aus einem Skript aufrufen

Das OpenAI-SDK für Python braucht eine andere Basis-URL und den Organisations-Header. Das Beispiel liest den Schlüssel aus `TALE_API_KEY`, fragt einmal eine vollständige Antwort ab und streamt dann eine zweite:

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://tale.example.com/api/v1/openai",
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
MODEL = "openrouter/anthropic/claude-sonnet-4.6"

reply = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Was bedeutet der Cron-Ausdruck 0 3 * * 1?"}],
)
print(reply.choices[0].message.content)

stream = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "Schreib eine Commit-Nachricht für eine Tippfehlerkorrektur."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

Tools, `tool_calls` und Bilder funktionieren wie bei OpenAI, und `model` in der Antwort ist die ID, die du gesendet hast. Ein Stream endet mit `data: [DONE]`; den abschließenden Chunk mit dem Verbrauch erhältst du nur, wenn du `stream_options={"include_usage": True}` übergibst.

Das Anthropic-SDK für Python nimmt den Schlüssel als Auth-Token. Führe es mit ungesetztem `ANTHROPIC_API_KEY` aus, denn das SDK würde den Wert dieser Variable als `x-api-key` senden, und diesen Header lehnt Tale ab:

```python
import os

import anthropic

client = anthropic.Anthropic(
    base_url="https://tale.example.com/api/v1/anthropic",
    auth_token=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)

message = client.messages.create(
    model="openrouter/anthropic/claude-sonnet-4.6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Erkläre den Fehler ECONNRESET in einem Absatz."}],
)
print(message.content[0].text)
```

### Was Tale bei jedem Aufruf prüft

Jeder Aufruf wird wie eine Chat-Anfrage geprüft, und zwar für die Person, deren Schlüssel ihn gesendet hat:

- **Schalter und Recht.** Die Organisation hat die Endpunkte eingeschaltet, und deine Rolle oder Kompetenz erlaubt dir den Aufruf.
- **Das Modell.** Es muss auf deiner Liste stehen, und der Modellzugriff der Organisation muss es dir zum Zeitpunkt des Aufrufs erlauben. Die erlaubten Modelle der Anbieter-Zugangsdaten gelten ebenfalls.
- **Was das Modell lesen kann.** Bilder verlangen ein Modell, das Bilder lesen kann, Tools ein Modell, das Tools annimmt. Bilder kommen als OpenAI-Teile `image_url` mit einer `data:`- oder `https:`-URL oder als Anthropic-Blöcke `image` in Base64 oder mit einer `https:`-URL, auch in Tool-Ergebnissen. Dokumente kommen als OpenAI-Teile `file` oder als Anthropic-Blöcke `document`.
- **Die Eingabe-Guardrails.** Inhaltssicherheit, PII-Schutz und Moderationsanbieter der Organisation lesen jeden Text der Anfrage, bevor Tale sie weitergibt: System- und Entwickleranweisungen, deine Turns und die des Assistenten, Tool-Aufrufe, Tool-Ergebnisse und Tool-Definitionen sowie Dokumente, die als Text mitkommen. Blockieren lehnt die Anfrage ab, Maskieren schickt dem Modell den maskierten Text. Nicht gefiltert werden die Antworten des Modells sowie Bilder und Dokumente, die kein Text sind. Einzelheiten stehen unter [Guardrails](/de/platform/admin/governance/guardrails#model-endpoints).
- **Die Budgets.** Vor dem Aufruf ermittelt Tale den ungünstigsten Fall, den geschätzten Prompt plus die höchstmögliche Ausgabe zum Katalogpreis des Modells. Passt er nicht in das, was unter einer Budgetgrenze für dich, deine Teams, die Organisation oder den Schlüssel – beim eigenen Schlüssel eines Projekts auch für sein Projekt – noch übrig ist, lehnt Tale den Aufruf mit `429 BUDGET_EXCEEDED` ab; sonst reserviert es ihn gegen diese Grenzen, solange der Aufruf läuft. Ein kleineres `max_tokens` passt eher. Danach verbucht Tale die vom Modell-Gateway gemessenen Kosten und die gemeldeten Tokens unter deinem Namen und dem Schlüssel. Brichst du einen Aufruf ab, während Tale ihn noch prüft, leitet Tale ihn nicht weiter und verbucht ihn nicht. Brichst du ihn ab, nachdem er weitergeleitet wurde, bricht Tale auch die Anfrage an den Anbieter ab, und der Aufruf wird trotzdem verbucht: mindestens mit seinem Prompt und der Ausgabe, die dich schon erreicht hatte, zum Katalogpreis des Modells. Jeder Aufruf zählt als eine Anfrage und erscheint in der Nutzungsanalyse als **Direkter API-Aufruf**.
- **Acht Aufrufe gleichzeitig.** Du und jeder deiner Schlüssel dürfen acht Aufrufe gleichzeitig laufen haben. Einen neunten lehnt Tale mit `429 MODEL_API_CONCURRENCY_EXCEEDED` und einem `Retry-After` von zwei Sekunden ab.

Deine Tools sehen nie einen Anbieterschlüssel. Tale leitet jeden Aufruf über sein Modell-Gateway weiter, mit einem Schlüssel, der nur für diese eine Anfrage und dieses eine Modell erzeugt wird. Widerrufst du deinen API-Schlüssel unter **Einstellungen > API > REST**, endet sein Zugriff mit der nächsten Anfrage; eine Antwort, die bereits gestreamt wird, läuft zu Ende.

### Was die Endpunkte nicht bedienen

- **Tools, die der Modellanbieter selbst ausführt.** `web_search_options` von OpenAI und jedes Tool, dessen Typ nicht `function` oder `custom` ist, sowie Websuche, Web-Abruf, Codeausführung und MCP-Toolsets von Anthropic samt den Feldern `mcp_servers` und `container` lehnt Tale mit `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED` ab, weil es sie weder messen noch protokollieren könnte. Deine eigenen Tools werden weitergereicht und kommen als `tool_calls` oder `tool_use` zurück, auch die Client-Tools `bash`, `text_editor`, `computer` und `memory` von Anthropic.
- **Audioeingaben.** Anfragen mit Teilen vom Typ `input_audio` lehnt Tale ab.
- **Anfragen, die Tale nicht abrechnen oder in deiner Organisation halten kann.** Mehr als acht Antworten pro Anfrage (`n`), Dateien im Konto des Anbieters (eine OpenAI-`file_id`, eine Anthropic-Quelle vom Typ `file`), ein `service_tier` außer `auto` oder `default` (`auto` oder `standard_only` bei Anthropic), Audioausgabe und `store: true` lehnt Tale mit `400 INVALID_BODY` ab.
- **Andere Routen.** `count_tokens` und alle anderen Routen von Anthropic bedient Tale nicht, ebenso wenig OpenAI-Routen jenseits von Chat Completions und der Modellliste, etwa Embeddings, Responses oder Bildgenerierung.
- **Assistent und Tools von Tale.** Dafür nutzt du [die REST-Chat-API](#die-rest-chat-api-aus-einem-skript-nutzen) oder [den MCP-Endpoint](#opencode-oder-claude-code-verbinden).

### Einen abgelehnten Aufruf beheben

Jede Ablehnung kommt im Fehlerformat der Schnittstelle, die du aufgerufen hast, und dein SDK meldet sie wie einen Fehler von OpenAI oder Anthropic. Das Feld `code` enthält den stabilen Code von Tale; die [API-Referenz](/de/develop/api-reference#model-endpoints) führt alle auf.

| Status und Code | Was du tun kannst |
| --- | --- |
| `401 UNAUTHORIZED` | Sende den Schlüssel als `Authorization: Bearer`, nie als `x-api-key`. Setze für Claude Code `ANTHROPIC_AUTH_TOKEN` und entferne `ANTHROPIC_API_KEY`; übergib den Schlüssel bei den Anthropic-SDKs als `auth_token` oder `authToken`. Auch ein widerrufener oder abgelaufener Schlüssel führt zu `401`. |
| `400 ORG_SLUG_REQUIRED` | Du gehörst mehreren Organisationen an. Sende `X-Organization-Slug` mit. |
| `403 MODEL_API_DISABLED` | Die Organisation hat die Endpunkte nicht eingeschaltet. Wende dich an einen Admin. |
| `403 MODEL_API_FORBIDDEN` | Deine Rolle darf sie nicht aufrufen. Frag einen Admin nach der Kompetenz **Modelle über die API aufrufen**. |
| `404 MODEL_API_MODEL_UNKNOWN` | Die ID steht nicht auf deiner Liste. Kopiere eine aus `GET /api/v1/openai/models` oder dem Tab **Modelle**, samt Slug des Anbieters. |
| `403 MODEL_API_MODEL_FORBIDDEN` | Der Modellzugriff sperrt dieses Modell für dich. Wähle ein anderes Modell oder wende dich an einen Admin. |
| `400 MODEL_API_VISION_UNSUPPORTED`, `400 MODEL_API_TOOLS_UNSUPPORTED` | Wähle ein Modell, das Bilder liest oder Tools annimmt, oder sende die Anfrage ohne sie. |
| `400 MODEL_API_VENDOR_TOOL_UNSUPPORTED` | Entferne das Tool, das der Modellanbieter selbst ausführen würde, etwa eine Websuche. In Claude Code löst das Tool WebSearch diese Ablehnung aus. |
| `400 MODEL_API_GUARDRAIL_BLOCKED` | Eine Guardrail hat den System-Prompt oder eine Nachricht abgelehnt, und beim Modell kam nichts an. Formuliere um oder frag einen Admin nach der Regel. |
| `403 MODEL_API_GUARDRAIL_UNSUPPORTED` | Der PII-Schutz der Organisation tokenisiert, und das können die Modell-Endpunkte nicht umsetzen. Ein Admin kann ihn auf Maskieren oder Blockieren umstellen. |
| `429 RATE_LIMITED` | Du hast mehr Anfragen gesendet, als das gemeinsame Kontingent deiner API-Schlüssel erlaubt. Warte die Zeit aus `Retry-After` ab; siehe [Ratenlimits](/de/develop/rate-limits). |
| `429 BUDGET_EXCEEDED` | Eine Budgetgrenze ist erreicht. `Retry-After` nennt die Zeit bis zum Zurücksetzen, und die Antwort trägt `x-should-retry: false`, damit die SDKs es nicht selbst erneut versuchen. Warte oder lass einen Admin die Grenze anheben. |
| `503 MODEL_API_UNAVAILABLE`, `503 MODEL_API_GUARDRAIL_UNAVAILABLE` | Ein Dienst, den der Aufruf braucht, ist nicht verfügbar, etwa das Modell-Gateway oder der Moderationsanbieter. Versuche es später erneut; hält der Fehler an, soll ein Admin die Anbieter-Zugangsdaten oder den Moderationsanbieter prüfen. |
| `MODEL_API_UPSTREAM_ERROR` | Der Modellanbieter hat den Aufruf abgelehnt, und die Meldung stammt von ihm. `400`, `413`, `422`, `429`, `503` und `529` behalten ihren Status; jede andere Ablehnung kommt als `502` an. |

## Die REST-Chat-API aus einem Skript nutzen

Über die REST-Chat-API erreicht ein Skript denselben Assistenten, den Mitglieder im Chat der App verwenden. Das ist kein reiner Modellaufruf: Jeder Turn läuft über den eingebauten Assistenten. Er durchsucht das Wissen deiner Organisation, wenn die Frage es verlangt, und verweist Wünsche nach Dokumenten oder anderen Arbeitsergebnissen an Aufgaben. Die API arbeitet asynchron. Ein Senden antwortet mit `202` und der ID der Antwort, danach fragst du den Status ab, bis der Turn abgeschlossen ist.

Die Beispiele teilen sich eine Hilfsfunktion, die bei jeder Anfrage den Schlüssel und den Organisations-Header mitschickt. Speichere sie als `tale-api.sh`:

```bash
# tale-api.sh: aus deiner Shell oder aus einem Skript mit source laden
: "${TALE_URL:?TALE_URL auf den Tale-Ursprung ohne /api/v1 setzen}"
: "${TALE_API_KEY:?TALE_API_KEY setzen}"
: "${TALE_ORG_SLUG:?TALE_ORG_SLUG setzen}"
tale_api() {
  curl --fail-with-body -sS \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' "$@"
}
```

Lade sie in deine Shell, prüfe den Schlüssel und liste die Modelle, die du aufrufen kannst. Die Beispiele brauchen curl und `jq`.

```bash
source ./tale-api.sh

# Für wen der Schlüssel handelt und in welcher Organisation
tale_api "$TALE_URL/api/v1/me" | jq '{email: .user.email, organization: .organization.slug, role: .organization.role}'

# Die Modelle, die du nennen darfst: id und providerSlug
tale_api "$TALE_URL/api/v1/models" | jq -r '.models[] | "\(.id)\t\(.providerSlug)"'
```

Exportiere `MODEL_ID` und `PROVIDER` nach einer Zeile dieser Liste. Das Gespräch ist ein Skript, `ask-tale.sh`, das neben der Hilfsfunktion liegt und mit `bash ask-tale.sh` läuft. Es legt einen persönlichen Thread an, stellt eine Frage, wartet, bis der Turn abgeschlossen ist, und gibt den Text der Antwort aus. `set -euo pipefail` bricht beim ersten fehlgeschlagenen Aufruf ab, sodass das Skript nie mit einer leeren ID weiterläuft.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${MODEL_ID:?MODEL_ID auf eine id aus /models setzen}"
: "${PROVIDER:?PROVIDER auf den zugehörigen providerSlug setzen}"

THREAD_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads" -d '{"title":"Skript-Hilfe"}' | jq -er '.id')

BODY=$(jq -n --arg model "$MODEL_ID" --arg provider "$PROVIDER" \
  '{content: "Was sagt unser Runbook zum Wechsel der Datenbankpasswörter?", model: $model, providerSlug: $provider}')
MESSAGE_ID=$(tale_api -X POST "$TALE_URL/api/v1/threads/$THREAD_ID/messages" -d "$BODY" | jq -er '.messageId')

# Alle drei Sekunden abfragen, bis zu zehn Minuten, bis der Turn abgeschlossen ist
STATUS=queued
for _ in $(seq 200); do
  STATUS=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/generation" | jq -r '.status')
  [ "$STATUS" = idle ] && break
  sleep 3
done
if [ "$STATUS" != idle ]; then
  echo "Keine Antwort innerhalb von zehn Minuten; der Turn wird gestoppt." >&2
  tale_api -X DELETE "$TALE_URL/api/v1/threads/$THREAD_ID/generation" > /dev/null
  exit 1
fi

# Die Antwort lesen, die das Senden genannt hat, und prüfen, wie sie endete
REPLY=$(tale_api "$TALE_URL/api/v1/threads/$THREAD_ID/messages/$MESSAGE_ID")
if [ "$(jq -r '.status' <<< "$REPLY")" != complete ]; then
  jq -r '"Turn \(.status): \(.errorCode // "") \(.error // "")"' <<< "$REPLY" >&2
  exit 1
fi
if [ "$(jq -r '.finishReason // ""' <<< "$REPLY")" = length ]; then
  echo "Die Antwort hat ihre Ausgabegrenze erreicht und ist womöglich abgeschnitten." >&2
fi
jq -r '[.parts[] | select(.type == "text") | .text] | join("")' <<< "$REPLY"
```

Solange das Senden auf einen Worker wartet, kann `GET .../messages/$MESSAGE_ID` noch mit `404 MESSAGE_NOT_FOUND` antworten. Das Skript liest die Antwort deshalb erst, wenn der Thread ruht. Einen Turn, der nach zehn Minuten nicht abgeschlossen ist, stoppt es mit `DELETE .../generation`. Schick Folgefragen an dieselbe `THREAD_ID`, damit der Gesprächskontext erhalten bleibt. Das Senden nimmt nur Text an und wird mit `409 CHAT_TURN_IN_PROGRESS` abgelehnt, solange der vorige Turn des Threads noch läuft.

Braucht ein Skript die passenden Textstellen statt einer Antwort, liefert `POST /api/v1/knowledge/search` sie ohne den Assistenten; siehe [Die Dateien eines Projekts durchsuchen](/de/develop/api-reference#die-dateien-eines-projekts-durchsuchen). [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) baut dasselbe Gespräch in Python mit Fehlerbehandlung auf, und [Eine Nachricht senden, dann den Turn pollen](/de/develop/api-reference#eine-nachricht-senden-dann-den-turn-pollen) beschreibt Wiederholungen, Token-Grenzen und Fehler.

## Die Tools von Tale in opencode oder Claude Code nutzen {#opencode-oder-claude-code-verbinden}

Der [MCP-Endpoint](/de/develop/mcp-endpoint) von Tale, `/api/v1/mcp`, stellt einem Editor-Agenten die Tools von Tale bereit. Für die Arbeit an Skripten ist `get_knowledge` am nützlichsten: Es ruft Textstellen aus den Dokumenten und gecrawlten Webseiten deiner Organisation ab. Dazu kommen die Automatisierungs-Tools, mit denen du Automatisierungen validierst, testest, speicherst, bereitstellst und ausführst und ihre Läufe liest. Speichern, Bereitstellen, das Setzen oder Löschen eines Triggers, das Abbrechen eines Laufs und Live-Läufe verlangen die Entwickler-Berechtigung. Ein Chat- oder Skill-Tool gibt es dort nicht. Um die Skills deiner Organisation in einen lokalen Skill-Ordner zu übernehmen, liest du sie mit `GET /api/v1/skills`, wie in [Skill-Pakete speichern und abgleichen](/de/develop/api-reference#skill-pakete-speichern-und-abgleichen) beschrieben.

Das Sprachmodell ist auf diesem Weg das Modell, das in deinem Editor eingerichtet ist. Tale authentifiziert die Tool-Aufrufe und prüft sie gegen deine Rechte. Die Prompts, dein Code und jede Textstelle, die ein Tale-Tool zurückgibt, gehen aber an den Modellanbieter dieses Editors. Ist das ein anderer Dienst, gelten Budgets, Verbrauchserfassung und Modellzugriffsregeln von Tale für seine Modellaufrufe nicht; kläre vor dem Verbinden, ob deine Organisation ihr Wissen an diesen Anbieter geben darf. Nutzt der Editor [die Modell-Endpunkte](#model-endpoints) als Anbieter, gehen die Textstellen nur an Modelle, die deine Organisation freigegeben hat, und jeder Modellaufruf wird geprüft, wie dort beschrieben.

Der Endpunkt authentifiziert mit dem API-Schlüssel im Header und kennt keine OAuth-Anmeldung. Schalte die OAuth-Erkennung eines Clients ab, wo er diese Option anbietet.

### opencode

Trag einen Remote-Server in deine globale opencode-Konfiguration `~/.config/opencode/opencode.json` oder in eine `opencode.json` im Projekt ein. Mit `{env:TALE_API_KEY}` liest opencode den Schlüssel aus deiner Umgebung, sodass die Datei das Geheimnis nie enthält. Ersetze Host und Slug durch deine eigenen Werte.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tale": {
      "type": "remote",
      "url": "https://your-host.example.com/api/v1/mcp",
      "oauth": false,
      "timeout": 60000,
      "headers": {
        "Authorization": "Bearer {env:TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`timeout` hebt die Vorgabe von opencode für MCP-Anfragen an, fünf Sekunden. Eine Wissenssuche unter Last oder ein Aufruf von `run_deployed`, der bis zu 30 Sekunden wartet, kann länger dauern. Starte opencode aus einer Shell, in der `TALE_API_KEY` gesetzt ist. `opencode mcp list` zeigt, ob der Server eingerichtet ist. opencode stellt den Tools den Servernamen voran, etwa `tale_get_knowledge`.

### Claude Code

Registriere den Endpunkt als HTTP-Server. Der folgende Befehl speichert den eingesetzten Schlüssel in deiner privaten Claude-Code-Konfiguration für das aktuelle Projekt:

```bash
claude mcp add --transport http tale "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

Willst du den Server über eine eingecheckte `.mcp.json` mit dem Team teilen, verweise auf den Schlüssel als Umgebungsvariable, damit jede Person ihren eigenen einsetzt:

```json
{
  "mcpServers": {
    "tale": {
      "type": "http",
      "url": "https://your-host.example.com/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${TALE_API_KEY}",
        "X-Organization-Slug": "your-org-slug"
      }
    }
  }
}
```

`claude mcp list` zeigt, ob Claude Code den Server erreicht.

### Prompts und Ressourcen in Claude Code {#prompts-and-resources}

Ist der Server als `tale` eingetragen, findest du die Prompts von Tale, wenn du in Claude Code `/` tippst: `/tale:edit_automation`, `/tale:debug_failed_run` und `/tale:add_trigger`. Die Argumente folgen dem Befehl, durch Leerzeichen getrennt, etwa `/tale:debug_failed_run <run-id>`. Jeder Prompt hängt an, worum es geht, und weist den Agent an, dich zu fragen, bevor etwas live geschaltet wird.

Mit `@` erwähnst du eine Ressource von Tale, etwa `@tale:tale://runs/<run-id>` für einen Lauf oder `@tale:tale://docs/triggers` für die Trigger-Referenz. Claude Code liest sie mit deinem Schlüssel und hängt sie an deine Nachricht an. [Ressourcen und Prompts](/de/develop/mcp-endpoint#resources-and-prompts) nennt jede Adresse und jeden Prompt.

### Den Tale-Skill installieren {#tale-skill}

Der Tale-Skill ist eine Datei `SKILL.md` im Format Agent Skills. Er bringt deinem Agent bei, wie er in Tale arbeitet: den Bearbeitungsablauf, Tests mit Mocks, Trigger, die Fehlersuche bei einem fehlgeschlagenen Lauf, das Lesen einer Ablehnung und die Regeln, an die er sich hält, etwa dich zu fragen, bevor etwas live geschaltet wird. Er gehört nicht zu den Skills deiner Organisation und nennt weder Host noch Organisation noch Schlüssel; eine Kopie genügt also für alle Projekte. Lege ihn dort ab, wo dein Agent Skills liest:

| Agent | Dieses Projekt | Alle deine Projekte |
| --- | --- | --- |
| Claude Code | `.claude/skills/tale/SKILL.md` | `~/.claude/skills/tale/SKILL.md` |
| Codex | `.agents/skills/tale/SKILL.md` | `~/.agents/skills/tale/SKILL.md` |

Lies ihn mit deinem Schlüssel über den MCP-Endpunkt. Das Beispiel speichert ihn für Claude Code im aktuellen Projekt; für einen anderen Agent änderst du den Ordner:

```bash
mkdir -p .claude/skills/tale
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-11-25' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"tale://docs/skill"}}' \
  | jq -r '.result.contents[0].text' > .claude/skills/tale/SKILL.md
```

Ein verbundener Agent kann `tale://docs/skill` auch selbst lesen und die Datei ablegen. Der Skill passt zu der Tale-Version, aus der er stammt; hol ihn nach einem Update neu. Die Referenzen, auf die er verweist, kommen jedes Mal frisch aus deinem Deployment.

## Skripte von einem Projektagenten bearbeiten lassen

Soll die Bearbeitung in Tale geschehen, in einer Sandbox und mit Prüfung durch eine Person, übergib das Skript einem [Projektagenten](/de/platform/projects/project-agents). Tale führt dann eine Coding-Laufzeit wie OpenCode in einer Sandbox aus, mit dem Modell, das für den Agenten eingerichtet ist. Der Lauf zählt gegen die Budgets des Mitglieds, das ihn gestartet hat, und wird dieser Person zugeordnet. Einen Lauf, den du per REST startest, verbucht Tale bei dir, nicht beim API-Schlüssel. Die bearbeiteten Dateien kommen als Ergebnisse der Aufgabe zurück, und die Aufgabe wartet auf die Prüfung durch eine Person. [Eine Agent-Laufzeit wählen](/de/platform/agents/harnesses) vergleicht die Laufzeiten. OpenCode läuft nur über das Modell-Gateway von Tale und erhält daher nie einen Anbieterschlüssel.

Um den Agenten anzulegen, brauchst du Bearbeitungsrechte im Projekt, also mindestens die Rolle Redakteur; die Aufgabe anlegen und den Agenten darauf starten kann danach jeder, der das Projekt öffnen kann. Die Organisation braucht ein Modell, das die Laufzeit nutzen kann, und freie Sandbox-Kapazität. In der App öffnest du den Tab **Agenten** des Projekts, wählst **Neuer Agent**, stellst OpenCode als Agent-Laufzeit und ein Modell ein, legst dann eine Aufgabe mit dem Skript als Anhang an, weist sie dem Agenten zu und startest ihn.

Derselbe Ablauf funktioniert per REST aus dem Terminal, mit `tale-api.sh` aus dem Chat-Beispiel. Prüfe zuerst, ob diese Installation OpenCode für Projektagenten ausführt:

```bash
tale_api "$TALE_URL/api/v1/models" | jq -r '.harnesses[] | "\(.harness)\t\(.label)"'
```

Speichere dann das folgende Skript als `hand-to-agent.sh` neben der Hilfsfunktion und starte es mit `bash hand-to-agent.sh`. Es verwendet den Agenten Skript-Editor des Projekts wieder oder legt ihn beim ersten Lauf an, denn Agentennamen sind in einem Projekt ohne Rücksicht auf Groß- und Kleinschreibung eindeutig. Danach reicht es das Skript als Aufgabe ein und setzt den Agenten mit einem Kommentar, der ihn erwähnt, an die Arbeit.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/tale-api.sh"
: "${PROJECT_ID:?PROJECT_ID auf ein Projekt setzen, das du bearbeiten darfst}"
: "${MODEL_ID:?MODEL_ID auf ein Modell setzen, das die Laufzeit nutzen kann}"
: "${PROVIDER:?PROVIDER auf den zugehörigen providerSlug setzen}"
AGENT_NAME="Skript-Editor"

AGENT_ID=$(tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
  | jq -r --arg name "$AGENT_NAME" 'first(.agents[] | select((.name | ascii_downcase) == ($name | ascii_downcase)) | .id) // ""')
if [ -z "$AGENT_ID" ]; then
  AGENT_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/agents" \
    -d "$(jq -n --arg name "$AGENT_NAME" --arg model "$MODEL_ID" --arg provider "$PROVIDER" '{name: $name, harness: "opencode", model: $model, modelProvider: $provider, skills: [], connectors: [], instructions: "Bearbeite das Skript aus der Aufgabenbeschreibung. Gib das geänderte Skript als Datei zurück und führe jede Änderung in deinem Bericht auf."}')" \
    | jq -er '.agent.id')
fi

TASK_ID=$(tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks" \
  -d "$(jq -n --rawfile script backup.ps1 '{externalSystem: "terminal", externalId: "backup-ps1-hardening", title: "backup.ps1 absichern", description: ("Ergänze Fehlerbehandlung und einen Testlauf-Schalter in diesem PowerShell-Skript:\n\n" + $script)}')" \
  | jq -er '.task.id')

tale_api -X POST "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments" \
  -d "$(jq -n --arg agent "$AGENT_ID" '{body: ("@" + $agent + " bitte übernimm diese Aufgabe.")}')" > /dev/null
echo "TASK_ID=$TASK_ID"
```

`externalSystem` und `externalId` machen die Aufgabe idempotent: Dasselbe Paar liefert beim nächsten Senden die bestehende Aufgabe. Eine Beschreibung fasst bis zu 20.000 Zeichen. Ein längeres Skript lädst du ins Projekt hoch, wie in [Eine Datei in zwei Schritten hochladen](/de/develop/api-reference#eine-datei-in-zwei-schritten-hochladen) beschrieben. Ein Agent reagiert auf seine ID und auf seinen Namen in Kleinbuchstaben, bei dem Leerzeichen durch Punkte ersetzt oder entfernt sind. `@skript-editor` funktioniert daher ebenfalls.

Die Erwähnung weist dem Agenten die Aufgabe zu und startet einen Lauf; die Aufgabe wechselt auf `in_progress`. Kann eine Erwähnung keinen Lauf starten, bleibt sie ein gewöhnlicher Kommentar ohne Fehlermeldung, etwa wenn du die Aufgabe nicht ändern darfst, die Aufgaben-Automatisierung ausgeschaltet ist oder ein anderer Lauf die Aufgabe bereits belegt. Setze `TASK_ID` auf den Wert, den das Skript ausgegeben hat, prüfe die Aufgabe und lies den Bericht des Agenten, sobald sie `in_review` erreicht:

```bash
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID" | jq -r '.task.status'
tale_api "$TALE_URL/api/v1/projects/$PROJECT_ID/tasks/$TASK_ID/comments?limit=20" \
  | jq -r '.comments[] | select(.authorType == "agent") | .body'
```

Prüfe die bearbeiteten Dateien in den Ergebnissen der Aufgabe in der App, bevor du die Aufgabe freigibst. Sollen noch Änderungen folgen, schreib einen weiteren Kommentar, der den Agenten erwähnt.

## Was sich seit Tale 0.3 geändert hat {#was-aus-dem-openai-kompatiblen-endpunkt-wurde}

Von 0.2.10 bis 0.3 bot Tale eine OpenAI-kompatible Schicht: `POST /api/v1/chat/completions`, `POST /api/v1/images/generations` und ein `GET /api/v1/models` im OpenAI-Format, dessen Feld `model` einen Agenten nennen konnte. Mit Tale 0.4 wurde die Plattform ohne diese Schicht neu aufgebaut. Für Modellaufrufe treten jetzt die [Modell-Endpunkte](#model-endpoints) an ihre Stelle, mit Unterschieden, die ein Client für 0.3 beachten muss:

- Die Basis-URL ist `/api/v1/openai`, für einen Anthropic-Client `/api/v1/anthropic`, nicht `/api/v1`. Ein OpenAI-SDK, das auf `/api/v1` zeigt, erhält für Chat Completions weiterhin `404 NOT_FOUND`, und `GET /api/v1/models` liefert die eigene Liste von Tale mit Modellen und Agent-Laufzeiten, nicht das OpenAI-Format.
- `model` nennt ein Modell als `<providerSlug>/<modelId>`, nie einen Agenten. Für den eingebauten Assistenten nutzt du die REST-Chat-API, für die Arbeit eines Agenten einen Projektagenten.
- Bildgenerierung wird nicht bedient.
- Die Endpunkte sind ausgeschaltet, bis ein Admin sie einschaltet, und jeder Aufruf durchläuft Modellzugriff, Eingabe-Guardrails und Budgets.

[Bereitstellung aktualisieren und wiederherstellen](/de/self-hosted/operate/upgrades#03-04-die-openai-kompatible-api-entfaellt) nennt die Entfernung für Betreiber, die von 0.3 umsteigen.
