---
title: MCP-Server
description: MCP-Server sind externe Prozesse, die Tales Agents Tools über das Model Context Protocol freilegen. Admins registrieren sie unter Einstellungen > MCP-Server; die Per-Tool-Genehmigungs-Regel entscheidet, was jeder Agent aufrufen darf.
---

Ein MCP-Server ist ein externer Prozess, der Tales Agents Tools über das Model Context Protocol freilegt. Während eine Erstanbieter-Integration ein anbieterspezifischer Konnektor ist, den Tale liefert, ist ein MCP-Server eine generische Brücke, die jeder hosten kann — das Protokoll ist offen, der Vertrag besteht aus Tools und Ressourcen, und die Organisation entscheidet pro Server, was ihre Agents erreichen dürfen. Admins registrieren MCP-Server unter **Einstellungen > MCP-Server**; Entwickler und Redakteure richten Agents darauf aus.

Diese Seite ist die Referenz dafür, was ein MCP-Server in Tale hineinbringt, wie Registrierung funktioniert, wie die Per-Tool-Genehmigungs-Regel formt, was ein Agent aufrufen darf, und wie sich MCP-Server von Erstanbieter-Integrationen unterscheiden. Das Protokoll selbst ist upstream dokumentiert; was folgt, ist die Tale-seitige Oberfläche.

## Was ein MCP-Server bringt

Ein MCP-Server spricht das Model Context Protocol über HTTP oder stdio. Nach der Registrierung holt Tale das Tool-Manifest des Servers — eine Liste benannter Tools, ihrer Eingabe-Schemata und was jedes tut — und legt die Tools als Tool-Familie auf jedem Agent frei, an den der Server gebunden ist. Der Agent ruft das Tool genauso auf, wie er jedes andere Tool aufruft; die Anfrage wandert durch Tale zum MCP-Server, die Antwort des Servers wandert zurück, und der Agent nutzt sie in der Antwort.

Der Server kann zusätzlich **Ressourcen** (nur-Lese-Kontext, den der Agent ziehen kann) und **Prompts** (benannte Templates, die der Agent komponieren kann) freilegen. Tools sind die häufigste Oberfläche; Ressourcen und Prompts sind optionale Fähigkeiten, die ein Server implementieren kann oder nicht.

## Einen Server registrieren

Öffne **Einstellungen > MCP-Server** und klick auf **Server hinzufügen**. Das Formular fragt nach:

- **Name** — ein menschliches Label, das in der Tool-Liste des Agents und auf jeder Genehmigungs-Karte erscheint.
- **Transport** — HTTP oder stdio. HTTP-Server tragen eine URL; stdio-Server tragen einen Befehl, den Tale spawnt.
- **Authentifizierung** — keine, Bearer-Token oder OAuth. Tokens gehen in ein Geheimnis-Feld; OAuth geht den Tanz wie eine Erstanbieter-Integration.
- **Erlaubte Agents** — welche Agents sich an diesen Server binden dürfen. Standard ist keine Agents; greif zu **Alle Agents** nur, wenn der Server generisch genug ist, dass jeder Agent profitiert.

Das Formular zu speichern, löst einen Handshake aus: Tale verbindet sich mit dem Server, holt das Manifest und legt es ab. Ein Handshake-Fehler zeigt den Upstream-Fehler neben der Zeile.

## Die Per-Tool-Genehmigungs-Regel

Beim ersten Mal, wenn ein Agent ein Tool eines MCP-Servers aufruft, zeigt Tale eine Genehmigungs-Karte im MCP-Genehmiger-Pool der Organisation (konfiguriert unter **Einstellungen > Richtlinien > MCP-Genehmigungen**). Der Genehmiger entscheidet, ob das Tool für diesen Agent erlaubt ist. Drei Ausgänge:

- **Einmal genehmigen** — das Tool läuft diesmal, und der nächste Aufruf zeigt die Karte wieder.
- **Für diesen Agent genehmigen** — das Tool ist für diesen Agent dauerhaft erlaubt; folgende Aufrufe laufen ohne Karte.
- **Ablehnen** — das Tool ist für diesen Agent blockiert; folgende Aufrufe schlagen mit einem Autorisierungs-Fehler fehl.

Die Per-Tool-Genehmigung ist pro Agent und pro Tool. Das `read_file`-Tool für den Support-Agent zu genehmigen, genehmigt es nicht für den Vertriebs-Agent und genehmigt nicht das `write_file`-Tool auf demselben Server. Das ist Absicht — jedes Tool auf jedem MCP-Server weitet die Vertrauensgrenze, und die Per-Tool-Entscheidung ist die Art, wie die Organisation die Grenze eng hält.

## Wofür ein MCP-Server gut ist

Greif zu einem MCP-Server, wenn du willst, dass ein Agent in etwas reicht, das keine Erstanbieter-Integration deckt — eine interne API, ein Anbieter ohne Tale-Konnektor, ein lokales Skript, das eine Berechnung macht, die Tales eingebaute Tools nicht können. Das Deployment liegt bei dir; Tale spricht nur mit dem Server.

Ein häufiges Muster ist ein MCP-Server pro internen Dienst, den die Agents brauchen. Der Server läuft neben der übrigen Infrastruktur der Organisation, spricht MCP, und das Team, dem der Dienst gehört, besitzt auch den Vertrag.

## Einen Server deaktivieren und entfernen

Jeder Server hat einen Aktiviert-Schalter in seiner Zeile. Deaktivieren stoppt Tale, ihn aufzurufen; die Tools des Servers erscheinen nicht mehr in Agent-Tool-Listen, und jeder Agent, der von ihnen abhing, zeigt einen Konfigurationsfehler. Den Server zu entfernen, löscht sein Manifest und widerruft jede Per-Tool-Genehmigung, die ihn referenzierte.

Einen Server mit demselben Namen wieder hinzuzufügen, startet von vorn — das Manifest wird neu geholt, und jede Per-Tool-Genehmigung muss neu entschieden werden. Es gibt keine intransparente Übernahme von Genehmigungen über ein Löschen-und-Wieder-Hinzufügen.

## MCP-Server versus Erstanbieter-Integrationen

Beide Oberflächen lassen einen Agent über Tale hinausgreifen; der Unterschied ist, wem der Konnektor gehört. Erstanbieter-Integrationen sind anbieterspezifisch, kommen als Teil von Tale und tragen die Anmeldedaten und die Operationsliste, die das Tale-Team pflegt. MCP-Server sind generisch, von dir gehostet und tragen die Tools, die der Autor des Servers gewählt hat freizulegen. Greif zu einer Integration, wenn eine für das Zielsystem existiert; greif zu einem MCP-Server, wenn du die Brücke selbst hosten musst.

## Wo das hingehört

MCP-Server sind die offene Erweiterungs-Oberfläche für den Toolbelt eines Agents — der Hebel, wenn keine Erstanbieter-Integration deckt, was du brauchst. Die natürliche nächste Lektüre ist [Integrations-Übersicht](/de/platform/integrations/overview) für den Erstanbieter-Katalog und [Agent-Tools](/de/platform/agents/tools) dafür, wie die Tools eines MCP-Servers auf den Agent treffen und welche Vertrauensgrenze sie weiten.
