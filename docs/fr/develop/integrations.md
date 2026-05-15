---
title: Construire une intégration
description: Écrire un connecteur Tale — config.json, connector.ts, l'API sandbox et l'empaquetage.
---

Un connecteur Tale est un répertoire : un manifeste `config.json`, un `connector.ts` optionnel (connecteurs REST) ou simplement des templates SQL (connecteurs SQL), et une icône. Le manifeste déclare l'identité, la forme d'authentification, les hôtes autorisés et les opérations nommées qu'expose l'intégration ; le code du connecteur exécute chaque opération dans une sandbox isolée à surface API petite et contrôlée. Cette page est la référence d'écriture — le schéma, le contrat de sandbox, les règles d'empaquetage.

Le public, ce sont les développeurs qui écrivent un nouveau connecteur. Pour les concepts côté utilisateur (ce qu'est une intégration, comment une organisation en ajoute une), [Aperçu des intégrations](/fr/platform/integrations/overview) est l'entrée ; pour l'écriture assistée par IA du manifeste, [Développement assisté par l'IA](/fr/develop/ai-assisted-development) couvre le flux éditeur.

## Disposition des fichiers

Un connecteur vit dans un seul répertoire. Le nom du répertoire est le **slug** — l'identifiant stable utilisé par Tale en interne ; ce n'est pas un champ de `config.json`.

```text
integrations/<slug>/
├── config.json     ← manifeste (obligatoire)
├── connector.ts    ← code en sandbox (connecteurs REST uniquement)
└── icon.svg        ← affiché dans la liste Ajouter une intégration
```

Deux chemins amènent le répertoire dans une instance Tale : le déposer dans le dossier `integrations/` d'un projet échafaudé par `tale init`, ou zipper les fichiers et les téléverser via **Paramètres > Intégrations > Ajouter une intégration** (limite 1 Mo). Les deux produisent le même état côté serveur.

## Exemple travaillé — Tavily

Avant de parcourir le schéma complet, voici l'image end-to-end la plus petite. Tavily est un service de recherche web hébergé ; le manifeste déclare la méthode d'auth, l'hôte sur la liste blanche, la liaison de secret et deux opérations :

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
  "setupGuide": "1. S'inscrire sur https://tavily.com\n2. Créer une clé API\n3. La coller ci-dessous et Test connection."
}
```

Le connecteur exporte deux fonctions — `testConnection` pour le sondage du dialogue de gestion, et `execute` pour le dispatch à l'exécution :

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

Remarque la forme des messages d'erreur — ils nomment ce que l'utilisateur doit faire (`Verify the API key`), pas juste qu'une chose a échoué. Les erreurs de `testConnection` apparaissent inline dans le dialogue de gestion ; celles d'`execute` apparaissent dans la réponse de l'agent et dans le journal d'exécution. Les deux appartiennent au même registre d'action.

Le fichier complet sous [tavily/connector.ts](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/connector.ts) couvre les helpers par opération, un utilitaire `handleHttpError` et le tronçonnage des résultats pour garder la consommation de tokens prévisible.

## Schéma `config.json`

Le manifeste est validé côté serveur contre un schéma Zod dans [services/platform/lib/shared/schemas/integrations.ts](https://github.com/tale-project/tale/blob/main/services/platform/lib/shared/schemas/integrations.ts).

| Nom                    | Type                                                                | Obligatoire          | Description                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | string (1–200)                                                      | Oui                  | Nom lisible affiché dans la liste des intégrations.                                                                                    |
| `description`          | string (≤ 2000)                                                     | Non                  | Résumé en une phrase affiché à côté du titre.                                                                                          |
| `version`              | integer                                                             | Non                  | Incrémenter quand des opérations ou des formes de paramètres changent pour que les consommateurs détectent la dérive.                  |
| `type`                 | `'rest_api'` \| `'sql'`                                             | Non                  | Défaut `rest_api`. Mets `sql` pour les connecteurs de base de données.                                                                 |
| `authMethod`           | `'api_key'` \| `'bearer_token'` \| `'basic_auth'` \| `'oauth2'`     | Oui                  | La méthode d'authentification dont ce connecteur a besoin.                                                                             |
| `supportedAuthMethods` | array du même enum                                                  | Non                  | À utiliser quand un connecteur accepte plus d'une méthode d'auth ; l'utilisateur choisit à l'installation.                             |
| `secretBindings`       | array of strings                                                    | Non                  | Noms des clés d'identifiants que le connecteur lit à l'exécution via `secrets.get('<key>')`. L'UI demande exactement ceux-là.          |
| `allowedHosts`         | array of strings                                                    | Non                  | Liste blanche réseau. Le connecteur ne peut pas atteindre des hôtes hors de cette liste.                                               |
| `operations`           | array of `Operation`                                                | connecteurs rest_api | Les opérations REST nommées que le connecteur expose. Voir [Forme d'opération](#forme-doperation).                                     |
| `oauth2Config`         | `{ authorizationUrl, tokenUrl, scopes? }`                           | connecteurs oauth2   | Endpoints pour le flux authorization-code.                                                                                             |
| `sqlConnectionConfig`  | `{ engine, readOnly?, options?, security? }`                        | connecteurs sql      | `engine` est `'mssql'`, `'postgres'` ou `'mysql'`. `readOnly` est un hint pour l'UI ; le compte de base de données est la vraie porte. |
| `sqlOperations`        | array of `SqlOperation`                                             | connecteurs sql      | Requêtes nommées avec placeholders de paramètres. Voir [Connecteurs SQL](#connecteurs-sql).                                            |
| `connectionConfig`     | `{ domain?, apiVersion?, apiEndpoint?, timeout?, rateLimit?, ... }` | Non                  | Indications de connexion optionnelles ; les clés supplémentaires sont acceptées.                                                       |
| `capabilities`         | `{ canSync?, canPush?, canWebhook?, syncFrequency? }`               | Non                  | Déclare des capacités optionnelles que la plateforme peut planifier (par ex. sync périodique).                                         |
| `exposeAsCapability`   | `{ label, icon?, tooltip?, order? }`                                | Non                  | Faire apparaître cette intégration comme une capacité nommée dans l'UI.                                                                |
| `setupGuide`           | string (≤ 5000)                                                     | Non                  | Markdown rendu sous **Configuration guide** dans le dialogue de gestion. Dis où générer les clés, quels scopes, etc.                   |
| `metadata`             | object                                                              | Non                  | Métadonnées libres pour l'outillage ; non interprétées par la plateforme.                                                              |

## Forme d'opération

Une opération REST décrit une action appelable. L'agent choisit une opération par `name` et fournit des paramètres validés ; `connector.ts` dispatche sur `ctx.operation`.

| Nom                | Type                  | Obligatoire | Description                                                                                            |
| ------------------ | --------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `name`             | string                | Oui         | Identifiant stable que l'agent utilise. Convention : snake_case.                                       |
| `title`            | string                | Non         | Étiquette lisible dans la liste d'opérations de l'UI.                                                  |
| `description`      | string                | Non         | Ce que fait l'opération et quand l'utiliser. L'agent lit ça — écris pour le modèle, pas pour l'humain. |
| `operationType`    | `'read'` \| `'write'` | Non         | Pilote la porte d'approbation. Défaut comportement read-like quand omis.                               |
| `requiresApproval` | boolean               | Non         | Force la carte d'approbation même sur un read, ou la saute sur un write réellement sûr.                |
| `requiredScopes`   | array of strings      | Non         | Scopes OAuth nécessaires à cette opération ; montrés à l'utilisateur lors de la connexion.             |
| `parametersSchema` | JSON Schema (object)  | Non         | JSON Schema standard. Seul `type: 'object'` avec `properties` et `required` est exploité aujourd'hui.  |

Un exemple compact tiré du manifeste Tavily :

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

## La sandbox du connecteur

Le code de connecteur ne tourne pas comme du Node ordinaire. Il est transpilé et exécuté dans un contexte isolé à surface API petite et contrôlée : pas de `fs`, pas de `child_process`, pas d'`import` arbitraire, pas de `process.env`, pas de `fetch` ambiant. Les seuls effets de bord disponibles sont HTTP via `ctx.http` et lecture d'identifiants via `ctx.secrets`. C'est la limite de confiance : toute autre capacité reste dans le runtime hôte.

### `ConnectorContext`

Chaque opération reçoit un objet de contexte de la forme ci-dessous :

```typescript
interface ConnectorContext {
  operation: string; // le nom de l'opération invoquée
  params: Record<string, unknown>; // validé contre parametersSchema
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi; // injecté uniquement si le runtime fournit un storage provider
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
  responseType?: 'base64'; // demander un corps base64 pour les téléchargements binaires
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string; // payload déjà sérialisée (par ex. JSON.stringify(...))
  binaryBody?: string; // corps de requête encodé en base64
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

Le client `http` n'atteint que les hôtes listés dans `allowedHosts`. Tout le reste échoue avant l'appel réseau.

### Ce que la sandbox ne fournit pas

- **Pas de built-ins Node.** Pas de `fs`, `child_process`, `crypto`, `path`, `os`, `net`. Utilise `base64Encode` / `base64Decode` pour la gestion binaire ; pour le hashing ou la signature, fais-le côté serveur ou pré-calcule.
- **Pas d'`import` ou `require` au top-level.** Écris du code autonome. Les déclarations de types TypeScript en haut de fichier sont retirées au transpile et n'existent que pour le support éditeur.
- **Pas de variables d'environnement.** Lis chaque identifiant via `ctx.secrets.get(...)`.
- **Pas de travail en arrière-plan.** `setTimeout`, `setInterval` et les promises non awaited ne font pas partie du contrat. Une opération s'exécute synchrone jusqu'au bout (la sandbox traite ta fonction comme synchrone) et renvoie une valeur.

## Les deux fonctions qu'exporte un connecteur

Un connecteur définit deux fonctions — une pour valider une connexion à l'installation, une pour exécuter les opérations.

| Fonction              | Quand elle tourne                                                          | Ce qu'elle doit faire                                                                                             |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `testConnection(ctx)` | Quand l'utilisateur clique **Test connection** dans le dialogue de gestion | Faire la requête authentifiée la moins coûteuse possible. Lever un `Error` clair avec un indice en cas d'échec.   |
| `execute(ctx)`        | À chaque invocation d'opération                                            | Dispatcher sur `ctx.operation`, valider les entrées, appeler l'API, façonner la réponse. Lever `Error` à l'échec. |

Les deux peuvent être exportées soit comme un objet littéral `connector` unique (comme Tavily et Discord) soit comme fonctions top-level ; les deux formes sont acceptées. La forme objet est recommandée parce qu'elle met les points d'entrée à côté d'une liste d'opérations et rend la table de dispatch évidente.

Par convention, un `execute` réussi renvoie un objet de la forme `{ success: true, operation, data, count?, cost?: { cents }, timestamp }`. La plateforme n'impose pas cette forme, mais les agents et le journal d'exécution la rendent proprement quand elle est présente.

## Connecteurs SQL

Les intégrations SQL sautent entièrement `connector.ts`. La plateforme exécute les requêtes déclarées dans le manifeste contre la base configurée ; tu écris seulement le SQL et le schéma de paramètres, rien d'autre.

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

Les placeholders utilisent `@paramName`, mappés contre `parametersSchema.properties`. Marque les requêtes qui mutent avec `operationType: 'write'` et le plus souvent `requiresApproval: true` pour que le flow d'approbation se déclenche. Voir [examples/integrations/protel/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/protel/config.json) pour un connecteur PMS hôtelier complet avec vingt-plus opérations read et une poignée de writes sous approbation.

`sqlConnectionConfig.engine` accepte `'mssql'`, `'postgres'` ou `'mysql'`. Les optionnels `security.maxResultRows` et `security.queryTimeoutMs` sont des plafonds que la plateforme impose en plus de ce que la base elle-même permet — défense en profondeur, pas un substitut à un compte de base en lecture seule.

## Empaquetage et livraison

- **Flux projet.** Dépose `integrations/<slug>/{config.json, connector.ts, icon.svg}` dans un projet `tale init`. La plateforme recharge à chaud ; enregistrer applique le changement.
- **Téléversement UI.** Zippe les mêmes fichiers (ou téléverse-les un à un) via **Paramètres > Intégrations > Ajouter une intégration**. Le paquet total est plafonné à 1 Mo.
- **Versionnage.** Incrémenter `version` dans `config.json` à chaque fois que tu changes l'ensemble des opérations ou une forme de paramètre, pour que les consommateurs puissent détecter la dérive.
- **Icônes.** SVG, PNG, JPG ou WebP, sous 256 Ko. SVG rend le plus proprement dans les deux thèmes.
- **Slugs.** Le nom du répertoire est le slug. Renommer est un changement cassant — chaque installation référence le connecteur par slug.

## Erreurs fréquentes

- **Boucles longues ou ensembles de résultats non bornés.** Les opérations devraient revenir vite avec des données paginées ou tronquées. Le connecteur Tavily plafonne les résultats à 5 et tronque chaque page à 2 000 caractères — réutilise le motif.
- **Secrets dans le code.** Ne jamais incorporer une clé API ou un jeton dans `connector.ts`. Toujours lire via `ctx.secrets.get('<binding>')` et déclarer la liaison dans `secretBindings`.
- **Hôtes pas dans `allowedHosts`.** Une requête vers un hôte non listé échoue avant de quitter la sandbox. Ajoute chaque URL de base que le connecteur touche, y compris les cibles de redirection.
- **Messages d'erreur vagues.** `Failed` n'est pas exploitable. Dis à l'utilisateur quel identifiant est faux, quel scope manque, ou quel quota a été dépassé.
- **`operationType: 'write'` manquant sur les appels mutants.** Sans, la porte d'approbation ne s'engage pas et un write peut tourner sans supervision.

## Où ça s'inscrit

Construire une intégration est le flux d'auteur de connecteur. À partir d'ici, le manifeste s'installe sur les instances Tale ; une fois installé, les opérations du connecteur apparaissent comme outils dans [Créer un agent](/fr/platform/agents/create) et comme étapes dans les [Workflows](/fr/platform/automations/workflows) d'automatisation. Pour la surface de consommation côté opérateur, [Aperçu des intégrations](/fr/platform/integrations/overview) est la référence canonique ; pour l'écriture assistée par IA du manifeste lui-même, [Développement assisté par l'IA](/fr/develop/ai-assisted-development) est le workflow. La surface API Tale — distincte des connecteurs — vit sous [Référence API](/fr/develop/api-reference).
