---
title: Construire une intégration
description: Écrire un connecteur Tale — config.json, connector.ts, APIs sandbox et empaquetage.
---

Un connecteur, c’est un `config.json` plus un `connector.ts` (ou `.js`) plus une icône. Le manifeste déclare l’identité de l’intégration, l’authentification, les hôtes autorisés et les opérations nommées qu’elle expose ; le code du connecteur exécute chaque opération dans un sandbox. Les intégrations SQL sont un cas particulier — elles ne livrent pas de code, seulement des requêtes paramétrées dans le manifeste.

Cette page est la référence d’écriture. Elle suppose que tu as déjà lu l’[aperçu des intégrations](/fr/platform/integrations/overview) pour les concepts côté utilisateur. Pour le workflow d’éditeur avec des assistants IA, voir [Développement assisté par IA](/fr/develop/ai-assisted-development).

## Disposition des fichiers

Un connecteur vit dans un seul dossier. Le nom du dossier est le **slug** — l’identifiant stable utilisé par la plateforme ; ce n’est pas un champ de `config.json`.

```text
integrations/<slug>/
├── config.json     ← manifeste (requis)
├── connector.ts    ← code sandboxé (connecteurs REST uniquement)
└── icon.svg        ← affichée dans la liste Ajouter une intégration
```

Deux façons de livrer ce dossier : pose-le dans le dossier `integrations/` d’un projet créé par `tale init`, ou zippe les fichiers et téléverse-les via **Paramètres > Intégrations > Ajouter une intégration** (max 1 Mo). Les deux chemins produisent le même état serveur.

## Schéma `config.json`

Le manifeste est validé côté serveur contre un schéma Zod dans [services/platform/lib/shared/schemas/integrations.ts](https://github.com/tale-project/tale/blob/main/services/platform/lib/shared/schemas/integrations.ts). Les champs ci-dessous sont la surface canonique ; consulte la source en cas de doute.

| Champ                  | Requis               | Type                                                                | Ce qu’il fait                                                                                                                   |
| ---------------------- | -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | oui                  | string (1-200)                                                      | Nom lisible affiché dans la liste des intégrations.                                                                             |
| `description`          | non                  | string (≤2000)                                                      | Résumé d’une phrase à côté du titre.                                                                                            |
| `version`              | non                  | integer                                                             | Incrémente quand les opérations ou les formes de paramètres changent, pour que les consommateurs détectent le drift.            |
| `type`                 | non                  | `'rest_api'` \| `'sql'`                                             | Par défaut `rest_api`. Mets `sql` pour les connecteurs base de données.                                                         |
| `authMethod`           | oui                  | `'api_key'` \| `'bearer_token'` \| `'basic_auth'` \| `'oauth2'`     | La méthode d’authentification requise par ce connecteur.                                                                        |
| `supportedAuthMethods` | non                  | tableau du même enum                                                | Quand un connecteur accepte plusieurs méthodes ; l’utilisateur choisit à l’installation.                                        |
| `secretBindings`       | non                  | string[]                                                            | Noms des clés de credentials que le connecteur lit à l’exécution via `secrets.get('<key>')`. L’UI demande exactement celles-ci. |
| `allowedHosts`         | non                  | string[]                                                            | Allow-list réseau. Le connecteur ne peut joindre que les hôtes listés.                                                          |
| `operations`           | connecteurs rest_api | tableau d’`Operation`                                               | Les opérations REST nommées exposées par le connecteur. Voir [Forme d’une opération](#operation-shape).                         |
| `oauth2Config`         | connecteurs oauth2   | `{ authorizationUrl, tokenUrl, scopes? }`                           | Endpoints du authorization-code flow.                                                                                           |
| `sqlConnectionConfig`  | connecteurs sql      | `{ engine, readOnly?, options?, security? }`                        | `engine` vaut `'mssql'`, `'postgres'` ou `'mysql'`. `readOnly` est un indice pour l’UI ; le compte DB est la vraie barrière.    |
| `sqlOperations`        | connecteurs sql      | tableau de `SqlOperation`                                           | Requêtes nommées avec placeholders. Voir [Connecteurs SQL](#connecteurs-sql).                                                   |
| `connectionConfig`     | non                  | `{ domain?, apiVersion?, apiEndpoint?, timeout?, rateLimit?, ... }` | Indices de connexion optionnels ; clés supplémentaires acceptées.                                                               |
| `capabilities`         | non                  | `{ canSync?, canPush?, canWebhook?, syncFrequency? }`               | Déclare des capacités optionnelles que la plateforme peut planifier (ex. sync périodique).                                      |
| `exposeAsCapability`   | non                  | `{ label, icon?, tooltip?, order? }`                                | Expose cette intégration comme capacité nommée dans l’UI.                                                                       |
| `setupGuide`           | non                  | string (≤5000)                                                      | Markdown rendu sous **Guide de configuration** dans le manage dialog. Indique où générer les clés, quels scopes, etc.           |
| `metadata`             | non                  | object                                                              | Métadonnées libres pour l’outillage ; non interprétées par la plateforme.                                                       |

## Forme d’une opération

Une opération REST décrit une action appelable. L’agent choisit une opération par `name` et fournit des paramètres validés ; ton `connector.ts` dispatche sur `ctx.operation` et utilise `ctx.params`.

| Champ              | Requis | Type                  | Ce qu’il fait                                                                                         |
| ------------------ | ------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `name`             | oui    | string                | Identifiant stable utilisé par l’agent. Snake_case par convention.                                    |
| `title`            | non    | string                | Label lisible dans la liste des opérations en UI.                                                     |
| `description`      | non    | string                | Ce que fait l’opération et quand l’utiliser. L’agent lit ça — écris pour le LLM, pas pour l’humain.   |
| `operationType`    | non    | `'read'` \| `'write'` | Pilote la porte d’approbation. Par défaut, comportement style read si omis.                           |
| `requiresApproval` | non    | boolean               | Force la carte d’approbation même sur un read, ou la saute sur un write réellement sûr.               |
| `requiredScopes`   | non    | string[]              | Scopes OAuth dont cette opération a besoin ; remontés à l’utilisateur lors de la connexion.           |
| `parametersSchema` | non    | JSON Schema (object)  | JSON Schema standard. Aujourd’hui seul `type: 'object'` avec `properties` et `required` est exploité. |

Un exemple REST compact, tiré de [examples/integrations/tavily/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/config.json) :

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

## Le sandbox du connecteur

Le code du connecteur ne tourne pas comme du Node ordinaire. Il est transpilé et exécuté dans un contexte isolé avec une petite surface d’API contrôlée. Planifie en conséquence : pas de `fs`, pas de `child_process`, pas d’`import` arbitraire, pas de `process.env`, pas de `fetch` ambiant. Les seuls effets de bord disponibles sont HTTP via `ctx.http` et lecture de credentials via `ctx.secrets`.

### `ConnectorContext`

Chaque opération reçoit un objet contexte. La forme :

```typescript
interface ConnectorContext {
  operation: string; // nom de l'opération invoquée
  params: Record<string, unknown>; // validé contre parametersSchema
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
  responseType?: 'base64'; // demander un body encodé base64 pour téléchargements binaires
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string; // payload déjà sérialisé (ex. JSON.stringify(...))
  binaryBody?: string; // body de requête encodé base64
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

Le client `http` ne joint que les hôtes listés dans `allowedHosts`. Une requête vers autre chose échoue avant l’appel réseau.

### Ce que le sandbox ne fournit pas

- **Aucune builtin Node** — pas de `fs`, `child_process`, `crypto`, `path`, `os`, `net`. Utilise `base64Encode`/`base64Decode` pour le binaire ; pour le hashing ou la signature, fais-le côté serveur ou pré-calcule.
- **Pas d’`import` ni `require` au niveau racine** — écris du code autonome. Les déclarations TypeScript en haut de fichier sont retirées au transpile et n’existent que pour l’éditeur.
- **Pas de variables d’environnement** — lis chaque credential via `ctx.secrets.get(...)`.
- **Pas de travail en arrière-plan** — `setTimeout`, `setInterval` et les promesses non awaited ne font pas partie du contrat. Une opération s’exécute jusqu’au bout de manière synchrone (le sandbox traite ta fonction comme synchrone) et renvoie une valeur.

## Les deux fonctions qu’un connecteur exporte

Un connecteur définit deux fonctions : une pour valider la connexion à l’installation, une pour exécuter les opérations.

| Fonction              | Quand elle tourne                                                         | Ce qu’elle doit faire                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `testConnection(ctx)` | Quand l’utilisateur clique **Tester la connexion** dans le manage dialog. | La requête authentifiée la moins coûteuse que l’API supporte. Lance un `Error` clair avec une indication de remédiation en cas d’échec. |
| `execute(ctx)`        | À chaque invocation d’opération.                                          | Dispatcher sur `ctx.operation`, valider les entrées, appeler l’API, mettre en forme la réponse. Lancer `Error` pour tout échec.         |

Les deux peuvent être exportées soit comme un seul objet `connector` (Tavily, Discord) soit comme fonctions de niveau racine ; les deux formes sont acceptées. La forme objet est recommandée parce qu’elle garde les deux entrées proches d’une liste d’opérations et rend la table de dispatch évidente.

Par convention, un `execute` réussi renvoie un objet de la forme `{ success: true, operation, data, count?, cost?: { cents }, timestamp }`. La plateforme n’impose pas cette forme, mais agents et logs d’exécution la rendent proprement.

## Exemple de bout en bout — Tavily

Voici l’image la plus compacte de bout en bout, tirée de [examples/integrations/tavily/](https://github.com/tale-project/tale/tree/main/examples/integrations/tavily).

Le manifeste déclare la méthode d’auth, l’hôte allow-listé, le secret binding et deux opérations :

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

Le connecteur exporte `testConnection` (une sonde authentifiée pas chère) et `execute` (dispatch vers les helpers par opération) :

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

Note la forme des messages d’erreur — ils disent à l’utilisateur quoi faire (`Verify the API key`), pas seulement que ça a échoué. Les erreurs de `testConnection` apparaissent inline dans le manage dialog ; celles d’`execute` apparaissent dans la réponse de l’agent et le log d’exécution. Rends-les actionnables.

Le fichier complet à [tavily/connector.ts](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/connector.ts) montre les helpers par opération, un utilitaire `handleHttpError` qui mappe les statuts à des messages lisibles, et la troncature des résultats pour garder l’usage de tokens prévisible. Reprends ces motifs.

## Connecteurs SQL

Les intégrations SQL sautent `connector.ts` complètement. La plateforme exécute les requêtes que tu déclares dans le manifeste contre la base configurée ; tu n’écris que le SQL et le schéma de paramètres.

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

Les placeholders utilisent `@paramName`, mappés sur les clés de `parametersSchema.properties`. Marque les requêtes mutantes avec `operationType: 'write'` et (généralement) `requiresApproval: true` ; la plateforme les passera par le flux d’approbation. Voir [examples/integrations/protel/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/protel/config.json) pour un connecteur PMS hôtelier complet avec une vingtaine d’opérations en lecture et une poignée de writes gated par approbation.

`sqlConnectionConfig.engine` accepte `'mssql'`, `'postgres'` ou `'mysql'`. Les `security.maxResultRows` et `security.queryTimeoutMs` optionnels sont des plafonds que la plateforme applique en sus de ce que la base permet.

## Empaquetage et livraison

- **Flux projet.** Pose `integrations/<slug>/{config.json, connector.ts, icon.svg}` dans un projet `tale init`. La plateforme recharge à chaud ; sauvegarder applique le changement.
- **Flux upload UI.** Zippe les fichiers (ou téléverse-les individuellement) via **Paramètres > Intégrations > Ajouter une intégration**. Le paquet total est plafonné à 1 Mo.
- **Versionnage.** Incrémente `version` dans `config.json` dès que tu changes l’ensemble d’opérations ou la forme d’un paramètre, pour que les consommateurs voient le drift.
- **Icônes.** SVG, PNG, JPG ou WebP, sous 256 Ko. SVG rend le mieux en thèmes clair et sombre.
- **Slugs.** Le nom de dossier est le slug. Garde-le stable entre versions ; le renommer est un breaking change.

## Erreurs courantes à éviter

- **Boucles longues ou résultats sans limite.** Les opérations doivent revenir vite avec des données paginées ou tronquées. Le connecteur Tavily plafonne à 5 résultats et tronque chaque page à 2 000 caractères — sers-t’en de référence.
- **Secrets en dur dans le code.** N’incorpore jamais de clés API ou de jetons dans `connector.ts`. Lis-les toujours via `ctx.secrets.get('<binding>')` et déclare le binding dans `secretBindings`.
- **Hôtes non listés dans `allowedHosts`.** Une requête vers un hôte non listé échoue. Ajoute chaque base URL que le connecteur touche, y compris les cibles de redirection dont tu dépends.
- **Messages d’erreur vagues.** `Failed` n’est pas actionnable. Dis à l’utilisateur quel credential est faux, quel scope manque, ou quel quota a été dépassé.
- **Oubli de `operationType: 'write'` sur les calls mutants.** Sans ça, la porte d’approbation ne s’enclenche pas et un write peut s’exécuter sans surveillance.

## Pages liées

- [Aperçu des intégrations](/fr/platform/integrations/overview) — concepts et consommation des connecteurs.
- [Développement assisté par IA](/fr/develop/ai-assisted-development) — utiliser Claude Code, Cursor, GitHub Copilot ou Windsurf pour écrire des connecteurs contre le code de référence de la plateforme.
- [Référence API](/fr/develop/api-reference) — l’API Tale elle-même, distincte des connecteurs.
