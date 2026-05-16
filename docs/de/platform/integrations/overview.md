---
title: Integrationen — Überblick
description: Tale über benannte, sandboxierte Konnektoren mit REST-APIs und SQL-Datenbanken verbinden.
---

Eine Integration ist ein vom Entwickler definierter Konnektor, der ein externes System als feste Menge benannter Operationen verfügbar macht, die Agents und Automatisierungen namentlich mit typisierten Parametern aufrufen können. Einmal installiert, werden diese Operationen zu Werkzeugen — auswählbar in der Tool-Liste eines Agents, aufrufbar aus einem Schritt vom Typ **Aktion** in einer Automatisierung, beim Schreiben durch Genehmigung abgesichert. Die Konfiguration lebt unter **Einstellungen > Integrationen** und ist dem Entwickler und Admin vorbehalten; alle anderen sehen die daraus entstehenden Werkzeuge, ohne den Konnektor dahinter zu sehen.

Diese Seite deckt das Integrationsmodell selbst ab — die zwei Konnektor-Typen, die Authentifizierungsformen, die Teilung zwischen Lesen und Schreiben, die mitgelieferten Beispiele und wie du eine Integration installierst. Die verwandten Verbindungen unten unter **Einstellungen > Integrationen** (Postfächer für den Posteingang, OneDrive für Wissensimporte, API-Schlüssel für die Tale-API selbst) liegen dort der Auffindbarkeit halber, nutzen aber ihre eigenen Einrichtungsoberflächen; sie werden am Ende kurz behandelt. Der Weg „Bring deinen eigenen Tool-Katalog" über einen externen MCP-Server hat eine eigene Seite unter [MCP-Server](/de/platform/integrations/mcp-servers).

## Die zwei Konnektor-Typen

Konnektoren kommen in zwei Formen, jede passend zu einem anderen externen System.

Ein **REST-API**-Konnektor kapselt einen beliebigen HTTP-Dienst. Die `config.json` des Konnektors deklariert die Operationen, die er veröffentlicht, die Authentifizierungsmethoden, die er unterstützt, und eine Liste erlaubter Hosts — der sandboxierte Konnektor-Code kann nur diese Hosts erreichen, sodass ein fehlerhafter Konnektor nicht zu einer fremden Domain exfiltrieren kann. Unterstützte Authentifizierungsmethoden sind API-Schlüssel (in einer Kopfzeile oder einem Query-Parameter), Bearer-Token, HTTP-Basic und OAuth 2.0 (Authorization-Code-Flow mit automatischer Refresh-Token-Rotation).

Ein **SQL**-Konnektor verbindet zu PostgreSQL, MySQL oder Microsoft SQL Server. Der Agent schreibt SQL nie freihändig. Stattdessen deklariert der Konnektor eine feste Liste benannter Operationen, jede paart eine vorgeschriebene Abfrage mit einem Parameterschema; der Agent wählt eine Operation und liefert validierte Werte für die Platzhalter. Nur-Lese-Datenbank-Zugangsdaten sind weiterhin der richtige Schritt — das Konnektor-Modell schränkt die Abfragen ein, die Tale ausführt, aber das Datenbankkonto selbst bleibt in den Händen deines DBAs.

## Operationen

Eine Operation ist die Einheit, die ein Agent oder eine Automatisierung aufruft. Jede Operation hat:

- Einen **Namen** — die Kennung, die der Aufrufer wählt (`create_order`, `list_customers`, `lookup_reservation`).
- Eine **Beschreibung** — was die Operation tut und wann sie zu nutzen ist. Der Agent liest sie, um zu wählen.
- Ein **Parameterschema** — JSON-Schema, das die Eingaben beschreibt. Die Plattform validiert vor dem Aufruf.
- Einen **Operationstyp** — `read` oder `write`. Standard ist `read`.
- Ein **Genehmigung erforderlich**-Flag — wenn wahr, erzeugt jede Ausführung eine Genehmigungskarte.

Operationen sind der Vertrag des Konnektors. Neues Verhalten bedeutet, eine Operation in `config.json` hinzuzufügen (oder zu ändern) und die Änderung auszuliefern; der Agent stellt nie ad hoc HTTP-Anfragen oder SQL-Abfragen gegen das darunterliegende System zusammen.

## Lesen, Schreiben und Genehmigungen

Operationen, die als `write` markiert sind, verlangen standardmäßig eine Genehmigung vor der Ausführung. Wenn ein Agent oder eine Automatisierung eine solche aufruft, pausiert die Plattform den Aufruf, postet eine Genehmigungskarte in den entsprechenden Chat oder den Posteingang **Genehmigungen** und wartet auf eine menschliche Annahme oder Ablehnung. Nur bei Annahme läuft der Aufruf. Lese-Operationen werden sofort ausgeführt. Die vollständige Doktrin — wer genehmigen darf, wie die Karte aussieht, was bei Ablehnung passiert — liegt unter [Genehmigungen](/de/platform/workspace/approvals); nutze sie für Abrechnungsaktionen, Massen-E-Mails, Schreibvorgänge auf Produktionsdaten und alles andere, das von einem zweiten Augenpaar profitiert.

## Authentifizierung und Zugangsdaten

Das Array `secretBindings` eines Konnektors benennt die Zugangsdaten, die er zur Laufzeit über `secrets.get('<key>')` liest. Wenn du die Integration unter **Einstellungen > Integrationen** verbindest, fragt das Formular genau diese Schlüssel ab; die Werte werden verschlüsselt im Ruhezustand gespeichert, an deine Organisation gebunden und nach dem Speichern nie wieder an die UI zurückgegeben. OAuth-2.0-Konnektoren durchlaufen den Standard-Authorization-Code-Flow, speichern sowohl Access- als auch Refresh-Token und erneuern das Access-Token automatisch vor Ablauf. SQL-Konnektoren speichern Server, Port, Datenbank, Benutzername und Passwort im selben verschlüsselten Speicher.

Das Feld **Konfigurationsanleitung** eines Konnektors rendert beliebiges vom Autor geliefertes Markdown im Manage-Dialog unter **Konfigurationsanleitung** — das ist der richtige Ort, um dem Nutzer zu sagen, wo der API-Schlüssel zu erzeugen ist, welche OAuth-Berechtigungen zu erteilen sind oder welche Datenbankrolle anzulegen ist. Nach Eingabe der Zugangsdaten ruft **Verbindung testen** den `testConnection`-Hook des Konnektors vor dem Speichern auf; ein fehlgeschlagener Test zeigt die Fehlermeldung inline, sodass Zugangsdaten korrigiert werden können, ohne den Dialog zu verlassen.

## Mitgelieferte Beispiele

Dreizehn einsatzbereite Konnektoren liegen im Repository unter `examples/integrations/`. Jeder ist eine vollständige `config.json` plus Konnektor-Quelltext; forke ihn als Ausgangspunkt für deine eigene Variante oder installiere ihn so wie er ist.

| Beispiel         | Typ      | Auth         | Was es abdeckt                                                          |
| ---------------- | -------- | ------------ | ----------------------------------------------------------------------- |
| **AI image**     | rest_api | bearer_token | Bildgenerierung gegen OpenAI-kompatible Anbieter.                       |
| **Circuly**      | rest_api | basic_auth   | Produkte, Kunden und Abonnements in Circuly.                            |
| **Discord**      | rest_api | bearer_token | Guilds, Kanäle und Nachrichten über die Discord-Bot-API.                |
| **GitHub**       | rest_api | bearer_token | Repositories, Issues, `Pull Requests` und Code-Suche.                   |
| **Gmail**        | rest_api | oauth2       | Nachrichten, Labels, Threads und Entwürfe in Gmail.                     |
| **Google Drive** | rest_api | oauth2       | Dateien aus Drive-Ordnern in Tale-Dokumente synchronisieren.            |
| **Outlook**      | rest_api | oauth2       | Mail, Kalender und Kontakte über Microsoft Graph.                       |
| **Protel**       | sql      | basic_auth   | Direkter SQL-Zugriff auf ein Protel-Hotel-PMS — Reservierungen, Folios. |
| **Shopify**      | rest_api | api_key      | Produkte, Kunden und Bestellungen in der Shopify Admin API.             |
| **Slack**        | rest_api | oauth2       | Kanäle, Nachrichten, Nutzer und Datei-Uploads.                          |
| **Tavily**       | rest_api | api_key      | Offene Web-Suche und Seitenextraktion, abgestimmt auf LLM-Agents.       |
| **Teams**        | rest_api | oauth2       | Teams, Kanäle, Nachrichten und Chats über Microsoft Graph.              |
| **Twilio**       | rest_api | basic_auth   | SMS, Sprachanrufe und Telefonnummern-Verwaltung.                        |

## Installieren oder selbst bauen

Zwei Wege landen einen Konnektor mit derselben `config.json` plus Quelltext auf dem Server.

**Aus der UI.** Öffne **Einstellungen > Integrationen > Integration hinzufügen** und lege ein `.zip`-Paket ab oder wähle `config.json`, `connector.ts` (oder `connector.js`) und ein Icon einzeln aus. Der Gesamt-Upload ist auf 1 MB begrenzt. Nach dem Hochladen Zugangsdaten eintragen und auf **Verbindung testen** klicken.

**Aus Projektcode.** Ein per `tale init` aufgesetztes Projekt hat ein Verzeichnis `integrations/`; jedes Unterverzeichnis ist ein Konnektor (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). Die Plattform lädt beim Speichern live nach, sodass das Iterieren wie das Bearbeiten jeder anderen Quelldatei ist. Das Dateiformat und die Sandbox-API sind unter [Integration bauen](/de/develop/integrations) dokumentiert; für KI-gestütztes Schreiben in einem Editor siehe [KI-gestützte Entwicklung](/de/develop/ai-assisted-development).

## MCP-Server

Über `rest_api`- und `sql`-Konnektoren hinaus konsumiert Tale auch externe Model-Context-Protocol-Server. Ein MCP-Server ist ein Drittprozess, der seinen eigenen Tool-Katalog über ein kleines standardisiertes RPC veröffentlicht; Tale registriert den Server einmal, und seine Tools werden Agents zugänglich, neben den Konnektor-Operationen. Die mentale Regel: greif zu einem MCP-Server, wenn ein Dritter schon einen für sein Produkt veröffentlicht, und greif zu einem Konnektor, wenn du den Wrapper kontrollierst und Tales Lese-/Schreib-Semantik und die UX der **Konfigurationsanleitung** willst. Die vollständige Referenz für den Registrierungs-Flow, die drei unterstützten Transporte und die Genehmigungssemantik der entdeckten Tools liegt unter [MCP-Server](/de/platform/integrations/mcp-servers).

## Verwandte Verbindungen

Drei Punkte stehen der Auffindbarkeit halber unter **Einstellungen > Integrationen**, sind aber keine `rest_api`- oder `sql`-Konnektoren — jeder hat eine eigene Einrichtungsoberfläche.

**E-Mail-Postfächer (für Konversationen).** Verbinde ein IMAP+SMTP-Postfach, um den [Konversationen](/de/platform/workspace/conversations)-Posteingang zu versorgen. Eingehende Nachrichten werden zu Threads; aus der Plattform gesendete Antworten werden als normale E-Mails zugestellt.

**Microsoft OneDrive.** Verbinde ein Microsoft-365-Konto, sodass Nutzer OneDrive-Dateien direkt in die [Wissensdatenbank](/de/platform/workspace/knowledge-base) importieren können, ohne sie vorher herunterzuladen. Konfiguriert über den Importfluss der Wissensdatenbank, nicht als Konnektor.

**API-Schlüssel.** API-Schlüssel gewähren programmatischen Zugriff auf die Tale-API selbst. Sie liegen unter **Einstellungen > Integrationen > API-Schlüssel**, weil die Oberfläche derselbe Admin-Tab ist, nicht weil sie Konnektoren sind. Jeder Schlüssel erbt die Rolle des Nutzers, der ihn erstellt hat; jederzeit auf demselben Bildschirm widerrufbar. Endpoint-Details liegen in der [API-Referenz](/de/develop/api-reference).

## Wo das hingehört

Integrationen sind die Brücke zwischen Tales KI und den Systemen, in denen die echten Daten leben. Ein Agent ohne Integrationen kann nur reden; ein Agent mit der richtigen Operation kann das Ticket anlegen, die Datenbank abfragen, die E-Mail senden, die Slack-Nachricht posten. Um einem Agent Zugriff auf eine bestimmte Operation zu geben, ist die nächste Seite [Agent erstellen](/de/platform/agents/create); für das API-Schlüssel-Gegenstück, das deinem Code erlaubt, Tale aufzurufen statt Tale hinausrufen zu lassen, öffne die [API-Referenz](/de/develop/api-reference).
