---
title: Entwickler
description: Entwickler ist die In-App-Entwickler-Oberfläche — API-Schlüssel für die REST-API, der MCP-Endpoint und die Connector-Zugangsdaten, mit denen eine Person mit Entwickler-Rolle Tale an externen Code anbindet.
---

Entwickler ist die In-App-Oberfläche für die Personen, die Tale an den Rest ihres Stacks anbinden. Sie bündelt die Hebel, die externem Code erlauben, mit Tale zu sprechen, und Tale erlauben, nach außen zu greifen: API-Schlüssel für die REST-Oberfläche, den MCP-Endpoint, mit dem sich MCP-Clients verbinden, und die Connector-Zugangsdaten hinter dem, was Agenten und Automatisierungen aufrufen können. Personen mit Entwickler-Rolle sehen diese Einstellungen; Mitglieder und Redakteure nicht.

Diese Übersicht nennt, was jede Seite behandelt, und verweist auf die tiefere Referenz. Wer die Entwickler-Rolle hat, landet meist am ersten Tag hier, erzeugt die nötigen Zugangsdaten und kommt wieder, wenn der Stack wächst — einen Schlüssel rotieren, einen neuen MCP-Client auf den Endpoint richten, einen weiteren Dienst verbinden.

## Was Entwickler abdeckt

Die Entwickler-Oberfläche sitzt neben den übrigen Einstellungen der Organisation, richtet sich aber an ein engeres Publikum. Sie setzt voraus, dass du weißt, was eine REST-API ist, wie ein Webhook aussieht und was ein MCP-Client tut — die Seiten erklären die Konzepte nicht neu, sondern zeigen, wie Tale sie offenlegt. Zwei Hebel der früheren Version gibt es in dieser nicht: externe MCP-Server registrieren und Custom Tools definieren. Dein eigener Code erreicht einen Agenten stattdessen über die **Secrets** eines Projekt-Agenten oder die Knoten einer Automatisierung — [MCP-Server](/de/platform/connectors/mcp-servers) und [Ein eigenes Tool bauen](/de/tutorials/developer/build-a-custom-tool) sagen, was an die Stelle von beidem getreten ist.

Dieselbe Oberfläche unterscheidet sich zwischen den Tabs Cloud und Selbst gehostet nur in der Deployment-Form; die Oberfläche hier ist identisch. Die Seite der Konfigurationsdateien — Umgebungsvariablen und Provider-Dateien — liegt einen Tab weiter in der Dokumentation unter Selbst gehostet.

## Seiten in diesem Bereich

<CardGroup cols="2">

<Card title="API-Schlüssel" icon="key" href="/de/platform/admin/api-keys">

Ein Skript, einen Cron-Job oder einen internen Dienst an Tales REST-API anbinden. Geteilt mit Admin unter **Einstellungen > API > REST**.

</Card>

<Card title="MCP-Endpoint" icon="network" href="/de/develop/mcp-endpoint">

Einen MCP-Client auf Tale richten — Endpoint-URL, Tool-Inventar und eine kopierbare Anfrage stehen unter **Einstellungen > API > MCP**.

</Card>

<Card title="Zugangsdaten für Connectors" icon="plug" href="/de/platform/admin/connectors">

Die Zugangsdaten anlegen, als Standard setzen, deaktivieren und neu verbinden, mit denen die mitgelieferten Connectors handeln — das, was Agenten und Automatisierungen außerhalb von Tale erreichen.

</Card>

</CardGroup>

## Wo das hingehört

Entwickler ist die Brücke zwischen Tale und dem Rest der Codebasis, die die Organisation betreibt. Die natürliche Erstlektüre hängt davon ab, was du anbinden willst — für eingehend (etwas von außen ruft in Tale hinein) [API-Schlüssel](/de/platform/admin/api-keys) und den [MCP-Endpoint](/de/develop/mcp-endpoint); für ausgehend (etwas in Tale greift nach außen) [Zugangsdaten für Connectors](/de/platform/admin/connectors) und die [Secrets](/de/platform/projects/project-agents) eines Projekt-Agenten.
