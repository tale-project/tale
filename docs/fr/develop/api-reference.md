---
title: Référence API
description: Comment appeler Tale de l'extérieur — authentification, inventaire des endpoints, pagination, les boucles asynchrones d'exécution et de tour, et le modèle d'erreur. La seule source de vérité pour la surface REST.
i18nLintExclude:
  - terminology-loanword
---

L'API de Tale est la surface des intégrateurs qui se tiennent hors du produit et veulent le scripter : ressources de connaissances, projets avec leurs fichiers et leurs tâches, automatisations et leurs exécutions, threads de chat, agents et skills — le tout en JSON sur HTTPS, avec une clé API dans un header. La même clé ouvre aussi l'[endpoint MCP](/fr/develop/mcp-endpoint) — cette page couvre la moitié REST.

Cette page est l'inventaire canonique de la surface, du modèle d'authentification et de la forme d'erreur. Les schémas de requête et de réponse champ par champ vivent dans le document OpenAPI que ton instance sert sous `/openapi.json` — son entrée `servers` nomme cette instance, donc un client généré à partir de lui vise le bon hôte — et que `/docs` affiche. Charge-le quand il te faut chaque propriété ; lis cette page pour comprendre comment l'API se comporte.

## Une première requête

La requête utile la plus courte — lister les automatisations de l'organisation — tient dans un curl :

```bash
curl -sS "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Une réponse réussie est une liste nommée : `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. La forme des listes varie selon la famille : la plupart répondent avec un tableau nommé comme celui-ci, tandis que les ressources de connaissances et de chat — contacts, produits, documents, entrées de connaissances, threads, sites web — répondent avec une enveloppe `{ "page": [...], "isDone": ..., "continueCursor": ... }`. Là où une enveloppe pagine, renvoie `continueCursor` en `?cursor=` et borne la page avec `?limit=` : les contacts, produits, documents, entrées de connaissances, threads et sites web paginent tous ainsi jusqu'à la dernière page (`isDone: true` avec un `continueCursor` vide). La liste des runs d'une automation est plutôt une fenêtre bornée — `?limit=` (1..200, 50 par défaut) fixe combien des runs les plus récents tu reçois. L'accès machine sous Projets voyage encore plus léger — sa section montre ces formes.

## Authentification

Les clés API se créent dans le produit par toute personne avec les permissions Admin ou Développeur — [Clés API](/fr/platform/admin/api-keys) décrit le panneau. Une clé s'affiche une seule fois à la création, jamais ensuite ; elle appartient à la personne qui l'a créée — chaque appel agit comme cette personne.

Envoie la clé comme bearer token : `Authorization: Bearer <key>`. Chaque appel agit au nom du détenteur dans une organisation dont il est membre. L’en-tête `X-Organization-Slug` choisit cette organisation ; Tale vérifie toujours l’appartenance. Avec une seule appartenance, tu peux l’omettre. Avec plusieurs, il est obligatoire pour toute écriture, tout appel sous `/api/v1/projects/...` et tout appel de conversation, même en lecture ; son absence donne **400**, `ORG_SLUG_REQUIRED`. Les autres lectures peuvent reprendre l’organisation active en dernier dans le dashboard, et `GET /api/v1/me` répond les slugs qu’une clé peut envoyer. Chaque opération du document OpenAPI déclare l’en-tête. Les droits dépendent du projet et de l’action : les lecteurs du projet peuvent discuter et commenter, tandis que modifier ses ressources ou démarrer un workflow sur une tâche exige l’accès en édition. Les exécutions live à entrée libre demandent aussi la capacité développeur. Les sections suivantes précisent les droits par opération.

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

Les jetons d'accès servent uniquement au point de terminaison userinfo natif ; les audiences de ressources externes sont désactivées. Utilise des clés API natives pour les requêtes REST.

Les erreurs suivent les RFC 6749 et 6750 — ce qu’un client maintenu attend. `userinfo` répond **401** `invalid_token` avec un défi `WWW-Authenticate: Bearer` pour un jeton d’accès invalide ou expiré — chaque expiration au bout de cinq minutes passe par là, traite-la donc comme une reconnexion, pas comme une nouvelle tentative — et **401** avec le défi nu quand le jeton manque ; un jeton sans le scope `openid` donne **403** `insufficient_scope`. Les endpoints de jeton et d’autorisation répondent `{ "error", "error_description" }` : un grant autre que `authorization_code` est `unsupported_grant_type`, une requête mal formée `invalid_request`. La découverte liste `https://tale.dev/organization` sous `claims_supported` ; elle annonce aussi les endpoints d’introspection, de révocation et de fin de session du fournisseur, dont le parcours ci-dessus n’a pas besoin.

Pour un identifiant client validé, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` avec `{}` renvoie une fois un nouveau `client_secret` et invalide l'ancien. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` avec `{ "disabled": true }` bloque les nouvelles autorisations ; `false` réactive le même client. Ces deux appels exigent, comme l'enregistrement, la même organisation active, une session administrateur, l'en-tête Origin et un contenu JSON. Supprimer une organisation supprime aussi ses clients et leurs consentements.

## Groupes d'endpoints

Pour une ressource de projet sous `/api/v1`, place l’ID du projet dans son URL. Ces corps de requête n’acceptent pas `projectId` : les schémas stricts le refusent avec **400**. La ressource doit appartenir au projet nommé et être visible pour le détenteur de la clé ; sinon, l’appel donne **404**. Les réponses peuvent contenir `projectId` comme métadonnée. Les catalogues de l’organisation, comme les définitions d’automatisations et les bundles de skills, gardent leurs chemins d’organisation.

| Groupe                     | Chemin                                  | Ce qu'il couvre                                                                                                                                              |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatisations | `/api/v1/automations/...` | Définitions, versions, déclencheurs et projets où chacune est installée ; supprimer une définition ; démarrer et lister les exécutions sans projet. |
| Automatisations du projet | `/api/v1/projects/{id}/automations/...` | Lister les automatisations installées, en installer ou en désinstaller une, démarrer et lister les exécutions de ce projet. |
| Exécutions | `/api/v1/projects/{id}/runs/{runId}` ou `/api/v1/runs/{runId}` | Statut, sortie, trace, effets et `POST .../cancel` ; une exécution de projet utilise le chemin du projet. |
| Threads | `/api/v1/projects/{id}/threads/...` ou `/api/v1/threads/...` | Les chats du détenteur dans un projet ou sans projet : lister, créer, lire, archiver ou restaurer, supprimer, envoyer des messages, suivre le tour et l’annuler. |
| Modèles | `GET /api/v1/models` | Modèles de chat configurés auxquels le détenteur de la clé a accès dans cette organisation, avec fenêtre de contexte, plafond de sortie, capacités, prix et le choix par défaut de l’organisation. |
| Agents | `/api/v1/projects/{id}/agents/...` | Lister, lire, créer, modifier et supprimer les agents du projet indiqué. |
| Skills | `/api/v1/skills/...` | Lister, lire, créer ou modifier et supprimer les bundles de skills de l’organisation. |
| Entrées de connaissances   | `/api/v1/knowledge-entries/...`         | Des faits par sujet : lister, créer, remplacer, supprimer.                                                                                                   |
| Recherche de connaissances | `POST /api/v1/projects/{id}/knowledge/search` ou `POST /api/v1/knowledge/search` | Rechercher dans les fichiers indexés d’un projet, ou dans les documents visibles du hub sans projet et les sites web. |
| Documents                  | `/api/v1/documents/...`                 | Les documents de la base de connaissances : CRUD plus `POST .../retry-indexing`. Les fichiers de projet n'apparaissent jamais ici — ils vivent sous Projets. |
| Sites web                  | `/api/v1/websites/...`                  | Les sources crawlées : CRUD plus `.../pages`, `.../sync`, `.../search`.                                                                                      |
| Sessions de navigateur     | `/api/v1/browser-sessions/...`          | Le pool de cookies préchauffés derrière l’[ingestion vidéo](/fr/self-hosted/configuration/video-ingestion) : liste masquée, `POST .../import` pour les opérateurs sur l’allowlist. |
| Produits                   | `/api/v1/products/...`                  | Les entrées du catalogue produit : CRUD.                                                                                                                     |
| Contacts                   | `/api/v1/contacts/...`                  | Les fiches contact : CRUD plus `POST /api/v1/contacts/bulk`.                                                                                                 |
| Conversations | `/api/v1/conversations/...` | Refléter les conversations externes dans la boîte de réception, lire les messages, récupérer les réponses et confirmer leur livraison ; les schémas exacts figurent dans `/docs` sur ton instance. |
| Projets                    | `/api/v1/projects/...`                  | L'accès machine des workers externes : chercher par id externe, créer, préparer les dossiers, charger des fichiers.                                          |
| Tâches | `/api/v1/projects/{id}/tasks/...` | Créer une tâche depuis une référence externe sans doublon, lire son état, démarrer un workflow et commenter dans le projet nommé. |
| MCP                        | `POST /api/v1/mcp`                      | L'[endpoint MCP](/fr/develop/mcp-endpoint) — même clé, JSON-RPC au lieu de REST.                                                                             |
| Déclencheur webhook | `POST /api/projects/{id}/automations/webhook/{token}` ou `POST /api/automations/webhook/{token}` | Démarrer une automatisation déployée avec son token ; [Webhooks](/fr/develop/webhooks) décrit les URL avec et sans projet. |

Pour modifier un contact, transmets la dernière valeur `updatedAt` lue dans le champ facultatif `expectedUpdatedAt` de `PATCH /api/v1/contacts/{id}`. Une modification concurrente renvoie **409**, `CONTACT_STALE` ; recharge le contact et fusionne tes changements avant de réessayer.

Les skills acceptent les visibilités `org` et `team` ; `teams` doit désigner des équipes de cette organisation. La visibilité `private` des skills a été retirée.

Pour créer un document du hub, envoie son contenu dans `content` à `POST /api/v1/documents`. Ce contenu inline reste stocké et lisible, mais il n’est jamais indexé : la recherche ne trouve que les documents adossés à un fichier chargé, et `POST .../retry-indexing` répond `{"status": "skipped", "reason": "content-only"}` pour un document sans fichier (les autres motifs sont `untracked-blob` et `rag-opt-out`). L’alternative `fileId` exige un chargement du hub encore sans liaison, effectué depuis l’app par le détenteur de la clé dans l’organisation choisie. REST ne crée pas ce chargement. Un fichier déjà lié à un document, un thread ou une conversation ne peut pas servir ici. Un chargement absent, appartenant à un autre utilisateur ou déjà lié donne **404**, `FILE_NOT_FOUND`. Cette route ne transforme pas les chargements de projet, de chat ou de conversation en documents du hub. Les documents supprimés ou expirés, y compris les fichiers d’un projet supprimé, restent absents de cette interface. Les corps de `POST` et `PATCH` sont stricts : un `projectId` donne **400**. Crée les fichiers de projet avec les routes de chargement et de fichiers du projet.

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

Un projet contient au maximum 50 agents. Leurs noms sont distincts dans le projet sans tenir compte de la casse, avec 120 caractères au plus ; chaque liste d’équipement accepte 25 entrées et les instructions 20 000 caractères. Une configuration invalide, un nom déjà pris ou une limite dépassée renvoie **400**. `model` doit être un modèle que le catalogue de l’organisation liste (nomme `modelProvider` quand plusieurs fournisseurs le servent) et `tools` ne doit nommer que des autorisations d’outils connues — une valeur fausse renvoie **400** avec `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` ou `PROJECT_AGENT_TOOL_UNKNOWN`, qui nomme ce qu’il faut corriger, plutôt qu’un agent qui échoue à sa première tâche. `secrets` contient des noms de secrets de l’organisation, jamais leurs valeurs ; les noms inconnus sont écartés. Seuls les Propriétaires et Admins peuvent modifier ces autorisations. Un Éditeur doit donc conserver les autorisations existantes dans sa configuration complète.

Le droit de lire un projet permet de lire ses agents ; les modifications exigent un projet actif et le droit de le modifier. Un projet invisible ou absent, ou un ID d’agent d’un autre projet, renvoie **404**. Si le titulaire de la clé appartient à plusieurs organisations, chaque lecture et écriture doit inclure `X-Organization-Slug`. [Agents de projet](/fr/platform/projects/project-agents) explique leur travail sur les tâches ; le chat direct utilise toujours l’assistant intégré.

## Les noms d'automatisation dans les URL

Le nom d'une automatisation est un chemin en `/` — `billing/dunning` — et un chemin ne tient pas dans un seul segment d'URL. Dans chaque URL `.../automations/{name}/...`, écris le nom avec `__` à la place de chaque `/` :

```bash
curl -sS "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Les réponses portent toujours le vrai nom (`"name": "billing/dunning"`) ; la forme `__` n'existe que dans les URL. Les slugs de skills sont plats et ne s’encodent pas. Les agents de projet utilisent l’ID du projet et celui de l’agent.

`GET /api/v1/automations` liste chaque automatisation avec `latestVersion`, `deployedVersion` et `projectIds` — les projets où elle est installée, ceux que les routes d’exécution ci-dessous exigent. `DELETE /api/v1/automations/{name}` supprime l’automatisation avec ses versions, ses déclencheurs et ses liaisons de projet, et répond **409** `AUTOMATION_HAS_ACTIVE_RUNS` tant qu’une exécution est en cours. Les deux demandent la capacité développeur.

## Démarrer une exécution, puis la suivre

Une exécution est durable et peut prendre des minutes — le démarrage répond donc **202** avec l'identité de l'exécution, pas son résultat :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Interroge `GET /api/v1/projects/{id}/runs/{runId}` jusqu'à ce que `status` quitte `queued`/`running`/`waiting` ; l'exécution terminée porte `output`, la `trace` nœud par nœud et les `effects` produits. `POST /api/v1/projects/{id}/runs/{runId}/cancel` arrête une exécution à sa prochaine frontière de nœud — ce qu'un nœud a déjà fait n'est pas défait.

`mode` vaut `live` par défaut. Les exécutions live à entrée libre et les annulations exigent la capacité développeur. Une exécution de projet demande aussi l’accès en édition à un projet actif, y compris avec `mode: "mock"`. Les mocks sont déterministes ; sans projet, une exécution mock demande seulement l’appartenance. Aucun déclencheur n’est nécessaire. Sans version déployée, l’appel donne **409**, sauf si tu choisis explicitement une version enregistrée pour une exécution mock.

Une automatisation inconnue répond **404**. Une exécution live accepte uniquement la `version` déployée ; une autre version enregistrée donne **409**. Teste-la avec `mode: "mock"`. Sans corps, l’entrée vaut `{}` ; un JSON mal formé donne **400** et ne démarre rien. Si l’automatisation définit un schéma `inputs`, l’entrée doit le respecter avant la création de l’exécution.

Le projet dans l’URL fournit le contexte aux outils de tâches et de documents de l’exécution. Une automatisation liée à des projets ne peut tourner que dans l’un d’eux. `GET /api/v1/projects/{id}/automations/{name}/runs` lit l’historique de ce projet. Sans aucune liaison, `POST /api/v1/automations/{name}/runs` démarre une exécution sans projet ; une automatisation liée y donne **409**. Les listes globales et `/api/v1/runs/{runId}` exposent uniquement les exécutions sans projet. Pour lire ou annuler une exécution de projet, utilise l’URL de ce projet.

## Envoyer un message, puis suivre le tour

Le chat de projet suit aussi la séquence 202, puis suivi. Choisis un projet que tu peux lire, crée un thread, envoie un message, interroge la génération, puis lis les messages :

Liste les modèles avant d’envoyer un message. Chaque entrée porte ce qu’il faut pour choisir — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing` quand le catalogue publie un prix, `tags` — et `default: true` marque le choix de l’organisation pour ce détenteur de clé. Reprends `id` dans `model` ; ajoute `providerSlug` quand le même id est listé sous plusieurs fournisseurs. La liste respecte les règles d’accès aux modèles de l’organisation et ne contient que ceux que REST peut appeler directement. Une liste vide signifie qu’aucun modèle de chat n’est disponible pour le détenteur de la clé. Le couple est vérifié à l’envoi, dès la porte : un id absent de la liste donne **400**, `CHAT_MODEL_UNKNOWN` ; un id servi par plusieurs fournisseurs sans qu’aucun soit nommé, **400**, `CHAT_MODEL_AMBIGUOUS` avec les candidats dans `data.providers` ; un `providerSlug` absent de la liste, **400**, `CHAT_PROVIDER_UNKNOWN`, et un fournisseur qui ne sert pas le `model` choisi, **400**, `CHAT_MODEL_NOT_ON_PROVIDER`. Le 202 nomme le fournisseur sur lequel le tour s’exécute, et le tour ne bascule jamais en silence vers un autre.

```bash
curl -sS "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# Aucun modèle disponible → 200 { "models": [] }
```

```bash
# 1. Un thread à toi
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Envoyer un message — sur cette API le modèle est toujours explicite, jamais choisi pour toi
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Résume-moi ce trimestre.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "providerSlug": "...", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Interroger jusqu'à idle, puis lire
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "streaming" } … puis { "status": "idle" }
```

`{"status": "idle"}` signifie qu’aucun tour ne tourne. Lis `GET /api/v1/projects/{id}/threads/{threadId}/messages` pour obtenir la réponse. Les listes, détails, messages et statuts montrent uniquement les threads du détenteur de la clé dans ce projet. Ceux d’un autre utilisateur restent invisibles, même dans un projet commun. `GET /api/v1/projects/{id}/threads` liste tes threads ; `GET /api/v1/projects/{id}/threads/{threadId}` en lit un.

`content` est nettoyé de ses espaces avant la vérification : un prompt vide donne **400** au lieu de consommer un tour ; `locale` est un tag BCP 47 (`de`, `en-GB`) qui nomme la langue dans laquelle l’assistant répond. Chaque message porte un `status` : pendant qu’un tour tourne, sa ligne d’assistant figure déjà sur la page en `pending` avec des `parts` vides — la ligne que `.../generation` nomme dans `messageId` — et passe à `complete`, ou à `failed` avec `error` et `errorCode`, quand le tour se termine, les compteurs de jetons dans `usage`. `parts` est une liste ordonnée distinguée par `type` — `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval`, `human-input` — et le document OpenAPI type chaque sorte. Une part `reasoning` est la réflexion du modèle et peut citer mot pour mot les instructions de l’assistant : affiche-la comme telle, jamais comme la réponse. Le vocabulaire est additif ; une sorte que tu ne connais pas, affiche-la comme opaque.

Pour un chat personnel sans projet, utilise `/api/v1/threads` et ses chemins de détail, de messages et de génération. Ces URL ne donnent pas accès aux threads de projet. Un mauvais projet dans l’URL donne **404**. Les deux types de chat utilisent l’assistant intégré ; `projectId`, `agentSlug` ou `agentId` dans un corps de création ou de message donne **400**. Les lecteurs du projet, y compris les Membres, peuvent créer et envoyer. Un projet archivé refuse ces écritures avec **403**. Un thread archivé refuse un message avec **409**, `CHAT_THREAD_ARCHIVED`, un thread sandbox avec **409**, `CHAT_THREAD_NOT_DIRECT`, et un thread dont le tour tourne encore avec **409**, `CHAT_TURN_IN_PROGRESS` — réessaie le dernier une fois que le suivi répond idle, jamais les deux autres.

Le cycle de vie t’appartient par les mêmes URL. `PATCH .../threads/{threadId}` avec `{ "archived": true }` archive un thread et `false` le restaure ; `DELETE .../threads/{threadId}` le met à la corbeille (**409**, `CHAT_TURN_IN_PROGRESS` tant qu’un tour tourne) ; `DELETE .../threads/{threadId}/generation` demande au tour en cours de s’arrêter — **202** `{ "status": "cancelling" }`, puis interroge jusqu’à idle ; **404**, `CHAT_TURN_NOT_RUNNING` quand rien ne tourne. Un projet archivé refuse les trois avec **403**.

Un échec du modèle peut apparaître dans un message d’assistant avec un texte lisible dans `error` et, si disponible, un `errorCode`. La liste des modèles est le catalogue configuré de l’organisation, pas une promesse du compte fournisseur : deux codes désignent donc le compte plutôt que la requête, `credit_exhausted` (solde épuisé) et `model_not_entitled` (le forfait du fournisseur n’inclut pas ce modèle). Choisis un autre modèle ou remets le compte en ordre — attendre ne change rien, et aucun des deux n’est un `rate_limited`. Avant d’ouvrir le tour, le worker revérifie le thread accepté et l’accès au projet. Si le thread change de projet ou que l’accès disparaît pendant l’attente, il n’exécute pas le tour et n’ajoute pas d’erreur dans le nouveau contexte.

## Rechercher dans les fichiers d’un projet

Utilise l’URL du projet quand tous les résultats doivent en provenir. La recherche porte uniquement sur ses fichiers indexés et exige l’accès en lecture, même si le projet est archivé. Les documents du hub ou des équipes, les autres projets, les sites web et les pièces jointes d’e-mails sont exclus. Omets `corpus` ou donne-lui la valeur `"documents"`. Un autre corpus ou un champ `projectId` dans le corps donne **400**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Date limite de déclaration du premier trimestre", "limit": 10 }'
```

Le corps exige `query` et accepte aussi `limit` (1–50) et `minSimilarity` (0–1). Chaque résultat porte son passage, son `score` et sa `source` ; un résultat de document porte aussi `source.documentId` — l’id que prennent les routes de fichiers et de documents — à côté de la `ref` du blob sous laquelle l’index le classe. Sans modèle d’embedding, la réponse est **409**, `EMBEDDING_NOT_CONFIGURED`. Le même **409** arrive en `EMBEDDING_CREDIT_EXHAUSTED` quand le fournisseur d’embedding refuse pour une raison de compte — solde épuisé, plafond de dépenses atteint, ou forfait qui n’inclut pas le modèle. Une clé que le fournisseur rejette, ou à laquelle il refuse le modèle, donne **409**, `EMBEDDING_CREDENTIAL_REJECTED` — corrige les réglages du fournisseur. Ni l’un ni l’autre n’est une limite de débit : attendre ne change rien, un admin doit intervenir. Toute autre panne côté fournisseur donne **503**, `EMBEDDING_UPSTREAM_ERROR`, avec `Retry-After` — celle-là, réessaie-la avec un backoff. Pour rechercher dans les documents visibles du hub et des équipes sans projet, ou dans les sites web enregistrés, utilise `POST /api/v1/knowledge/search`. Son champ `corpus` accepte `"documents"`, `"web"` ou `"all"`, la valeur par défaut. Cette URL exclut les fichiers de projet et les pièces jointes d’e-mails. Les deux recherches ne trouvent que les documents adossés à un fichier — un `content` inline n’entre jamais dans l’index.

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

Un `key` de projet explicite contient 2 à 6 lettres ou chiffres, convertis en majuscules. Une valeur invalide donne **400**, sans troncature. Si le nom ne permet pas de former un key valide, le projet est créé sans key. Un key dérivé qui entre en collision est dérivé de nouveau jusqu’à être libre ; un key explicite qui entre en collision donne **409**, `PROJECT_KEY_TAKEN` — fournis-en un libre. Le même `externalItemId` deux fois donne **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

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

Le `uploadId` sert une seule fois et expire après 30 minutes, et l’`url` présignée expire avec lui — `expiresAt` est la seule échéance pour les deux — donc un worker qui a crashé en plein chargement demande un handoff frais au lieu de rejouer l'ancien. `fileName` est un simple nom : un séparateur de chemin ou un caractère de contrôle dedans donne **400**. La politique de chargement s'applique à la liaison : un blob trop gros ou un type hors de la liste autorisée est refusé avec **400** et un code de raison.

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

Les routes de tâches transforment un élément externe en tâche sur le board du projet, y démarrent un workflow déployé et en récupèrent les résultats. Une automatisation liée à des projets doit d’abord être installée dans celui-ci. L’installation est idempotente : **201** au premier appel, **200** si la liaison existe. Elle exige la capacité développeur et l’accès en édition à un projet actif. Prépare la liaison en amont si le compte du worker n’a pas ces droits :

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` liste les automatisations installées dans ce projet. Une automatisation sans aucune liaison peut aussi tourner dans un projet accessible si l’appelant possède les droits d’édition requis, mais elle ne figure pas dans cette liste. `DELETE /api/v1/projects/{id}/automations/{name}` la désinstalle — **204**, ou **404** `AUTOMATION_NOT_INSTALLED` si elle n’y était pas installée — sous la même capacité développeur et le même accès en édition.

La création est idempotente par `(projectId, externalSystem, externalId)` : le premier appel crée la tâche (**201**, `created: true`), un nouvel appel renvoie la même (**200**, `created: false`). Le `projectId` vient de l’URL ; l’envoyer dans le corps donne **400**. La création exige l’accès en édition à un projet actif.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Un nouvel appel avec la même référence externe d’une tâche active met à jour son titre et sa description. Omettre `description` l’efface ; les libellés changent uniquement s’ils sont envoyés. Une tâche archivée reste inchangée. L’identifiant de tâche reste le même et `runWorkflowSlug` ne démarre aucune autre exécution. Garde les mêmes données lorsque tu réessaies après une réponse perdue.

`description`, `labels` et `externalUrl` sont optionnels ; `title` accepte jusqu’à 200 caractères et `externalUrl` doit être une URL `http(s)` absolue — un titre plus long ou un autre schéma donne **400** plutôt qu’une tâche modifiée en silence. Envoie `automationSlug` quand la tâche appartient à une automatisation : elle devient l'assignee, et c'est là-dessus que s'appuie le panneau de travail du dialogue de tâche — le bouton Start, la progression de l'exécution et les questions qu'une exécution pose à l'opérateur (un re-pick ultérieur comble une attribution manquante, mais n'écrase jamais un assignee). `runWorkflowSlug` démarre dans le même appel un workflow déployé sur une tâche fraîchement créée — l'exécution démarre en ligne, donc la réponse porte son `executionId` (l'id d'exécution à suivre), ou `executionId: null` quand le slug ne nomme aucune automatisation déployée. Démarre plutôt explicitement quand tu veux nommer le workflow dans un appel séparé. L’`automationSlug` responsable doit désigner une automatisation déployée, sinon l’appel donne **404**. Un workflow lié uniquement à d’autres projets donne **403**.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "executionId": "<runId>" }
```

Le démarrage exige l’accès en édition à un projet actif et une tâche active. L’entrée contient la tâche dans `{task: ...}` ; aucune capacité développeur supplémentaire n’est requise. Le journal attribue le démarrage à ta clé. Suis `GET /api/v1/projects/{id}/runs/{runId}`. Avec `started: false`, `reason: "already_running"` fournit l’`executionId` de l’exécution en cours ; suis celle-là. `reason: "not_started"` signifie que le slug ne désigne aucune automatisation déployée.

Rends compte et lis l'état — le commentaire est posté comme l'utilisateur qui a créé la clé, indiscernable de la même personne dans l'app, @mentions comprises. Les lecteurs du projet, y compris les Membres, peuvent commenter une tâche active dans un projet actif. La tâche et ses commentaires restent lisibles après archivage. Chaque URL de tâche vérifie son appartenance au projet nommé.

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

Et récupère les résultats. Ce que l'automatisation a rapporté se trouve dans la discussion de la tâche ; ce qu'elle a déposé arrive comme fichiers dans le dossier du trimestre — les deux se lisent par le même accès. La discussion arrive par pages, la plus récente d'abord (`limit`, 200 par défaut, 500 au plus), en ordre chronologique dans la page ; tant que `isDone` vaut `false`, renvoie `continueCursor` comme `cursor` pour lire les commentaires plus anciens. L'endpoint de contenu répond **302** vers une URL présignée de courte durée pour le blob stocké, donc suis les redirections :

```bash
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
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
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` est une phrase pour les humains ; `code` est la valeur stable sur laquelle brancher — chaque refus que l’API prononce elle-même en porte un, et le document OpenAPI liste l’ensemble complet comme enum de `Error.code`. L’ensemble est additif : un nouveau code est un changement mineur, donc traite une valeur que tu ne connais pas comme un refus générique du statut reçu. Certains refus ajoutent `data` — `issues` pour un corps refusé, `retryAfterMs` pour une limite de débit, `providers` pour un modèle ambigu. Branche sur le code quand il est nommé ci-dessous, sur le statut sinon :

- **400** — requête mal formée : champ requis manquant, mauvais type, clé inconnue, corps illisible, chaîne contenant un caractère NUL — la réponse porte `code: "INVALID_BODY"` et liste sous `data.issues` chaque problème avec le champ (`price`, `contacts.2.email` ; une clé inconnue est un problème à part, sous son nom) et la raison, donc corrige ce qu'elle nomme ; un `cursor` que la liste n'a jamais renvoyé (`INVALID_CURSOR`), un `limit` qui n'est pas un nombre (`INVALID_LIMIT`) ou un autre paramètre de requête que la route refuse (`INVALID_QUERY`) — aucun n’est lu comme la première page ; ou une clé multi-organisations qui n'a pas nommé son organisation (`ORG_SLUG_REQUIRED`).
- **401** — clé API absente ou invalide (`UNAUTHORIZED`), avec un défi `WWW-Authenticate: Bearer`.
- **403** — le rôle (`ROLE_FORBIDDEN`) ou l’accès en édition manque, le projet ou la tâche est archivé pour l’écriture demandée (`PROJECT_ARCHIVED`), ou l’automatisation ne peut pas tourner dans ce projet.
- **404** — la ressource est absente, invisible pour le détenteur, appartient au thread d’un autre utilisateur ou à un autre projet que celui de l’URL ; chaque famille nomme son propre code (`PROJECT_NOT_FOUND`, `THREAD_NOT_FOUND`, …) et une route inconnue répond `NOT_FOUND`.
- **405** — la route existe, mais pas pour ce verbe (`METHOD_NOT_ALLOWED`) ; `Allow` liste les verbes qu’elle sert.
- **409** — l’état empêche l’action : pas de version déployée, automatisation liée appelée sans URL de projet, thread archivé ou tour déjà en cours, sujet, e-mail ou `externalItemId` en double, entrée de connaissances remplacée (`KNOWLEDGE_ENTRY_SUPERSEDED`), `expectedUpdatedAt` périmé (`CONTACT_STALE`, `PRODUCT_STALE`), ou recherche sans modèle d’embedding.
- **413** — le corps est trop gros (`BODY_TOO_LARGE`) : le déclencheur webhook à sa limite de 256 Ko, les routes de conversation à la leur. Un fichier chargé qui dépasse la politique de taille ou de type est refusé à la liaison avec **400** et un code de raison à la place.
- **422** — un corps de skill que la couche de fichiers ne peut pas lire (`SKILL_MALFORMED`).
- **429** — limite de débit atteinte (`RATE_LIMITED`), avec `Retry-After` en secondes entières et `data.retryAfterMs` ; voir [Limites de débit](/fr/develop/rate-limits).
- **500** — erreur interne (`INTERNAL_ERROR`) ; l’enveloppe porte un `requestId` à citer quand tu la signales.
- **503** — une dépendance dont la requête avait besoin est indisponible : le fournisseur d’embedding (`EMBEDDING_UPSTREAM_ERROR`, avec `Retry-After`) ou une purge de document qui n’a pas pu aboutir (`PURGE_INCOMPLETE`) — réessaie avec un backoff.

Délier le déclencheur d’une automatisation existante (`DELETE .../triggers`) répond **204**, même si aucun déclencheur n’était lié. Une automatisation inconnue donne **404**. Supprimer une ressource absente donne aussi **404**, y compris un contact déjà dans la corbeille ou une entrée de connaissances déjà supprimée. Annuler une exécution inconnue donne **404** ; `{cancelled: false}` signifie qu’elle existe mais qu’elle est déjà terminée.

## Versionnage

Le préfixe REST actuel est `/api/v1/`. Le document OpenAPI sous `/openapi.json` décrit les routes et les schémas de requête et de réponse de l’instance qui tourne, avec `servers` réglé sur cette instance ; `/docs` l’affiche. Prends-le comme contrat pour ton client.

## Où ça se place

Cette page est la moitié REST de la surface externe. L'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme aux clients MCP — l'écriture d'automatisations vit là-bas, pas dans REST. La [page Webhooks](/fr/develop/webhooks) couvre le déclencheur entrant qui démarre des exécutions sans clé. Si tu construis dans le produit — agents de projet, automatisations — l'onglet [Platform](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
