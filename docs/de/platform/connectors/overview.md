---
title: Tale mit externen Diensten verbinden
description: Wähle den passenden Connector und das richtige Konto und verstehe, wo seine Lese- und Schreibaktionen ausgeführt werden.
---

Nutze einen Connector, wenn Tale Daten in einem externen Dienst lesen oder ändern soll. Der Connector definiert die unterstützten Aktionen. Mit den Zugangsdaten greift Tale auf das gewählte Konto zu. Entwickler, Admins und Inhaber verwalten sie unter **Einstellungen > Connectors**.

<Video src="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.mp4" poster="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.webp" captions="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.vtt" lang="de" title="Episode 7 — Connectors & die Außenwelt" caption="Episode 7 — Connectors & die Außenwelt (2:52)">

</Video>

## Die Verbindung nach der Aufgabe wählen

| Connector | Typischer Einsatz | Anmeldung |
| --- | --- | --- |
| Confluence | Confluence-Cloud-Seiten ins Wissen importieren. | Benutzername mit Passwort oder Token. |
| Discord | Mit Nachrichten und Kanälen arbeiten. | Token. |
| GitHub | Repositorys, Issues und Pull Requests lesen oder verwalten. | Token. |
| Gmail | E-Mails lesen, senden und organisieren. | OAuth. |
| Google Drive | Dateien ins Wissen importieren. | OAuth. |
| IMAP / SMTP Mailbox | E-Mails über einen eigenen Maildienst lesen oder senden. | Benutzername und Passwort. |
| Microsoft Outlook | Mit E-Mails, Kalendern und Kontakten arbeiten. | OAuth. |
| Shopify | Mit Produkten, Kunden und Bestellungen arbeiten. | API-Schlüssel. |
| Slack | Mit Nachrichten und Kanälen arbeiten. | OAuth. |
| Tavily | Im Web suchen und Seiten auslesen. | API-Schlüssel. |
| Microsoft Teams | Mit Nachrichten und Kanälen arbeiten. | OAuth. |
| Twilio | SMS senden und Sprachanrufe starten. | Benutzername mit Passwort oder Token. |
| WebDAV Files | WebDAV-Dateien der Organisation lesen, schreiben und auflisten. | Benutzername und Passwort. |

Die Karten des installierten Katalogs zeigen die aktuellen Aktionen und Anmeldemethoden. Diese Definitionen kommen mit der Plattform. Ein weiteres Konto installiert keinen beliebigen neuen Connector-Code.

Wissensimporte verwenden die [Dokumentenindexierung](/de/platform/knowledge/documents). OneDrive und SharePoint nutzen den Import unter **Wissen > Dokumente** mit persönlicher Zustimmung statt eines separaten Organisations-Connectors. Soll dein Gerät Tale-Dokumente als Laufwerk öffnen, ist die Richtung umgekehrt: Dafür dient [WebDAV](/de/platform/connectors/webdav).

## Das gewünschte Konto hinzufügen

Wähle **Zugangsdaten hinzufügen**, suche den Dienst und öffne seine Karte. Bereits eingerichtete Connectors erscheinen zuerst. Trotzdem kannst du für denselben Dienst ein weiteres Konto hinzufügen. Das Formular fragt nach der vom Connector unterstützten Anmeldung.

<Frame caption="Zugangsdaten hinzufügen öffnet den Katalog — die dreizehn mitgelieferten Connectoren, die mit vorhandenen Zugangsdaten zuerst.">

![Der Dialog Zugangsdaten hinzufügen über der Tabelle unter Einstellungen > Connectors, mit den mitgelieferten Connectoren als Karten samt Kategorien und Aktionszahl, einem Suchfeld oben und dem bereits eingerichteten Connector Tavily am Anfang der Liste.](/images/platform/connectors-add-credential.webp)

</Frame>

Gib dem Eintrag einen zweckbezogenen Namen, etwa `Support-Postfach` oder `Release-Bot`. Verwende Zugangsdaten des externen Diensts, keinen Tale-API-Schlüssel. Schließe bei OAuth die Zustimmung beim Provider ab und prüfe das zurückgemeldete Konto. Kann der Vorgang nicht starten, muss gegebenenfalls ein Administrator zuerst die OAuth-App einrichten.

Confluence und Shopify brauchen pro Eintrag eine **Instanz-URL**. Verwende den Ursprung der Atlassian-Site oder die `myshopify.com`-Adresse des Shops, keine beliebige Unterseite oder Kundendomain. [Connector-Zugangsdaten](/de/platform/admin/connectors) erklärt Felder, erneute Autorisierung und Schlüsselaustausch.

## Das Konto für eine Aktion bestimmen

Eine Aktion verwendet den ausdrücklich genannten Eintrag oder, ohne Angabe, den Standard des Connectors. Nur ein Eintrag pro Connector kann Standard sein. Ohne Standard schlägt ein Aufruf ohne Namen fehl, selbst wenn andere Zugangsdaten vorhanden sind.

Zwei Support-Postfächer sind beispielsweise zwei Einträge. Vergib unterscheidbare Namen und prüfe die aufgelöste Eingabe eines Workflows vor dem Live-Lauf. Der Standard wird verwendet, wenn die Aktion keinen bestimmten Eintrag nennt. Postfachoperationen, die alle aktiven Konten auslesen, sind ein eigener Fall.

Das Deaktivieren erhält die Konfiguration, verhindert aber ihre Nutzung. Der Austausch eines Secrets erneuert den Zugang hinter bestehenden Verweisen. Prüfe abhängige Workflows, bevor du einen Eintrag deaktivierst, löschst oder den Standard änderst.

## Lesen und Schreiben unterscheiden

Automatisierungen verwenden Connector-Aktionen als Workflow-Nodes. Jede Aktion definiert Eingabeschema, Ausgabe und Lese- oder Schreibwirkung. Testläufe simulieren die Antworten. Ein Live-Schreibvorgang kann Nachrichten senden oder externe Daten ändern und unterliegt der Freigaberichtlinie der Organisation.

Projektagenten mit konfigurierten Connectors erhalten deren unterstützte Leseaktionen über Tales Connector-Broker. Er hält diese Zugangsdaten außerhalb der Sandbox und gibt Ergebnisse zurück. Connector-Schreibaktionen lehnt er ab. Direkte GitHub-Werkzeuge und explizite Agent-Secrets nutzen andere Wege und brauchen eine eigene Prüfung.

Ein neuer Zugang erweitert nicht beliebig die Tools des gewöhnlichen Chat-Assistenten. Nutze [Automatisierungen](/de/platform/automations/editor) für einen definierten Connector-Ablauf und [Projektagenten](/de/platform/projects/project-agents) für Sandbox-Arbeit.

## Wenn der Dienst fehlt

Ein Projektagent kann aus seiner Sandbox auf einen Dienst zugreifen, wenn sein Harness dafür geeignete Werkzeuge und ein ausdrücklich freigegebenes Secret erhält. Eine `transform`-Node formt nur Daten um und ruft keine externe API auf. Prüfe Berechtigungen und erwartete Auswirkungen vor einer direkten Integration.

Soll die externe Anwendung Tale aufrufen, nutze die [REST-API](/de/develop/api-reference) oder den [MCP-Endpunkt](/de/develop/mcp-endpoint). [MCP und eigene Integrationen](/de/platform/connectors/mcp-servers) erklärt diese Unterscheidung.
