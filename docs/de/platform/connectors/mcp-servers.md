---
title: Einen externen Client über MCP verbinden
description: Finde den MCP-Endpunkt von Tale und erfahre, wie externe Clients damit arbeiten.
---

Über den MCP-Endpunkt verbindet sich ein externer Coding-Assistent oder anderer MCP-Client mit deiner Organisation in Tale. Er kann verfügbare Funktionen finden, Automationen erstellen und Läufe prüfen. Der Zugriff folgt dem Organisations-API-Schlüssel und den Berechtigungen seines Inhabers.

## Den Endpunkt finden

Öffne **Einstellungen > API > MCP**. Die Seite zeigt die Endpunkt-URL, den Organisations-Slug, die verfügbaren Tool-Gruppen und eine kopierbare Anfrage zum Verbindungstest. Falls du noch keinen passenden Schlüssel hast, erstelle ihn unter **Einstellungen > API**.

<Frame caption="Die MCP-Einstellungen zeigen Endpunkt, Organisationskontext und verfügbare Tools.">

![Die MCP-Seite zeigt eine Endpunkt-URL mit /api/v1/mcp, einen Organisations-Slug, Tool-Gruppen und eine Beispielanfrage zum Verbindungstest.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

Unter [MCP-Endpunkt](/de/develop/mcp-endpoint) stehen Client-Konfiguration, Authentifizierung und benötigte Berechtigungen. Hinterlege den Schlüssel in der Zugangsdatenverwaltung des Clients, nicht in einem Prompt oder geteilten Dokument.

## Die Verbindungsrichtung wählen

Der MCP-Endpunkt von Tale nimmt Verbindungen externer Clients an. In Tale gibt es kein Einstellungsformular, um einen externen MCP-Server als Ausstattung eines Projektagenten zu registrieren.

Soll ein Agent innerhalb von Tale einen anderen Dienst verwenden, prüfe den [Connector-Katalog](/de/platform/connectors/overview). Gibt es keinen passenden Connector, kann ein [Projektagent](/de/platform/projects/project-agents) den Dienst mit einem passend begrenzten Secret aus seiner Sandbox aufrufen. Der laufende Agent erhält dabei Zugriff auf das Secret. Begrenze seine Rechte deshalb auf die konkrete Aufgabe.

## Den Zugriff vor dem Erstellen prüfen

Beginne mit der Testanfrage auf der MCP-Seite und prüfe, ob der Client die Tools auflisten kann. Lies vor einem Schreibzugriff, welche Berechtigung das Tool verlangt. Eine Automation zu speichern und bereitzustellen sind getrennte Schritte. Eine Client-Verbindung umgeht weder die Freigabe zur Bereitstellung noch Genehmigungsregeln.

[API-Schlüssel](/de/platform/admin/api-keys) erklärt Austausch und Widerruf. Unter [Automationen verstehen](/de/platform/automations/concepts) findest du den Ablauf zum Speichern, Testen und Bereitstellen.
