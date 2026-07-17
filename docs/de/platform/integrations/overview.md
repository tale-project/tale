---
title: Integrationen
description: Die Drittsysteme, mit denen sich Tale verbindet — der Katalog unter Einstellungen > Integrationen, was jeder Konnektor tut, wie das Verbinden abläuft und wie sich die Oberfläche von MCP unterscheidet.
---

Integrationen sind die Brücken zwischen Tale und dem Rest deines Stacks: Agents rufen sie als Tools auf, Workflows rufen sie in Schritten auf, und die Wissens-Pipeline zieht Dokumente durch sie hindurch. Die Organisation verbindet jede genau einmal unter **Einstellungen > Integrationen**; von da an kann alles in Tale sie nutzen, ohne sich neu zu authentifizieren. Diese Übersicht benennt den mitgelieferten Katalog und die zwei Wege, ihn zu erweitern.

Lieber erst zusehen? Episode 7 geht die Türen zur Außenwelt ab — Connectoren, MCP und die Grenzen — in knapp drei Minuten, mit Untertiteln.

<Video src="/videos/de/tutorials/ep7-integrations/ep7-integrations.de.mp4" poster="/videos/de/tutorials/ep7-integrations/ep7-integrations.de.webp" captions="/videos/de/tutorials/ep7-integrations/ep7-integrations.de.vtt" lang="de" title="Episode 7 — Integrationen & die Außenwelt" caption="Episode 7 — Integrationen & die Außenwelt (2:52)">

</Video>

<Frame caption="Einstellungen > Integrationen auf dem Tab Alle Integrationen — der volle Katalog, jede Karte ein Verbinden entfernt.">

![Die Seite Einstellungen Integrationen mit einem Suchfeld, einem Button Integration hinzufügen und einem Kartenraster aus zwölf Diensten, darunter Confluence, GitHub, Gmail, Slack und Twilio.](/images/platform/integrations-catalog.webp)

</Frame>

## Der Katalog

Die Seite hat zwei Tabs — **Verbunden** zeigt, was die Organisation bereits nutzt, **Alle Integrationen** den vollen Katalog mit einem Suchfeld. Die Beschreibung jeder Karte ist der ehrliche Einzeiler dessen, was dir das Verbinden bringt:

| Integration             | Was sie tut                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confluence**          | Importiert Confluence-Cloud-Seiten in Tales Wissensdatenbank.                                                                                                                                                                         |
| **Discord**             | Postet Nachrichten und verwaltet Kanäle in deinem Discord-Server.                                                                                                                                                                     |
| **GitHub**              | Verwaltet Repositories, Issues und Pull Requests auf GitHub.                                                                                                                                                                          |
| **Gmail**               | Liest, sendet und organisiert E-Mails in Gmail.                                                                                                                                                                                       |
| **Google Drive**        | Importiert Dateien aus Google Drive in Tales Wissensdatenbank.                                                                                                                                                                        |
| **IMAP / SMTP Mailbox** | Verbindet einen privaten IMAP- und SMTP-Mailserver mit dem Posteingang — kein Gmail- oder Outlook-Konto nötig; der Versand kann über ein separates SMTP-Relay (Resend, SendGrid, Amazon SES, …) laufen statt über den Postfach-Login. |
| **Microsoft Outlook**   | Verwaltet Outlook-Mail, -Kalender und -Kontakte.                                                                                                                                                                                      |
| **Shopify**             | Synchronisiert Produkte, Kunden und Bestellungen aus deinem Shopify-Shop.                                                                                                                                                             |
| **Slack**               | Sendet Nachrichten und interagiert mit Kanälen in Slack.                                                                                                                                                                              |
| **Tavily**              | Websuche und Seitenextraktion in Echtzeit für KI-Recherche.                                                                                                                                                                           |
| **Microsoft Teams**     | Sendet Nachrichten und verwaltet Kanäle in Microsoft Teams.                                                                                                                                                                           |
| **Twilio**              | Sendet SMS und führt Sprachanrufe mit Twilio.                                                                                                                                                                                         |

## Eine verbinden

Klicke auf **Verbinden** auf einer Karte. OAuth-gestützte Dienste führen durch den Einwilligungs-Flow des Anbieters; Token-gestützte fragen im Abschnitt **Authentifizierung** nach dem Zugangsnachweis. Die Detailansicht listet außerdem die Operationen der Integration — die mit **Genehmigung erforderlich** markierten halten im Chat, bis eine Person zustimmt; so bleiben ausgehende Schreibzugriffe nachvollziehbar ([Genehmigungen konfigurieren](/de/platform/approvals/configure)).

Dokumente, die über Confluence oder Google Drive hereinkommen, fließen durch dieselbe Indexierungs-Pipeline wie direkte Uploads, und Zitate zeigen zurück auf die Quelle — siehe [Dokumente](/de/platform/knowledge/documents).

## Über den Katalog hinaus erweitern

**Integration hinzufügen** lädt einen eigenen Konnektor hoch — ein kleines Paket aus `config.json`, einer `connector.js` oder `.ts` und einem Icon (als `.zip` oder Einzeldateien, 1 MB gesamt). Die Vorschau zeigt vor der Installation seine Operationen, erlaubten Hosts und den Konnektor-Code, und das Ergebnis erscheint im Katalog wie jeder mitgelieferte Eintrag.

Wenn kein Konnektor passt und du die Brücke selbst hosten kannst, registriere stattdessen einen [MCP-Server](/de/platform/integrations/mcp-servers) — eine generische Protokolloberfläche statt eines anbieterspezifischen Konnektors.

<Note>

WebDAV steht nicht in diesem Katalog, weil es in die andere Richtung zeigt: Es serviert Tales Dokumente als Netzlaufwerk an deine Geräte. Siehe [WebDAV](/de/platform/integrations/webdav).

</Note>

## Wo das hingehört

Integrationen sind der Weg, auf dem Agents auf die Welt außerhalb von Tale wirken. Für Agent-Autoren zeigt [Agent-Tools](/de/platform/agents/tools), wie die Operationen einer Integration als Tools auftauchen; für Genehmiger ist [Genehmigungen konfigurieren](/de/platform/approvals/configure) der Ort, an dem Schreiboperationen angehalten werden; für Builder ohne passenden Konnektor ist [MCP-Server](/de/platform/integrations/mcp-servers) die offene Alternative.
