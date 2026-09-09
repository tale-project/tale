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

Une réponse réussie est une liste nommée : `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. La forme des listes varie selon la famille : la plupart répondent avec un tableau nommé comme celui-ci, tandis que les ressources de connaissances et de chat — contacts, produits, documents, entrées de connaissances, threads, sites web — répondent avec une enveloppe `{ "page": [...], "isDone": ..., "continueCursor": ... }`. Là où une enveloppe pagine, renvoie `continueCursor` en `?cursor=` et borne la page avec `?limit=` : les contacts, produits, documents, entrées de connaissances, threads et sites web paginent tous ainsi jusqu'à la dernière page (`isDone: true` avec un `continueCursor` vide). La liste des runs d'une automation est plutôt une fenêtre bornée — `?limit=` (1..200, 50 par défaut) fixe combien des runs les plus récents tu reçois. L'accès machine sous Projets voyage encore plus léger — sa section montre ces formes.

## Authentification

Les clés API se créent dans le produit par toute personne avec les permissions Admin ou Développeur — [Clés API](/fr/platform/admin/api-keys) décrit le panneau. Une clé s'affiche une seule fois à la création, jamais ensuite ; elle appartient à la personne qui l'a créée — chaque appel agit comme cette personne.

Passe la clé en bearer token : `Authorization: Bearer <key>`. L'organisation se résout à chaque requête depuis les appartenances de l'utilisateur de la clé — une clé atteint exactement les organisations dont son utilisateur est membre, rien d'autre. Un header `X-Organization-Slug` explicite gagne toujours et est vérifié contre l'appartenance : un slug dont l'utilisateur n'est pas membre est refusé. Sans le header, un utilisateur d'une seule organisation atterrit dans celle-là. Un utilisateur de plusieurs suit l'organisation active en dernier dans le dashboard seulement en lecture — toute écriture (`POST`/`PATCH`/`PUT`/`DELETE`) et tout appel sur les routes Projets et Tâches doivent nommer l'organisation, et une requête multi-organisations sans le header répond **400**. Ce que la clé _peut faire_ suit le rôle de son détenteur : lire et lancer en mock demandent l'appartenance ; démarrer du travail live et modifier ce qui est déployé demande la capacité développeur. Les sections ci-dessous le précisent là où ça compte.

## Se connecter à une application avec Tale

Tale est aussi un émetteur OpenID Connect. Une application enregistrée te fait passer par la connexion native de Tale et le consentement. Elle reçoit une identité signée avec une adresse e-mail vérifiée et l'appartenance à la seule organisation liée à son client. Une clé API ne remplace pas une connexion personnelle dans ce parcours.

Enregistre l'application avec une session Owner ou Admin active dont l'organisation sélectionnée correspond à `TALE_ORG_ID`. `TALE_ORIGIN` désigne l'origine de ton instance Tale et `TALE_SESSION_COOKIE` l'en-tête Cookie de cette session. Utilise l'URL de rappel HTTPS exacte de l'application ; HTTP est accepté uniquement sur la boucle locale pour le développement :

```bash
curl -sS -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

La première réponse est **201** avec `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Conserve le secret dans l'environnement secret de l'application. Le même identifiant avec une configuration inchangée renvoie **200**, `created: false` et le même identifiant client, sans le secret. Un rappel ou une politique modifiés donnent **409** : relancer la commande ne peut donc pas détourner silencieusement une intégration existante.

| Usage | Endpoint ou exigence |
| --- | --- |
| Émetteur | `https://your-host.example.com/api/auth` |
| Découverte | `GET /api/auth/.well-known/openid-configuration` |
| Autorisation | `GET /api/auth/oauth2/authorize` |
| Échange du code | `POST /api/auth/oauth2/token`, `client_secret_post` |
| Clés de signature | `GET /api/auth/jwks` |
| Identité actuelle | `GET /api/auth/oauth2/userinfo`, jeton d'accès Bearer |
| Scopes demandés | `openid profile email tale:organization` |

Utilise un client OIDC maintenu avec le flux Authorization Code, S256 PKCE, un état à usage unique et un nonce. Vérifie l'émetteur, l'audience, la signature RS256, l'expiration et le nonce du jeton d'identité, puis exige `email_verified: true`. Le claim `https://tale.dev/organization` contient `{ "id", "slug", "role" }` pour l'organisation enregistrée. Tale revérifie l'appartenance actuelle et l'exigence MFA native avant d'émettre les jetons et à chaque lecture de Userinfo. L'application reste responsable de sa propre politique d'accès. Les codes expirent après 60 secondes et ne s'échangent qu'une fois ; les jetons d'accès et d'identité expirent après cinq minutes. L'enregistrement dynamique, les flux implicites et les jetons de renouvellement sont désactivés.

Les jetons d'accès servent uniquement au point de terminaison userinfo natif ; les audiences de ressources externes sont désactivées. Utilisez des clés API natives pour les requêtes REST.

Pour un identifiant client validé, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` avec `{}` renvoie une fois un nouveau `client_secret` et invalide l'ancien. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` avec `{ "disabled": true }` bloque les nouvelles autorisations ; `false` réactive le même client. Ces deux appels exigent, comme l'enregistrement, la même organisation active, une session administrateur, l'en-tête Origin et un contenu JSON. Supprimer une organisation supprime aussi ses clients et leurs consentements.

## Groupes d'endpoints

| Groupe                     | Chemin                                  | Ce qu'il couvre                                                                                                                                              |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatisations            | `/api/v1/automations/...`               | Lister, lire les versions, démarrer des exécutions, lire l'historique, lier et délier les déclencheurs.                                                      |
| Exécutions                 | `/api/v1/runs/{runId}`                  | Une exécution durable en entier — statut, sortie, trace, effets — plus `POST .../cancel`.                                                                    |
| Threads                    | `/api/v1/threads/...`                   | Les threads de chat du détenteur de la clé : créer, lire les messages, envoyer, suivre le tour.                                                              |
| Modèles | `GET /api/v1/models` | Modèles de chat configurés auxquels le détenteur de la clé a accès dans cette organisation. |
| Agents | `/api/v1/projects/{id}/agents/...` | Lister, lire, créer, modifier et supprimer les agents du projet indiqué. |
| Skills | `/api/v1/skills/...` | Lister, lire, créer ou modifier et supprimer les bundles de skills de l’organisation. |
| Entrées de connaissances   | `/api/v1/knowledge-entries/...`         | Des faits par sujet : lister, créer, remplacer, supprimer.                                                                                                   |
| Recherche de connaissances | `POST /api/v1/knowledge/search`         | Recherche sémantique sur les connaissances indexées de l'organisation.                                                                                       |
| Documents                  | `/api/v1/documents/...`                 | Les documents de la base de connaissances : CRUD plus `POST .../retry-indexing`. Les fichiers de projet n'apparaissent jamais ici — ils vivent sous Projets. |
| Sites web                  | `/api/v1/websites/...`                  | Les sources crawlées : CRUD plus `.../pages`, `.../sync`, `.../search`.                                                                                      |
| Sessions de navigateur     | `/api/v1/browser-sessions/...`          | Le pool de cookies préchauffés derrière l’[ingestion vidéo](/fr/self-hosted/configuration/video-ingestion) : liste masquée, `POST .../import` pour les opérateurs sur l’allowlist. |
| Produits                   | `/api/v1/products/...`                  | Les entrées du catalogue produit : CRUD.                                                                                                                     |
| Contacts                   | `/api/v1/contacts/...`                  | Les fiches contact : CRUD plus `POST /api/v1/contacts/bulk`.                                                                                                 |
| Conversations | `/api/v1/conversations/...` | Refléter les conversations externes dans la boîte de réception, lire les messages, récupérer les réponses et confirmer leur livraison ; les schémas exacts figurent dans `/docs` sur ton instance. |
| Projets                    | `/api/v1/projects/...`                  | L'accès machine des workers externes : chercher par id externe, créer, préparer les dossiers, charger des fichiers.                                          |
| Tâches                     | `/api/v1/tasks/...`                     | Création idempotente depuis une référence externe, lecture d'état, démarrage de workflow, commentaires.                                                      |
| MCP                        | `POST /api/v1/mcp`                      | L'[endpoint MCP](/fr/develop/mcp-endpoint) — même clé, JSON-RPC au lieu de REST.                                                                             |
| Déclencheur webhook        | `POST /api/automations/webhook/<token>` | Démarrer une automatisation déployée de l'extérieur ; la [page Webhooks](/fr/develop/webhooks).                                                              |

Pour modifier un contact, transmets la dernière valeur `updatedAt` lue dans le champ facultatif `expectedUpdatedAt` de `PATCH /api/v1/contacts/{id}`. Une modification concurrente renvoie **409**, `CONTACT_STALE` ; recharge le contact et fusionne tes changements avant de réessayer.

Les skills acceptent les visibilités `org` et `team` ; `teams` doit désigner des équipes de cette organisation. La visibilité `private` des skills a été retirée.

Pour créer un document du hub, envoie son contenu dans `content` à `POST /api/v1/documents`. L’alternative `fileId` exige un chargement du hub déjà effectué depuis l’app. REST ne crée pas ce chargement, et ceux des projets ne conviennent pas ici. Les documents supprimés ou expirés, y compris les fichiers d’un projet supprimé, restent absents de cette interface du hub.

## Gérer les agents d’un projet

Chaque agent appartient à un projet. L’ID du projet est obligatoire dans l’URL de chaque opération ; les réponses incluent `projectId` et l’`id` de l’agent. Ce sont les mêmes agents que dans l’onglet **Agents** du projet, avec les mêmes droits d’accès.

| Opération | Route | Réussite |
| --- | --- | --- |
| Lister les agents | `GET /api/v1/projects/{id}/agents` | `200 {agents}` |
| Créer | `POST /api/v1/projects/{id}/agents` | `201 {agent}` |
| Lire | `GET /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Enregistrer toute la configuration | `PUT /api/v1/projects/{id}/agents/{agentId}` | `200 {agent}` |
| Supprimer | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204` |

Choisis un projet existant et un modèle que le harness choisi peut utiliser. Cet exemple crée un agent Claude Code et relit sa configuration ; il ne lance aucune tâche.

```bash
: "${BASE:?Set BASE to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${ORG_SLUG:?Set ORG_SLUG}"
: "${PROJECT_ID:?Set PROJECT_ID to an existing project ID}"
: "${MODEL_ID:?Set MODEL_ID to a model served by your harness}"
AGENT_URL="$BASE/api/v1/projects/$PROJECT_ID/agents"
AGENT_BODY=$(jq -n --arg model "$MODEL_ID" \
  '{name:"Reviewer",harness:"claude-code",model:$model,skills:[],connectors:[]}')
AGENT_ID=$(curl -fsS "$AGENT_URL" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  -H 'Content-Type: application/json' -d "$AGENT_BODY" | jq -er '.agent.id')
curl -fsS "$AGENT_URL/$AGENT_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $ORG_SLUG" \
  | jq '.agent | {name, harness, skills, connectors}'
```

```json
{
  "name": "Reviewer",
  "harness": "claude-code",
  "skills": [],
  "connectors": []
}
```

`POST` et `PUT` exigent `name`, `harness`, `model`, `skills` et `connectors`. Les champs facultatifs sont `modelProvider`, `tools`, `secrets` et `instructions`. Un `PUT` enregistre toute la configuration : omettre le fournisseur ou les instructions les remet à `null`, omettre les outils ou les secrets vide ces listes. L’ID doit déjà exister ; un `PUT` ne crée pas un nouvel agent.

Un projet contient au maximum 50 agents. Leurs noms sont distincts dans le projet sans tenir compte de la casse, avec 120 caractères au plus ; chaque liste d’équipement accepte 25 entrées et les instructions 20 000 caractères. Une configuration invalide, un nom déjà pris ou une limite dépassée renvoie **400**. `secrets` contient des noms de secrets de l’organisation, jamais leurs valeurs ; les noms inconnus sont écartés. Seuls les Propriétaires et Admins peuvent modifier ces autorisations. Un Éditeur doit donc conserver les autorisations existantes dans sa configuration complète.

Le droit de lire un projet permet de lire ses agents ; les modifications exigent un projet actif et le droit de le modifier. Un projet invisible ou absent, ou un ID d’agent d’un autre projet, renvoie **404**. Si le titulaire de la clé appartient à plusieurs organisations, chaque lecture et écriture doit inclure `X-Organization-Slug`. [Agents de projet](/fr/platform/projects/project-agents) explique leur travail sur les tâches ; le chat direct utilise toujours l’assistant intégré.

## Les noms d'automatisation dans les URL

Le nom d'une automatisation est un chemin en `/` — `billing/dunning` — et un chemin ne tient pas dans un seul segment d'URL. Dans chaque URL `/api/v1/automations/{name}/...`, écris le nom avec `__` à la place de chaque `/` :

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Les réponses portent toujours le vrai nom (`"name": "billing/dunning"`) ; la forme `__` n'existe que dans les URL. Les slugs de skills sont plats et ne s’encodent pas. Les agents de projet utilisent l’ID du projet et celui de l’agent.

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

Une automatisation inconnue répond **404**. Une exécution live accepte uniquement la `version` déployée ; une autre version enregistrée donne **409**. Teste-la avec `mode: "mock"`. Sans corps, l’entrée vaut `{}` ; un JSON mal formé donne **400** et ne démarre rien. Si l’automatisation définit un schéma `inputs`, l’entrée doit le respecter avant la création de l’exécution.

`projectId` nomme le projet dans lequel l’exécution opère — le projet sur lequel agissent ses outils de tâches et de documents. Omets-le et l’exécution porte sur toute l’organisation, sauf qu’une automatisation liée à un seul projet s’exécute dans celui-là automatiquement ; une automatisation liée à plusieurs n’accepte qu’un `projectId` parmi eux, et refuse tout autre.

## Envoyer un message, puis suivre le tour

Le chat suit la même forme 202-puis-suivi. Crée un thread, poste un message, interroge la génération, puis lis les messages :

Liste les modèles avant d’envoyer un message. Reprends `id` dans `model` et `providerSlug` pour choisir le fournisseur. La liste respecte les règles d’accès aux modèles de l’organisation et ne contient que ceux que REST peut appeler directement. Une liste vide signifie qu’aucun modèle de chat n’est disponible pour le détenteur de la clé.

```bash
curl -sS "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
# Aucun modèle disponible → 200 { "models": [] }
```

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
  -d '{ "content": "Résume-moi ce trimestre.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "poll": "/api/v1/threads/<threadId>/generation" }

# 3. Interroger jusqu'à idle, puis lire
curl -sS "https://your-host.example.com/api/v1/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY"
# → 200 { "status": "streaming" } … puis { "status": "idle" }
```

`{"status": "idle"}` signifie qu'aucun tour ne tourne — lis `GET /api/v1/threads/{id}/messages` pour la réponse. Un tour qui échoue avant toute sortie reste visible : l'erreur atterrit comme message d'assistant, jamais en silence. Les threads listés et lus par l'API sont ceux du détenteur de la clé ; les threads d'un autre utilisateur restent invisibles pour ta clé, même dans la même organisation.

Si un tour échoue, ton message reste enregistré et un message d’assistant porte l’erreur. La réponse REST fournit un texte lisible dans `error` et une classification `errorCode` lorsqu’elle est disponible. Les threads directs utilisent l’assistant intégré. Le champ facultatif `projectId` ajoute le contexte du projet ; les sélecteurs d’agent comme `agentSlug` ou `agentId` renvoient **400**.

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

Un `key` de projet explicite contient 2 à 6 lettres ou chiffres, convertis en majuscules. Une valeur invalide donne **400**, sans troncature. Si le nom ne permet pas de former un key valide, le projet est créé sans key. Une collision donne **409** ; fournis un key libre.

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
# → 200 { "uploadId": "...", "url": "https://...", "method": "PUT", "s3Ref": "...", "expiresAt": 1774... }
```

Chaque blob est stocké dans le stockage objet, donc `url` est toujours un `PUT` présigné : envoie les octets là avec cette méthode, avec un en-tête `Content-Type` strictement identique au `contentType` déclaré au moment du mint — le type déclaré est signé dans l'URL, le bucket refuse donc un PUT qui en porte un autre (sans `contentType` au mint, le PUT n'impose aucun en-tête) — puis lie la `s3Ref` du handoff comme `fileId`. La liaison termine le chargement :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

Le `uploadId` sert une seule fois et expire après 30 minutes — un worker qui a crashé en plein chargement demande un handoff frais au lieu de rejouer l'ancien. La politique de chargement s'applique à la liaison : un blob trop gros ou un type hors de la liste autorisée est refusé avec **400** et un code de raison.

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

Un nouvel appel avec la même référence externe d’une tâche active met à jour son titre et sa description. Omettre `description` l’efface ; les libellés changent uniquement s’ils sont envoyés. Une tâche archivée reste inchangée. L’identifiant de tâche reste le même et `runWorkflowSlug` ne démarre aucune autre exécution. Garde les mêmes données lorsque tu réessaies après une réponse perdue.

`description`, `labels` et `externalUrl` sont optionnels. Envoie `automationSlug` quand la tâche appartient à une automatisation : elle devient l'assignee, et c'est là-dessus que s'appuie le panneau de travail du dialogue de tâche — le bouton Start, la progression de l'exécution et les questions qu'une exécution pose à l'opérateur (un re-pick ultérieur comble une attribution manquante, mais n'écrase jamais un assignee). `runWorkflowSlug` démarre dans le même appel un workflow déployé sur une tâche fraîchement créée — l'exécution démarre en ligne, donc la réponse porte son `executionId` (l'id d'exécution à suivre), ou `executionId: null` quand le slug ne nomme aucune automatisation déployée. Démarre plutôt explicitement quand tu veux nommer le workflow dans un appel séparé :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

L’entrée de l’exécution contient la tâche dans `{task: ...}` — démarrer demande donc l'appartenance et la visibilité de la tâche, pas la capacité développeur : l'acte privilégié était le déploiement du workflow, et le journal d'exécution attribue le démarrage à ta clé. Suis l'exécution au familier `GET /api/v1/runs/{runId}`. `started: false` porte un `reason` : `already_running` répond l'`executionId` de l'exécution en cours au lieu de risquer un doublon — suis celle-là ; `not_started` veut dire que le slug ne nomme aucune automatisation déployée.

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

Et récupère les résultats. Ce que l'automatisation a rapporté se trouve dans la discussion de la tâche ; ce qu'elle a déposé arrive comme fichiers dans le dossier du trimestre — les deux se lisent par le même accès. La discussion arrive par pages, la plus récente d'abord (`limit`, 200 par défaut, 500 au plus), en ordre chronologique dans la page ; tant que `isDone` vaut `false`, renvoie `continueCursor` comme `cursor` pour lire les commentaires plus anciens. L'endpoint de contenu répond **302** vers une URL présignée de courte durée pour le blob stocké, donc suis les redirections :

```bash
curl -sS "https://your-host.example.com/api/v1/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "…", ... } ], "isDone": false, "continueCursor": "312" }

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

- **400** — requête mal formée : champ requis manquant, mauvais type, corps illisible — ou une clé multi-organisations qui n'a pas nommé son organisation (requis à chaque écriture et sur toutes les routes Projets et Tâches).
- **401** — clé API absente ou invalide.
- **403** — la clé est valide mais le rôle de son détenteur n'a pas la capacité (exécutions live, écriture de déclencheurs, annulation).
- **404** — la ressource n'existe pas dans ton organisation, appartient au thread de quelqu'un d'autre — ou est un projet ou une tâche que l'utilisateur de la clé ne peut pas voir : impossible à distinguer, à dessein, d'une ressource qui n'existe pas.
- **409** — l'état refuse l'action : pas de version déployée, un sujet, un e-mail ou un `externalItemId` en double (unique par organisation — la même chaîne dans une autre organisation passe), un tour déjà en cours.
- **413** — le corps est trop gros ; seul le déclencheur webhook le renvoie, à sa limite de 256 Ko. Un fichier chargé qui dépasse la politique de taille ou de type est refusé à la liaison avec **400** et un code de raison à la place.
- **429** — limite de débit atteinte, avec `Retry-After` en secondes entières ; voir [Limites de débit](/fr/develop/rate-limits).
- **500** — erreur interne.

Délier le déclencheur d’une automatisation existante (`DELETE .../triggers`) répond **204**, même si aucun déclencheur n’était lié. Une automatisation inconnue donne **404**. Supprimer une ressource absente donne aussi **404**, y compris un contact déjà dans la corbeille ou une entrée de connaissances déjà supprimée. Annuler une exécution inconnue donne **404** ; `{cancelled: false}` signifie qu’elle existe mais qu’elle est déjà terminée.

## Versionnage

L'API est versionnée par le préfixe d'URL — aujourd'hui `/api/v1/` — et y évolue par ajout : de nouveaux endpoints et de nouveaux champs optionnels arrivent, les formes existantes restent. Un changement cassant sortirait sous un nouveau préfixe. Le document OpenAPI sous `/docs` décrit toujours l'instance qui tourne.

## Où ça se place

Cette page est la moitié REST de la surface externe. L'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme aux clients MCP — l'écriture d'automatisations vit là-bas, pas dans REST. La [page Webhooks](/fr/develop/webhooks) couvre le déclencheur entrant qui démarre des exécutions sans clé. Si tu construis dans le produit — agents de projet, automatisations — l'onglet [Platform](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
