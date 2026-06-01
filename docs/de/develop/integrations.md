---
title: Integrations
description: Eigene Integrations bauen — REST-Connectors, SQL-Datenbanken, MCP-Server — und wo jede neben dem ausgelieferten Integration-Katalog hingehört.
---

Integrations sind die Nähte zwischen Tale und dem Rest deines Stacks. Der ausgelieferte Katalog deckt die üblichen SaaS-Systeme ab (Slack, GitHub, Microsoft 365, Google Drive, Shopify und den Rest); wenn dein Zielsystem nicht dabei ist, baust du die Brücke selbst. Drei Oberflächen erlauben das: ein JSON-deklarierter REST-Connector, ein SQL-Adapter für relationale Datenbanken oder ein MCP-Server, wenn ein selbst gehosteter Prozess die Aufrufe vermitteln soll.

Lies das, wenn du den Integration-Katalog erweiterst. Komm zurück, wenn eine deklarierte Operation nicht im Agent-Toolbelt auftaucht — die Antwort ist fast immer ein Schema-Konflikt gegen das Reference unter `.tale/reference/integrations/`.

## Ein durchgespielter eigener REST-Connector

Die kleinste nützliche Integration ist eine einzelne REST-Operation, deklariert in JSON. Leg einen Ordner ins Projekt und die Integration erscheint unter **Einstellungen > Integrations**, ohne Code-Änderung:

```text
integrations/
  acme-billing/
    config.json
    connector.ts        # optional, für nicht-triviale Request-Formung
    icon.svg
```

`config.json` deklariert die Auth-Methode, die erlaubten Hosts und die Operations:

```json
{
  "slug": "acme-billing",
  "name": "ACME Billing",
  "auth": { "type": "apiKey", "header": "X-API-Key" },
  "allowedHosts": ["api.acme.example.com"],
  "operations": [
    {
      "name": "list_invoices",
      "method": "GET",
      "path": "/v1/invoices",
      "query": { "since": "string?" }
    }
  ]
}
```

Die Operation taucht auf Agents als Tool-Familie auf, sobald die Org Credentials hinterlegt. Die Connector-Datei ist optional — greif darauf zurück, wenn die Response-Form geflacht werden muss oder Paginierungs-Schleifen nötig sind, die das Manifest nicht ausdrücken kann.

Für einen OAuth2-Connector (`"auth": { "type": "oauth2", … }`) registriere Tales Callback-URL als erlaubte Redirect-URI in der Upstream-OAuth-App, sonst scheitert der Consent-Schritt mit einem `redirect_uri`-Mismatch. Der Callback ist `${SITE_URL}/api/integrations/oauth2/callback` (mit `BASE_PATH` vorangestellt, falls gesetzt). Für lokale Entwicklung ist dieser Origin deine Dev-URL — `http://localhost:3000/api/integrations/oauth2/callback`, kein `https://`-Host.

## Wahl der Oberfläche

| Oberfläche    | Greif darauf zurück, wenn                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| REST-Manifest | Das Zielsystem spricht JSON über HTTPS, und die Auth ist API-Schlüssel oder OAuth2. Deckt die meisten SaaS-APIs.                        |
| SQL-Adapter   | Das Ziel ist eine relationale Datenbank (Postgres, MySQL, SQL Server) und Agents sollen Tabellen unter Row-Level-Policy lesen.          |
| MCP-Server    | Die Brücke muss ein langlebiger Prozess sein — lokale Dateien, eine eigene CLI, ein System, das aus dem Netz von Tale unerreichbar ist. |
| Connector-TS  | Das REST-Manifest deckt 80 % der API ab, aber eine Operation braucht Response-Formung, die das Manifest nicht deklarieren kann.         |

Die ausgelieferten Integrations unter [Platform > Integrations](/de/platform/integrations/overview) sind der Katalog der REST-Manifeste, die Tale ausliefert — lies ihre Configs in `examples/default/integrations/` für die Muster, die du kopierst.

## SQL-Adapter

Ein SQL-Adapter exponiert eine Tale-geformte Tool-Oberfläche über eine SQL-Datenbank. Du deklarierst die Verbindung (Treiber, Host, Credential-Referenz) und die Tabellen, die die Integration lesen darf; der Adapter erzeugt eine `query_<table>`-Operation pro deklarierter Tabelle und eine `run_named_query`-Operation für die Queries, die du nach Namen freigibst. Schreibvorgänge gehen nur über deklarierte Mutations — es gibt keine rohe `execute`-Operation.

Row-weise Autorisierung liegt beim Betreiber: deklarier eine Tenant-Spalte auf jeder Tabelle, und Tale injiziert den Tenant-Filter in jede erzeugte Query. Operations gegen Tabellen ohne Tenant-Spalte scheitern bei der Validierung zur Deploy-Zeit.

## MCP-Server

Wenn die Integration sich nicht als JSON-Manifest ausdrücken lässt — eine CLI, eine lokale Toolchain, irgendetwas, das vom Tale-Netz isoliert ist — schreib einen MCP-Server und registrier ihn unter **Einstellungen > MCP-Server**. Jedes Tool, das der Server exponiert, erscheint im Agent-Toolbelt mit Per-Tool-Freigabe beim ersten Aufruf. Der Transport ist stdio für selbst gehostete Tale-Instanzen; für Tale Cloud lebt der Server in deinem Netz und Tale ruft ihn über einen signierten HTTPS-Tunnel auf.

Der vollständige MCP-Walk-Through lebt unter [MCP-Server von Grund auf](/de/tutorials/developer/mcp-server-from-scratch) — diese Seite ist der Bau; die hier ist die Auswahl.

## Wo das hingehört

Eigene Integrations sind, wie Tale Systeme erreicht, die der ausgelieferte Katalog nicht abdeckt. Die [Integrations-Übersicht](/de/platform/integrations/overview) listet, was schon da ist; sobald deine eigene Integration deklariert ist, erklärt [Agent-Tools](/de/platform/agents/tools), wie ihre Operations auf einem Agent auftauchen. Wenn die Brücke ganz ausserhalb von Tale leben muss — ein Prozess, den du startest, ein Host, den du kontrollierst — deckt die [MCP-Server-Referenz](/de/platform/integrations/mcp-servers) die andere Hälfte ab.
