---
title: Eine Integration bauen
description: Einen Tale-Konnektor schreiben — config.json, connector.ts, die Sandbox-API und Paketierung.
---

Ein Tale-Konnektor ist ein Verzeichnis: ein `config.json`-Manifest, optional eine `connector.ts` (REST-Konnektoren) oder nur SQL-Templates (SQL-Konnektoren) und ein Icon. Das Manifest deklariert Identität, Authentifizierungs-Form, erlaubte Hosts und die benannten Operationen, die die Integration anbietet; der Konnektor-Code führt jede Operation in einer isolierten Sandbox mit einer kleinen, kontrollierten API-Oberfläche aus. Diese Seite ist die Authoring-Referenz — das Schema, der Sandbox-Vertrag, die Paketierungs-Regeln.

Das Publikum sind Entwickler, die einen neuen Konnektor schreiben. Für die nutzerseitigen Konzepte (was eine Integration ist, wie eine Organisation eine hinzufügt) ist [Integrationen — Überblick](/de/platform/integrations/overview) der Einstieg; für KI-gestütztes Authoring des Manifests deckt [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) den Editor-Ablauf ab.

## Datei-Layout

Ein Konnektor lebt in einem einzelnen Verzeichnis. Der Verzeichnisname ist der **Slug** — der stabile Identifier, den Tale intern nutzt; er ist kein Feld in `config.json`.

```text
integrations/<slug>/
├── config.json     ← Manifest (Pflicht)
├── connector.ts    ← Sandbox-Code (nur REST-Konnektoren)
└── icon.svg        ← in der Add-Integration-Liste angezeigt
```

Zwei Pfade landen das Verzeichnis in einer Tale-Instanz: in den `integrations/`-Ordner eines per `tale init` aufgesetzten Projekts ablegen, oder die Dateien zippen und über **Einstellungen > Integrationen > Integration hinzufügen** hochladen (1-MB-Limit). Beide produzieren denselben serverseitigen Zustand.

## Durchgespieltes Beispiel — Tavily

Bevor das volle Schema durchlaufen wird, hier das kleinste End-to-End-Bild. Tavily ist ein gehosteter Websuche-Dienst; das Manifest deklariert die Auth-Methode, den auf der Allowlist stehenden Host, die Secret-Bindung und zwei Operationen:

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
  "setupGuide": "1. Bei https://tavily.com registrieren\n2. Einen API-Schlüssel erstellen\n3. Unten einfügen und Test connection."
}
```

Der Konnektor exportiert zwei Funktionen — `testConnection` für den Probe-Aufruf im Manage-Dialog und `execute` für das Laufzeit-Dispatch:

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

Beachte die Form der Fehlermeldungen — sie nennen, was der Nutzer tun muss (`Verify the API key`), nicht nur, dass etwas fehlschlug. Fehler aus `testConnection` erscheinen inline im Manage-Dialog; Fehler aus `execute` erscheinen in der Antwort des Agents und im Ausführungs-Log. Beide gehören in dasselbe handlungsleitende Register.

Die volle Datei unter [tavily/connector.ts](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/connector.ts) deckt die Pro-Operation-Helfer, ein `handleHttpError`-Utility und Ergebnis-Truncation ab, um Token-Verbrauch vorhersagbar zu halten.

## `config.json`-Schema

Das Manifest wird serverseitig gegen ein Zod-Schema in [services/platform/lib/shared/schemas/integrations.ts](https://github.com/tale-project/tale/blob/main/services/platform/lib/shared/schemas/integrations.ts) validiert.

| Name                   | Typ                                                                 | Erforderlich         | Beschreibung                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | string (1–200)                                                      | Ja                   | Menschen-lesbarer Name, in der Integrationen-Liste angezeigt.                                                                     |
| `description`          | string (≤ 2000)                                                     | Nein                 | Einsatz-Zusammenfassung in einem Satz, neben dem Titel angezeigt.                                                                 |
| `version`              | integer                                                             | Nein                 | Hochzählen, wenn sich Operationen oder Parameter-Formen ändern, damit Konsumenten Drift erkennen.                                 |
| `type`                 | `'rest_api'` \| `'sql'`                                             | Nein                 | Standard `rest_api`. Setze `sql` für Datenbank-Konnektoren.                                                                       |
| `authMethod`           | `'api_key'` \| `'bearer_token'` \| `'basic_auth'` \| `'oauth2'`     | Ja                   | Die Authentifizierungs-Methode, die dieser Konnektor braucht.                                                                     |
| `supportedAuthMethods` | array desselben Enums                                               | Nein                 | Nutzen, wenn ein Konnektor mehr als eine Auth-Methode akzeptiert; der Nutzer wählt zur Installationszeit.                         |
| `secretBindings`       | array of strings                                                    | Nein                 | Namen der Anmelde-Schlüssel, die der Konnektor zur Laufzeit per `secrets.get('<key>')` liest. Die UI fragt genau diese ab.        |
| `allowedHosts`         | array of strings                                                    | Nein                 | Netzwerk-Allowlist. Der Konnektor erreicht keine Hosts ausserhalb dieser Liste.                                                   |
| `operations`           | array of `Operation`                                                | rest_api-Konnektoren | Die benannten REST-Operationen, die der Konnektor anbietet. Siehe [Operation-Form](#operation-form).                              |
| `oauth2Config`         | `{ authorizationUrl, tokenUrl, scopes? }`                           | oauth2-Konnektoren   | Endpoints für den Authorization-Code-Flow.                                                                                        |
| `sqlConnectionConfig`  | `{ engine, readOnly?, options?, security? }`                        | sql-Konnektoren      | `engine` ist `'mssql'`, `'postgres'` oder `'mysql'`. `readOnly` ist ein UI-Hinweis; das Datenbank-Konto ist das eigentliche Gate. |
| `sqlOperations`        | array of `SqlOperation`                                             | sql-Konnektoren      | Benannte Queries mit Parameter-Platzhaltern. Siehe [SQL-Konnektoren](#sql-konnektoren).                                           |
| `connectionConfig`     | `{ domain?, apiVersion?, apiEndpoint?, timeout?, rateLimit?, ... }` | Nein                 | Optionale Verbindungs-Hinweise; zusätzliche Schlüssel werden akzeptiert.                                                          |
| `capabilities`         | `{ canSync?, canPush?, canWebhook?, syncFrequency? }`               | Nein                 | Deklariert optionale Capabilities, gegen die die Plattform planen kann (z. B. periodische Sync).                                  |
| `exposeAsCapability`   | `{ label, icon?, tooltip?, order? }`                                | Nein                 | Diese Integration in der UI als benannte Capability sichtbar machen.                                                              |
| `setupGuide`           | string (≤ 5000)                                                     | Nein                 | Markdown, gerendert unter **Configuration guide** im Manage-Dialog. Sag Nutzern, wo sie Schlüssel generieren, welche Scopes etc.  |
| `metadata`             | object                                                              | Nein                 | Freie Metadaten für Werkzeuge; von der Plattform nicht interpretiert.                                                             |

## Operation-Form

Eine REST-Operation beschreibt eine aufrufbare Aktion. Der Agent wählt eine Operation per `name` und liefert validierte Parameter; `connector.ts` dispatcht auf `ctx.operation`.

| Name               | Typ                   | Erforderlich | Beschreibung                                                                                                              |
| ------------------ | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `name`             | string                | Ja           | Stabiler Identifier, den der Agent nutzt. Konvention: Snake_case.                                                         |
| `title`            | string                | Nein         | Menschen-lesbares Label in der Operations-Liste der UI.                                                                   |
| `description`      | string                | Nein         | Was die Operation tut und wann sie zu nutzen ist. Der Agent liest das — für das Modell schreiben, nicht für den Menschen. |
| `operationType`    | `'read'` \| `'write'` | Nein         | Treibt das Genehmigungs-Gate. Standard ist Read-artiges Verhalten, wenn weggelassen.                                      |
| `requiresApproval` | boolean               | Nein         | Erzwingt die Genehmigungs-Karte auch bei einem Read, oder überspringt sie bei einem Write, der wirklich sicher ist.       |
| `requiredScopes`   | array of strings      | Nein         | OAuth-Scopes, die diese Operation braucht; werden beim Connect für den Nutzer angezeigt.                                  |
| `parametersSchema` | JSON Schema (object)  | Nein         | Standard-JSON-Schema. Aktuell wird nur `type: 'object'` mit `properties` und `required` benutzt.                          |

Ein kompaktes Beispiel aus dem Tavily-Manifest:

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
        "description": "Max results to return (1–10)."
      }
    }
  }
}
```

## Die Konnektor-Sandbox

Konnektor-Code läuft nicht als gewöhnliches Node. Er wird transpiliert und in einem isolierten Kontext mit einer kleinen, kontrollierten API-Oberfläche ausgeführt: kein `fs`, kein `child_process`, kein willkürliches `import`, kein `process.env`, kein ambientes `fetch`. Die einzigen verfügbaren Seiteneffekte sind HTTP über `ctx.http` und Anmeldedaten-Lesen über `ctx.secrets`. Das ist die Vertrauensgrenze: jede andere Fähigkeit bleibt in der Host-Laufzeit.

### `ConnectorContext`

Jede Operation erhält ein Kontext-Objekt der Form unten:

```typescript
interface ConnectorContext {
  operation: string; // der Name der aufgerufenen Operation
  params: Record<string, unknown>; // gegen parametersSchema validiert
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi; // nur injiziert, wenn die Laufzeit einen Storage-Provider liefert
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
  responseType?: 'base64'; // base64-Body für Binär-Downloads anfordern
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string; // bereits serialisierte Payload (z. B. JSON.stringify(...))
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

interface FilesApi {
  download(
    url: string,
    options: { headers?: Record<string, string>; fileName: string },
  ): FileReference;
  store(
    data: string,
    options: {
      encoding: 'base64' | 'utf-8';
      contentType: string;
      fileName: string;
    },
  ): FileReference;
}
```

Der `http`-Client erreicht nur Hosts, die in `allowedHosts` stehen. Alles andere scheitert vor dem Netzwerk-Aufruf.

### Was die Sandbox nicht liefert

- **Keine Node-Builtins.** Kein `fs`, `child_process`, `crypto`, `path`, `os`, `net`. Nutze `base64Encode` / `base64Decode` für Binär-Verarbeitung; für Hashing oder Signieren serverseitig erledigen oder vorausberechnen.
- **Kein Top-Level-`import` oder `require`.** Schreibe in sich geschlossenen Code. TypeScript-Typdeklarationen oben in der Datei werden beim Transpile entfernt und sind nur für Editor-Support da.
- **Keine Umgebungsvariablen.** Jede Anmeldung über `ctx.secrets.get(...)` lesen.
- **Keine Hintergrundarbeit.** `setTimeout`, `setInterval` und nicht-awaitete Promises sind nicht Teil des Vertrags. Eine Operation läuft synchron zu Ende (die Sandbox behandelt deine Funktion als synchron) und liefert einen Wert zurück.

## Die zwei Funktionen, die ein Konnektor exportiert

Ein Konnektor definiert zwei Funktionen — eine, um eine Verbindung beim Install zu validieren, und eine, um Operationen auszuführen.

| Funktion              | Wann sie läuft                                              | Was sie tun sollte                                                                                                         |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `testConnection(ctx)` | Wenn der Nutzer **Test connection** im Manage-Dialog klickt | Die billigste authentifizierte Anfrage machen, die die API erlaubt. Im Fehlerfall einen klaren `Error` mit Hinweis werfen. |
| `execute(ctx)`        | Bei jedem Aufruf einer Operation                            | Auf `ctx.operation` dispatchen, Eingaben validieren, die API rufen, die Antwort formen. Bei Fehler `Error` werfen.         |

Beide können entweder als einzelnes `connector`-Objektliteral (wie Tavily und Discord) oder als Top-Level-Funktionen exportiert werden; beide Formen werden akzeptiert. Die Objekt-Form ist die empfohlene Form, weil sie die Eintrittspunkte neben eine Liste von Operationen stellt und die Dispatch-Tabelle offensichtlich macht.

Per Konvention liefert ein erfolgreiches `execute` ein Objekt der Form `{ success: true, operation, data, count?, cost?: { cents }, timestamp }`. Die Plattform erzwingt diese Form nicht, aber Agents und das Ausführungs-Log rendern sie sauber, wenn sie vorhanden ist.

## SQL-Konnektoren

SQL-Integrationen überspringen `connector.ts` ganz. Die Plattform führt die im Manifest deklarierten Queries gegen die konfigurierte Datenbank aus; du schreibst nur das SQL und das Parameter-Schema, sonst nichts.

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

Platzhalter nutzen `@paramName`, abgeglichen gegen `parametersSchema.properties`. Markiere ändernde Queries mit `operationType: 'write'` und meist `requiresApproval: true`, damit der Genehmigungs-Flow greift. Siehe [examples/integrations/protel/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/protel/config.json) für einen vollen Hotel-PMS-Konnektor mit zwanzig-plus Read-Operationen und einer Handvoll genehmigungs-gegateter Writes.

`sqlConnectionConfig.engine` akzeptiert `'mssql'`, `'postgres'` oder `'mysql'`. Die optionalen `security.maxResultRows` und `security.queryTimeoutMs` sind Obergrenzen, die die Plattform zusätzlich zu dem durchsetzt, was die Datenbank selbst erlaubt — Defense in Depth, kein Ersatz für ein read-only Datenbank-Konto.

## Paketierung und Auslieferung

- **Projekt-Ablauf.** Lege `integrations/<slug>/{config.json, connector.ts, icon.svg}` in ein `tale init`-Projekt. Die Plattform lädt live nach; Speichern wendet die Änderung an.
- **UI-Upload.** Zippe dieselben Dateien (oder lade sie einzeln) über **Einstellungen > Integrationen > Integration hinzufügen** hoch. Das Gesamt-Paket ist auf 1 MB begrenzt.
- **Versionierung.** Hochzählen von `version` in `config.json` immer dann, wenn du den Operationen-Satz oder eine Parameter-Form änderst, damit Konsumenten die Drift erkennen können.
- **Icons.** SVG, PNG, JPG oder WebP, unter 256 KB. SVG rendert in beiden Themes am saubersten.
- **Slugs.** Der Verzeichnisname ist der Slug. Umbenennen ist eine breaking Change — jede Installation referenziert den Konnektor per Slug.

## Häufige Fehler

- **Lang laufende Schleifen oder unbegrenzte Ergebnis-Sets.** Operationen sollten schnell mit paginierten oder gekürzten Daten zurückkehren. Der Tavily-Konnektor begrenzt Ergebnisse auf 5 und kürzt jede Seite auf 2 000 Zeichen — nutze das Muster wieder.
- **Secrets im Code.** Niemals einen API-Schlüssel oder Token in `connector.ts` einbetten. Immer über `ctx.secrets.get('<binding>')` lesen und die Bindung in `secretBindings` deklarieren.
- **Hosts nicht in `allowedHosts`.** Eine Anfrage an einen nicht gelisteten Host scheitert, bevor sie die Sandbox verlässt. Jede Basis-URL eintragen, die der Konnektor berührt, einschliesslich Redirect-Ziele.
- **Vage Fehlermeldungen.** `Failed` ist nicht handlungsleitend. Sag dem Nutzer, welche Anmeldung falsch ist, welcher Scope fehlt oder welche Quote überschritten wurde.
- **Fehlendes `operationType: 'write'` bei ändernden Calls.** Ohne greift das Genehmigungs-Gate nicht, und ein Write kann unbeaufsichtigt laufen.

## Wo das einsetzt

Eine Integration zu bauen ist der Konnektor-Autor-Ablauf. Von hier wird das Manifest auf Tale-Instanzen installiert; einmal installiert, erscheinen die Operationen des Konnektors als Tools in [Einen Agent erstellen](/de/platform/agents/create) und als Schritte in Automatisierungs-[Workflows](/de/platform/automations/workflows). Für die operatorseitige Konsum-Oberfläche ist [Integrationen — Überblick](/de/platform/integrations/overview) die kanonische Referenz; für KI-gestütztes Authoring des Manifests selbst ist [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) der Workflow. Die Tale-API-Oberfläche — getrennt von Konnektoren — liegt unter [API-Referenz](/de/develop/api-reference).
