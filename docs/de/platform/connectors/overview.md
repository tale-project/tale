---
title: Connectors
description: Die Connectoren, die mit Tale ausgeliefert werden, die Zugangsdaten, die deine Organisation dazu hinterlegt, und wie die Aktionen eines Connectors in Automationen und im Chat landen.
---

Eine Connector besteht aus zwei Teilen: einem **Connector**, der mit der Plattform ausgeliefert wird, und den **Zugangsdaten**, die deine Organisation dazu hinterlegt. Der Connector bringt das Wissen über den Anbieter mit — welche Aktionen es gibt, was jede davon entgegennimmt und zurückgibt, wie die Anmeldung läuft — und sieht in jeder Organisation gleich aus. Die Zugangsdaten gehören dir, und ein Connector hält davon so viele, wie du brauchst: einen Eintrag pro Workspace, Shop, Postfach oder Bot. Dreizehn Connectoren werden ausgeliefert, und jeder davon steht bereits unter **Einstellungen > Connectors** und wartet auf seinen ersten Eintrag.

Lieber erst zusehen? Episode 7 geht die Türen zur Außenwelt ab — Connectoren, MCP und die Grenzen — in knapp drei Minuten, mit Untertiteln.

<Video src="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.mp4" poster="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.webp" captions="/videos/de/tutorials/ep7-connectors/ep7-connectors.de.vtt" lang="de" title="Episode 7 — Connectors & die Außenwelt" caption="Episode 7 — Connectors & die Außenwelt (2:52)">

</Video>

## Was ein Connector ist

Es gibt nichts zu installieren. Jeder Connector kommt mit der Plattform, deshalb sieht der Katalog in jeder Organisation gleich aus und deshalb hält ein Upgrade ihn aktuell, ohne dass jemand ihn pflegt. Ein Connector ist eine Definition: ein Anzeigename mit einer Zeile Beschreibung, die Kategorien, zu denen er gehört, die Authentifizierungsmethoden, die er akzeptiert, und die Liste der Aktionen, die er beim Anbieter ausführen kann.

Weil diese Definition für alle gilt, entscheidet deine Organisation nur eines: als welche Konten Tale handeln darf. Diese Entscheidung sind die Zugangsdaten, und mehr Einrichtung gibt es nicht.

## Die mitgelieferten Connectoren

Dreizehn Connectoren werden ausgeliefert, jeder mit der Kategorie, zu der er gehört — Knowledge, Messaging, Email, Developer, Commerce, Search oder Files. **Anmeldung** ist die Authentifizierungsmethode, die der Connector akzeptiert; sie bestimmt, wonach das Formular fragt. **Aktionen** ist die Anzahl der Operationen, die er anbietet — dieselbe Zahl, die der Abschnitt des Connectors in den Einstellungen zeigt.

| Connector               | Was dir das Verbinden bringt                                                                                   | Anmeldung               | Aktionen |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| **Confluence**          | Confluence-Cloud-Seiten in die Wissensdatenbank von Tale importieren.                                          | Benutzername & Passwort | 2        |
| **Discord**             | Nachrichten posten und Kanäle im eigenen Discord-Server verwalten.                                             | Token                   | 8        |
| **GitHub**              | Repositories, Issues und Pull Requests auf GitHub verwalten.                                                   | Token                   | 19       |
| **Gmail**               | E-Mails in Gmail lesen, senden und sortieren.                                                                  | OAuth                   | 9        |
| **Google Drive**        | Dateien aus Google Drive in die Wissensdatenbank von Tale importieren.                                         | OAuth                   | 2        |
| **IMAP / SMTP Mailbox** | Einen eigenen IMAP- und SMTP-Mailserver an Conversations anbinden — ohne Gmail- oder Outlook-Konto.            | Benutzername & Passwort | 2        |
| **Microsoft Outlook**   | Outlook-Mail, -Kalender und -Kontakte verwalten.                                                               | OAuth                   | 10       |
| **Shopify**             | Produkte, Kunden und Bestellungen aus dem eigenen Shopify-Shop abgleichen.                                     | API-Schlüssel           | 9        |
| **Slack**               | Nachrichten senden und mit Kanälen in Slack arbeiten.                                                          | OAuth                   | 7        |
| **Tavily**              | Websuche und Seitenextraktion in Echtzeit für KI-Recherche.                                                    | API-Schlüssel           | 2        |
| **Microsoft Teams**     | Nachrichten senden und Kanäle in Microsoft Teams verwalten.                                                    | OAuth                   | 9        |
| **Twilio**              | SMS verschicken und Sprachanrufe über Twilio führen.                                                           | Benutzername & Passwort | 7        |
| **WebDAV Files**        | Dateien im WebDAV-Speicher der Organisation lesen, schreiben und auflisten — dieselben, die `/dav` ausliefert. | Benutzername & Passwort | 4        |

Seiten und Dateien, die über Confluence oder Google Drive hereinkommen, laufen durch dieselbe Indexierung wie ein direkter Upload, und Antworten zitieren sie zurück auf die Quelle — siehe [Dokumente](/de/platform/knowledge/documents). OneDrive- und SharePoint-Import läuft über Wissen → Dokumente (pro Benutzer autorisiert), nicht als Org-Connector. Der WebDAV-Connector ist die Schreibseite desselben Speichers, den deine Geräte als Netzlaufwerk einbinden; das beschreibt [WebDAV](/de/platform/connectors/webdav).

## Zugangsdaten an einem Connector

Ein Connector hält so viele Zugangsdaten, wie deine Organisation braucht. Ein Slack-Workspace pro Geschäftsbereich, ein Shopify-Shop pro Markt, ein Postfach pro Support-Warteschlange — jeder davon ist eine eigene Zeile unter dem Connector, mit eigenem Secret und eigenem Zustand. Genau das lässt eine gemeinsame Automations-Bibliothek mehrere Teams bedienen, ohne dass eines das Konto eines anderen mitbenutzt.

Jeder Eintrag trägt vier Dinge:

- **Name** — unter diesem Namen wählt eine Aktion diesen Eintrag aus. Schreib ihn für die Person, die in einem halben Jahr die Automation liest: `Support-Postfach`, `Shop EU`, `Release-Bot`.
- **Authentifizierungsmethode** — **API-Schlüssel**, **Token**, **Benutzername & Passwort** oder **OAuth**, ausgewählt aus dem, was der Connector akzeptiert.
- **Standard** — ein Eintrag pro Connector kann das sein. Ein Automations-Node oder eine Chat-Aktion ohne eigene Angabe nutzt ihn.
- **Zustand** — ein Eintrag ist entweder im Einsatz oder **Deaktiviert**. Deaktivieren behält die Zeile samt Konfiguration, verhindert aber jeden Aufruf darüber.

Ohne Standard funktioniert ein Connector weiterhin für alle Aufrufer, die einen Eintrag benennen — wer keinen benennt, hat jedoch nichts, worauf er zurückfallen kann. Der Abschnitt des Connectors sagt das, und die Lösung ist, einen der vorhandenen Einträge zum Standard zu machen.

<Note>

Confluence und Shopify haben keinen einheitlichen Anbieter-Host — die API liegt auf deiner eigenen Atlassian-Site oder in deinem eigenen `myshopify.com`-Shop. Beide fragen deshalb pro Eintrag nach einer **Instanz-URL**, und ihr Abschnitt trägt die Zeile _Jeder Eintrag nennt seine eigene Instanz._ Richte Confluence auf die Adresse, unter der du Confluence öffnest, und Shopify auf die Admin-Adresse des Shops statt auf die Storefront-Domain.

</Note>

## Einen Connector verbinden

Wo du anfängst, hängt davon ab, was der Connector akzeptiert. Connectoren mit Token oder Schlüssel öffnen ein Formular und nehmen das Secret direkt entgegen; OAuth-Connectoren schicken dich auf den Freigabe-Dialog des Anbieters und kommen mit einem fertig ausgefüllten Eintrag zurück. Beide Wege enden am selben Punkt — einer benannten Zeile unter dem Connector.

<Steps>

<Step title="Einstellungen > Connectors öffnen">

Jeder Connector hat einen Abschnitt, überschrieben mit Icon, Beschreibung, Kategorien und Aktionszahl. Nichts versteckt sich hinter einem Katalog-Dialog.

</Step>

<Step title="Zugangsdaten hinzufügen">

**Zugangsdaten hinzufügen** öffnet das Formular bei Connectoren, die einen Schlüssel, ein Token oder Benutzername und Passwort entgegennehmen. **Verbinden** startet bei OAuth-Connectoren den Freigabe-Flow des Anbieters und legt danach eine neue Zeile an.

</Step>

<Step title="Benennen und zum Standard machen">

Gib dem Eintrag einen Namen, auf den deine Automationen zeigen können, und mache ihn zum Standard, wenn er greifen soll, sobald niemand einen Eintrag benennt. Die Aktionen des Connectors stehen Automationen und Chat zur Verfügung, sobald die Zeile existiert.

</Step>

</Steps>

Die Details pro Methode — wonach jedes Formular fragt, wie du ein Secret ersetzt, was bei einer abgelaufenen Autorisierung passiert — stehen unter [Zugangsdaten für Connectors](/de/platform/admin/connectors).

## Aktionen in Automationen und im Chat

Jede Aktion, die ein Connector deklariert, hat einen Namen, eine Beschreibung, ein Eingabe-Schema, eine Ausgabe-Signatur und einen deklarierten Effekt: `read` oder `write`. Automationen setzen eine Aktion als Node in den Workflow-Editor; im Chat erreichen Agents dieselben Aktionen als Tools. In beiden Fällen löst der Aufruf zuerst die Zugangsdaten auf — den benannten Eintrag oder den Standard des Connectors — und scheitert mit klarer Meldung, wenn es beides nicht gibt.

<Warning>

Schreibende Aktionen verändern etwas im anderen System: eine gepostete Nachricht, ein angelegtes Issue, eine verschickte SMS. Solche Aufrufe laufen über die Genehmigungsrichtlinie deiner Organisation, der Agent schlägt den Aufruf also vor und eine Person gibt ihn frei. Lies [Genehmigungen konfigurieren](/de/platform/approvals/configure), bevor du einen Agent darauf ansetzt.

</Warning>

## Wenn kein Connector passt

Dreizehn Connectoren decken die Systeme ab, zu denen die meisten Teams greifen — und sie decken keine interne API ab, kein selbstgebautes Tool und keinen Anbieter, für den niemand einen Connector geschrieben hat. Dafür gibt es MCP: du betreibst einen Server, Tale registriert ihn, und seine Tools reihen sich neben den Connector-Aktionen in den Werkzeugkasten des Agents ein. Die Brücke ist dann dein Code statt einer mitgelieferten Definition — genau das ist der Handel: mehr Freiheit, mehr Wartung.

Registriert wird ein solcher Server unter **Einstellungen > API > MCP**, beschrieben in [MCP-Server](/de/platform/connectors/mcp-servers).

## Wo das hingehört

Connectoren sind der Weg, auf dem Tale die Systeme erreicht, in denen deine Arbeit ohnehin stattfindet; Zugangsdaten sind die Entscheidung darüber, als welche Konten Tale dabei handelt. Von hier aus zeigt [Zugangsdaten für Connectors](/de/platform/admin/connectors) die Betriebsseite — Einträge anlegen, ersetzen, deaktivieren und neu verbinden. [Agent-Tools](/de/platform/agents/tools) zeigt, wie die Aktionen eines Connectors im Werkzeugkasten eines Agents ankommen, [Genehmigungen konfigurieren](/de/platform/approvals/configure) hält die schreibenden zurück, und [MCP-Server](/de/platform/connectors/mcp-servers) deckt ab, was der Katalog offen lässt.
</content>
</invoke>
