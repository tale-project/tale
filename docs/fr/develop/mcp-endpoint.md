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
| Révisions du protocole | `2026-07-28`, portée par chaque requête ; ou `2025-11-25`, `2025-06-18` ou `2025-03-26`, ouvertes par `initialize` ([Révisions du protocole](#protocol-revisions)) |

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

Un résultat `get_docs` réussi contient la référence des automatisations en texte et ne porte pas d'indicateur d'erreur. Ajoute `"arguments":{"topic":"triggers"}` pour la référence des déclencheurs (les champs de chaque type de déclencheur, l’entrée avec laquelle ses exécutions démarrent et les événements), `"validation"` pour lire un résultat de validation et connaître chaque code d’erreur, ou `"skill"` pour le [skill Tale](/fr/develop/use-tale-from-your-editor#tale-skill). Pour consulter les schémas des outils, envoie plutôt `method: "tools/list"`. Conserve l'`id` JSON-RPC pour associer chaque résultat à sa requête.

### Transport et lots

| Requête | Réponse |
| --- | --- |
| Un message JSON-RPC | Un résultat ou une erreur JSON-RPC |
| Lot de 20 messages au maximum (révisions de 2025 uniquement) | Tableau de réponses ; les notifications n'ont pas d'entrée de réponse |
| Notifications uniquement | HTTP `202` |
| `OPTIONS` | HTTP `204`, `Allow: POST, OPTIONS` ; aucune clé requise |
| Autre méthode HTTP | HTTP `405`, `Allow: POST, OPTIONS` |

Chaque appel d'outil, lecture ou liste de ressources ou prompt supplémentaire d'un lot consomme le même budget qu'un appel séparé. Si le lot épuise son budget, l'entrée refusée contient JSON-RPC `-32000` avec `data.retryAfterMs`. La réponse HTTP reste `200`, sans `Retry-After`. Une requête unique refusée à l'entrée HTTP reçoit le `429` REST. Gère les deux cas selon les [limites de débit](/fr/develop/rate-limits).

Le point d'accès ne fournit pas d'en-têtes CORS pour utiliser une clé dans une page web. Conserve la clé sur un serveur de confiance ou dans le stockage d'identifiants du client MCP. Une requête dont l’en-tête `Origin` nomme un site que le déploiement n’accepte pas est journalisée, et refusée avec `403` `ORIGIN_FORBIDDEN` là où l’opérateur impose cette vérification ([référence de l’environnement](/fr/self-hosted/configuration/environment-reference#mcp-endpoint)). Les agents de code lancés dans un terminal n’envoient pas d’`Origin`.

### Révisions du protocole {#protocol-revisions}

Le point d’accès sert deux générations du protocole sur la même URL avec la même clé, et décide pour chaque requête de laquelle il s’agit. Un client qui parle `2026-07-28` n’envoie pas d’`initialize` : chaque requête porte sa révision et les capacités du client, si bien que rien n’est conservé d’une requête à l’autre.

| | `2025-11-25`, `2025-06-18`, `2025-03-26` | `2026-07-28` |
| --- | --- | --- |
| Démarrage | `initialize`, puis la révision négociée dans `MCP-Protocol-Version` | Aucune poignée de main ; `server/discover` indique ce que le serveur parle |
| Chaque requête | Le message JSON-RPC | `params._meta` avec `io.modelcontextprotocol/protocolVersion` et `io.modelcontextprotocol/clientCapabilities` ; les en-têtes `MCP-Protocol-Version` et `Mcp-Method`, plus `Mcp-Name` pour `tools/call`, `resources/read` et `prompts/get` |
| Lots | 20 messages au maximum | Un message par requête |
| Résultats | Comme décrit sur cette page | En plus, `resultType: "complete"` et le serveur sous `_meta["io.modelcontextprotocol/serverInfo"]` ; `server/discover`, les listes et `resources/read` ajoutent `ttlMs` et `cacheScope: "private"` |
| `initialize`, `ping` | Traités | HTTP `404` avec JSON-RPC `-32601` |
| Une adresse qui ne trouve rien | `-32002` | `-32602` |

Une requête est servie selon `2026-07-28` quand son `_meta` nomme une révision ou que son en-tête `MCP-Protocol-Version` vaut `2026-07-28`. Ses en-têtes doivent reprendre ce que dit le corps. Si un en-tête manque, ou s’il nomme une autre révision, une autre méthode, un autre outil, un autre prompt ou une autre adresse, la requête est refusée avec HTTP `400` et JSON-RPC `-32020` avant que quoi que ce soit ne s’exécute. Envoie une valeur de `Mcp-Name` qui n’est pas en ASCII simple sous la forme `=?base64?<texte UTF-8 en Base64>?=`. Si `_meta` manque ou est mal formé, le point d’accès répond `-32602` avec HTTP `400` et nomme les entrées concernées dans `data.missing` ou `data.malformed`.

```bash
curl --fail-with-body "$TALE_URL/api/v1/mcp" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'MCP-Protocol-Version: 2026-07-28' \
  --header 'Mcp-Method: server/discover' \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"docs-client","version":"1.0.0"}}}}'
```

La réponse liste toutes les révisions dans `supportedVersions` et contient les mêmes capacités et `instructions` qu’`initialize`, avec le serveur sous `_meta`. `ttlMs` indique combien de temps ton client peut réutiliser une réponse : une heure pour `server/discover`, les listes d’outils, de prompts et de modèles d’adresse, et les références ; une minute pour `resources/list` et le catalogue des connecteurs ; `0` pour une automatisation ou une exécution, car elles peuvent changer dès le prochain enregistrement de ton agent. Chaque réponse appartient à la clé qui l’a demandée ; un cache ne doit donc jamais la partager avec une autre clé. Le nom indiqué dans `io.modelcontextprotocol/clientInfo` est enregistré avec chaque appel et avec les modifications qu’il apporte, si bien qu’une version enregistrée par un agent nomme le client qui l’a enregistrée.

## Les outils

`tools/list` fournit le schéma d'entrée de chaque outil, et un outil de lecture décrit aussi sa réponse dans `outputSchema`. Les arguments sont vérifiés avant exécution : un argument manquant, vide, mal typé ou inattendu est refusé par un seul résultat d’outil marqué `isError`, dont le `code` est `INVALID_ARGUMENTS` et dont `data.issues` liste chaque problème avec son `path`, son `code` et son `message`. Le refus ne répète jamais la valeur d’un argument. Chaque résultat porte sa réponse sous forme de texte JSON compact, et la réponse réussie d’un outil de lecture arrive aussi comme `structuredContent`, le même objet. Le document passé à `validate_automation`, `run_automation`, `test_automation` ou `save_automation` garde volontairement une enveloppe ouverte : `get_docs` en explique la grammaire et le moteur valide son contenu.

Les outils exposent aussi `readOnlyHint`, `destructiveHint`, `idempotentHint` et `openWorldHint`. Un hôte peut s'en servir pour expliquer un appel, mais ces indications n'accordent aucun droit et ne garantissent pas sa sûreté. Les lectures sont marquées comme telles ; enregistrer écrit une version ; déployer, supprimer, installer ou modifier un déclencheur peut remplacer un état existant. Les exécutions réelles peuvent joindre de vrais services. Mettre en service, supprimer, définir un déclencheur, installer une automatisation dans des projets et répondre à la question d’une exécution portent aussi `_meta["anthropic/requiresUserInteraction"]` : un client qui en tient compte demande à la personne avant chacun de ces appels.

### Écriture {#authoring}

| Outil                 | Ce qu'il fait                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `get_docs` | Lire la référence d'automatisation : grammaire, types de nœuds, nœuds de capacité et méthodes au format `tools/call`. |
| `get_catalog` | Lister les types de nœuds disponibles, avec le schéma d’entrée, la signature de sortie et l’`outputSchema` de chaque capacité ; `kind` filtre le type, `compact: true` omet les schémas. |
| `search_catalog`      | Chercher dans le catalogue de types de nœuds par mot-clé.            |
| `validate_automation` | Valider un document d’automatisation sans l’enregistrer : ses erreurs et avertissements avec leur emplacement, plus l’analyse du flux et les types déduits. |
| `run_automation` | Exécuter un document avec les mocks déterministes. |
| `test_automation`     | Lancer les tests d'acceptation propres à une automatisation — d’un brouillon (`automation`) ou d’une version enregistrée (`name`, `version`), dont le verdict est alors noté sur la version. |
| `save_automation`     | Enregistrer un document comme nouvelle version immuable ; la réponse liste ses avertissements. Voir [Enregistrer sans perdre de travail](#save). |
| `get_automation`      | Lire une version enregistrée — la dernière sans précision, `version: "deployed"` pour celle qui est en ligne (`AUTOMATION_VERSION_UNKNOWN` tant que rien n’est déployé) : le document sous `automation`, ses `settings`, `taskContract` et `presentation`, `latestVersion`, `deployedVersion`, qui l’a enregistrée (`createdBy`), par quel accès (`createdVia` : `app`, `upload`, `mcp`, `managed` ou `system` ; `null` pour une version enregistrée avant que ce soit noté) et avec quel client (`clientName`), ses `projectIds` et son `trigger`. |
| `list_automations`    | Les automatisations de l'organisation avec leur dernière version, leur version déployée et les projets où chacune est installée (`projectIds`). |
| `deploy_automation` | Déployer une version enregistrée pour les exécutions réelles ; une version plus ancienne revient en arrière. `expectedDeployedVersion` (la version que tu as lue comme en service, `null` pour aucune) refuse la mise en service avec `AUTOMATION_DEPLOYMENT_STALE` quand une autre est passée en service entre-temps ; la réponse nomme la `previousVersion`. |
| `delete_automation` | Supprimer une automatisation — toutes ses versions, son déclencheur et ses installations ; ses exécutions restent. `expectedLatestVersion` doit être la dernière version que tu as lue (sinon `AUTOMATION_VERSION_STALE`) ; une exécution encore en cours empêche la suppression (`AUTOMATION_HAS_ACTIVE_RUNS`). |

Suis cet ordre : lire la grammaire et le catalogue, valider le document, l'exécuter avec les mocks, lancer ses tests d'acceptation, enregistrer une version, puis la déployer. Un test simulé réussi vérifie le chemin simulé. Il ne valide ni les identifiants du fournisseur, ni le réseau, ni les effets réels.

#### Enregistrer sans perdre de travail {#save}

Une version porte, à côté du document, le formulaire `settings` qu’affiche une tâche, le `taskContract` et la `presentation` dans la liste des automatisations. Un enregistrement qui en omet un garde celui de la dernière version ; `null` n’en enregistre aucun (pour `presentation`, la liste continue alors d’afficher la plus récente des précédentes) ; une valeur est vérifiée avec le schéma par lequel l’application la lit, et refusée comme `INVALID_ARGUMENTS` avec chaque problème quand elle ne convient pas. `carried` dans la réponse nomme ce qui a été gardé.

Passe `baseVersion`, la version dont ta modification est partie. Si quelqu’un a enregistré une version plus récente entre-temps, l’enregistrement est refusé avec `AUTOMATION_VERSION_STALE` et `data.latestVersion` ; lis cette version, reporte ta modification et enregistre à nouveau. Sans `baseVersion`, la version s’ajoute, et `baseVersionChecked: false` indique que la vérification a été sautée. Enregistre une nouvelle automatisation avec `create: true` : un nom qui existe déjà est refusé (`AUTOMATION_NAME_TAKEN`), pour qu’une nouvelle automatisation ne devienne jamais une version d’une autre. Un enregistrement est refusé de la même façon, avec ou sans `create`, quand le nom appartient à une automatisation que tu ne peux pas voir. `projectId` installe une nouvelle automatisation, avec sa première version, dans un projet que tu peux modifier ; l’enregistrement d’une automatisation existante l’ignore.

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

`detail` choisit ce qui accompagne les problèmes : `["analysis"]`, `["types"]` ou `[]` pour les problèmes seuls ; sans `detail`, tu reçois les deux. Certains avertissements ne vérifient pas le document, ils le comparent à ton organisation : un skill qu’aucune exécution de l’automatisation ne peut atteindre (`SKILL_UNKNOWN`), un connector que personne n’a connecté (`CONNECTOR_NOT_CONNECTED`), un secret que personne n’a enregistré (`SECRET_UNKNOWN`, signalé seulement aux rôles Propriétaire, Admin et Développeur), un environnement d’agent que ce déploiement ne peut pas exécuter (`HARNESS_UNKNOWN`) et un déclencheur d’événement qui attend un événement que Tale n’émet pas (`EVENT_UNKNOWN`). Ils n’empêchent jamais d’enregistrer ; les [outils de découverte](#discovery) listent ce qui existe.

### Gestion des exécutions & déclencheurs {#management}

| Outil            | Ce qu'il fait                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_deployed` | Exécuter la version déployée et attendre jusqu'à 30 secondes sa sortie, sa trace et ses effets. Si elle continue, suivre le `runId` renvoyé. Prend le même `idempotencyKey` facultatif que `start_run`, dans le même registre que la porte REST : une répétition renvoie la première exécution avec `duplicate: true` et ne démarre rien, quelle que soit la porte qui l'a lancée. |
| `start_run` | Démarrer une exécution en arrière-plan, puis suivre l'identifiant renvoyé avec `get_run`. `mode: "live"` (par défaut) exécute pour de vrai la version en service ; `mode: "mock"` exécute n’importe quelle version enregistrée — la dernière sans `version` — avec les mocks déterministes, et l’exécution figure dans l’historique comme une exécution lancée dans l’application. Prend un `idempotencyKey` facultatif — l’`Idempotency-Key` de la porte REST, le même registre : la même clé avec les mêmes arguments répond la poignée de la première exécution avec `duplicate: true` et ne démarre rien, la même clé avec d’autres arguments est refusée (`IDEMPOTENCY_KEY_REUSED`). L’en-tête HTTP `Idempotency-Key` est refusé sur cet endpoint (**400**, `INVALID_HEADER`) : un lot porte jusqu’à 20 appels, la clé voyage donc dans les arguments de l’outil. |
| `list_runs` | Lister les exécutions accessibles d'une automatisation ou de plusieurs projets, les plus récentes d'abord, avec leur `projectId`. `mode` et `statuses` filtrent, et `nextCursor` (`null` sur la dernière page) est le `cursor` de la page plus ancienne suivante ; passe-le tel quel avec les mêmes filtres. |
| `get_run` | Lire le statut, la sortie, la trace, les effets et le `projectId`. L'identifiant d'une exécution de projet s'utilise aussi dans `GET /api/v1/projects/{id}/runs/{runId}`. Une exécution qui attend la réponse d’une personne (`waitingFor: "ask"`) donne la question sous `ask` : son `askId` et la question. `detail` choisit ce qui accompagne le statut ; `detail: []` ne renvoie que le statut, pour suivre une longue exécution. |
| `cancel_run` | Arrêter une exécution lors du prochain passage d'un nœud à l'autre. |
| `answer_run_ask` | Répondre à la question qu’une exécution en attente a posée à une personne (`get_run` la donne sous `ask`, avec l’`askId` à passer) ; l’exécution reprend avec la réponse, notée comme celle du titulaire de la clé. |
| `list_versions`  | L'historique de versions immuable d'une automatisation ; chaque ligne dit si elle est la version `deployed`, qui l’a enregistrée par quel accès (`createdVia`, `clientName`), et `deployedVersion` nomme celle en service à côté de la liste (`null` tant que rien n’est déployé). `deployments` liste quand des versions sont passées en service, les plus récentes d’abord, avec la version en service avant. |
| `set_automation_projects` | Installer une automatisation dans des projets (`add`) et la retirer d’autres (`remove`) en une seule modification ; la réponse nomme ce qui est `added`, `removed` et `unchanged`. La retirer d’un projet où elle n’est pas installée est refusé (`AUTOMATION_NOT_INSTALLED`). |
| `get_automation_metrics` | Les chiffres d’exécution de l’organisation sur 7, 30 ou 90 jours (`periodDays`), exécutions réelles par défaut ou simulées : exécutions par résultat, taux de réussite, durée moyenne, une série par jour et les automatisations les plus utilisées, chacun comparé à la période précédente. |
| `list_triggers` | Lire les déclencheurs sans révéler le secret du webhook. |
| `delete_trigger` | Supprimer le déclencheur ; conserver les versions et l'historique des exécutions. |
| `set_trigger` | Configurer un déclencheur planifié, webhook ou événement. Le `token` d’un webhook est répondu une fois, ici, et plus jamais — conserve-le ; `deployed` dit si les livraisons tourneront : un déclencheur lié à une automatisation sans version déployée est enregistré et ne déclenche rien tant qu’une version n’est pas déployée. |

| Outil | Quand le choisir |
| --- | --- |
| `run_automation` | Essayer un document non enregistré avec les mocks déterministes ; `mode: "live"` est refusé |
| `run_deployed` | Exécuter réellement la version déployée et attendre jusqu'à 30 secondes ; suivre ensuite le `runId` si elle continue |
| `start_run` | Démarrer la version déployée en arrière-plan puis suivre `get_run` ; passe `idempotencyKey` pour qu’une répétition soit sûre |
| `start_run` avec `mode: "mock"` | Exécuter une version enregistrée — en service ou non — avec les mocks, avec une trace que chacun peut ouvrir dans l’historique des exécutions |

Les deux outils de version déployée utilisent le même moteur durable, avec les mêmes contrôles d'accès et traces d'exécution. `start_run` accepte un `projectId` facultatif. Une automatisation liée à des projets doit s'exécuter dans un projet où elle est installée ; une liaison unique peut être choisie automatiquement. Sans liaison, omettre le champ sélectionne le périmètre de l'organisation. Lis `projectIds` dans `list_automations` et le véritable `projectId` du résultat au lieu de deviner l'URL REST de suivi.

### Découverte {#discovery}

| Outil | Ce qu’il fait |
| --- | --- |
| `list_models` | Les modèles que tu peux utiliser, filtrés selon ton accès aux modèles : chacun avec `providerSlug` (un nœud `agent` l’enregistre comme `modelProvider`), `lane` (`direct` quand un fournisseur le sert, `subscription` ou `broker` quand c’est l’abonnement d’un membre), les `nodeTypes` qui lui conviennent (un nœud `llm` n’accepte qu’un modèle servi directement) et les environnements d’agent auxquels il est proposé (`harnesses`). `nodeType` et `harness` filtrent la liste. |
| `list_harnesses` | Les environnements d’agent qu’un nœud `agent` peut indiquer comme `harness`, celui par défaut (`default`) qui s’exécute quand il n’en indique aucun, et si un abonnement peut servir chacun. |
| `list_skills` | Les skills de l’organisation ; avec `projectId`, aussi les skills d’équipe de ce projet, ceux qu’une exécution dans ce projet peut utiliser. Un projet que tu ne peux pas lire répond `PROJECT_NOT_FOUND`. |
| `list_connectors` | Les connectors que ce déploiement propose, si ton organisation a connecté chacun (`connected`) et combien d’actions il compte ; `query` filtre. `search_catalog` liste les actions. |
| `list_agent_secrets` | Les noms des secrets d’agent de l’organisation avec un aperçu masqué (`preview`), jamais une valeur. Les rôles Propriétaire, Admin et Développeur les voient ; les autres reçoivent une liste vide avec une explication (`note`). |
| `list_projects` | Les projets que tu peux lire : si chacun est modifiable (`writable`) ou archivé (`archived`), et les automatisations installées que tu peux voir (`automations`). `query` filtre par nom ; `includeArchived` ajoute les projets archivés. |
| `list_events` | Les événements que Tale émet, chacun avec le moment où il se produit : ce qu’un déclencheur d’événement peut attendre. |

Chaque réponse porte un `hint` qui nomme l’outil ou le paramètre qui la fait changer.

### Capacités & connaissances {#capabilities}

| Outil                 | Ce qu'il fait                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_capabilities` | Rechercher les automatisations déployées de l'organisation par nom et description. |
| `invoke_capability` | Appeler une capacité par son `id` : une automatisation déployée, exécutée en réel comme avec `run_deployed`. Si l’organisation soumet une étape à approbation, l’exécution attend qu’une personne décide dans Tale. |
| `get_knowledge` | Récupérer des passages des documents et sites web explorés de l'organisation. `corpus` vaut `private` (documents), `public-web` (pages explorées) ou `all` ; les orthographes REST `documents` et `web` sont acceptées aussi. `query` est plafonné à 2000 caractères. Chaque passage porte `text`, `source` (un titre), `ref`, `corpus`, `chunkIndex`, `score`, `similarity` quand la recherche dense l’a classé, `url` pour une page web et — pour un document — le `documentId` qu’attend `GET /api/v1/documents/{id}` (l’id du fichier pour un résultat de projet) ainsi que son `projectId` : la même citation que renvoie la recherche REST. |

Le registre de capacités contient actuellement les automatisations déployées. Il n'inclut ni outils intégrés, ni actions de connectors, ni skills, ni serveurs MCP externes. Appeler une automatisation déployée correspond à la même opération réelle que `run_deployed` et attend de la même façon jusqu’à 30 secondes la fin de l’exécution. Si une étape demande une [approbation](/fr/platform/approvals/concepts), l’exécution attend qu’une personne décide dans Tale : l’`output` de la réponse est l’exécution avec `status: "waiting"`, et `get_run` indique `waitingFor: "approval"`. Aucun outil ne l’approuve ni ne la rejette ; ton client doit donc prévenir la personne plutôt que réessayer. Arrêter l’exécution avec `cancel_run` retire l’approbation.

## Ressources et prompts {#resources-and-prompts}

En plus des outils, le point d’accès sert des ressources, qu’un client lit par leur adresse, et des prompts : des requêtes prêtes à l’emploi par lesquelles une personne commence un travail. Les deux lisent ce qu’un outil renvoie déjà, pour la même personne et avec les mêmes contrôles.

### Lire par adresse {#resources}

`resources/list` nomme d’abord les ressources fixes, puis chaque automatisation que le titulaire de la clé peut voir, 100 par page ; suis `nextCursor` pour la page suivante. `resources/templates/list` renvoie les modèles d’adresse, et `resources/read` le contenu d’une ressource.

| Adresse | Contenu | Se lit comme |
| --- | --- | --- |
| `tale://docs/authoring`, `tale://docs/triggers`, `tale://docs/validation`, `tale://docs/skill` | Les références, en Markdown | `get_docs` avec ce `topic` |
| `tale://catalog/{kind}` (`transform`, `llm`, `agent`, `subautomation`, `connector`) | La section de la référence consacrée à un type de nœud de base, ou les actions des connectors | `get_catalog` avec ce `kind` |
| `tale://automations/{name}` | La dernière version enregistrée, en JSON | `get_automation` |
| `tale://automations/{name}/versions/{version}` | Une version enregistrée ; `{version}` est un numéro ou `deployed` | `get_automation` avec `version` |
| `tale://runs/{runId}` | Une exécution avec sa sortie, sa trace et ses effets | `get_run` |

Écris chaque `/` d’un nom d’automatisation sous la forme `%2F` : `tale://automations/billing%2Fdunning`. Une adresse qui ne trouve rien renvoie JSON-RPC `-32002` (`-32602` en `2026-07-28`) avec le code du refus dans `data.code`, par exemple `AUTOMATION_NOT_FOUND`. Une automatisation que le titulaire de la clé ne peut pas voir renvoie la même erreur qu’une automatisation qui n’existe pas. Une adresse mal formée, par exemple une version qui n’est pas un nombre, renvoie `-32602`.

### Partir d’un prompt {#prompts}

`prompts/list` nomme trois prompts, et `prompts/get` renvoie le message avec, en pièce jointe sous forme de ressource, ce dont il traite. Claude Code les affiche sous la forme `/tale:edit_automation`, et ainsi de suite.

| Prompt | Arguments | Ce qu’il demande à l’agent |
| --- | --- | --- |
| `edit_automation` | `name` (facultatif) | Modifier l’automatisation ou en créer une, la valider, la tester sur les simulations et l’enregistrer avec `baseVersion` ; il ne met rien en service |
| `debug_failed_run` | `runId` | Expliquer pourquoi l’exécution a échoué, reproduire l’échec sur les simulations et proposer la plus petite correction |
| `add_trigger` | `name`, `kind` (facultatif : `schedule`, `webhook` ou `event`) | Choisir ce qui lance l’automatisation, et demander avant d’appeler `set_trigger` |

Chaque argument est un seul mot, car des clients comme Claude Code séparent les arguments aux espaces. Un argument envoyé vide compte comme omis. Un prompt dont l’exécution ou l’automatisation n’est pas lisible par le titulaire de la clé renvoie `-32602` avec le code de cette lecture.

## Ce que la clé peut faire

| Opération | Accès nécessaire |
| --- | --- |
| Lectures, validation, simulations (y compris `start_run` avec `mode: "mock"`) et tests d'acceptation, recherche de capacités, récupération de connaissances | Appartenance à l'organisation, puis règles habituelles de la ressource |
| Répondre à la question d’une exécution | Appartenance à l’organisation ; pour une exécution dans un projet, droit de modifier ce projet |
| Noms des secrets d’agent (`list_agent_secrets`) | Rôle Propriétaire, Admin ou Développeur ; les autres reçoivent une liste vide |
| Enregistrer, déployer, supprimer, installer dans des projets, définir/supprimer un déclencheur, annuler ou exécuter réellement | Capacité développeur, puis règles habituelles de la ressource |

La clé identifie son titulaire ; elle n'élargit ni son rôle ni son accès aux projets. Une automatisation installée uniquement dans des projets que le titulaire de la clé ne peut pas lire n’apparaît pas dans `list_automations`, et toute lecture de celle-ci répond `AUTOMATION_NOT_FOUND`, comme pour une automatisation qui n’existe pas. Les appels réels via `invoke_capability` passent aussi par les contrôles d'exécution.

Chaque modification qu’un appel MCP apporte à une automatisation — une version enregistrée, une mise en service, une suppression, un déclencheur défini ou retiré, une installation ajoutée ou retirée — figure dans le journal d’audit de l’organisation, marquée comme venue par MCP, avec l’outil et la clé API. Dans le détail de l’événement, **Source** affiche Agent de code, et **Client** nomme l’application de l’agent quand elle se nomme à chaque appel, comme en révision 2026-07-28 ; une application en révision 2025 ne se nomme qu’à `initialize`, et ses événements n’affichent donc pas de **Client** ([Journaux d’audit](/fr/platform/admin/governance/audit-logs)).

Avant de configurer des outils privilégiés, lis `GET /api/v1/me` : `capabilities.developer` indique le droit lié au rôle actuel. `deploymentEditor` correspond à une liste opérateur distincte et n’autorise pas la création par MCP. Les erreurs d’outils gardent le format MCP décrit ci-dessous ; la lecture d’une capacité REST ne change pas leur traitement JSON-RPC.

### Distinguer une erreur de protocole d'un refus d'outil

| Résultat | Traitement |
| --- | --- |
| JSON-RPC `-32601` | Corriger la méthode inconnue ; en `2026-07-28`, l’erreur arrive avec HTTP `404`, y compris pour `initialize` et `ping` |
| JSON-RPC `-32602` | Corriger le nom de l'outil à partir de `tools/list`, le nom ou les arguments d’un prompt à partir de `prompts/list`, ou une adresse de ressource. Avec HTTP `400`, compléter le `_meta` de `2026-07-28` avec les entrées de `data.missing` ou `data.malformed` |
| JSON-RPC `-32002` | L’adresse de ressource ne trouve rien ; `data.code` nomme le refus, par exemple `AUTOMATION_NOT_FOUND`. En `2026-07-28`, la même réponse porte le code `-32602` |
| JSON-RPC `-32020` (HTTP `400`) | Les en-têtes d’une requête `2026-07-28` ne reprennent pas son corps ; envoyer `MCP-Protocol-Version`, `Mcp-Method` et `Mcp-Name` comme décrit dans [Révisions du protocole](#protocol-revisions) |
| JSON-RPC `-32022` (HTTP `400`) | Envoyer une des révisions de `data.supported` : dans `MCP-Protocol-Version` et, en `2026-07-28`, aussi dans `_meta`. Une révision de 2025 s’ouvre avec `initialize` |
| Résultat avec `isError: true` | Lire le `code` stable, l'`error` explicative et le `hint` dans le texte ; `data` peut détailler les champs invalides |
| `validate_automation` avec `valid: false` | Verdict normal de validation ; examiner `errors` et leurs emplacements ([Lire un résultat de validation](#validation-result)), même si `isError` reste false. Les avertissements ne rendent jamais un document invalide |
| Capacité dont l’`output` porte `status: "waiting"` | L’exécution attend, par exemple une approbation qu’une personne donne dans Tale ; elle n’est ni terminée ni en échec. Interroger `get_run`, sans relancer |
| Capacité avec `refused` | Résultat d'erreur ; corriger la cause indiquée |

Les codes de refus comprennent `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_UNKNOWN`, `AUTOMATION_NOT_DEPLOYED`, `RUN_NOT_FOUND`, `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`, `AUTOMATION_VERSION_STALE`, `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_NAME_TAKEN`, `AUTOMATION_HAS_ACTIVE_RUNS`, `AUTOMATION_NOT_INSTALLED`, `HUMAN_ASK_NOT_FOUND`, `HUMAN_ASK_NOT_PENDING`, `HUMAN_ASK_EXPIRED`, `EMPTY_ANSWER`, `INVALID_CURSOR`, `LIVE_MODE_UNAVAILABLE` et `NOT_SUPPORTED`. Ce dernier indique que l'hôte ne prend pas en charge l'opération sur les exécutions, versions ou déclencheurs. `start_run` refuse un `idempotencyKey` réutilisé avec d’autres arguments par `IDEMPOTENCY_KEY_REUSED` ; `invoke_capability` refuse un id que le registre ne tient pas — une automatisation seulement enregistrée n’y est pas — par `CAPABILITY_NOT_FOUND` et une entrée que son schéma rejette par `CAPABILITY_INPUT_INVALID` ; `get_knowledge` transmet les codes propres de la porte des connaissances (`KNOWLEDGE_UNAVAILABLE` quand la recherche elle-même a échoué). Les erreurs de plateforme conservent leur code, leur conseil et leurs données éventuelles ; par exemple, l'absence d'accès développeur renvoie `FORBIDDEN_DEVELOPER_SETTINGS`. `INVALID_ARGUMENTS` liste chaque problème d’argument ; une valeur hors d’un ensemble énuméré est refusée et le message nomme l’ensemble. `RATE_LIMITED` signifie que l’outil avait besoin d’une exécution et que le [budget d’exécution](/fr/develop/rate-limits) du détenteur de la clé est épuisé : attends `data.retryAfterMs`. `INTERNAL_ERROR` signifie que l’appel a échoué de façon inattendue ; communique son `data.requestId` à l’équipe qui exploite le déploiement.

Un nom d'automatisation inconnu est aussi une erreur pour `list_versions`, `list_runs` et `list_triggers`. Une liste vide signifie qu'une automatisation existante n'a pas d'éléments correspondants. La seule exception est l’historique des exécutions : une automatisation supprimée conserve ses exécutions, `list_runs {name}` les renvoie donc tant qu’elles existent, et seul un nom qui n’a jamais tourné donne `AUTOMATION_NOT_FOUND`. `get_catalog` restreint à un type de nœud de base (`transform`, `llm`, `agent`, `subautomation`) répond une liste vide accompagnée d’un `hint` renvoyant à `get_docs`, comme le fait `search_catalog`, et de la section de la référence consacrée à ce type de nœud sous `reference`. Un document invalide soumis à un outil qui exige un document valide, une recherche échouée ou un déploiement absent produisent `isError: true`. Seul l'outil de validation présente un document invalide comme son verdict normal.

## Où ça se place

REST et MCP partagent les clés, le périmètre d'organisation et les objets d'exécution durables. Choisis REST pour des routes HTTP explicites, et MCP pour un client capable de découvrir et d'appeler des outils. Tale n'enregistre ni n'appelle de serveurs MCP externes par ce point d'accès.
