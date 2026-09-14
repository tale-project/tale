---
title: Connectors
description: Wie ein Connector deklariert wird, was eine seiner Aktionen einem Aufrufer zusichert und wohin dein eigener Code gehört, wenn kein Connector passt.
---

Ein Connector stellt Tale einen wiederverwendbaren Zugriff auf einen Dienst bereit. Seine Definition beschreibt Authentifizierung, erlaubte Ziele und Aktionen; jede Organisation hinterlegt eigene Zugangsdaten. Diese Seite hilft dir, den Vertrag zu prüfen oder einen neuen Connector beizutragen.

Wenn du ein Konto in der Anwendung verbinden möchtest, nutze [Connector-Zugangsdaten](/de/platform/admin/connectors). Verfügbare Integrationen findest du im [Connector-Katalog](/de/platform/connectors/overview).

## Wie ein Connector deklariert wird

Definitionen liegen unter `configs/platform/system/connectors/<slug>/connector.yml`, zusammen mit dem Symbol des Connectors. Der Verzeichnis-Slug muss `name` entsprechen. Automatisierungen rufen Aktionen mit `<connector>.<action>` auf, etwa `tavily.search`. Anbieter-Connectoren erscheinen in den Einstellungen; interne Connectoren mit Plattformauthentifizierung nicht.

Dieser Ausschnitt aus der mitgelieferten Tavily-Definition zeigt Identität und Authentifizierung. Er ist kein vollständiger Connector: Die Aktionsdefinitionen fehlen hier bewusst.

```yaml
name: tavily
displayName: Tavily
description: Real-time web search and page extraction for AI research.
tags:
  - Search
allowedHosts:
  - api.tavily.com
auth:
  - method: api-key
```

### Erlaubte Ziele festlegen

| Feld | Bedeutung |
| --- | --- |
| `endpointMode: fixed` | Standard. Live-HTTP-Aufrufe verwenden feste Anbieter-URLs; `allowedHosts` enthält genaue Hostnamen |
| `endpointMode: per-credential` | Jeder Zugang enthält eine HTTPS-`endpointUrl`; Aktionen lesen den Ursprung ohne abschließenden Schrägstrich über `ctx.endpoint` |
| `allowedHosts` bei per-credential | Hostsuffixe: `atlassian.net` erlaubt seine Subdomains |
| `configFields` | Nicht geheime Angaben je Zugang, etwa Serverhost, Port, Region oder API-Version |

Confluence und Shopify verwenden Ursprünge je Zugang. Geheimnisse gehören nicht in `configFields`, sondern in die verschlüsselten Zugangsdaten. Bei JavaScript-Aktionen setzt `ctx.http` die erlaubten HTTP-Ziele durch. Native Backends, etwa für Mailprotokolle, prüfen ihren Transport selbst; eine HTTP-Freigabeliste beschreibt nicht ihre gesamte Sicherheitsgrenze.

<Info>

Ein neuer Connector ist ein Quellcodebeitrag. Die Laufzeit liest den Plattformkatalog; Organisationen können keine Connector-Definition hochladen. Beginne mit der [Entwicklungsumgebung](/de/develop/contributor-setup) und prüfe vor der Umsetzung einen vorhandenen Connector mit ähnlicher Authentifizierung und ähnlichem Transport.

</Info>

## Was eine Aktion zusichert

| Feld | Vertrag für Autor und Aufrufer |
| --- | --- |
| `name`, `description` | Stabiler Aktionsname in snake_case und eine Erklärung zum Einsatzzweck |
| `input` | Objekt-JSON-Schema, vor der Ausführung validiert; Felder beschreiben und Pflichtfelder markieren |
| `output` | Ergebnissignatur im TypeScript-Stil; Dokumentation, keine Laufzeitvalidierung der Ausgabe |
| `effects` | `read` oder `write`; Schreibaktionen durchlaufen die Genehmigungsrichtlinie |
| `mock` | Erforderliches deterministisches JavaScript: gleiche Eingabe, gleiche Ausgabe, kein Netzwerkzugriff |
| `backend` | Optionale Live-Implementierung: `yaml-js` mit `live` oder `native` mit `impl`-Kennung |
| `exampleInput` | Optionales kleines, aussagekräftiges Beispiel für Erkennung und Tests |

Ohne Live-Backend läuft ein Connector nur mit Mocks und lehnt echte Aufrufe ab. Schreibaktionen werden nicht ausgeführt, wenn keine Genehmigungsentscheidung ermittelt werden kann. Die [Genehmigungsreferenz](/de/self-hosted/configuration/approvals) erklärt Vorrangregeln und ausstehende Entscheidungen.

Lies bei Ergebnisverträgen auch die Live-Implementierung. Tavily beschreibt beispielsweise `max_results` als Eingabe, begrenzt die zurückgegebenen Suchergebnisse aber auf fünf. Die Ausgabesignatur allein erklärt diese Grenze nicht.

### Das richtige Konto auswählen

Der Zugang wird beim Aufruf bestimmt: der ausdrücklich benannte, sonst der Standardzugang des Connectors. Ein geänderter Standard kann daher beeinflussen, welches Konto ein späterer Lauf nutzt. Benenne den Zugang ausdrücklich, wenn das Konto Teil deines Integrationsvertrags ist.

Für Postfächer gilt eine gezielte Ausnahme: `conversation.sync_mailbox` und `conversation.list_mailbox_messages` durchlaufen alle aktiven Zugänge des Connectors. So werden sämtliche verbundenen Postfächer berücksichtigt, nicht nur das Standardkonto.

## Die Authentifizierungsmethoden

Ein Connector kann mehrere Verfahren unterstützen; ein gespeicherter Zugang verwendet genau eines.

| Methode   | Bezeichnung in der Oberfläche | Was der Eintrag hält                                                                                                       |
| --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `api-key` | API-Schlüssel                 | Ein einzelnes Secret, das der Aktionsrumpf selbst platziert — ein Anbieter-Header, ein Query-Parameter oder ein Body-Feld. |
| `bearer`  | Token                         | Ein Token, gesendet als Authorization-Header unter dem Schema, das der Connector nennt.                                    |
| `basic`   | Benutzername & Passwort       | Benutzername und Passwort als HTTP Basic — dieselbe Form, die auch ein Postfach-Login annimmt.                             |
| `oauth2`  | OAuth                         | Ein Authorization-Code-Grant: Access Token, Refresh Token, Ablauf und die erteilten Scopes.                                |

Das interne Verfahren `platform` hat keine gespeicherten Zugangsdaten und lässt sich nicht mit Anbieter-Verfahren kombinieren. Es ist nativen Plattformfunktionen wie Aufgaben- und Dokumentaktionen vorbehalten.

Geheimnisse werden verschlüsselt gespeichert. Listen liefern maskierte Vorschauen und Metadaten statt Klartext. Die autorisierte Live-Laufzeit löst das Geheimnis für den eigentlichen Aufruf auf. Erfolgreiches Speichern bestätigt nur die Ablage, nicht die Gültigkeit beim Anbieter oder ausreichende Berechtigungen.

## Eine OAuth-App registrieren

Der Connector deklariert Autorisierungs- und Token-URLs sowie angeforderte Berechtigungen. Konfiguriere zuerst die Anbieteranwendung und verbinde danach ein Konto darüber.

| Quelle | Vorrang und Einrichtung |
| --- | --- |
| Organisations-App | Hat Vorrang. Ein Administrator hinterlegt Client-ID und Geheimnis unter **Einstellungen > Connectoren > OAuth-Apps** |
| Deployment-App | Standard ohne Organisations-App: `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` und `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` |

Schreibe den Slug in Umgebungsvariablen groß und ersetze Bindestriche durch Unterstriche. Bei einer Microsoft-App für einen einzelnen Mandanten gehört die Verzeichnis-ID dazu, damit die Autorisierung diesen Mandanten statt `/common` nutzt. Organisationsgeheimnisse werden verschlüsselt und nicht erneut angezeigt.

### Die Callback-URL exakt registrieren

Alle OAuth-Connectoren der Organisation verwenden diese Redirect-URI:

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

Schema, Host und Pfad müssen exakt übereinstimmen, einschließlich des fehlenden abschließenden Schrägstrichs. Ohne `SITE_URL` startet Tale die Einwilligung nicht; es leitet keine öffentliche Callback-URL aus der Anfrage ab. Ein `redirect_uri`-Fehler beim Anbieter deutet meist darauf hin, dass registrierte und gesendete URI voneinander abweichen.

Persönliche OneDrive-/Google-Drive-Importe für Wissen sind ein eigener Ablauf. Google Drive verwendet dieselbe OAuth-App für Connector und Import. Registriere deshalb beide Redirect-URIs beim Google-Client. Die Import-URL steht in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

### Slacks Ereignisendpunkt einrichten

Die Slack-App wird ausschließlich für das Deployment konfiguriert: `CONNECTOR_OAUTH_SLACK_*` und `CONNECTOR_SLACK_SIGNING_SECRET`. Eingehende Ereignisse müssen geprüft werden, bevor Tale die Organisation kennt; eine Organisations-App kann dieses Geheimnis daher nicht bereitstellen.

Registriere `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` als Events Request URL. Ohne Signaturgeheimnis erhält schon die Registrierung `503`. Mit gültiger Konfiguration prüft Tale Signaturen und ordnet den Slack-Workspace einer Organisation zu. Der Endpunkt bestätigt Ereignisse derzeit nur. Er macht aus eingehenden Slack-Nachrichten keine Konversationen und startet nicht automatisch eine Automatisierung.

## Die passende Oberfläche wählen

| Bedarf | Weg |
| --- | --- |
| Unterstützte Anbieteraktion | Mitgelieferter Connector mit Organisationszugang |
| Wiederverwendbare Aktion fehlt im Katalog | Quellcodebeitrag mit Schema, deterministischem Mock, Live-Backend und Tests |
| Projektspezifische Aufrufe deines Dienstes | Geheimnisse und Sandbox-Code eines Projektagenten, innerhalb der Netzwerkfreigaben der Sandbox |
| Eigene Logik in einer Automatisierung | `transform`-Knoten im Rahmen der Fähigkeiten und Netzwerkregeln des Runners |

Ein Geheimnis ermöglicht die Anmeldung, aber nicht die Erreichbarkeit eines privaten Dienstes. Prüfe den Netzwerkzugriff aus der tatsächlichen Sandbox oder dem Runner, bevor du deine Integration darauf aufbaust.

Externe MCP-Server lassen sich nicht registrieren. Über Tales [MCP-Endpunkt](/de/develop/mcp-endpoint) ruft ein externer Client Tale auf; dadurch entsteht kein ausgehender Connector zu einem anderen MCP-Server.

## Wo das hingehört

Prüfe bei einem Beitrag drei Bereiche getrennt: Schemavalidierung, deterministisches Mock-Verhalten und echte Anbieteraufrufe. Prüfe auch Fehlerfälle: fehlender Zugang, falsche Berechtigungen, gesperrtes Ziel, ungültige Eingabe, Anbieterfehler und ausstehende Genehmigung bei Schreibaktionen. Die [Entwicklungsanleitung](/de/develop/contributor-setup) beschreibt die lokale Umgebung, die [Zugangsdaten-Anleitung](/de/platform/admin/connectors) die Einrichtung durch Administratoren.
