---
title: Référence API
description: Comment appeler Tale de l'extérieur — authentification, inventaire des endpoints, pagination, les boucles asynchrones d'exécution et de tour, et le modèle d'erreur. La seule source de vérité pour la surface REST.
i18nLintExclude:
  - terminology-loanword
---

L'API de Tale est la surface des intégrateurs qui se tiennent hors du produit et veulent le scripter : ressources de connaissances, automatisations et leurs exécutions, threads de chat, agents et skills — le tout en JSON sur HTTPS, avec une clé API dans un header. La même clé ouvre aussi l'[endpoint MCP](/fr/develop/mcp-endpoint) — cette page couvre la moitié REST.

Cette page est l'inventaire canonique de la surface, du modèle d'authentification et de la forme d'erreur. Les schémas de requête et de réponse champ par champ vivent dans le document OpenAPI que ton instance sert sous `/docs` — charge-le quand il te faut chaque propriété ; lis cette page pour comprendre comment l'API se comporte.

## Une première requête

La requête utile la plus courte — lister les automatisations de l'organisation — tient dans un curl :

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Une réponse réussie est une page : `{ "page": [ { "name": "billing/dunning", "latest": 3, "deployedVersion": 2 } ], "isDone": true, "continueCursor": null }`. Chaque endpoint de liste répond avec cette même enveloppe — renvoie `continueCursor` en `?cursor=` pour la page suivante, et borne la taille avec `?limit=`.

## Authentification

Les clés API se créent dans le produit par toute personne avec les permissions Admin ou Développeur — [Clés API](/fr/platform/admin/api-keys) décrit le panneau. Une clé s'affiche une seule fois à la création, jamais ensuite ; elle appartient à la personne qui l'a créée et à son organisation.

Passe la clé en bearer token : `Authorization: Bearer <key>`. Le contexte d'organisation vient de la clé — inutilisable hors de son organisation, et tout ce qu'elle touche y reste. Ce que la clé _peut faire_ suit le rôle de son détenteur : lire et lancer en mock demandent l'appartenance ; démarrer du travail live et modifier ce qui est déployé demande la capacité développeur. Les sections ci-dessous le précisent là où ça compte.

## Groupes d'endpoints

| Groupe                     | Chemin                                  | Ce qu'il couvre                                                                                         |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Automatisations            | `/api/v1/automations/...`               | Lister, lire les versions, démarrer des exécutions, lire l'historique, lier et délier les déclencheurs. |
| Exécutions                 | `/api/v1/runs/{runId}`                  | Une exécution durable en entier — statut, sortie, trace, effets — plus `POST .../cancel`.               |
| Threads                    | `/api/v1/threads/...`                   | Les threads de chat du détenteur de la clé : créer, lire les messages, envoyer, suivre le tour.         |
| Agents                     | `/api/v1/agents/...`                    | Lister, lire, créer ou remplacer, supprimer les agents de l'organisation.                               |
| Skills                     | `/api/v1/skills/...`                    | La même forme que les agents, pour les skills.                                                          |
| Entrées de connaissances   | `/api/v1/knowledge-entries/...`         | Des faits par sujet : lister, créer, remplacer, supprimer.                                              |
| Recherche de connaissances | `POST /api/v1/knowledge/search`         | Recherche sémantique sur les connaissances indexées de l'organisation.                                  |
| Documents                  | `/api/v1/documents/...`                 | Les documents de la base de connaissances : CRUD plus `POST .../retry-indexing`.                        |
| Sites web                  | `/api/v1/websites/...`                  | Les sources crawlées : CRUD plus `.../pages`, `.../sync`, `.../search`.                                 |
| Produits                   | `/api/v1/products/...`                  | Les entrées du catalogue produit : CRUD.                                                                |
| Contacts                   | `/api/v1/contacts/...`                  | Les fiches contact : CRUD plus `POST /api/v1/contacts/bulk`.                                            |
| MCP                        | `POST /api/v1/mcp`                      | L'[endpoint MCP](/fr/develop/mcp-endpoint) — même clé, JSON-RPC au lieu de REST.                        |
| Déclencheur webhook        | `POST /api/automations/webhook/<token>` | Démarrer une automatisation déployée de l'extérieur ; la [page Webhooks](/fr/develop/webhooks).         |

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

# 2. Envoyer un message — le modèle est toujours explicite, jamais choisi pour toi
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

## Modèle d'erreur

Chaque réponse non-2xx porte une enveloppe plate :

```json
{ "error": "Automation not found" }
```

Branche sur le statut HTTP ; le message est pour les humains :

- **400** — requête mal formée : champ requis manquant, mauvais type, corps illisible.
- **401** — clé API absente ou invalide.
- **403** — la clé est valide mais le rôle de son détenteur n'a pas la capacité (exécutions live, écriture de déclencheurs, annulation).
- **404** — la ressource n'existe pas dans ton organisation, ou appartient au thread de quelqu'un d'autre.
- **409** — l'état refuse l'action : pas de version déployée, un sujet ou un e-mail en double, un tour déjà en cours.
- **413** — le corps est trop gros (le déclencheur webhook plafonne à 256 Ko).
- **429** — limite de débit atteinte ; voir [Limites de débit](/fr/develop/rate-limits).
- **500** — erreur interne.

Deux sémantiques de suppression existent, à dessein. Délier le déclencheur d'une automatisation (`DELETE .../triggers`) répond **204**, qu'un déclencheur ait existé ou non — un « fais que ce soit ainsi » idempotent. Supprimer une ressource (`DELETE /api/v1/agents/{slug}`) répond **404** quand rien n'existait — tu as demandé de retirer une chose absente.

## Versionnage

L'API est versionnée par le préfixe d'URL — aujourd'hui `/api/v1/` — et y évolue par ajout : de nouveaux endpoints et de nouveaux champs optionnels arrivent, les formes existantes restent. Un changement cassant sortirait sous un nouveau préfixe. Le document OpenAPI sous `/docs` décrit toujours l'instance qui tourne.

## Où ça se place

Cette page est la moitié REST de la surface externe. L'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme aux clients MCP — l'écriture d'automatisations vit là-bas, pas dans REST. La [page Webhooks](/fr/develop/webhooks) couvre le déclencheur entrant qui démarre des exécutions sans clé. Si tu construis dans le produit — agents, automatisations, outils maison — l'onglet [Platform](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
