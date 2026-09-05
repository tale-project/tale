---
title: MCP-Server
description: Externe MCP-Server zu registrieren, damit Agenten sie aufrufen, gibt es in dieser Version nicht.
---

Diese Seite hat früher ein Formular **MCP-Server hinzufügen** beschrieben: einen Transport, eine Authentifizierungsmethode, eine Liste erlaubter Agenten und eine Tabelle erkannter Tools mit Genehmigungs-Flags pro Tool. Nichts davon gibt es in dieser Version von Tale. Es gibt kein Panel für MCP-Server, kein Registrierungsformular und keinen Werkzeugkasten der Agenten, in den sich ein externer Server einreihen könnte — eine Capability, die zu einem externen MCP-Tool führen würde, lehnt die Laufzeit mit einer lesbaren Begründung ab. Ausgeliefert wird die Gegenrichtung: Tale ist selbst ein MCP-Server, mit dem sich Clients von außen verbinden.

<Note>

Ausgehende MCP-Server sind in dieser Version nicht verfügbar. Die frühere Adresse **Einstellungen > MCP-Server** leitet auf **Einstellungen > Connectors** weiter, und dort stehen die von Tale mitgelieferten Connectors — nichts MCP-Spezifisches.

</Note>

## Die MCP-Oberfläche, die es gibt

Tale stellt pro Deployment einen MCP-Endpoint unter `/api/v1/mcp` bereit, authentifiziert mit einem API-Schlüssel der Organisation. Dahinter liegen zweiundzwanzig Tools in drei Gruppen — Automatisierungen autorieren und live schalten, sie ausführen und ihre Läufe lesen, und durchsuchen und aufrufen, was die Organisation kann. Unter **Einstellungen > API > MCP** findest du die Endpoint-URL deines Deployments, das Inventar in genau diesen drei Gruppen und unter **Ausprobieren** eine kopierbare `tools/list`-Anfrage. [MCP-Endpoint](/de/develop/mcp-endpoint) ist die Referenz — Protokoll, Tool-Tabelle und was der Schlüssel jeder Rolle darf; wie du den Schlüssel erzeugst, steht auf [API-Schlüssel](/de/platform/admin/api-keys).

<Frame caption="Einstellungen > API > MCP — die Endpoint-URL für deinen Client, das Tool-Inventar in seinen drei Gruppen und eine Anfrage, mit der du den Schlüssel ausprobierst.">

![Die MCP-Seite unter Einstellungen > API mit der Zeile MCP-Endpunkt, deren URL auf /api/v1/mcp endet und einen Kopieren-Button trägt, drei Zeilen mit Tool-Namen nach Gruppe — Autorieren, Lauf- & Trigger-Verwaltung, Capabilities & Wissen — und einer Zeile Ausprobieren mit einer curl-Anfrage, die tools/list mit einem API-Schlüssel als Bearer-Token aufruft.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

## Eigenen Code heute aus einem Agenten erreichen

Einen eigenen Dienst so zu verpacken, dass ein Agent ihn nutzen kann, hat in dieser Version drei Formen. Ein [Connector](/de/platform/connectors/overview) ist die herstellerspezifische Brücke, die Tale mitliefert — nimm ihn, wenn es für das Zielsystem einen gibt. Eine [Automatisierung](/de/platform/automations/catalog) ruft Connector-Aktionen auf und führt dein eigenes JavaScript in `transform`-Knoten aus, nach Zeitplan oder per Webhook; du lädst sie als Paket hoch. Ein [Projekt-Agent](/de/platform/projects/project-agents) trägt **Secrets** — einen API-Schlüssel, den er als Umgebungsvariable bekommt — und ruft damit direkt aus seiner Sandbox einen Dienst auf, für den es keinen Connector gibt.

## Wo das hingehört

Die MCP-Oberfläche dieser Version zeigt nach innen: Externe Clients steuern Tale, nicht umgekehrt. Soll ein Modell außerhalb von Tale Automatisierungen autorieren oder das Wissen der Organisation durchsuchen, verbinde es mit dem [MCP-Endpoint](/de/develop/mcp-endpoint); soll ein Agent in Tale deinen Code erreichen, nimm einen Connector, eine Automatisierung oder die Secrets eines Projekt-Agenten — der [Connectors-Überblick](/de/platform/connectors/overview) öffnet diesen Weg.
