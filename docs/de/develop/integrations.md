---
title: Integration bauen
description: Einen Tale-Konnektor schreiben — config.json, connector.ts, Sandbox-APIs und Paketierung.
---

Ein Konnektor ist eine `config.json` plus eine `connector.ts` (oder `.js`) plus ein Icon. Das Manifest deklariert Identität, Authentifizierung, erlaubte Hosts und die benannten Operationen, die die Integration veröffentlicht; der Konnektor-Code führt jede Operation in einer Sandbox aus. SQL-Integrationen sind ein Sonderfall — sie liefern keinen Code, sondern nur parametrisierte Abfragen im Manifest.

Diese Seite ist die Autoring-Referenz. Sie setzt voraus, dass du den [Integrationen-Überblick](/de/platform/integrations/overview) für die nutzerseitigen Konzepte gelesen hast. Zum Editor-Workflow mit KI-Assistenten siehe [KI-gestützte Entwicklung](/de/develop/ai-assisted-development).

## Dateilayout

Ein Konnektor lebt in einem einzigen Verzeichnis. Der Verzeichnisname ist der **Slug** — die stabile Kennung, die die Plattform verwendet; er ist kein Feld innerhalb der `config.json`.

```text
integrations/<slug>/
├── config.json     ← Manifest (erforderlich)
├── connector.ts    ← sandboxierter Code (nur REST-Konnektoren)
└── icon.svg        ← in der Add-integration-Liste angezeigt
```

Es gibt zwei Wege, dieses Verzeichnis auszuliefern: leg es in den `integrations/`-Ordner eines per `tale init` erstellten Projekts, oder zippe die Dateien und lade sie über **Einstellungen > Integrationen > Integration hinzufügen** hoch (max. 1 MB). Beide Pfade ergeben denselben Server-State.

## `config.json`-Schema

Das Manifest wird serverseitig gegen ein Zod-Schema in [services/platform/lib/shared/schemas/integrations.ts](https://github.com/tale-project/tale/blob/main/services/platform/lib/shared/schemas/integrations.ts) validiert. Die folgenden Felder sind die kanonische Oberfläche; bei Zweifel die Quelle konsultieren.

| Feld                   | Pflicht              | Typ                                                                 | Was es tut                                                                                                                       |
| ---------------------- | -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | ja                   | string (1-200)                                                      | Lesbarer Name in der Integrationen-Liste.                                                                                        |
| `description`          | nein                 | string (≤2000)                                                      | Ein-Satz-Zusammenfassung neben dem Titel.                                                                                        |
| `version`              | nein                 | integer                                                             | Hochsetzen, wenn sich Operationen oder Parameterformen ändern, damit Konsumenten Drift erkennen.                                 |
| `type`                 | nein                 | `'rest_api'` \| `'sql'`                                             | Default `rest_api`. Auf `sql` setzen für DB-Konnektoren.                                                                         |
| `authMethod`           | ja                   | `'api_key'` \| `'bearer_token'` \| `'basic_auth'` \| `'oauth2'`     | Die Authentifizierungsmethode dieses Konnektors.                                                                                 |
| `supportedAuthMethods` | nein                 | Array desselben Enums                                               | Wenn ein Konnektor mehrere Methoden akzeptiert; Nutzer wählt beim Installieren.                                                  |
| `secretBindings`       | nein                 | string[]                                                            | Namen der Credential-Schlüssel, die der Konnektor zur Laufzeit über `secrets.get('<key>')` liest. Die UI fragt genau diese ab.   |
| `allowedHosts`         | nein                 | string[]                                                            | Netzwerk-Allowlist. Der Konnektor kann nur die hier gelisteten Hosts erreichen.                                                  |
| `operations`           | rest_api-Konnektoren | Array von `Operation`                                               | Die benannten REST-Operationen des Konnektors. Siehe [Operations-Form](#operations-form).                                        |
| `oauth2Config`         | oauth2-Konnektoren   | `{ authorizationUrl, tokenUrl, scopes? }`                           | Endpunkte für den Authorization-Code-Flow.                                                                                       |
| `sqlConnectionConfig`  | sql-Konnektoren      | `{ engine, readOnly?, options?, security? }`                        | `engine` ist `'mssql'`, `'postgres'` oder `'mysql'`. `readOnly` ist ein UI-Hinweis; das Datenbankkonto ist die echte Begrenzung. |
| `sqlOperations`        | sql-Konnektoren      | Array von `SqlOperation`                                            | Benannte Abfragen mit Parameter-Platzhaltern. Siehe [SQL-Konnektoren](#sql-konnektoren).                                         |
| `connectionConfig`     | nein                 | `{ domain?, apiVersion?, apiEndpoint?, timeout?, rateLimit?, ... }` | Optionale Verbindungs-Hints; zusätzliche Schlüssel sind erlaubt.                                                                 |
| `capabilities`         | nein                 | `{ canSync?, canPush?, canWebhook?, syncFrequency? }`               | Deklariert optionale Fähigkeiten, gegen die die Plattform planen kann (z. B. periodischer Sync).                                 |
| `exposeAsCapability`   | nein                 | `{ label, icon?, tooltip?, order? }`                                | Stellt diese Integration als benannte Capability in der UI dar.                                                                  |
| `setupGuide`           | nein                 | string (≤5000)                                                      | Markdown, gerendert unter **Konfigurationsanleitung** im Manage-Dialog. Sag den Nutzern, wo Schlüssel zu erzeugen sind, etc.     |
| `metadata`             | nein                 | object                                                              | Freie Metadaten für Tooling; wird von der Plattform nicht interpretiert.                                                         |

## Operations-Form

Eine REST-Operation beschreibt eine aufrufbare Aktion. Der Agent wählt eine Operation per `name` und liefert validierte Parameter; deine `connector.ts` dispatcht auf `ctx.operation` und nutzt `ctx.params`.

| Feld               | Pflicht | Typ                   | Was es tut                                                                                               |
| ------------------ | ------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `name`             | ja      | string                | Stabile Kennung, die der Agent nutzt. Snake_case per Konvention.                                         |
| `title`            | nein    | string                | Lesbares Label in der UI-Operationsliste.                                                                |
| `description`      | nein    | string                | Was die Operation tut und wann zu nutzen. Der Agent liest das — schreib für das LLM, nicht den Menschen. |
| `operationType`    | nein    | `'read'` \| `'write'` | Steuert das Genehmigungs-Gate. Default ist read-artiges Verhalten, wenn weggelassen.                     |
| `requiresApproval` | nein    | boolean               | Erzwingt die Genehmigungs-Karte auch bei Read, oder überspringt sie bei einem genuin sicheren Write.     |
| `requiredScopes`   | nein    | string[]              | OAuth-Scopes, die diese Operation braucht; beim Verbinden dem Nutzer angezeigt.                          |
| `parametersSchema` | nein    | JSON-Schema (object)  | Standard-JSON-Schema. Heute wird `type: 'object'` mit `properties` und `required` ausgewertet.           |

Ein kompaktes REST-Beispiel aus [examples/integrations/tavily/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/config.json):

```json
{
  "name": "search",
  "title": "Search the web",
  "description": "Search the open web via Tavily. Use 'basic' depth for quick facts, 'advanced' for deeper research.",
  "operationType": "read",
  "parametersSchema": {
    "type": "object",
    "required": ["query"],
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural-language search query. Be specific."
      },
      "max_results": {
        "type": "number",
        "description": "Max results to return (1-10)."
      }
    }
  }
}
```

## Die Konnektor-Sandbox

Konnektor-Code läuft nicht als gewöhnliches Node. Er wird transpiliert und in einem isolierten Kontext mit kleiner, kontrollierter API-Oberfläche ausgeführt. Plane entsprechend: kein `fs`, kein `child_process`, kein freies `import`, kein `process.env`, kein ambient `fetch`. Die einzigen Seiten­effekte sind HTTP über `ctx.http` und Credential-Reads über `ctx.secrets`.

### `ConnectorContext`

Jede Operation erhält ein Kontext-Objekt. Die Form:

```typescript
interface ConnectorContext {
  operation: string; // Name der aufgerufenen Operation
  params: Record<string, unknown>; // gegen parametersSchema validiert
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
}

interface HttpApi {
  get(url: string, options?: HttpMethodOptions): HttpResponse;
  post(url: string, options?: BodyMethodOptions): HttpResponse;
  put(url: string, options?: BodyMethodOptions): HttpResponse;
  patch(url: string, options?: BodyMethodOptions): HttpResponse;
  delete(url: string, options?: BodyMethodOptions): HttpResponse;
}

interface HttpMethodOptions {
  headers?: Record<string, string>;
  responseType?: 'base64'; // base64-kodierten Body für binäre Downloads anfordern
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string; // bereits serialisierter Payload (z. B. JSON.stringify(...))
  binaryBody?: string; // base64-kodierter Request-Body
}

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text(): string;
  json(): unknown;
}

interface SecretsApi {
  get(key: string): string | undefined;
}
```

Der `http`-Client erreicht nur die Hosts, die in `allowedHosts` gelistet sind. Eine Anfrage an alles andere scheitert vor dem Netzwerkaufruf.

### Was die Sandbox nicht bietet

- **Keine Node-Built-ins** — kein `fs`, `child_process`, `crypto`, `path`, `os`, `net`. Nutze `base64Encode`/`base64Decode` für Binärdaten; für Hashing oder Signaturen serverseitig oder vorab erledigen.
- **Kein Top-Level-`import` oder `require`** — schreib selbst-enthaltenen Code. TypeScript-Typdeklarationen oben in der Datei werden beim Transpile entfernt und dienen nur der Editor-Unterstützung.
- **Keine Umgebungsvariablen** — lies jedes Credential über `ctx.secrets.get(...)`.
- **Keine Hintergrundarbeit** — `setTimeout`, `setInterval` und nicht-awaited Promises sind nicht Teil des Vertrags. Eine Operation läuft synchron zu Ende (die Sandbox behandelt deine Funktion als synchron) und gibt einen Wert zurück.

## Die zwei Funktionen, die ein Konnektor exportiert

Ein Konnektor definiert zwei Funktionen: eine zur Verbindungsprüfung beim Installieren, eine zum Ausführen der Operationen.

| Funktion              | Wann sie läuft                                                 | Was sie tun soll                                                                                                                    |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `testConnection(ctx)` | Wenn der Nutzer **Verbindung testen** im Manage-Dialog klickt. | Den günstigsten authentifizierten Anfrage, den die API bietet. Bei Fehlschlag einen klaren `Error` mit Hinweis zur Behebung werfen. |
| `execute(ctx)`        | Bei jedem Operations-Aufruf.                                   | Auf `ctx.operation` dispatchen, Inputs validieren, API aufrufen, Response formen. Bei jeglichem Fehler `Error` werfen.              |

Beide können entweder als einzelnes `connector`-Objektliteral (Tavily, Discord) oder als Top-Level-Funktionen exportiert werden; beide Formen sind erlaubt. Die Objektform ist empfohlen, weil sie die zwei Einstiegspunkte nahe an einer Operations-Liste hält und die Dispatch-Tabelle offensichtlich macht.

Per Konvention gibt ein erfolgreiches `execute` ein Objekt der Form `{ success: true, operation, data, count?, cost?: { cents }, timestamp }` zurück. Die Plattform erzwingt diese Form nicht, aber Agents und Execution-Logs rendern sie sauber.

## Durchgespieltes Beispiel — Tavily

Hier das kleinste End-to-End-Bild, gezogen aus [examples/integrations/tavily/](https://github.com/tale-project/tale/tree/main/examples/integrations/tavily).

Das Manifest deklariert Auth-Methode, allow-gelisteten Host, Secret-Binding und zwei Operationen:

```json
{
  "title": "Tavily",
  "type": "rest_api",
  "authMethod": "api_key",
  "secretBindings": ["apiKey"],
  "allowedHosts": ["api.tavily.com"],
  "operations": [
    {
      "name": "search",
      "operationType": "read",
      "parametersSchema": {
        /* ... */
      }
    },
    {
      "name": "extract",
      "operationType": "read",
      "parametersSchema": {
        /* ... */
      }
    }
  ],
  "setupGuide": "1. Sign up at https://tavily.com\n2. Create an API key\n3. Paste it below and Test connection."
}
```

Der Konnektor exportiert `testConnection` (eine günstige authentifizierte Probe) und `execute` (Dispatch zu Per-Operation-Helpern):

```typescript
const API_BASE = 'https://api.tavily.com';

const connector = {
  testConnection(ctx: TestConnectionContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) throw new Error('Tavily API key is required.');

    const response = ctx.http.post(API_BASE + '/search', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query: 'ping', max_results: 1 }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Tavily authentication failed. Verify the API key.');
    }
    if (response.status !== 200) {
      throw new Error(
        'Tavily connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }
    return { status: 'ok' };
  },

  execute(ctx: ConnectorContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) throw new Error('Tavily API key is required.');
    if (ctx.operation === 'search') return search(ctx.http, apiKey, ctx.params);
    if (ctx.operation === 'extract')
      return extractUrls(ctx.http, apiKey, ctx.params);
    throw new Error('Unknown operation: ' + ctx.operation);
  },
};
```

Achte auf die Form der Fehlermeldungen — sie sagen dem Nutzer, was zu tun ist (`Verify the API key`), nicht nur dass etwas fehlschlug. Fehler aus `testConnection` erscheinen inline im Manage-Dialog; Fehler aus `execute` erscheinen in der Agent-Antwort und im Execution-Log. Mach sie umsetzbar.

Die vollständige Datei unter [tavily/connector.ts](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/connector.ts) zeigt die Per-Operation-Helper, ein `handleHttpError`-Hilfswerkzeug, das Status auf nutzerlesbare Meldungen mappt, und Result-Truncation, um Token-Nutzung vorhersehbar zu halten. Übernimm diese Muster.

## SQL-Konnektoren

SQL-Integrationen überspringen `connector.ts` komplett. Die Plattform führt die im Manifest deklarierten Abfragen gegen die konfigurierte Datenbank aus; du schreibst nur das SQL und das Parameterschema.

```json
{
  "name": "list_reservations",
  "title": "List Reservations",
  "description": "Fetch reservations with optional status and date filters.",
  "operationType": "read",
  "query": "SELECT id, guest_id, check_in FROM reservations WHERE (@status IS NULL OR status = @status) AND check_in >= @fromDate ORDER BY check_in DESC",
  "parametersSchema": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "description": "Optional status filter." },
      "fromDate": {
        "type": "string",
        "format": "date",
        "description": "ISO date."
      }
    }
  }
}
```

Platzhalter nutzen `@paramName`, gemappt auf Schlüssel in `parametersSchema.properties`. Markiere mutierende Abfragen mit `operationType: 'write'` und (üblicherweise) `requiresApproval: true`; die Plattform leitet sie durch den Genehmigungs-Flow. Siehe [examples/integrations/protel/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/protel/config.json) für einen vollständigen Hotel-PMS-Konnektor mit über zwanzig Read-Operationen und einer Handvoll genehmigungs-gegateter Writes.

`sqlConnectionConfig.engine` akzeptiert `'mssql'`, `'postgres'` oder `'mysql'`. Optionales `security.maxResultRows` und `security.queryTimeoutMs` sind Obergrenzen, die die Plattform zusätzlich zu den DB-eigenen erzwingt.

## Paketierung und Auslieferung

- **Projekt-Flow.** Lege `integrations/<slug>/{config.json, connector.ts, icon.svg}` in ein per `tale init` erstelltes Projekt. Die Plattform lädt live nach; Speichern reicht.
- **UI-Upload.** Zippe die Dateien (oder lade sie einzeln hoch) über **Einstellungen > Integrationen > Integration hinzufügen**. Das Gesamtpaket ist auf 1 MB begrenzt.
- **Versionierung.** Hebe `version` in `config.json`, sobald sich der Operations-Satz oder eine Parameterform ändert, damit Konsumenten den Drift erkennen.
- **Icons.** SVG, PNG, JPG oder WebP, unter 256 KB. SVG rendert in dunklen und hellen Themes am saubersten.
- **Slugs.** Der Verzeichnisname ist der Slug. Halt ihn über Versionen stabil; Umbenennen ist eine breaking change.

## Häufige Fehler

- **Lange Schleifen oder unbegrenzte Result-Sets.** Operationen sollten zügig mit paginierten oder gekürzten Daten zurückkommen. Der Tavily-Konnektor begrenzt Ergebnisse auf 5 und kürzt jede Seite auf 2 000 Zeichen — als Referenz.
- **Geheimnisse im Code.** Bette nie API-Schlüssel oder Tokens in `connector.ts` ein. Lies sie immer über `ctx.secrets.get('<binding>')` und deklariere das Binding in `secretBindings`.
- **Hosts nicht in `allowedHosts`.** Eine Anfrage an einen ungelisteten Host scheitert. Trag jede Base-URL ein, die der Konnektor anfasst — inklusive jedes Redirect-Ziels, von dem du abhängst.
- **Vage Fehlermeldungen.** `Failed` ist nicht umsetzbar. Sag dem Nutzer, welches Credential falsch ist, welcher Scope fehlt oder welche Quote überschritten wurde.
- **Fehlendes `operationType: 'write'` bei mutierenden Calls.** Ohne das greift das Genehmigungs-Gate nicht und ein Write läuft unbeaufsichtigt.

## Verwandt

- [Integrationen-Überblick](/de/platform/integrations/overview) — Konzepte und wie Konnektoren konsumiert werden.
- [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) — Claude Code, Cursor, GitHub Copilot oder Windsurf nutzen, um Konnektoren gegen den Referenz-Quellcode der Plattform zu schreiben.
- [API-Referenz](/de/develop/api-reference) — die Tale-API selbst, getrennt von Konnektoren.
