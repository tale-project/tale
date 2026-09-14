---
title: Anbieter
description: Die Operator-Seite der KI-Anbieter — die Connector-Dateien, die mit der Plattform kommen, und die reservierten Umgebungsvariablen, mit denen das Deployment die API-Schlüssel hält statt der Datenbank.
---

Unterscheide bei einem AI-Anbieter drei Dinge: Connector-Definition, Zugangsdaten der Organisation und Modellserver. Der Connector beschreibt Endpunkt und Protokoll, Zugangsdaten steuern den Zugriff, und der Endpunktbetreiber betreibt den Modelldienst.

Diese Seite behandelt eigene Anbieterdefinitionen und Geheimnisse aus der Umgebung. Zugangsdaten und Standardmodelle in der App beschreibt [AI-Anbieter](/de/platform/admin/providers).

## Lokale Anbieterendpunkte

Ein lokaler Inferenzserver braucht eine Anbieterdefinition und die Erlaubnis für das Backend, seinen Host zu erreichen. Die Definition installiert keinen Server und lädt kein Modell.

1. Mache den Inferenzserver für jede Backend-Rolle erreichbar, die ihn aufruft. `localhost` bezeichnet im Container diesen Container, nicht den Hostrechner. Prüfe Namensauflösung, Netzwerkzugriff und gegebenenfalls das TLS-Zertifikat aus dem tatsächlichen Laufzeitnetz.
2. Setze für einen privaten oder Loopback-Endpunkt `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in der Backend-Bereitstellungsumgebung. Die Einstellung erlaubt private Anbieterhosts für die gesamte Installation; sie ist keine Freigabeliste einzelner Anbieter. Cloud-Metadatenendpunkte bleiben gesperrt. Erstelle die betroffenen Container neu, um die Änderung zu übernehmen. Ein Neustart behält ihre bestehende Compose-Umgebung.
3. Lege die Anbieterdefinition unter `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml` ab oder nutze den [verwalteten Konfigurationsablauf](/self-hosted/configuration/config-releases). Halte das native Anbieterschema ein und wähle einen Namen, der nicht mit einer mitgelieferten Definition kollidiert.

Ersetze im Beispiel private IP und Port durch deinen erreichbaren Server. HTTP ist nur für als privat oder Loopback erkannte Hosts zulässig; öffentliche Endpunkte brauchen HTTPS. Ein interner DNS-Name umgeht die Prüfung privater Hosts zur Anfragezeit nicht.

```yaml
name: local-models
displayName: Local models
apiFormat: openai
baseUrl: http://192.168.1.20:8000/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

Die Definition verwendet eine OpenAI-kompatible Chat-API und liest Modelle aus `/v1/models`. Prüfe die tatsächliche Kompatibilität des Servers. Eine Modellliste beweist noch nicht, dass Generierung, Werkzeugaufrufe oder Streaming funktionieren. Nutze einen statischen Katalog oder konkrete Modellfreigaben, wenn der Server den hier angeforderten Katalog nicht liefern kann.

Lass anschließend einen Organisationsadmin unter [KI-Anbieter](/platform/admin/providers) Zugangsdaten hinzufügen, den Katalog aktualisieren und ein bestimmtes Modell für einen kurzen Chat auswählen. Prüfe die abgeschlossene Anfrage im Protokoll des vorgesehenen Inferenzservers. Für Embeddings, Sprache und Werkzeugverkehr musst du die Ziele getrennt prüfen; ein lokaler Chatendpunkt hält sie nicht automatisch lokal.

## Wo die Connectoren liegen

Connector-Definitionen sind YAML-Dateien unter `configs/platform/system/providers/`, eine pro Anbieter, benannt nach dessen Slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml` und so weiter. Diese Dateien gehören zum Plattform-Image und werden mit ihm aktualisiert. Die passenden mitgelieferten Modellkataloge liegen daneben unter `configs/platform/system/models/<slug>.yml`.

<Warning>

Mitgelieferte Dateien sind schreibgeschützte Image-Eingaben und werden beim Upgrade ersetzt. Nutze für externe Anbieter die geprüfte Deployment-Deklaration `configuration` aus [CLI-Installation](/de/self-hosted/install/cli-install#plattform-konfigurieren). Sie erstellt mit dem nativen Schema einen organisationsgebundenen Connector unter `TALE_CONFIG_DIR/<org>/providers/`; Änderungen an Zugangsdaten und Richtlinien nutzen native APIs.

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

Definier die Variable so, dass das Backend sie lesen kann — es löst die Anbieter-Zugangsdaten zur Laufzeit auf. Erstelle nach einer neuen oder geänderten Bereitstellungsvariablen `backend-api` und `backend-worker` mit der aktualisierten Umgebung neu. Ein Compose-Neustart behält die alten Werte. Werte werden getrimmt, was dir den Zeilenumbruch am Ende einer gemounteten Secret-Datei und den daraus folgenden `401` erspart.

## Broker-Secrets aus der Umgebung

Zugangsdaten vom Typ **Abo-Broker** müssen sich erst beim Broker ausweisen, bevor sie einen Token-Pool holen können, und dieses Broker-Secret kann ebenfalls vom Deployment kommen. Seine Variablen tragen ein eigenes reserviertes Präfix, `TALE_TOKEN_SOURCE_`, getrennt von den Anbieter-Schlüsseln, damit die beiden Namensräume nicht verwechselt werden können. Es gilt dieselbe fail-closed-Regel: Ein Name ausserhalb des Präfixes wird abgelehnt. Im Formular heisst das Feld **Secret aus Umgebungsvariable**; lässt du es leer, wird das Broker-Secret stattdessen verschlüsselt bei den Zugangsdaten gespeichert.

## Was Organisationsdaten sind statt Deployment-Konfiguration

Zugangsdaten, Namen, erlaubte Modelle, Standards und Aktivierungszustand bleiben Organisationsdaten. Im Normalfall verwaltet die App diese Daten. Ein verwaltetes Deployment kann nach Prüfung von Organisation und Betreiber exakte umgebungsgebundene Zugangsdaten über die native API anlegen; es schreibt keine Zugangsdaten direkt in Datenbankzeilen.

<Tip>

Trenne Connector-Fakten, Zugangsdaten und Server-Betrieb. Das verwaltete Deployment prüft den deklarierten Katalog und native Richtlinien; es installiert keinen Inferenzserver und belegt kein Laufzeitverhalten des Modells.

</Tip>

## Wo das hingehört

Nutze verwaltete Deployments für geprüfte externe Anbieter-Einstellungen und die [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference) für die Schlüsselübergabe. [KI-Anbieter](/de/platform/admin/providers) beschreibt Zugangsdaten, Standards und Katalogaktualisierung in der App; der [Modellkatalog](/de/platform/models) erklärt die Ansicht für Mitglieder.
