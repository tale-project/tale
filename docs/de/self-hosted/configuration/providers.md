---
title: Anbieter
description: Die Operator-Seite der KI-Anbieter — die Connector-Dateien, die mit der Plattform kommen, und die reservierten Umgebungsvariablen, mit denen das Deployment die API-Schlüssel hält statt der Datenbank.
---

Ein KI-Anbieter in Tale besteht aus zwei Hälften, die an zwei verschiedenen Orten leben. Der **Connector** — Wire-Format, Endpunkt, Quelle des Modellkatalogs, akzeptierte Authentifizierungsmethoden — kommt mit der Plattform als Datei, die du liest, aber nicht änderst. Die **Zugangsdaten** sind Organisationsdaten und werden in der App unter **Einstellungen > KI-Anbieter** angelegt und rotiert. Diese Seite ist die Operator-Hälfte: was in den mitgelieferten Dateien steht, und der eine Hebel, der wirklich dem Deployment gehört — Anbieter-Schlüssel in Umgebungsvariablen zu halten.

## Wo die Connectoren liegen

Connector-Definitionen sind YAML-Dateien unter `configs/platform/system/providers/`, eine pro Anbieter, benannt nach dessen Slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml` und so weiter. Diese Dateien gehören zum Plattform-Image und werden mit ihm aktualisiert. Die passenden mitgelieferten Modellkataloge liegen daneben unter `configs/platform/system/models/<slug>.yml`.

<Warning>

Diese Dateien sind schreibgeschützte Eingaben, keine Deployment-Konfiguration. Wer eine davon in einem laufenden Container ändert, verliert die Änderung beim nächsten Upgrade, und eine Überschreibung auf Organisationsebene gibt es nicht. Fehlt ein Anbieter, den du brauchst, im mitgelieferten Satz, ist das eine Änderung an der Plattform und keine an der Konfiguration.

</Warning>

## Was ein Connector deklariert

Ein Connector ist bewusst kurz. Er nennt den Anbieter, den Wire-Dialekt seiner API, den Endpunkt, auf dem er antwortet, die Herkunft seiner Modellliste und die akzeptierten Authentifizierungsmethoden — nichts Organisationsspezifisches und keine Secrets.

<CodeGroup>

```yaml anthropic.yml
name: anthropic
displayName: Anthropic
apiFormat: anthropic
baseUrl: https://api.anthropic.com
catalog:
  source: static
auth:
  - method: api-key
  - method: env
  - method: subscription-broker
    constraints:
      execution: sandbox
      harness: claude-code
```

```yaml openrouter.yml
name: openrouter
displayName: OpenRouter
apiFormat: openai
baseUrl: https://openrouter.ai/api/v1
catalog:
  source: openrouter-api
auth:
  - method: api-key
  - method: env
```

</CodeGroup>

`apiFormat` ist der Wire-Dialekt — `openai` oder `anthropic`. Ein Connector im `openai`-Format kann zusätzlich `wireDialect: openai-modern` deklarieren, wie es die mitgelieferten OpenAI- und Azure-Connectors tun: Die Plattform schreibt das Ausgabelimit dann als `max_completion_tokens` und schickt Reasoning-Modellen keine eigene Temperatur mit — api.openai.com lehnt bei diesen Modellen `max_tokens` und jede vom Standard abweichende Temperatur ab, während OpenAI-kompatible Endpunkte von Drittanbietern die klassischen Felder behalten. `baseUrl` ist der feste Endpunkt; ein Connector, der ihn weglässt, deklariert stattdessen `endpointMode: per-credential`, so wie Azure OpenAI: Jede Azure-Ressource bedient ihren eigenen Endpunkt, also trägt dort jeder Zugangsdaten-Eintrag seine eigene URL. `catalog.source` ist eines von `static` (eine mitgelieferte Datei unter `configs/platform/system/models/`), `openrouter-api`, `models-endpoint` oder `none`. Jeder Eintrag unter `auth` ist eine Methode, die die Zugangsdaten dieses Anbieters nutzen dürfen, und eine Methode kann `constraints` tragen, die sie auf sandboxed Ausführung mit einem benannten Harness festlegen.

## Umgebungsvariable als Schlüsselquelle

Wenn deine API-Schlüssel bereits in Kubernetes-Secrets, Vault oder einem Cloud-Secret-Manager liegen, müssen die Zugangsdaten das Secret nicht halten. Die Authentifizierungsmethode **Umgebungsvariable** speichert nur den _Namen_ einer Deployment-Variable, und die Plattform liest den Wert zur Aufrufzeit aus der Prozessumgebung. Das ist der von Ops verwaltete Weg: Der Schlüssel landet nie in der Anwendungsdatenbank, und Rotieren ist eine Sache des Deployments statt einer Admin-Aufgabe.

Der Variablenname ist präfix-geschützt. Er muss mit `TALE_PROVIDER_KEY_` beginnen, und die App hält dieses Präfix im Formular fest, sodass nur das Suffix getippt wird:

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

Die Schranke ist fail-closed: Jeder Name ausserhalb des reservierten Präfixes wird abgelehnt. Genau das verhindert, dass Zugangsdaten ein fremdes Deployment-Geheimnis wie `SOPS_AGE_KEY` oder `BETTER_AUTH_SECRET` benennen und es als Bearer-Token an einen Anbieter-Endpunkt geschickt wird. Namen sind auf 40 Zeichen begrenzt — ein längerer Name würde die Backend-Laufzeit nie erreichen.

</Note>

Definier die Variable so, dass das Backend sie lesen kann — es löst die Anbieter-Zugangsdaten zur Laufzeit auf. Eine nach dem Boot hinzugefügte oder geänderte Variable braucht einen Neustart von `backend-api` und `backend-worker`, bevor sie sichtbar wird. Werte werden getrimmt, was dir den Zeilenumbruch am Ende einer gemounteten Secret-Datei und den daraus folgenden `401` erspart.

## Broker-Secrets aus der Umgebung

Zugangsdaten vom Typ **Abo-Broker** müssen sich erst beim Broker ausweisen, bevor sie einen Token-Pool holen können, und dieses Broker-Secret kann ebenfalls vom Deployment kommen. Seine Variablen tragen ein eigenes reserviertes Präfix, `TALE_TOKEN_SOURCE_`, getrennt von den Anbieter-Schlüsseln, damit die beiden Namensräume nicht verwechselt werden können. Es gilt dieselbe fail-closed-Regel: Ein Name ausserhalb des Präfixes wird abgelehnt. Im Formular heisst das Feld **Secret aus Umgebungsvariable**; lässt du es leer, wird das Broker-Secret stattdessen verschlüsselt bei den Zugangsdaten gespeichert.

## Was Organisationsdaten sind statt Deployment-Konfiguration

Zugangsdaten, ihre Namen, ihre erlaubten Modelle, welcher Eintrag der Standard ist und welche aktiv sind — all das sind Organisationsdaten. Angelegt werden sie in der App, sie gehören genau einer Organisation, und es gibt keine Datei auf Platte, die du bearbeitest, um welche anzulegen — auch nicht auf einer selbst gehosteten Instanz.

<Tip>

Diese Trennung ordnet eine Aufgabe am schnellsten ein. Alles zur Frage, _welcher Anbieter existiert und was er kann_, ist ein mitgelieferter Connector; alles zur Frage, _wer ihn mit welchem Schlüssel aufrufen darf_, sind Zugangsdaten in der App. Die einzige Überschneidung ist der Weg über Umgebungsvariablen, bei dem das Deployment das Secret hält und die Zugangsdaten nur dessen Namen.

</Tip>

## Wo das hingehört

Die gesamte Oberfläche eines Operators besteht hier darin, Umgebungsvariablen bereitzustellen und zu wissen, welche Connectoren die Plattform mitbringt; alles andere rund um Anbieter passiert in der App. Die UI-Anleitung — Zugangsdaten anlegen, einen Standard wählen, erlaubte Modelle einschränken, Kataloge aktualisieren — ist [KI-Anbieter](/de/platform/admin/providers), was deine Leute am Ende sehen, steht im [Modellkatalog](/de/platform/models), und die Variablen selbst stehen neben dem Rest der Deployment-Konfiguration in der [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference).
