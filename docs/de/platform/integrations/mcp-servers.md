---
title: MCP-Server
description: Externe Model-Context-Protocol-Server an Tale anbinden, sodass deren Tools und Ressourcen als Agent-Tools auftauchen.
---

Ein Model-Context-Protocol-Server (MCP-Server) ist ein externer Prozess, der eine Reihe von Tools, Ressourcen und Prompts über ein kleines standardisiertes RPC veröffentlicht. Tale registriert einen MCP-Server einmal und stellt dessen Tools dann jedem Agent in der Organisation zur Verfügung, der sich aktiv beteiligt. Wo eine Tale-[Integration](/de/platform/integrations/overview) die REST- oder SQL-Oberfläche eines Anbieters in einem Tale-eigenen Manifest verpackt, lässt ein MCP-Server eine Drittpartei ihren eigenen Tool-Katalog veröffentlichen — und Tale konsumiert ihn, ohne einen Konnektor schreiben zu müssen.

Diese Seite ist die Referenz für den Bildschirm **Einstellungen > MCP-Server** und das dahinterliegende Schema. Die Zielgruppe sind Admins und Entwickler, die einen MCP-Server an eine Organisation anbinden. Mitglieder und Redakteure sehen diese Oberfläche nicht; sie sehen nur, dass neue Tools auf ihren Agents auftauchen.

## Ein durchgespieltes Beispiel

Der kürzeste Weg zu einer funktionierenden MCP-Anbindung ist die Registrierung eines öffentlichen Streamable-HTTP-Servers mit API-Schlüssel-Auth. Um den Server `example-tools` unter `https://mcp.example.com` zu registrieren, öffne **Einstellungen > MCP-Server**, klick auf **MCP-Server hinzufügen** und trag ein:

```json
{
  "name": "example-tools",
  "displayName": "Example Tools",
  "transportType": "streamable_http",
  "url": "https://mcp.example.com/mcp",
  "authType": "api_key"
}
```

Nach dem Speichern fragt Tale nach dem API-Schlüssel, speichert ihn verschlüsselt und versetzt den Server in den Zustand `discovering`. Das Discovery-RPC liefert die Tool-Liste des Servers innerhalb von Sekunden zurück; der Status springt auf `active` und jedes entdeckte Tool ist nun auf Agents unter **Agents > [Agent] > Tools** aktivierbar.

## Transport-Typen

Tale unterstützt drei MCP-Transporte. Wähle danach, wo der Server läuft und wie Tale ihn erreicht.

| Transport         | Wann du es wählst                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streamable_http` | Der Server ist ein öffentlicher HTTP-Dienst, der den MCP-Streamable-HTTP-Transport spricht. Die Voreinstellung für gehostete MCP-Server.                                                             |
| `sse`             | Der Server ist ein HTTP-Dienst, der den älteren Server-Sent-Events-Transport spricht. Aus Kompatibilitätsgründen mit älteren Servern unterstützt.                                                    |
| `stdio`           | Der Server ist ein lokaler Prozess, den Tale über einen Befehl spawned (`command` + `args`). Nur auf selbst gehosteten Instanzen gültig, auf denen der Prozess neben dem Tale-Container laufen kann. |

`streamable_http` und `sse` brauchen beide eine `url`; `stdio` braucht `command`, optional `args` und eine optionale `env`-Map für Umgebungsvariablen an den gespawnten Prozess.

## Authentifizierung

Drei Auth-Typen decken die üblichen Formen ab:

| Auth-Typ  | Was Tale speichert                                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`    | Nichts. Der Server ist offen oder auth-frei (typisch für `stdio`-Transports, die lokal laufen).                                                                                                                       |
| `api_key` | Ein einzelner API-Schlüssel (`apiKeyEncrypted`), bei jeder Anfrage entsprechend der Server-Konvention mitgegeben.                                                                                                     |
| `oauth2`  | Eine OAuth-2.0-Client-Konfiguration (`tokenUrl`, optional `authorizationUrl`, `clientId`, `clientSecretEncrypted`, `scopes`, `grantType`) plus die Access-/Refresh-Tokens, die Tale nach Abschluss des Flows bekommt. |

OAuth2 unterstützt zwei Grant-Typen: `client_credentials` für Server-zu-Server, und `authorization_code` für Flows, in denen ein Admin Tale autorisiert, im Namen eines Kontos zu handeln. Letzterer löst eine Weiterleitung an die `authorizationUrl` aus, wenn die Integration verbunden wird; Tale speichert Access- und Refresh-Tokens und aktualisiert den Access-Token automatisch, wenn er abläuft.

Alle Geheimnisse — `apiKeyEncrypted`, `clientSecretEncrypted`, `accessTokenEncrypted`, `refreshTokenEncrypted` — werden ruhend verschlüsselt gespeichert, auf die Organisation eingeschränkt.

## Status-Zustände

Jeder MCP-Server-Eintrag trägt ein `status`-Feld, das die Verbindungs-Gesundheit widerspiegelt.

| Status        | Bedeutung                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `discovering` | Anfangszustand nach der Registrierung. Tale ruft das `tools/list`-RPC des Servers, um `discoveredTools` zu füllen.                   |
| `active`      | Discovery war erfolgreich und der Server ist erreichbar. Tools sind auf Agents aktivierbar.                                          |
| `inactive`    | Der Admin hat den Server manuell deaktiviert. Die entdeckte Tool-Liste bleibt erhalten; Wieder-Aktivierung überspringt Re-Discovery. |
| `error`       | Der letzte Verbindungsversuch ist fehlgeschlagen. Der Grund steht in `lastError`; korrigiere Anmeldedaten oder URL und teste erneut. |

## Entdeckte Tools

Wenn Discovery abschliesst, landet der Tool-Katalog des Servers im `discoveredTools`-Array. Jedes Tool hat einen `name`, eine optionale `description`, ein optionales `inputSchema` (JSON Schema für Parameter) und ein optionales `requiresApproval`-Flag.

`requiresApproval: true` lässt jeden Aufruf dieses Tools eine Genehmigungskarte im Chat erzeugen — derselbe Ablauf wie eine `write`-Operation auf einer Tale-eigenen Integration. Nutze das für Tools, die Abrechnungssysteme berühren, Nachrichten in jemandes Namen senden oder Produktivdaten verändern. Die vollständige Doktrin zu Genehmigungen liegt unter [Genehmigungen](/de/platform/workspace/approvals).

Die entdeckte Liste ist das, woraus Agent-Inhaber wählen, wenn sie MCP-Tools unter **Agents > [Agent] > Tools > MCP-Server** aktivieren. Einen MCP-Server auf einem Agent zu aktivieren, gewährt Zugriff auf alle Tools dieses Servers; Granularität auf Pro-Tool-Ebene liegt in der Tool-Konfiguration des Agents, nicht in der MCP-Server-Registrierung.

## Wo das einsetzt

MCP-Server sind der „Bring deinen eigenen Tool-Katalog"-Pfad; [Integrationen](/de/platform/integrations/overview) sind der „Wir verpacken einen Anbieter, den wir kennen"-Pfad. Sie koexistieren — ein Agent kann beides nutzen — und beide tauchen im selben Agent-Tool-Picker auf. Greif zu MCP, wenn der Server schon existiert (eine Drittpartei veröffentlicht einen für ihr Produkt), und zu einem Konnektor, wenn du den Wrapper kontrollierst und Tales Lese-/Schreib-Semantik, die Operations-Tabelle und den Setup-Guide des Konnektors haben willst.

Um die Tools eines MCP-Servers auf einem bestimmten Agent zu aktivieren, öffne den Agent und folge dem [Tools-Abschnitt](/de/platform/agents/create) des Agent-Bau-Flows. Um zu prüfen, welche Agents welche MCP-Tools aktiviert haben, zeichnet das [Audit-Log](/de/platform/admin/governance) jede Aktivierungs-/Deaktivierungs-Änderung mit Akteur und Zeitstempel auf.
