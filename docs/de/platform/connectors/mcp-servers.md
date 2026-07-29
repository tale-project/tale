---
title: MCP-Server
description: Registriere externe Tool-Server unter Einstellungen > API > MCP — Transport, Authentifizierung, die Liste der erkannten Tools und die Genehmigungs-Flags pro Tool, die die Vertrauensgrenze eng halten.
---

Ein MCP-Server ist ein externer Prozess, der Tales Agents über das Model Context Protocol Tools bereitstellt. Wo eine [Connector](/de/platform/connectors/overview) ein anbieterspezifischer Konnektor ist, den Tale mitliefert, ist ein MCP-Server eine generische Brücke, die jeder hosten kann — eine interne API, ein Anbieter ohne Konnektor, ein Skript, das etwas berechnet, was Tales eingebaute Tools nicht können. Du hostest den Server; Tale spricht nur mit ihm.

<Frame caption="Das Formular MCP-Server hinzufügen — eine Verbindung und eine Authentifizierungsmethode sind die ganze Registrierung.">

![Der Dialog MCP-Server hinzufügen unter Einstellungen API MCP, ausgefüllt für einen Server für Support-Tickets — Anzeigename Support Tickets, eine einzeilige Beschreibung, Streamable HTTP als Transporttyp, die Server-URL und Keine als Authentifizierungsmethode — über der MCP-Seite, auf der bereits ein Server Internal Wiki registriert ist.](/images/platform/settings-mcp-add-dialog.webp)

</Frame>

## Einen Server registrieren

Öffne **Einstellungen > API > MCP** und klicke auf **MCP-Server hinzufügen**. Das Formular nimmt:

- **Name** und **Anzeigename** — die Kennung und das Label, das Agents und Genehmigungskarten zeigen.
- **Transporttyp** — **Streamable HTTP**, **SSE** oder **stdio**. Die HTTP-Transporte nehmen eine **URL** — das Formular markiert eine fehlerhafte URL inline, bevor du speichern kannst; stdio nimmt den Befehl, den Tale startet.
- **Authentifizierung** — **Keine**, **API-Key** oder **OAuth 2.0** (Token-URL, Client-ID und -Geheimnis, Bereiche).
- **Erlaubte Agents** — welche Agents sich an diesen Server binden dürfen. Standard ist keine Agents; greif zu **Alle Agents** nur, wenn der Server generisch genug ist, dass jeder Agent profitiert.

**Server speichern**, dann **Verbindung testen** auf der Zeile, um den Handshake zu prüfen — der Status der Zeile zeigt **Verbunden**, **Getrennt** oder **Fehler** mit der Meldung der Gegenseite.

## Die erkannten Tools

Sobald die Verbindung steht, holt Tale das Manifest des Servers und listet es als **Erkannte Tools** — Name und Beschreibung jedes Tools und ob der Server es mit **Genehmigung erforderlich** markiert. Markierte Tools fragen im Chat bei jedem Aufruf durch einen Agent, mit den exakten Argumenten auf der Karte; unmarkierte laufen wie jedes eingebaute Tool.

<Warning>

Jedes MCP-Tool weitet aus, was deine Agents erreichen können, und die Genehmigungs-Flags stammen vom Autor des Servers — einen Server zu verbinden heißt, seinen Tool-Vertrag anzunehmen. Lies die erkannte Liste, bevor du Agents auf einen Server richtest, den du nicht selbst geschrieben hast.

</Warning>

## Aus Agents heraus nutzen

Die Tools eines registrierten, aktiven Servers reihen sich in das Tool-Set ein, das Agents aufrufen können; die Anfrage reist durch Tale zu deinem Server, und die Antwort kommt zurück ins Gespräch. Der Server kann auch Ressourcen und Prompts bereitstellen, wo sein Autor sie implementiert — Tools sind die gemeinsame Oberfläche.

## Deaktivieren und entfernen

Jede Server-Zeile lässt sich deaktivieren — seine Tools fallen aus den Tool-Sets der Agents heraus, bis du ihn wieder aktivierst; die Registrierung bleibt erhalten. Den Server zu löschen entfernt die Registrierung nach einer Bestätigung vollständig; ihn später erneut hinzuzufügen ist eine frische Registrierung mit einem frischen Manifest-Abruf.

## MCP-Server oder Connector

Beide lassen einen Agent über Tale hinausgreifen; der Unterschied ist, wem der Konnektor gehört. Connectors sind anbieterspezifisch, mitgeliefert und im Katalog gepflegt; MCP-Server sind generisch, und du betreibst sie selbst. Greif zur Connector, wenn eine für das Zielsystem existiert; greif zu MCP, wenn die Brücke dein eigener Code sein soll.

## Wo das hingehört

MCP ist die offene Erweiterungsfläche des Agent-Tool-Sets. Die natürlichen nächsten Lektüren sind [Agent-Tools](/de/platform/agents/tools) dafür, wie Tools an einem Agent auftauchen, [Genehmigungen konfigurieren](/de/platform/approvals/configure) für die Flags, die riskante Aufrufe anhalten, und das Tutorial [MCP-Server von Grund auf](/de/tutorials/developer/mcp-server-from-scratch) für den Bau von Anfang bis Ende.
