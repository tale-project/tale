---
title: Entwickler
description: Entwickler ist die In-App-Entwickler-Oberfläche — API-Schlüssel, Custom Tools, Agent-Webhooks, MCP-Server. Die Seiten hier sind das, was eine Person mit Entwickler-Rolle durchklickt, wenn sie Tale an externen Code verdrahtet.
---

Entwickler ist die In-App-Oberfläche für die Personen, die Tale an den Rest ihres Stacks verdrahten. Sie gruppiert die vier Hebel, die externem Code erlauben, mit Tale zu sprechen, und Tale erlauben, mit externem Code zu sprechen: API-Schlüssel für die REST-Oberfläche, Custom Tools, die die Reichweite eines Agents erweitern, Agent-Webhooks für eingehende Trigger und MCP-Server für die Brücke zu externen Prozessen. Personen mit Entwickler-Rolle sehen dieses Menü; Mitglieder und Redakteure nicht.

Diese Übersicht nennt, was jede Seite behandelt, und verweist auf die tiefere Referenz. Entwickler-Rollen-Benutzer landen meist hier an ihrem ersten Tag, richten die Anmeldedaten und Tools ein, die sie brauchen, und kommen wieder, wenn sie den Stack erweitern — einen neuen MCP-Server hinzufügen, einen Schlüssel rotieren, einen neuen Webhook registrieren.

## Was Entwickler abdeckt

Die Entwickler-Oberfläche sitzt neben dem Rest der Einstellungen der Organisation, aber mit einem engeren Publikum. Sie setzt voraus, dass du weißt, was eine REST-API ist, wie ein Webhook aussieht und was ein MCP-Server tut — die Seiten erklären die zugrundeliegenden Konzepte nicht neu; sie erklären, wie Tale sie offenlegt.

Dieselbe Oberfläche in den Cloud- und Self-hosted-Tabs unterscheidet sich nur in der Deployment-Form; die Oberfläche hier ist identisch. Die Konfigurationsdatei-Entsprechungen einiger dieser Funktionen (Env-Vars, JSON-Konfigurationen für Custom Tools) liegen einen Tab weiter in der Self-hosted-Dokumentation.

## Seiten in diesem Bereich

<CardGroup cols="2">

<Card title="API-Schlüssel" icon="key" href="/de/platform/admin/api-keys">

Ein Skript, einen Cron-Job oder einen internen Dienst an Tales REST-API verdrahten. Geteilt mit Admin unter Einstellungen > API-Schlüssel.

</Card>

<Card title="MCP-Server" icon="server" href="/de/platform/connectors/mcp-servers">

Einen externen MCP-Protokoll-Prozess registrieren und wählen, welche seiner Tools die Agents der Organisation aufrufen dürfen.

</Card>

<Card title="Agent-Tools" icon="wrench" href="/de/platform/agents/tools">

Den Toolbelt eines Agents um ein Custom Tool erweitern, das die Agents der Organisation aufrufen können.

</Card>

</CardGroup>

## Wo das hingehört

Entwickler ist die Brücke zwischen Tale und dem Rest der Codebase, die die Organisation fährt. Die natürliche Erstlektüre hängt davon ab, was du verdrahten willst — für ausgehend (etwas innerhalb von Tale ruft nach außen) [Agent-Tools](/de/platform/agents/tools) und [MCP-Server](/de/platform/connectors/mcp-servers); für eingehend (etwas von außen ruft in Tale hinein) [API-Schlüssel](/de/platform/admin/api-keys).
