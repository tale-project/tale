---
title: Einen MCP-Server von Grund auf hochziehen
description: Einen eigenen MCP-Server für Agenten zu registrieren gibt es in dieser Version nicht — Tale ist selbst der MCP-Server, also verbinde deinen Client mit dem eingehenden Endpoint.
---

Diese Anleitung hat früher gezeigt, wie du einen Model-Context-Protocol-Server hostest und ihn in den Einstellungen registrierst, damit die Agenten der Organisation seine Tools aufrufen. Diese Richtung gibt es in dieser Version von Tale nicht: Es gibt kein Panel für MCP-Server, kein Registrierungsformular, und eine Capability, die zu einem externen MCP-Tool führen würde, lehnt die Laufzeit mit einer lesbaren Begründung ab. Ausgeliefert wird die Gegenrichtung — Tale ist selbst ein MCP-Server, mit dem sich deine Tools verbinden.

<Note>

Ausgehende MCP-Server sind in dieser Version nicht verfügbar. Die frühere Adresse **Einstellungen > MCP-Server** leitet auf **Einstellungen > Connectors** weiter, und dort stehen die von Tale mitgelieferten Connectors — nichts MCP-Spezifisches.

</Note>

## Verbinde stattdessen deinen Client mit Tale

Tale stellt pro Deployment einen MCP-Endpoint unter `/api/v1/mcp` bereit, authentifiziert mit einem API-Schlüssel der Organisation. Dahinter liegen zweiundzwanzig Tools: Automatisierungen autorieren und live schalten, sie ausführen und ihre Läufe lesen, und durchsuchen und aufrufen, was die Organisation kann. Unter **Einstellungen > API > MCP** findest du die Endpoint-URL deines Deployments, das Tool-Inventar in genau diesen drei Gruppen und unter **Ausprobieren** eine kopierbare Anfrage für dein Terminal:

```bash
curl -X POST https://your-host.example.com/api/v1/mcp \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Protokolldetails, die vollständige Tool-Tabelle und was der Schlüssel jeder Rolle darf, stehen auf [MCP-Endpoint](/de/develop/mcp-endpoint); wie du den Schlüssel erzeugst, auf [API-Schlüssel](/de/platform/admin/api-keys).

## Eigenen Code heute aus Tale erreichen

Einen eigenen Dienst so zu verpacken, dass ein Agent ihn nutzen kann, hat in dieser Version drei Formen. Ein [Connector](/de/platform/connectors/overview) ist die herstellerspezifische Brücke, die Tale mitliefert — nimm ihn, wenn es für das Zielsystem einen gibt. Eine [Automatisierung](/de/platform/automations/catalog) ruft Connector-Aktionen auf und führt dein eigenes JavaScript in `transform`-Knoten aus, nach Zeitplan oder per Webhook; du lädst sie als Paket hoch. Ein [Projekt-Agent](/de/platform/projects/project-agents) trägt **Secrets** — einen API-Schlüssel, den er als Umgebungsvariable bekommt — und ruft damit direkt aus seiner Sandbox einen Dienst auf, für den es keinen Connector gibt.

## Wo das hingehört

Die MCP-Oberfläche dieser Version zeigt nach innen: Externe Clients steuern Tale, nicht umgekehrt. Soll ein Modell außerhalb von Tale Automatisierungen autorieren oder das Wissen der Organisation durchsuchen, verbinde es mit dem Endpoint; soll ein Agent in Tale deinen Code erreichen, nimm einen Connector, eine Automatisierung oder die Secrets eines Projekt-Agenten. [MCP-Endpoint](/de/develop/mcp-endpoint) ist die Referenz für den ersten Weg; der [Connectors-Überblick](/de/platform/connectors/overview) öffnet den zweiten.
