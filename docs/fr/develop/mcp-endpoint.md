---
title: Endpoint MCP
description: Connecte un client MCP, découvre les outils Tale, développe des automatisations et traite les refus et les résultats.
i18nLintExclude:
  - terminology-loanword
---

Connecte un client MCP lorsqu'un agent doit découvrir les outils Tale, récupérer des connaissances ou concevoir et exécuter des automatisations. La connexion utilise la même clé API et le même périmètre d'organisation que [REST](/fr/develop/api-reference). Tale joue le rôle de serveur : ton client externe appelle Tale.

Commence par `initialize`, consulte `tools/list`, puis appelle `get_docs` avant d'écrire une automatisation. L'installation fournit sa propre grammaire prise en charge ; le client n'a donc pas à inventer des types de nœuds ou des champs.

## Connecter un client

### Préparer la connexion

Crée une [clé API](/fr/platform/admin/api-keys) et conserve-la dans la configuration sécurisée de ton client. La page **Paramètres > API > MCP** affiche le point d'accès, le slug d'organisation et une requête de découverte à copier.

| Paramètre | Valeur |
| --- | --- |
| Point d'accès | `https://your-host.example.com/api/v1/mcp` |
| Transport | HTTPS POST avec JSON-RPC ; réponses JSON simples |
| Autorisation | `Authorization: Bearer <api-key>` |
| Organisation | `X-Organization-Slug: <slug>` |
| Révisions du protocole | `2025-11-25`, ou `2025-06-18` ou `2025-03-26` si le client la propose |

Le client doit accepter un point d'accès HTTP distant avec des en-têtes personnalisés. Il n'y a ni flux SSE, ni session à supprimer, ni parcours d'autorisation OAuth. Les URL de découverte OAuth renvoient du JSON avec `404` ; un client qui exige ce parcours doit être configuré autrement. Un client limité aux serveurs stdio locaux ne peut pas utiliser directement cette URL. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) fournit des configurations prêtes pour opencode et Claude Code.

Envoie toujours l'en-tête d'organisation dans une intégration réutilisable. Il n'est facultatif que si le titulaire de la clé appartient à une seule organisation. Avec plusieurs appartenances, son absence produit `400 ORG_SLUG_REQUIRED`. Un slug inconnu produit `404 ORG_SLUG_INVALID`, et une organisation dont le titulaire n'est pas membre produit `403 ORG_FORBIDDEN`. Chacun de ces refus liste dans `data.organizations` les slugs que tu peux envoyer.

### Initialiser et récupérer la référence

Les exemples supposent que `TALE_URL`, `TALE_API_KEY` et `TALE_ORG_SLUG` sont déjà définis dans ton environnement. `TALE_URL` est l'origine de l'application, sans `/api/v1`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"docs-client","version":"1.0.0"}}}'
```

Le serveur s'identifie comme `tale-platform` et indique la version du contrat d’API dans `serverInfo.version`. Ses `instructions` sont un court guide pour travailler avec Tale, que ton client peut transmettre à son modèle. Lis `result.protocolVersion` puis envoie la valeur négociée dans `MCP-Protocol-Version` lors des appels suivants. L'exemple ci-dessous utilise `2025-11-25` ; remplace-la si l'initialisation a négocié une révision plus ancienne. Une révision que le point d’accès ne parle pas renvoie `400` avec JSON-RPC `-32022`, et `data.supported` liste celles qu’il parle.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2025-11-25' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_docs","arguments":{}}}'
```

Un résultat `get_docs` réussi contient la référence des automatisations en texte et ne porte pas d'indicateur d'erreur. Pour consulter les schémas des outils, envoie plutôt `method: "tools/list"`. L'inventaire actuel compte 22 outils. Conserve l'`id` JSON-RPC pour associer chaque résultat à sa requête.

### Transport et lots

| Requête | Réponse |
| --- | --- |
| Un message JSON-RPC | Un résultat ou une erreur JSON-RPC |
| Lot de 20 messages au maximum | Tableau de réponses ; les notifications n'ont pas d'entrée de réponse |
| Notifications uniquement | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS` ; aucune clé requise |
| Autre méthode HTTP | HTTP `405`, `Allow: POST, OPTIONS` |

Chaque appel d'outil supplémentaire d'un lot consomme le même budget qu'un appel séparé. Si le lot épuise son budget, l'entrée refusée contient JSON-RPC `-32000` avec `data.retryAfterMs`. La réponse HTTP reste `200`, sans `Retry-After`. Une requête unique refusée à l'entrée HTTP reçoit le `429` REST. Gère les deux cas selon les [limites de débit](/fr/develop/rate-limits).

Le point d'accès ne fournit pas d'en-têtes CORS pour utiliser une clé dans une page web. Conserve la clé sur un serveur de confiance ou dans le stockage d'identifiants du client MCP. Une requête dont l’en-tête `Origin` nomme un site que le déploiement n’accepte pas est journalisée, et refusée avec `403` `ORIGIN_FORBIDDEN` là où l’opérateur impose cette vérification ([référence de l’environnement](/fr/self-hosted/configuration/environment-reference#mcp-endpoint)). Les agents de code lancés dans un terminal n’envoient pas d’`Origin`.

## Les outils

`tools/list` fournit le schéma d'entrée de chaque outil, et un outil de lecture décrit aussi sa réponse dans `outputSchema`. Les arguments sont vérifiés avant exécution : un argument manquant, vide, mal typé ou inattendu est refusé par un seul résultat d’outil marqué `isError`, dont le `code` est `INVALID_ARGUMENTS` et dont `data.issues` liste chaque problème avec son `path`, son `code` et son `message`. Le refus ne répète jamais la valeur d’un argument. Chaque résultat porte sa réponse sous forme de texte JSON compact, et la réponse réussie d’un outil de lecture arrive aussi comme `structuredContent`, le même objet. Le document passé à `validate_automation`, `run_automation`, `test_automation` ou `save_automation` garde volontairement une enveloppe ouverte : `get_docs` en explique la grammaire et le moteur valide son contenu.

Les outils exposent aussi `readOnlyHint`, `destructiveHint`, `idempotentHint` et `openWorldHint`. Un hôte peut s'en servir pour expliquer un appel, mais ces indications n'accordent aucun droit et ne garantissent pas sa sûreté. Les lectures sont marquées comme telles ; enregistrer écrit une version ; déployer ou modifier un déclencheur peut remplacer un état existant. Les exécutions réelles peuvent joindre de vrais services.

### Écriture

| Outil                 | Ce qu'il fait                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `get_docs` | Lire la référence d'automatisation : grammaire, types de nœuds, nœuds de capacité et méthodes au format `tools/call`. |
| `get_catalog` | Lister les types de nœuds disponibles, avec le schéma d’entrée, la signature de sortie et l’`outputSchema` de chaque capacité ; `kind` filtre le type, `compact: true` omet les schémas. |
| `search_catalog`      | Chercher dans le catalogue de types de nœuds par mot-clé.            |
| `validate_automation` | Valider un document d’automatisation sans l’enregistrer : ses erreurs et avertissements avec leur emplacement, plus l’analyse du flux et les types déduits. |
| `run_automation` | Exécuter un document avec les mocks déterministes. |
| `test_automation`     | Lancer les tests d'acceptation propres à une automatisation.         |
| `save_automation`     | Enregistrer un document comme nouvelle version immuable ; la réponse liste ses avertissements. |
| `get_automation`      | Lire une version enregistrée — la dernière sans précision, `version: "deployed"` pour celle qui est en ligne (`AUTOMATION_VERSION_UNKNOWN` tant que rien n’est déployé). |
| `list_automations`    | Les automatisations de l'organisation avec leur dernière version, leur version déployée et les projets où chacune est installée (`projectIds`). |
| `deploy_automation` | Déployer une version enregistrée pour les exécutions réelles. |

Suis cet ordre : lire la grammaire et le catalogue, valider le document, l'exécuter avec les mocks, lancer ses tests d'acceptation, enregistrer une version, puis la déployer. Un test simulé réussi vérifie le chemin simulé. Il ne valide ni les identifiants du fournisseur, ni le réseau, ni les effets réels.

#### Lire un résultat de validation {#validation-result}

`validate_automation` répond avec `valid`, `errors`, `warnings`, `analysis` et `types`. Les erreurs empêchent d’enregistrer et de déployer, les avertissements jamais. `save_automation` renvoie les `warnings` de la version enregistrée, et un enregistrement refusé indique ses `warnings` à côté de ses `errors` : tu découvres ainsi les deux pendant ton travail.

| Champ d’un problème | Contenu |
| --- | --- |
| `code` | La valeur stable sur laquelle brancher, comme `REF_UNKNOWN_FIELD` ou `MAYBE_NULL` |
| `message`, `hint` | Des phrases en anglais qui restent stables d’une version à l’autre ; affiche-les, mais branche sur `code` |
| `nodeId` | Le nœud concerné, s’il y en a un |
| `at.pointer` | Un JSON Pointer dans le document envoyé, comme `/nodes/2/input/to` ; `""` désigne le document entier |
| `at.range` | `[start, end)` en unités de code UTF-16 dans la chaîne située à `at.pointer`, quand le problème est une seule expression d’un template, d’une condition ou du code |
| `at.subject` | `key` quand le pointeur désigne un champ qui ne devrait pas exister ; `missing` quand il désigne un champ qui devrait exister et manque |
| `params` | Les faits dont le message est fait, comme `node`, `field`, `ref`, `key` et `suggestion` |
| `related` | Les autres endroits concernés : le nœud dont dépend une lecture, le nœud dont la condition ou l’échec cause le problème, les nœuds lecteurs ou les membres d’une boucle |

`analysis.nodes.<id>` indique si un nœud est atteignable (`reachable`), s’il s’exécute toujours (`alwaysRuns`), comment il peut être ignoré (`maySkip`) et si son échec arrête l’exécution (`failureHandling: "halts"`) ou la laisse continuer (`"continues"`). `analysis.paths` liste les chemins que peut prendre une exécution réussie — jusqu’à 32, avec `count` pour le total — et nomme les nœuds dont l’échec termine une exécution. `types` donne le JSON Schema de l’entrée de l’exécution, de la sortie de chaque nœud et du résultat de l’automatisation ; `get_catalog` donne de la même façon l’`outputSchema` de chaque capacité. [Ce que Tale vérifie avant une exécution](/fr/platform/automations/concepts#checks) explique chaque famille de vérifications.

### Gestion des exécutions & déclencheurs

| Outil            | Ce qu'il fait                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed` | Exécuter la version déployée et attendre jusqu'à 30 secondes sa sortie, sa trace et ses effets. Si elle continue, suivre le `runId` renvoyé. Prend le même `idempotencyKey` facultatif que `start_run`, dans le même registre que la porte REST : une répétition renvoie la première exécution avec `duplicate: true` et ne démarre rien, quelle que soit la porte qui l'a lancée. |
| `start_run` | Démarrer la version déployée en arrière-plan, puis suivre l'identifiant renvoyé avec `get_run`. Prend un `idempotencyKey` facultatif — l’`Idempotency-Key` de la porte REST, le même registre : la même clé avec les mêmes arguments répond la poignée de la première exécution avec `duplicate: true` et ne démarre rien, la même clé avec d’autres arguments est refusée (`IDEMPOTENCY_KEY_REUSED`). L’en-tête HTTP `Idempotency-Key` est refusé sur cet endpoint (**400**, `INVALID_HEADER`) : un lot porte jusqu’à 20 appels, la clé voyage donc dans les arguments de l’outil. |
| `list_runs` | Lister les exécutions accessibles d'une automatisation ou de plusieurs projets, les plus récentes d'abord, avec leur `projectId`. |
| `get_run` | Lire le statut, la sortie, la trace, les effets et le `projectId`. L'identifiant d'une exécution de projet s'utilise aussi dans `GET /api/v1/projects/{id}/runs/{runId}`. |
| `cancel_run` | Arrêter une exécution lors du prochain passage d'un nœud à l'autre. |
| `list_versions`  | L'historique de versions immuable d'une automatisation ; chaque ligne dit si elle est la version `deployed`, et `deployedVersion` la nomme à côté de la liste (`null` tant que rien n’est déployé).                                                        |
| `list_triggers` | Lire les déclencheurs sans révéler le secret du webhook. |
| `delete_trigger` | Supprimer le déclencheur ; conserver les versions et l'historique des exécutions. |
| `set_trigger` | Configurer un déclencheur planifié, webhook ou événement. Le `token` d’un webhook est répondu une fois, ici, et plus jamais — conserve-le ; `deployed` dit si les livraisons tourneront : un déclencheur lié à une automatisation sans version déployée est enregistré et ne déclenche rien tant qu’une version n’est pas déployée. |

| Outil | Quand le choisir |
| --- | --- |
| `run_automation` | Essayer un document non enregistré avec les mocks déterministes ; `mode: "live"` est refusé |
| `run_deployed` | Exécuter réellement la version déployée et attendre jusqu'à 30 secondes ; suivre ensuite le `runId` si elle continue |
| `start_run` | Démarrer la version déployée en arrière-plan puis suivre `get_run` ; passe `idempotencyKey` pour qu’une répétition soit sûre |

Les deux outils de version déployée utilisent le même moteur durable, avec les mêmes contrôles d'accès et traces d'exécution. `start_run` accepte un `projectId` facultatif. Une automatisation liée à des projets doit s'exécuter dans un projet où elle est installée ; une liaison unique peut être choisie automatiquement. Sans liaison, omettre le champ sélectionne le périmètre de l'organisation. Lis `projectIds` dans `list_automations` et le véritable `projectId` du résultat au lieu de deviner l'URL REST de suivi.

### Capacités & connaissances

| Outil                 | Ce qu'il fait                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Rechercher les automatisations déployées de l'organisation par nom et description. |
| `invoke_capability` | Appeler une capacité par son `id`. Si une approbation est nécessaire, renvoyer son état en attente au lieu d'exécuter l'action. |
| `get_knowledge` | Récupérer des passages des documents et sites web explorés de l'organisation. `corpus` vaut `private` (documents), `public-web` (pages explorées) ou `all` ; les orthographes REST `documents` et `web` sont acceptées aussi. `query` est plafonné à 2000 caractères. Chaque passage porte `text`, `source` (un titre), `ref`, `corpus`, `chunkIndex`, `score`, `similarity` quand la recherche dense l’a classé, `url` pour une page web et — pour un document — le `documentId` qu’attend `GET /api/v1/documents/{id}` (l’id du fichier pour un résultat de projet) ainsi que son `projectId` : la même citation que renvoie la recherche REST. |

Le registre de capacités contient actuellement les automatisations déployées. Il n'inclut ni outils intégrés, ni actions de connectors, ni skills, ni serveurs MCP externes. Appeler une automatisation déployée correspond à la même opération réelle que `run_deployed`. Si une approbation est nécessaire, le résultat `pending` permet au client d'expliquer qu'une personne doit décider avant la poursuite.

## Ce que la clé peut faire

| Opération | Accès nécessaire |
| --- | --- |
| Lectures, validation, simulations et tests d'acceptation, recherche de capacités, récupération de connaissances | Appartenance à l'organisation, puis règles habituelles de la ressource |
| Enregistrer, déployer, définir/supprimer un déclencheur, annuler ou exécuter réellement | Capacité développeur, puis règles habituelles de la ressource |

La clé identifie son titulaire ; elle n'élargit ni son rôle ni son accès aux projets. Les appels réels via `invoke_capability` passent aussi par les contrôles d'exécution.

Avant de configurer des outils privilégiés, lis `GET /api/v1/me` : `capabilities.developer` indique le droit lié au rôle actuel. `deploymentEditor` correspond à une liste opérateur distincte et n’autorise pas la création par MCP. Les erreurs d’outils gardent le format MCP décrit ci-dessous ; la lecture d’une capacité REST ne change pas leur traitement JSON-RPC.

### Distinguer une erreur de protocole d'un refus d'outil

| Résultat | Traitement |
| --- | --- |
| JSON-RPC `-32601` | Corriger la méthode inconnue |
| JSON-RPC `-32602` | Corriger le nom de l'outil à partir de `tools/list` |
| JSON-RPC `-32022` (HTTP `400`) | Envoyer `MCP-Protocol-Version` avec une des révisions de `data.supported` |
| Résultat avec `isError: true` | Lire le `code` stable, l'`error` explicative et le `hint` dans le texte ; `data` peut détailler les champs invalides |
| `validate_automation` avec `valid: false` | Verdict normal de validation ; examiner `errors` et leurs emplacements ([Lire un résultat de validation](#validation-result)), même si `isError` reste false. Les avertissements ne rendent jamais un document invalide |
| Capacité avec `pending` | Résultat normal d'approbation ; ni une fin d'exécution, ni un échec à relancer |
| Capacité avec `refused` | Résultat d'erreur ; corriger la cause indiquée |

Les codes de refus comprennent `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `LIVE_MODE_UNAVAILABLE` et `NOT_SUPPORTED`. Ce dernier indique que l'hôte ne prend pas en charge l'opération sur les exécutions, versions ou déclencheurs. `start_run` refuse un `idempotencyKey` réutilisé avec d’autres arguments par `IDEMPOTENCY_KEY_REUSED` ; `invoke_capability` refuse un id que le registre ne tient pas — une automatisation seulement enregistrée n’y est pas — par `CAPABILITY_NOT_FOUND` et une entrée que son schéma rejette par `CAPABILITY_INPUT_INVALID` ; `get_knowledge` transmet les codes propres de la porte des connaissances (`KNOWLEDGE_UNAVAILABLE` quand la recherche elle-même a échoué). Les erreurs de plateforme conservent leur code, leur conseil et leurs données éventuelles ; par exemple, l'absence d'accès développeur renvoie `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` liste chaque problème d’argument ; une valeur hors d’un ensemble énuméré est refusée et le message nomme l’ensemble. `RATE_LIMITED` signifie que l’outil avait besoin d’une exécution et que le [budget d’exécution](/fr/develop/rate-limits) du détenteur de la clé est épuisé : attends `data.retryAfterMs`. `INTERNAL_ERROR` signifie que l’appel a échoué de façon inattendue ; communique son `data.requestId` à l’équipe qui exploite le déploiement.

Un nom d'automatisation inconnu est aussi une erreur pour `list_versions`, `list_runs` et `list_triggers`. Une liste vide signifie qu'une automatisation existante n'a pas d'éléments correspondants. La seule exception est l’historique des exécutions : une automatisation supprimée conserve ses exécutions, `list_runs {name}` les renvoie donc tant qu’elles existent, et seul un nom qui n’a jamais tourné donne `AUTOMATION_NOT_FOUND`. `get_catalog` restreint à un type de nœud de base (`transform`, `llm`, `agent`, `subautomation`) répond une liste vide accompagnée d’un `hint` renvoyant à `get_docs`, comme le fait `search_catalog`. Un document invalide soumis à un outil qui exige un document valide, une recherche échouée ou un déploiement absent produisent `isError: true`. Seul l'outil de validation présente un document invalide comme son verdict normal.

## Où ça se place

REST et MCP partagent les clés, le périmètre d'organisation et les objets d'exécution durables. Choisis REST pour des routes HTTP explicites, et MCP pour un client capable de découvrir et d'appeler des outils. Tale n'enregistre ni n'appelle de serveurs MCP externes par ce point d'accès.
