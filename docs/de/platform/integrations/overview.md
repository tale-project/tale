---
title: Integrationen – Überblick
description: Tale per entwicklergebauten Konnektoren mit REST-APIs und SQL-Datenbanken verbinden.
---

Eine Integration ist ein vom Entwickler definierter Konnektor, der die Fähigkeiten eines fremden Systems — REST-Endpoints oder SQL-Abfragen — als feste Liste benannter Operationen verfügbar macht. Einmal installiert, sind diese Operationen Werkzeuge, die der Chat-Assistent, Agents und Action-Schritte in Automatisierungen namentlich mit typisierten Parametern aufrufen. Die Konfiguration lebt unter **Einstellungen > Integrationen** und erfordert mindestens die Entwickler-Rolle; die Konsumenten rufen die Operationen auf, die der Konnektor publiziert.

Die Plattform unterstützt zwei Konnektor-Typen: `rest_api` für HTTP-Dienste und `sql` für direkten Datenbankzugriff. Alles andere, was unter **Einstellungen > Integrationen** in der UI auftaucht — E-Mail-Postfächer, Microsoft OneDrive, API-Schlüssel für die Tale-API selbst — sind verwandte Verbindungen mit eigener Konfigurationsoberfläche, kein Konnektor-Modell. Diese decken wir am Ende der Seite ab.

## Integrationen-Typen

### REST-API

REST-Konnektoren kapseln einen beliebigen HTTP-Dienst. Das Manifest des Konnektors listet die unterstützten Auth-Methoden und die Hosts, die er erreichen darf; sandboxierter Konnektor-Code übernimmt jede Operation. Unterstützte Authentifizierungsmethoden:

| Methode           | So funktioniert sie                                          |
| ----------------- | ------------------------------------------------------------ |
| **API-Schlüssel** | Schlüssel in einem Kopfzeile oder Query-Parameter mitsenden. |
| **Bearer-Token**  | `Authorization: Bearer <token>`-Kopfzeile bei jedem Anfrage. |
| **Basic Auth**    | Benutzername und Passwort, base64-kodiert.                   |
| **OAuth 2.0**     | Authorization-Code-Flow mit automatischem Token-Refresh.     |

Das Feld `allowedHosts` im Manifest wirkt als Netzwerk-Allowlist — der Konnektor kann nur die deklarierten Hosts erreichen. Siehe [Agent erstellen](/de/platform/agents/create), wie ein Agent Zugriff auf die Operationen einer Integration erhält.

### SQL

SQL-Konnektoren verbinden mit PostgreSQL, MySQL oder Microsoft SQL Server. Der Agent schreibt **kein** SQL freihändig. Stattdessen registriert das Manifest eine feste Liste benannter Operationen, jede mit vorgeschriebener Abfrage und Parameterschema; der Agent wählt eine Operation und liefert Werte für die Platzhalter. Nur-Lese-Credentials sind weiterhin dringend empfohlen — Schreib-Operationen und Genehmigungs-Gates beschränken nur, was der Konnektor publiziert, nicht, was das Datenbankkonto selbst darf.

## Operationen

Jede Integration veröffentlicht eine Liste von Operationen. Eine Operation hat einen `name` (die Kennung, die der Agent aufruft), eine `description` (was sie tut und wann sie genutzt werden soll), ein `parametersSchema` (ein JSON-Schema, das Eingaben beschreibt), ein optionales `operationType` von `read` oder `write` sowie ein optionales `requiresApproval`-Flag. Der Agent wählt eine Operation per Name und liefert validierte Parameter; er komponiert nie Ad-hoc-HTTP-Calls oder SQL. So bleibt ein Konnektor vorhersehbar: Eine neue Operation existiert nur, wenn ein Entwickler sie ins Manifest aufnimmt.

## Lesen, Schreiben und Genehmigungen

Operationen mit `operationType: write` erfordern standardmäßig eine Genehmigung vor der Ausführung. Wenn ein Agent oder eine Automatisierung eine solche Operation auslöst, erscheint eine Genehmigungs-Karte im Chat — ein Mensch akzeptiert oder lehnt ab, und nur bei Akzeptanz wird der Aufruf ausgeführt. Siehe [Genehmigungen](/de/platform/workspace/approvals) für den vollständigen Ablauf. Nutze das für Abrechnung-Aktionen, Massen-E-Mails, Schreibvorgänge auf Produktionsdaten und alles, wo du einen Menschen in der Schleife willst. Lese-Operationen werden ohne Genehmigungsschritt ausgeführt.

## Authentifizierung und Geheimnisse

Das Array `secretBindings` im Manifest benennt die Credential-Schlüssel, die ein Konnektor zur Laufzeit über `secrets.get('<key>')` liest. Wenn du die Integration unter **Einstellungen > Integrationen** verbindest, fragt die UI genau diese Schlüssel ab und speichert die Werte verschlüsselt im Ruhezustand, gebunden an deine Organisation. OAuth-2.0-Konnektoren nutzen den Standard-Authorization-Code-Flow, speichern Access- und Refresh-Tokens und erneuern Access-Tokens automatisch beim Ablauf. SQL-Konnektoren speichern Server, Port, Datenbankname, Benutzername und Passwort im selben verschlüsselten Speicher.

## Konfigurationsanleitung und Verbindungstest

Konnektoren können einen Markdown-`setupGuide` ausliefern, den die Plattform unter **Konfigurationsanleitung** im Manage-Dialog rendert — nutze ihn, um auf den richtigen Ort für den API-Schlüssel hinzuweisen, welche OAuth-Scopes nötig sind oder welche Datenbankrolle anzulegen ist. Nach Eingabe der Credentials ruft **Verbindung testen** den leichtgewichtigen `testConnection`-Hook des Konnektors vor dem Speichern auf; ein Fehlversuch zeigt die Fehlermeldung des Konnektors inline, sodass Nutzer Credentials beheben können, ohne den Dialog zu verlassen.

## Mitgelieferte Beispiele

Das Repository liefert dreizehn einsatzbereite Konnektoren unter [github.com/tale-project/tale/tree/main/examples/integrations](https://github.com/tale-project/tale/tree/main/examples/integrations). Forke einen als Ausgangspunkt für einen eigenen Konnektor gegen denselben Anbieter, oder installiere einen so wie er ist.

| Beispiel         | Typ      | Auth         | Was es abdeckt                                                          |
| ---------------- | -------- | ------------ | ----------------------------------------------------------------------- |
| **AI image**     | rest_api | bearer_token | Bildgenerierung gegen OpenAI-kompatible Anbieter.                       |
| **Circuly**      | rest_api | basic_auth   | Produkte, Kunden und Abonnements in Circuly.                            |
| **Discord**      | rest_api | bearer_token | Guilds, Kanäle und Nachrichten über die Discord-Bot-API.                |
| **GitHub**       | rest_api | bearer_token | Repositories, Issues, Pull Anfragen und Code-Suche.                     |
| **Gmail**        | rest_api | oauth2       | Nachrichten, Labels, Threads und Entwürfe in Gmail.                     |
| **Google Drive** | rest_api | oauth2       | Dateien aus Drive-Ordnern in Tale-Dokumente synchronisieren.            |
| **Outlook**      | rest_api | oauth2       | Mail, Kalender und Kontakte über Microsoft Graph.                       |
| **Protel**       | sql      | basic_auth   | Direkter SQL-Zugriff auf ein Protel-Hotel-PMS — Reservierungen, Folios. |
| **Shopify**      | rest_api | api_key      | Produkte, Kunden und Bestellungen in der Shopify Admin API.             |
| **Slack**        | rest_api | oauth2       | Kanäle, Nachrichten, Nutzer und Datei-Uploads.                          |
| **Tavily**       | rest_api | api_key      | Offene Web-Suche und Page-Extraction für LLM-Agents.                    |
| **Teams**        | rest_api | oauth2       | Teams, Kanäle, Nachrichten und Chats über Microsoft Graph.              |
| **Twilio**       | rest_api | basic_auth   | SMS, Sprachanrufe und Telefonnummern-Verwaltung.                        |

## Eine eigene Integration installieren oder bauen

Es gibt zwei Wege, einen Konnektor zu installieren. Beide enden mit derselben `config.json` plus Konnektor-Code auf dem Server.

**Aus der UI hochladen.** Öffne **Einstellungen > Integrationen**, klicke **Integration hinzufügen** und lege ein `.zip`-Paket ab, oder wähle `config.json`, den Konnektor-Quelltext (`connector.ts` oder `connector.js`) und ein Icon einzeln aus. Der Gesamt-Upload ist auf 1 MB begrenzt. Nach dem Upload Credentials eingeben und **Verbindung testen** klicken.

**Als Projekt-Code schreiben.** Ein per `tale init` aufgesetztes Projekt hat ein `integrations/`-Verzeichnis; jedes Unterverzeichnis ist ein Konnektor (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). Die Plattform lädt bei Speichern live nach, das Iterieren ist also wie das Bearbeiten jeder anderen Quelldatei. Das vollständige Dateiformat und die Sandbox-API sind unter [Integration bauen](/de/develop/integrations) dokumentiert; für KI-gestütztes Schreiben im Editor siehe [KI-gestützte Entwicklung](/de/develop/ai-assisted-development).

## Verwandte Verbindungen

Ein paar weitere Punkte stehen unter **Einstellungen > Integrationen** zur besseren Auffindbarkeit, sind aber keine `rest_api`- oder `sql`-Konnektoren — sie haben eigene Konfigurationsoberflächen.

**E-Mail (Konversationen-Posteingang).** Verbinde ein IMAP- und SMTP-Postfach, um den [Konversationen](/de/platform/workspace/conversations)-Posteingang zu versorgen. Eingehende E-Mails werden zu Threads; aus der Plattform versendete Antworten gehen als normale E-Mails raus. Konfiguration getrennt von Konnektoren.

**Microsoft OneDrive.** Verbinde ein Microsoft-365-Konto, sodass Nutzer OneDrive-Dateien direkt in die [Wissensdatenbank](/de/platform/workspace/knowledge-base) importieren können, ohne sie vorher herunterzuladen. Konfiguriert über den Wissensdatenbank-Importfluss, nicht als Konnektor.

## API-Schlüssel

API-Schlüssel gewähren programmatischen Zugriff auf die Tale-API selbst. Sie leben unter **Einstellungen > Integrationen > API-Schlüssel**, weil das die gleiche Admin-Oberfläche ist, nicht weil sie Konnektoren wären. Jeder Schlüssel erbt die Rolle des Nutzers, der ihn erstellt hat; jederzeit auf demselben Bildschirm widerrufbar. Endpoint-Details siehe [API-Referenz](/de/develop/api-reference).

## Wo das hingehört

Integrationen sind die Brücke zwischen Tales KI und den Systemen, in denen eure echten Daten leben. Ein Agent ohne Integrationen kann nur reden; ein Agent mit der richtigen Integration kann ein Ticket aktualisieren, eine Datenbank abfragen, eine E-Mail senden oder eine Slack-Nachricht posten. Jede Operation, die ein Konnektor publiziert, erscheint einheitlich — als Tool, das Agents namentlich aufrufen, und als Action-Schritt, den Automatisierungen mit typisierten Parametern triggern.

Um einem Agent Zugriff auf die Operationen einer bestimmten Integration zu geben, ist die nächste Seite [Agent erstellen → Tools](/de/platform/agents/create). Für das API-Schlüssel-Gegenstück dieser Integrationen — _dein_ Code, der Tale aufruft, statt Tale, das hinausruft — öffne die [API-Referenz](/de/develop/api-reference).
