---
title: Tale aus deinem Editor oder einem Skript nutzen
description: Nutze den REST-Chat aus Skripten, verbinde opencode oder Claude Code mit dem MCP-Endpoint von Tale oder lass einen Projektagenten deine Skripte mit den Modellen deiner Organisation bearbeiten.
i18nLintExclude:
  - terminology-loanword
---

Tale lässt sich auf drei Wegen in deine Entwicklungsarbeit einbinden. Sie unterscheiden sich darin, wo das Sprachmodell läuft und wie viel der Arbeit Tale steuert:

| Du möchtest | Weg | Modell | Was Tale steuert |
| --- | --- | --- | --- |
| Den eingebauten Assistenten aus einem Skript fragen | [Die REST-Chat-API](#die-rest-chat-api-aus-einem-skript-nutzen) | Ein Modell der Organisation, das du in jeder Anfrage nennst | Den ganzen Turn: Modellzugriff, Budgets, Verbrauch unter deinem Namen |
| Wissen und Automatisierungs-Tools von Tale in opencode oder Claude Code | [Der MCP-Endpoint](#opencode-oder-claude-code-verbinden) | Das Modell, das in deinem Editor eingerichtet ist | Nur die Tool-Aufrufe; die Modellaufrufe des Editors laufen an Tale vorbei |
| Ein Skript mit den Modellen deiner Organisation bearbeiten lassen | [Ein Projektagent an einer Aufgabe](#skripte-von-einem-projektagenten-bearbeiten-lassen) | Das Modell der Organisation, mit dem der Agent eingerichtet ist | Den ganzen Lauf: Sandbox, Budgets, Verbrauch, Prüfung |

Tale bietet keinen OpenAI-kompatiblen Modell-Endpunkt. Ein Editor kann Tale deshalb nicht als Modellanbieter verwenden. [Der letzte Abschnitt](#was-aus-dem-openai-kompatiblen-endpunkt-wurde) erklärt, was aus `/api/v1/chat/completions` geworden ist.

## Einen API-Schlüssel erstellen

Jeder Zugriff von außerhalb der App beginnt mit einem persönlichen API-Schlüssel. Inhaber, Admins und Entwickler erstellen ihn unter **Einstellungen > API > REST** mit **API-Schlüssel erstellen** und legen dabei Namen und Ablaufzeit fest. Der geheime Wert erscheint nur einmal. Kopiere ihn in deinen Secret-Speicher oder eine private Shell-Umgebung, bevor du den Dialog schließt. [API-Schlüssel](/de/platform/admin/api-keys) beschreibt Erstellen, Rotieren und Widerrufen.

Ein Schlüssel handelt in deinem Namen. Er trägt deine aktuelle Rolle und deinen Projektzugriff, und der Verbrauch, den er verursacht, wird dir zugeordnet. Chat-Turns und Automatisierungsläufe, die du mit dem Schlüssel startest, erfassen zusätzlich den Schlüssel, sodass auch API-Schlüssellimits für sie gelten. Ein Lauf eines Projektagenten wird nur dir zugeordnet. Ein Admin kann deine Ausgaben mit einem persönlichen, Team- oder Rollenbudget unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) begrenzen. Eine Anfrage über der Grenze lehnt Tale mit `429 BUDGET_EXCEEDED` ab.

Die Beispiele auf dieser Seite lesen drei Umgebungsvariablen. `TALE_URL` ist der Ursprung deiner Instanz ohne `/api/v1`. `TALE_ORG_SLUG` ist der Slug der Organisation; du findest ihn unter **Einstellungen > API > MCP** und in der Antwort von `GET /api/v1/me`. Exportiere alle drei in deiner Shell. `TALE_API_KEY` gehört in keine Datei, die du committest.

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

## opencode oder Claude Code verbinden

Der [MCP-Endpoint](/de/develop/mcp-endpoint) von Tale, `/api/v1/mcp`, stellt einem Editor-Agenten die Tools von Tale bereit. Für die Arbeit an Skripten ist `get_knowledge` am nützlichsten: Es ruft Textstellen aus den Dokumenten und gecrawlten Webseiten deiner Organisation ab. Dazu kommen die Automatisierungs-Tools, mit denen du Automatisierungen validierst, testest, speicherst, bereitstellst und ausführst und ihre Läufe liest. Speichern, Bereitstellen, das Setzen oder Löschen eines Triggers, das Abbrechen eines Laufs und Live-Läufe verlangen die Entwickler-Berechtigung. Ein Chat- oder Skill-Tool gibt es dort nicht. Um die Skills deiner Organisation in einen lokalen Skill-Ordner zu übernehmen, liest du sie mit `GET /api/v1/skills`, wie in [Skill-Pakete speichern und abgleichen](/de/develop/api-reference#skill-pakete-speichern-und-abgleichen) beschrieben.

Das Sprachmodell ist auf diesem Weg das Modell, das in deinem Editor eingerichtet ist, nicht eines deiner Organisation. Tale authentifiziert die Tool-Aufrufe und prüft sie gegen deine Rechte. Die Prompts, dein Code und jede Textstelle, die ein Tale-Tool zurückgibt, gehen aber an den Modellanbieter dieses Editors. Budgets, Verbrauchserfassung und Modellzugriffsregeln von Tale gelten für diese Modellaufrufe nicht. Kläre vor dem Verbinden, ob deine Organisation ihr Wissen an diesen Anbieter geben darf.

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

## Skripte von einem Projektagenten bearbeiten lassen

Muss das Modell eines deiner Organisation sein, übergib das Skript stattdessen einem [Projektagenten](/de/platform/projects/project-agents). Tale führt dann eine Coding-Laufzeit wie OpenCode in einer Sandbox aus, mit dem Modell, das für den Agenten eingerichtet ist. Der Lauf zählt gegen die Budgets des Mitglieds, das ihn gestartet hat, und wird dieser Person zugeordnet. Einen Lauf, den du per REST startest, verbucht Tale bei dir, nicht beim API-Schlüssel. Die bearbeiteten Dateien kommen als Ergebnisse der Aufgabe zurück, und die Aufgabe wartet auf die Prüfung durch eine Person. [Eine Agent-Laufzeit wählen](/de/platform/agents/harnesses) vergleicht die Laufzeiten. OpenCode läuft nur über das Modell-Gateway von Tale und erhält daher nie einen Anbieterschlüssel.

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

## Was aus dem OpenAI-kompatiblen Endpunkt wurde

Von 0.2.10 bis 0.3 bot Tale eine OpenAI-kompatible Schicht: `POST /api/v1/chat/completions`, `POST /api/v1/images/generations` und ein `GET /api/v1/models` im OpenAI-Format. Mit Tale 0.4 wurde die Plattform ohne diese Schicht neu aufgebaut. Ein OpenAI-SDK, das auf `/api/v1` zeigt, erhält bei einer aktuellen Version für Chat Completions `404 NOT_FOUND`. Gehört dein Schlüssel zu mehreren Organisationen, lautet die Antwort `400 ORG_SLUG_REQUIRED`, weil das SDK standardmäßig keinen `X-Organization-Slug` sendet. `GET /api/v1/models` liefert jetzt die eigene Liste von Tale mit Modellen und Agent-Laufzeiten, nicht das OpenAI-Format.

Nutze die REST-Chat-API für Fragen aus Skripten, den MCP-Endpoint für das Wissen von Tale in deinem Editor und einen Projektagenten, wenn die Arbeit mit den Modellen deiner Organisation laufen muss. [Bereitstellung aktualisieren und wiederherstellen](/de/self-hosted/operate/upgrades#03-04-die-openai-kompatible-api-entfaellt) nennt die Entfernung für Betreiber, die von 0.3 umsteigen.
