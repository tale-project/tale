---
title: Integrationen
description: Drittsysteme, aus denen Tale liest und in die es schreibt — Kommunikation, Speicher, Identität, Entwicklung, Wissen — und wie sich die Integrations-Oberfläche von MCP unterscheidet.
---

Integrationen sind die Brücken zwischen Tale und dem Rest deines Stacks. Agents rufen sie als Tools auf, Workflows triggern sie an Schritten, und die Dokumenten-Pipeline zieht Dateien aus ihnen. Jede Integration ist eine einzige JSON-Konfiguration plus eine Credential, die die Org einmal speichert; einmal verbunden, kann alles in Tale sie ohne erneute Authentifizierung nutzen. Diese Übersicht benennt die ausgelieferten Integrationen, gruppiert danach, was sie tun.

Die Form einer Integration ist über jeden Eintrag unten gleich — eine OpenAI-kompatible REST-Oberfläche oder ein OAuth2-Tanz, mit in einer JSON-Konfiguration unter `examples/default/integrations/` deklarierten Operationen. Benutzerdefinierte Integrationen folgen derselben Form; eine Code-Änderung brauchst du nicht, um eine hinzuzufügen.

## Wie Integrationen sich von MCP unterscheiden

Zwei Oberflächen lassen einen Agent über Tale hinausreichen. **Integrationen** sind Erstanbieter-Konnektoren, durch OAuth oder API-Key gesichert, die die Org einmal unter **Einstellungen > Integrationen** konfiguriert. **MCP-Server** sind externe Prozesse (oft self-hosted), die das Model Context Protocol freigeben; die Org registriert sie unter **Einstellungen > MCP-Server** und genehmigt jedes Tool beim ersten Aufruf. Greif zu einer Integration, wenn für dein Zielsystem eine existiert; greif zu [MCP-Servern](/de/platform/integrations/mcp-servers), wenn keine Integration abdeckt, was du brauchst, und du die Brücke selbst hosten kannst.

## Kommunikation

| Integration | Was sie tut                                                 | Einrichtung                        |
| ----------- | ----------------------------------------------------------- | ---------------------------------- |
| **Slack**   | Kanäle lesen, Nachrichten senden, auf Ereignisse reagieren. | OAuth2 vom Slack-Workspace.        |
| **Teams**   | Dieselbe Form für Microsoft Teams — Kanäle und Chats.       | OAuth über Microsoft Entra ID.     |
| **Discord** | Bot-getriebener Nachrichtenversand und Kanal-Lesen.         | Discord-Bot-Token.                 |
| **Gmail**   | Inbox lesen, Mail senden, labeln.                           | OAuth über Google.                 |
| **Outlook** | Inbox lesen, Mail senden, Kalender lesen.                   | OAuth über Microsoft Entra ID.     |
| **Twilio**  | SMS, Voice, WhatsApp Business.                              | Twilio Account-SID und Auth-Token. |

## Speicher und Dokumente

| Integration       | Was sie tut                                                                                                                                | Einrichtung                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Microsoft 365** | OneDrive- und SharePoint-Dokumentensynchronisation ins [Wissen](/de/platform/knowledge/documents); Single Sign-on über Microsoft Entra ID. | OAuth über Microsoft Entra ID; derselbe Tenant treibt SSO und Dokumenten-Sync. |
| **Google Drive**  | Dateien aus Drive-Ordnern ins Wissen ziehen.                                                                                               | OAuth über Google.                                                             |
| **Confluence**    | Confluence-Seiten ins Wissen ziehen; Agents zitieren die Quellseite.                                                                       | API-Token + Base-URL (Cloud oder self-hosted).                                 |
| **WebDAV**        | Ordner von einem beliebigen WebDAV-Server lesen (Nextcloud, ownCloud, generisch).                                                          | Server-URL, Benutzername, Passwort.                                            |

Über jede dieser Quellen synchronisierte Dokumente fliessen durch dieselbe Indexierungs-Pipeline wie Direktuploads — siehe [Dokumente](/de/platform/knowledge/documents). Das Quellfeld jedes indizierten Dokuments benennt die Integration, sodass Zitate auf das Original zurückzeigen.

## Identität

Microsoft 365 deckt auch Identität ab. Sie unter **Einstellungen > Integrationen** zu verbinden aktiviert OneDrive- und SharePoint-Lesen; sie unter **Einstellungen > Authentifizierung** zu verbinden aktiviert Single Sign-on für die ganze Org über denselben Entra-ID-Tenant. Die zwei Pfade teilen Credentials und Provisionierungsregeln — siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) für das Rollen-Mapping.

## Wissen und Recherche

| Integration | Was sie tut                                                                                     | Einrichtung               |
| ----------- | ----------------------------------------------------------------------------------------------- | ------------------------- |
| **Tavily**  | Open-Web-Suche und Seitenextraktion für die [Tiefenrecherche](/de/platform/chat/deep-research). | API-Key von `tavily.com`. |

## Quellcode

| Integration | Was sie tut                                                    | Einrichtung                         |
| ----------- | -------------------------------------------------------------- | ----------------------------------- |
| **GitHub**  | Repositories lesen, Code suchen, auf Issues und PRs reagieren. | GitHub-App oder persönliches Token. |

## Vertikal: Commerce und Hospitality

| Integration | Was sie tut                              | Einrichtung              |
| ----------- | ---------------------------------------- | ------------------------ |
| **Shopify** | Bestellungen, Kunden und Produkte lesen. | Shopify-Admin-API-Token. |

## KI-Dienste

| Integration  | Was sie tut                                                                           | Einrichtung                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **AI image** | Bildgenerierungs-Oberfläche, die die konfigurierten bild-getaggten Modelle umwickelt. | Keine Einrichtung — nutzt die Modell-Provider unter [Einstellungen > Provider](/de/platform/admin/providers). |

## Eine eigene Integration hinzufügen

Eigene Integrationen folgen derselben JSON-Form wie die oben. Leg eine Konfiguration in `TALE_CONFIG_DIR/<orgSlug>/integrations/<slug>/config.json` ab, die die Operationen, die Auth-Methode und die erlaubten Hosts deklariert; unter dem org-first Layout ist jeder `integrations/`-Unterbaum der Org unabhängig. Die Integration erscheint in **Einstellungen > Integrationen**, damit User sie verbinden können. Die Form und die Validierungsregeln leben neben den ausgelieferten Konfigurationen in `examples/default/integrations/`.

Für reichere oder selbst gehostete Brücken sind [MCP-Server](/de/platform/integrations/mcp-servers) die alternative Oberfläche — jeder MCP-Server, den du registrierst, fügt seine Tools dem Agent-Werkzeuggürtel hinzu mit pro-Tool-Genehmigung.

## Wo das hineinpasst

Integrationen sind, wie Agents auf die Welt ausserhalb von Tale wirken. Welche Seite du als Nächstes liest, hängt davon ab, wozu du gekommen bist — für den Agent-Autor erklärt [Agent-Tools](/de/platform/agents/tools), wie die Operationen einer Integration als Tool-Familie am Agent auftauchen; für den Org-Admin ist [Einstellungen > Integrationen](/de/platform/admin/integrations) der Ort, an dem Credentials gespeichert und rotiert werden; für den Entwickler, der etwas Neues verdrahtet, ist [MCP-Server von Grund auf](/de/tutorials/developer/mcp-server-from-scratch) der End-to-End-Bau einer benutzerdefinierten Brücke.
