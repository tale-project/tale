---
title: Integrationen (Admin-Sicht)
description: Einstellungen > Integrationen ist der Ort, an dem Admins die Anmeldedaten hinter Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily und MCP installieren, konfigurieren und rotieren. Diese Seite behandelt die Admin-Oberfläche, nicht die Per-Integrations-Funktionsliste.
---

Einstellungen > Integrationen ist die Anmeldedaten-Oberfläche für jedes Drittanbieter-System, mit dem Tale im Namen der Organisation spricht. Admins installieren Integrationen einmal; Agents, Workflows und die Dokumenten-Pipeline nutzen sie überall sonst. Diese Seite behandelt die Admin-Seite — was die Liste zeigt, wie Installation und Rotation funktionieren, was ein Admin skopieren kann und wie sich die Oberfläche von MCP-Servern unterscheidet.

Die funktionale Geschichte jeder Integration (was sie tut, welche Scopes sie verlangt, was ein Agent aufrufen kann) liegt einen Tab weiter auf den Per-Integrations-Seiten und in der übergreifenden Konzeptseite. Was folgt, ist die Betriebsoberfläche: installieren, rotieren, einschränken, widerrufen.

## Was die Liste zeigt

Öffne **Einstellungen > Integrationen**, um auf den installierten Integrationen der Organisation zu landen. Jede Zeile nennt eine Integration, zeigt ihre Kategorie (Kommunikation, Speicher, Identität, Wissen, Quellcode, Handel, KI), den Anmeldedaten-Typ (OAuth2, API-Schlüssel, App-Token) und den Verbindungs-Status (verbunden, ausstehend, Fehler). Die Liste ist nach Kategorie und Status filterbar.

Der Katalog verfügbarer Integrationen sitzt einen Klick entfernt unter **Integration hinzufügen**. Der Katalog liefert aktuell Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify, Protel, Circuly und AI-Image; derselbe Katalog ist die Quelle, die die Integrations-Übersicht dokumentiert.

## Eine Integration installieren

Wähl eine Integration aus dem Katalog und klick auf **Verbinden**. Die Integration deklariert den erwarteten Anmeldedaten-Typ und die benötigten Scopes; Tale geht für OAuth-Integrationen den OAuth-Tanz und zeigt ein Formular für API-Schlüssel-Integrationen. Sobald die Anmeldedaten ankommen, prüft Tale sie mit einem No-op-Aufruf gegen das Upstream-System, bevor gespeichert wird — ein Fehler erscheint als Verbindungsfehler mit der Upstream-Meldung dran.

Einige Integrationen tragen Unteroptionen bei der Installation. Microsoft 365 lässt dich wählen, ob OneDrive-Sync, SharePoint-Sync, beide oder nur Single Sign-on aktiviert werden; GitHub lässt dich die Repositories wählen, auf die die Organisation Zugriff erhält; Slack fragt, in welchen Kanälen der Bot posten darf. Die Unteroptionen lassen sich später aus der Zeile der Integration ändern, ohne neu zu installieren.

## Anmeldedaten rotieren

Zum Rotieren öffne die Zeile der Integration und klick auf **Anmeldedaten rotieren**. OAuth-Integrationen gehen den Tanz nochmal mit denselben Scopes; API-Schlüssel-Integrationen zeigen ein Feld für den neuen Schlüssel. Die alte Anmeldung hört auf zu funktionieren, sobald die neue verifiziert ist — auf Integrations-Ebene gibt es kein Überlappungsfenster für Anmeldedaten. Greif zur Rotation in dem Rhythmus, den deine Sicherheitsrichtlinie vorgibt, oder wann immer das Upstream-System meldet, dass die Anmeldung kompromittiert ist.

## Eine Integration einschränken

Über die Anmeldedaten hinaus trägt eine Integration zwei Skopierungs-Hebel unter ihrer Zeile:

- **Erlaubte Rollen.** Schränke ein, welche Rollen-Agents und -Workflows die Integration aufrufen dürfen. Standard ist jede schreibende Rolle (Redakteur, Entwickler, Admin, Inhaber); das einzuengen ist die Art, wie du etwa die Twilio-Integration aus Mitglieder-Agents fernhältst.
- **Erlaubte Teams.** Schränke ein, welche Team-Agents und -Workflows die Integration aufrufen dürfen. Nützlich, wenn die Anmeldung zur Arbeit eines Teams gehört (das Slack des Supports) und du nicht willst, dass es in ein anderes leakt.

Beide Hebel werden zur Anfrage-Zeit erzwungen, nicht zur Installations-Zeit — ein Hebelwechsel greift beim nächsten Aufruf.

## Eine Integration widerrufen

Klick auf die Zeile, dann auf **Trennen**. Eine getrennte Integration hört sofort auf zu authentifizieren; Agents und Workflows, die von ihr abhängen, melden beim nächsten Aufruf einen Konfigurationsfehler. Die Zeile bleibt mit einem Getrennt-Badge in der Liste, damit der Audit-Pfad überlebt. Erneutes Verbinden geht den Anmelde-Fluss von Grund auf neu.

## Integrationen versus MCP-Server

Zwei Oberflächen lassen einen Agent über Tale hinausgreifen. **Integrationen** sind die hier dokumentierten anbieterspezifischen Erstanbieter-Konnektoren. **MCP-Server** sind externe Prozesse, die das Model Context Protocol freilegen; die Organisation registriert sie unter **Einstellungen > MCP-Server** und genehmigt jedes Tool beim ersten Aufruf. Greif zu einer Integration, wenn eine für das Zielsystem existiert; greif zu [MCP-Servern](/de/platform/integrations/mcp-servers), wenn keine Integration deckt, was du brauchst.

## Wo das hingehört

Integrationen sind die Anmelde-Hälfte der Agent-zu-Aussenwelt-Geschichte; die Agent-Hälfte (welche Tools ein Agent bekommt, wie er sie aufruft, wie die Vertrauensgrenze aussieht) liegt unter [Agent-Tools](/de/platform/agents/tools). Die natürliche nächste Lektüre für einen neuen Admin ist [Integrations-Übersicht](/de/platform/integrations/overview) — sie nennt jede ausgelieferte Integration nach Zweck gruppiert und gibt das Per-Integrations-Setup auf einen Blick.
