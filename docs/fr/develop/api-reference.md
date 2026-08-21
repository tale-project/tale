---
title: Référence API
description: Comment appeler Tale de l'extérieur — authentification, inventaire des endpoints, pagination, les boucles asynchrones d'exécution et de tour, et le modèle d'erreur. La seule source de vérité pour la surface REST.
i18nLintExclude:
  - terminology-loanword
---

L'API de Tale est la surface des intégrateurs qui se tiennent hors du produit et veulent le scripter : ressources de connaissances, projets avec leurs fichiers et leurs tâches, automatisations et leurs exécutions, threads de chat, agents et skills — le tout en JSON sur HTTPS, avec une clé API dans un header. La même clé ouvre aussi l'[endpoint MCP](/fr/develop/mcp-endpoint) — cette page couvre la moitié REST.

Cette page est l'inventaire canonique de la surface, du modèle d'authentification et de la forme d'erreur. Les schémas de requête et de réponse champ par champ vivent dans le document OpenAPI que ton instance sert sous `/docs` — charge-le quand il te faut chaque propriété ; lis cette page pour comprendre comment l'API se comporte.

## Une première requête

La requête utile la plus courte — lister les automatisations de l'organisation — tient dans un curl :

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Une réponse réussie est une page : `{ "page": [ { "name": "billing/dunning", "latest": 3, "deployedVersion": 2 } ], "isDone": true, "continueCursor": null }`. Chaque endpoint de liste répond avec cette même enveloppe — renvoie `continueCursor` en `?cursor=` pour la page suivante, et borne la taille avec `?limit=`. La seule exception est l'accès machine sous Projets : ses listes répondent plus léger — sa section montre les formes.

## Authentification

Les clés API se créent dans le produit par toute personne avec les permissions Admin ou Développeur — [Clés API](/fr/platform/admin/api-keys) décrit le panneau. Une clé s'affiche une seule fois à la création, jamais ensuite ; elle appartient à la personne qui l'a créée — chaque appel agit comme cette personne.

Passe la clé en bearer token : `Authorization: Bearer <key>`. L'organisation se résout à chaque requête depuis les appartenances de l'utilisateur de la clé — une clé atteint exactement les organisations dont son utilisateur est membre, rien d'autre. Un header `X-Organization-Slug` explicite gagne toujours et est vérifié contre l'appartenance : un slug dont l'utilisateur n'est pas membre est refusé. Sans le header, un utilisateur d'une seule organisation atterrit dans celle-là ; un utilisateur de plusieurs suit l'organisation active en dernier dans le dashboard — sauf sur les routes Projets et Tâches, qui ne devinent jamais : là, une clé multi-organisations doit envoyer le header, et une requête sans lui répond **400**. Ce que la clé _peut faire_ suit le rôle de son détenteur : lire et lancer en mock demandent l'appartenance ; démarrer du travail live et modifier ce qui est déployé demande la capacité développeur. Les sections ci-dessous le précisent là où ça compte.

## Groupes d'endpoints

| Groupe                     | Chemin                                  | Ce qu'il couvre                                                                                                                                              |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatisations            | `/api/v1/automations/...`               | Lister, lire les versions, démarrer des exécutions, lire l'historique, lier et délier les déclencheurs.                                                      |
| Exécutions                 | `/api/v1/runs/{runId}`                  | Une exécution durable en entier — statut, sortie, trace, effets — plus `POST .../cancel`.                                                                    |
| Threads                    | `/api/v1/threads/...`                   | Les threads de chat du détenteur de la clé : créer, lire les messages, envoyer, suivre le tour.                                                              |
| Agents                     | `/api/v1/agents/...`                    | Lister, lire, créer ou remplacer, supprimer les agents de l'organisation.                                                                                    |
| Skills                     | `/api/v1/skills/...`                    | La même forme que les agents, pour les skills.                                                                                                               |
| Entrées de connaissances   | `/api/v1/knowledge-entries/...`         | Des faits par sujet : lister, créer, remplacer, supprimer.                                                                                                   |
| Recherche de connaissances | `POST /api/v1/knowledge/search`         | Recherche sémantique sur les connaissances indexées de l'organisation.                                                                                       |
| Documents                  | `/api/v1/documents/...`                 | Les documents de la base de connaissances : CRUD plus `POST .../retry-indexing`. Les fichiers de projet n'apparaissent jamais ici — ils vivent sous Projets. |
| Sites web                  | `/api/v1/websites/...`                  | Les sources crawlées : CRUD plus `.../pages`, `.../sync`, `.../search`.                                                                                      |
| Produits                   | `/api/v1/products/...`                  | Les entrées du catalogue produit : CRUD.                                                                                                                     |
| Contacts                   | `/api/v1/contacts/...`                  | Les fiches contact : CRUD plus `POST /api/v1/contacts/bulk`.                                                                                                 |
| Projets                    | `/api/v1/projects/...`                  | L'accès machine des workers externes : chercher par id externe, créer, préparer les dossiers, charger des fichiers.                                          |
| Tâches                     | `/api/v1/tasks/...`                     | Création idempotente depuis une référence externe, lecture d'état, démarrage de workflow, commentaires.                                                      |
| MCP                        | `POST /api/v1/mcp`                      | L'[endpoint MCP](/fr/develop/mcp-endpoint) — même clé, JSON-RPC au lieu de REST.                                                                             |
| Déclencheur webhook        | `POST /api/automations/webhook/<token>` | Démarrer une automatisation déployée de l'extérieur ; la [page Webhooks](/fr/develop/webhooks).                                                              |

## Les noms d'automatisation dans les URL

Le nom d'une automatisation est un chemin en `/` — `billing/dunning` — et un chemin ne tient pas dans un seul segment d'URL. Dans chaque URL `/api/v1/automations/{name}/...`, écris le nom avec `__` à la place de chaque `/` :

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Les réponses portent toujours le vrai nom (`"name": "billing/dunning"`) ; la forme `__` n'existe que dans les URL. Les slugs d'agents et de skills sont plats et ne s'encodent pas.

## Démarrer une exécution, puis la suivre

Une exécution est durable et peut prendre des minutes — le démarrage répond donc **202** avec l'identité de l'exécution, pas son résultat :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Interroge `GET /api/v1/runs/{runId}` jusqu'à ce que `status` quitte `queued`/`running`/`waiting` ; l'exécution terminée porte `output`, la `trace` nœud par nœud et les `effects` produits. `POST /api/v1/runs/{runId}/cancel` arrête une exécution à sa prochaine frontière de nœud — ce qu'un nœud a déjà fait n'est pas défait.

`mode` vaut `live` par défaut. Une exécution live agit au nom de l'organisation, elle exige donc une clé dont le détenteur a la capacité développeur ; `{"mode": "mock"}` tourne contre des mocks déterministes et ne demande que l'appartenance. Démarrer ne demande aucun déclencheur — la clé API est le droit d'entrée. Une automatisation sans version déployée répond **409** ; déploie une version dont les tests passent et le même appel passe.

`projectId` nomme le projet dans lequel l’exécution opère — le projet sur lequel agissent ses outils de tâches et de documents. Omets-le et l’exécution porte sur toute l’organisation, sauf qu’une automatisation liée à un seul projet s’exécute dans celui-là automatiquement ; une automatisation liée à plusieurs n’accepte qu’un `projectId` parmi eux, et refuse tout autre.

## Envoyer un message, puis suivre le tour

Le chat suit la même forme 202-puis-suivi. Crée un thread, poste un message, interroge la génération, puis lis les messages :

```bash
# 1. Un thread à toi
curl -sS -X POST "https://your-host.example.com/api/v1/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Envoyer un message — sur cette API le modèle est toujours explicite, jamais choisi pour toi
curl -sS -X POST "https://your-host.example.com/api/v1/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Résume-moi ce trimestre.", "model": "<un modèle configuré dans ton organisation>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/threads/<threadId>/generation" }

# 3. Interroger jusqu'à idle, puis lire
curl -sS "https://your-host.example.com/api/v1/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY"
# → 200 { "status": "streaming" } … puis { "status": "idle" }
```

`{"status": "idle"}` signifie qu'aucun tour ne tourne — lis `GET /api/v1/threads/{id}/messages` pour la réponse. Un tour qui échoue avant toute sortie reste visible : l'erreur atterrit comme message d'assistant, jamais en silence. Les threads listés et lus par l'API sont ceux du détenteur de la clé ; les threads d'un autre utilisateur restent invisibles pour ta clé, même dans la même organisation.

## Refléter un système externe dans un projet

Le groupe Projets est fait pour un worker sans surveillance qui reflète un système externe — un CRM, un logiciel de cabinet — dans Tale : trouver ou créer le projet du client, préparer ses dossiers, charger des fichiers, vérifier. Chaque appel agit comme l'utilisateur qui a créé la clé : un projet que cet utilisateur ne voit pas répond comme un projet qui n'existe pas, et écrire demande un rôle qui édite (Éditeur ou au-dessus — Membre ne fait que lire ici) plus l'accès en édition au projet.

Ces routes — et les routes Tâches plus bas — ne devinent jamais l'organisation : une clé dont l'utilisateur appartient à plusieurs organisations doit envoyer `X-Organization-Slug` à chaque appel — une requête sans le header répond **400**. Crée les clés machine pour un utilisateur dédié avec une seule appartenance, et la question ne se pose plus ; les exemples gardent le header quand même — il est toujours vérifié contre l'appartenance, jamais ignoré.

### Trouver ou créer le projet

`externalItemId` est ta clé, pas celle de Tale — une chaîne opaque (l'id d'enregistrement de ton CRM), unique par organisation, jamais interprétée par la plateforme. Cherche-la d'abord ; la recherche répond au plus un projet, et une correspondance que l'utilisateur de la clé ne peut pas voir ressemble exactement à aucune :

```bash
curl -sS "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — ou [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

Une correspondance porte `archivedAt` quand le projet est archivé — décide avant coup ce que ton worker fait de ce cas. Une liste vide veut dire créer :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (le préfixe des identifiants de tâches) et `description` sont optionnels — le key se dérive du nom quand tu l'omets. Une seconde création avec le même `externalItemId` répond **409** ; la même chaîne dans une autre organisation passe, l'unicité vaut par organisation.

### Créer les dossiers

La création de dossier est un get-or-create : le même nom sous le même parent répond le dossier existant avec `created: false` (**200**) au lieu d'un doublon — un worker rejoue son étape de préparation à l'aveugle après un crash. Les noms de dossiers n'ont aucun sens réservé côté plateforme — l'agencement t'appartient :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (un dossier de ce projet) imbrique plus profond ; omets-le pour un dossier racine. `GET .../folders` liste les dossiers racine.

### Charger un fichier en deux étapes

Un chargement est un handoff, puis une liaison. Demande d'abord le handoff — il répond où vont les octets :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/uploads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "application/pdf" }'
# → 200 { "uploadId": "...", "url": "https://...", "method": "POST", "expiresAt": 1774... }
```

`method` nomme la voie de stockage que tu as reçue. `POST` vise le stockage de la plateforme : envoie les octets à `url` avec cette méthode, et la réponse porte `{"storageId": "..."}` — c'est ton `fileId`. `PUT` est une URL présignée pour le bucket propre de l'organisation : envoie les octets, puis lie la `s3Ref` du handoff comme `fileId`. Dans les deux cas, la liaison termine le chargement :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<storageId ou s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

Le `uploadId` sert une seule fois et expire après 60 minutes — un worker qui a crashé en plein chargement demande un handoff frais au lieu de rejouer l'ancien. La politique de chargement s'applique à la liaison : un blob trop gros répond **413**, un type hors de la liste autorisée **415**.

Les fichiers qui passent par cet accès sont du matériel de travail du projet, pas des connaissances de l'organisation : ils sautent l'indexation des connaissances par défaut (`skipRagIndexing` vaut `true` par défaut à la liaison ; envoie `false` pour les indexer), et ils n'apparaissent jamais sous `/api/v1/documents` — cette famille reste la surface de la base de connaissances.

### Vérifier ce qui est arrivé

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "createdAt": 1774... } ] }
```

La liste répond `{files, cursor?}` : un `cursor` dans la réponse veut dire d'autres pages — renvoie-le en `?cursor=`, borne la page avec `?limit=` (100 au plus).

## Créer une tâche, puis l'exécuter

Le groupe Tâches ferme la boucle : le worker transforme un élément externe en tâche sur le board du projet, y démarre un workflow déployé et rend compte. Un prérequis quand l'automatisation est liée à des projets : ses liaisons décident où elle a le droit de tourner — un projet fraîchement créé doit donc être lié une fois. C'est aussi un appel d'API, idempotent (**201** à la première liaison, **200** si elle existe déjà), et il exige la capacité Developer — la même barrière que le panneau de liaisons du dashboard. Crée la clé du worker pour un utilisateur qui a cette capacité, ou lie en amont :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/automations/vat-return/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>" }'
# → 201 { "name": "vat-return", "added": true }
```

Une automatisation sans aucune liaison est à l'échelle de l'organisation et n'a besoin de rien de tout ça — chaque projet la voit. Délier reste une opération du dashboard.

La création d'une tâche est idempotente par `(projectId, externalSystem, externalId)` — le premier appel crée (**201**, `created: true`), chaque répétition répond la même tâche (**200**, `created: false`) — un worker qui a crashé après son POST rejoue donc sans risque. `projectId` est requis ; cet accès ne retombe jamais sur un défaut à l'échelle de l'organisation.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<projectId>", "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

`description`, `labels` et `externalUrl` sont optionnels. Envoie `automationSlug` quand la tâche appartient à une automatisation : elle devient l'assignee, et c'est là-dessus que s'appuie le panneau de travail du dialogue de tâche — le bouton Start, la progression de l'exécution et les questions qu'une exécution pose à l'opérateur (un re-pick ultérieur comble une attribution manquante, mais n'écrase jamais un assignee). `runWorkflowSlug` planifie dans le même appel un workflow déployé sur une tâche fraîchement créée — la réponse porte alors `executionId: null` (planifié, pas encore d'identité d'exécution) ; pour un id d'exécution à suivre, démarre explicitement :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

L'entrée de l'exécution est la tâche elle-même — démarrer demande donc l'appartenance et la visibilité de la tâche, pas la capacité développeur : l'acte privilégié était le déploiement du workflow, et le journal d'exécution attribue le démarrage à ta clé. Suis l'exécution au familier `GET /api/v1/runs/{runId}`. `started: false` porte un `reason` : `already_running` répond l'`executionId` de l'exécution en cours au lieu de risquer un doublon — suis celle-là ; `not_started` veut dire que le slug ne nomme aucune automatisation déployée.

Rends compte et lis l'état — le commentaire est posté comme l'utilisateur qui a créé la clé, indiscernable de la même personne dans l'app, @mentions comprises :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

Et récupère les résultats. Ce que l'automatisation a rapporté se trouve dans la discussion de la tâche ; ce qu'elle a déposé arrive comme fichiers dans le dossier du trimestre — les deux se lisent par le même accès. L'endpoint de contenu streame directement un blob stocké dans Convex ; sur une organisation avec son propre stockage objet, il répond **302** vers une URL présignée de courte durée, donc suis les redirections :

```bash
curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "…", ... } ] }

curl -sSL "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -o report.md
# → les octets du fichier (Content-Disposition porte le nom du fichier)
```

## Modèle d'erreur

Chaque réponse non-2xx porte une enveloppe plate :

```json
{ "error": "Automation not found" }
```

Branche sur le statut HTTP ; le message est pour les humains :

- **400** — requête mal formée : champ requis manquant, mauvais type, corps illisible — ou une clé multi-organisations sans `X-Organization-Slug` sur les routes Projets et Tâches.
- **401** — clé API absente ou invalide.
- **403** — la clé est valide mais le rôle de son détenteur n'a pas la capacité (exécutions live, écriture de déclencheurs, annulation).
- **404** — la ressource n'existe pas dans ton organisation, appartient au thread de quelqu'un d'autre — ou est un projet ou une tâche que l'utilisateur de la clé ne peut pas voir : impossible à distinguer, à dessein, d'une ressource qui n'existe pas.
- **409** — l'état refuse l'action : pas de version déployée, un sujet, un e-mail ou un `externalItemId` en double (unique par organisation — la même chaîne dans une autre organisation passe), un tour déjà en cours.
- **413** — le corps est trop gros (le déclencheur webhook plafonne à 256 Ko), ou un fichier chargé dépasse le plafond de taille.
- **415** — le type d'un fichier chargé sort de la liste autorisée.
- **429** — limite de débit atteinte, avec `Retry-After` en secondes entières ; voir [Limites de débit](/fr/develop/rate-limits).
- **500** — erreur interne.

Deux sémantiques de suppression existent, à dessein. Délier le déclencheur d'une automatisation (`DELETE .../triggers`) répond **204**, qu'un déclencheur ait existé ou non — un « fais que ce soit ainsi » idempotent. Supprimer une ressource (`DELETE /api/v1/agents/{slug}`) répond **404** quand rien n'existait — tu as demandé de retirer une chose absente.

## Versionnage

L'API est versionnée par le préfixe d'URL — aujourd'hui `/api/v1/` — et y évolue par ajout : de nouveaux endpoints et de nouveaux champs optionnels arrivent, les formes existantes restent. Un changement cassant sortirait sous un nouveau préfixe. Le document OpenAPI sous `/docs` décrit toujours l'instance qui tourne.

## Où ça se place

Cette page est la moitié REST de la surface externe. L'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme aux clients MCP — l'écriture d'automatisations vit là-bas, pas dans REST. La [page Webhooks](/fr/develop/webhooks) couvre le déclencheur entrant qui démarre des exécutions sans clé. Si tu construis dans le produit — agents, automatisations, outils maison — l'onglet [Platform](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
