---
title: Einen externen Client über MCP verbinden
description: Finde den MCP-Endpunkt von Tale und erfahre, wie externe Clients damit arbeiten.
---

Über den MCP-Endpunkt verbindet sich ein externer Coding-Assistent oder anderer MCP-Client mit deiner Organisation in Tale. Er kann verfügbare Funktionen finden, Automatisierungen erstellen und Läufe prüfen. Der Zugriff folgt den Berechtigungen der Person hinter der Verbindung: dem Inhaber des API-Schlüssels oder der Person, die den Agent angemeldet hat.

## Den Endpunkt finden

Öffne **Einstellungen > API > MCP**. Wo sich Agents anmelden dürfen, beginnt die Seite mit **Coding-Agent verbinden**: den Befehlen für Claude Code und Codex, einer Zeile, die sagt, wann sich dein Agent angemeldet hat, und einem ersten Prompt für ihn. Darunter zeigt sie die Endpunkt-URL, den Organisations-Slug, die verfügbaren Tool-Gruppen und eine kopierbare Anfrage zum Verbindungstest. Ein Coding-Agent meldet sich selbst an, sobald er diese Adresse hat ([Verbundene Agenten](/de/platform/admin/connected-agents) zeigt und beendet diese Verbindungen); sonst erstelle einen passenden Schlüssel unter **Einstellungen > API**.

<Frame caption="Die MCP-Einstellungen verbinden einen Coding-Agent und zeigen Endpunkt, Organisationskontext und verfügbare Tools.">

![Die MCP-Seite beginnt mit Connect a coding agent: den Tabs Claude Code, Codex und Other, den zwei Befehlen, die Tale hinzufügen und anmelden, einer Zeile, die auf die Anmeldung des Agents wartet, und einem ersten Prompt zum Kopieren. Darunter zeigt der Abschnitt MCP endpoint eine Endpunkt-URL, die auf /api/v1/mcp endet.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

Unter [MCP-Endpunkt](/de/develop/mcp-endpoint) stehen Client-Konfiguration, Authentifizierung und benötigte Berechtigungen. Hinterlege den Schlüssel in der Zugangsdatenverwaltung des Clients, nicht in einem Prompt oder geteilten Dokument.

## Die Verbindungsrichtung wählen

Der MCP-Endpunkt von Tale nimmt Verbindungen externer Clients an. In Tale gibt es kein Einstellungsformular, um einen externen MCP-Server als Ausstattung eines Projektagenten zu registrieren.

Soll ein Agent innerhalb von Tale einen anderen Dienst verwenden, prüfe den [Connector-Katalog](/de/platform/connectors/overview). Gibt es keinen passenden Connector, kann ein [Projektagent](/de/platform/projects/project-agents) den Dienst mit einem passend begrenzten Secret aus seiner Sandbox aufrufen. Der laufende Agent erhält dabei Zugriff auf das Secret. Begrenze seine Rechte deshalb auf die konkrete Aufgabe.

## Den Zugriff vor dem Erstellen prüfen

Beginne mit der Testanfrage auf der MCP-Seite und prüfe, ob der Client die Tools auflisten kann. Lies vor einem Schreibzugriff, welche Berechtigung das Tool verlangt. Eine Automatisierung zu speichern und bereitzustellen sind getrennte Schritte. Eine Client-Verbindung umgeht weder die Freigabe zur Bereitstellung noch Genehmigungsregeln.

[API-Schlüssel](/de/platform/admin/api-keys) erklärt Austausch und Widerruf. Unter [Automatisierungen verstehen](/de/platform/automations/concepts) findest du den Ablauf zum Speichern, Testen und Bereitstellen.
