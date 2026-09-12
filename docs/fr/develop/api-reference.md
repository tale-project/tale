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
curl -sS --compressed "https://your-host.example.com/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Une réponse réussie est une liste nommée : `{ "automations": [ { "name": "billing/dunning", "latestVersion": 3, "deployedVersion": 2 } ] }`. La forme des listes varie selon la famille : la plupart répondent avec un tableau nommé comme celui-ci, tandis que les ressources de connaissances et de chat — contacts, produits, documents, entrées de connaissances, threads, sites web — répondent avec une enveloppe `{ "page": [...], "isDone": ..., "continueCursor": ... }`. Là où une enveloppe pagine, renvoie `continueCursor` en `?cursor=` et borne la page avec `?limit=` : les contacts, produits, documents, entrées de connaissances, threads et sites web paginent tous ainsi jusqu’à la dernière page (`isDone: true` avec un `continueCursor` vide). Les listes d’exécutions paginent de la même façon, sous leur propre clé — `{ "runs": [...], "isDone": ..., "continueCursor": ... }`, les plus récentes d’abord, `?limit=` (1..200, 50 par défaut ; une valeur hors bornes est ramenée dans la plage) par page — et `GET /api/v1/runs` liste les exécutions de toutes les automatisations. L’accès machine sous Projets voyage encore plus léger — sa section montre ces formes.

## Authentification

Les clés API se créent dans le produit par toute personne avec les permissions Admin ou Développeur — [Clés API](/fr/platform/admin/api-keys) décrit le panneau. Une clé s'affiche une seule fois à la création, jamais ensuite ; elle appartient à la personne qui l'a créée — chaque appel agit comme cette personne.

Envoie la clé comme bearer token : `Authorization: Bearer <key>` — une clé commence par `tale` et ne contient aucun séparateur ; traite la chaîne entière comme opaque. Chaque appel agit au nom du détenteur dans une organisation dont il est membre. L’en-tête `X-Organization-Slug` choisit cette organisation ; Tale vérifie toujours l’appartenance. Avec une seule appartenance, tu peux l’omettre. Avec plusieurs, il est obligatoire à chaque appel, lectures comprises ; son absence donne **400**, `ORG_SLUG_REQUIRED` — l’organisation qu’une personne a ouverte en dernier dans le dashboard ne pilote jamais un appel machine. Un slug qui ne nomme aucune organisation donne **404**, `ORG_SLUG_INVALID`, et un slug dont le détenteur de la clé n’est pas membre **403**, `ORG_FORBIDDEN`. Le **400** liste sous `data.organizations` les slugs que tu peux envoyer, et `GET /api/v1/me` en fait autant dès qu’un appel en nomme un. Chaque opération du document OpenAPI déclare l’en-tête. Les droits dépendent du projet et de l’action : les lecteurs du projet peuvent discuter et commenter, tandis que modifier ses ressources ou démarrer un workflow sur une tâche exige l’accès en édition. Les exécutions live à entrée libre demandent aussi la capacité développeur. Les sections suivantes précisent les droits par opération.

## Ce que chaque requête doit respecter

Un corps est du JSON, lu strictement : UTF-8 uniquement (une suite d’octets qui n’est pas de l’UTF-8 donne **400**, `INVALID_BODY`), sans caractère NUL, et un entier au-delà de 2^53 − 1 est refusé plutôt qu’arrondi — envoie donc un tel id sous forme de chaîne. Chaque schéma de corps est strict : une clé inconnue donne **400**, `INVALID_BODY`, qui la nomme. Les chaînes de requête sont strictes de la même façon : un paramètre que la route ne prend pas, un paramètre envoyé deux fois ou un filtre nommé laissé vide donne **400**, `INVALID_QUERY` — et les écritures ne prennent aucun paramètre de requête. Un corps est plafonné à 1 Mio sauf mention contraire de l’opération — le `content` inline d’un document à 32 Mio, `POST /api/v1/contacts/bulk` à 8 Mio, un instantané de conversation à 8 Mio, un chargement de conversation en attente de liaison à 30 Mio, l’enregistrement d’un skill à 4 Mio — et un corps trop gros donne **413**, `BODY_TOO_LARGE`, avant qu’un octet soit lu quand sa longueur est déclarée. Les corps sont lus comme du JSON quoi que dise `Content-Type` ; il n’y a pas de 415. Chaque chemin servi répond à `HEAD` (pour un `GET`) et à `OPTIONS` (**204** avec `Allow`), et un verbe qu’un chemin ne prend pas donne **405**, `METHOD_NOT_ALLOWED`, avec `Allow` qui nomme ceux qu’il prend. Une URL de requête au-delà de 32 Kio est refusée en amont — avant l’API — avec **431**. Chaque réponse porte un `X-Request-Id` — envoie le tien pour corréler un appel avec ce que la plateforme journalise ; une **500** et une **413** le répètent dans l’enveloppe sous `requestId`. Les horodatages sont partout des millisecondes epoch, et les ids sont des chaînes.

## Cache, compression et lectures partielles

Chaque lecture JSON — un `GET` qui répond **200** — porte un `ETag` calculé sur ses octets et `Cache-Control: private, no-cache` : garde la réponse et renvoie le tag en `If-None-Match` à la lecture suivante. Une ressource inchangée répond **304** sans corps, si bien qu’un client qui interroge une exécution terminée, un fil au repos ou l’état d’indexation d’un document dépense un aller-retour au lieu de la charge utile. Renvoie le tag exactement tel que tu l’as reçu : derrière le proxy qui compresse, le tag d’une réponse compressée s’écrit `"…-gzip"` ou `"…-zstd"`, et cette forme correspond, tout comme la forme faible `W/"…"` ; la 304 porte le tag que l’API a calculé. Le contenu des fichiers (`GET /api/v1/projects/{id}/files/{documentId}/content`) honore `If-None-Match` et `If-Modified-Since` contre l’`ETag` et le `Last-Modified` qu’il émet, de la même façon — un miroir ne retélécharge un fichier que si ses octets ont changé. Une **304** compte tout de même pour une requête dans les [limites de débit](/fr/develop/rate-limits).

```bash
# La première lecture répond 200 et son ETag ; la répétition avec ce tag répond 304
curl -sS --compressed -D - -o /dev/null "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H 'If-None-Match: "<ETag de la réponse précédente>"'
```

Les réponses JSON et texte sont compressées quand la requête propose `gzip` ou `zstd` dans `Accept-Encoding` — `curl --compressed` le fait, et toute bibliothèque HTTP le peut — au-delà d’un plancher d’environ 512 octets ; `br` n’est pas servi, et une réponse compressée ne porte pas de `Content-Length`. Les exemples de cette page le demandent tous : une liste d’exécutions est environ six fois plus petite compressée, une exécution dont l’entrée se répète, des centaines de fois.

Quand une ressource est volumineuse et qu’une lecture n’en a besoin que d’une partie, l’opération le dit : la lecture d’une exécution accepte `?fields=status,finishedAt` (n’importe quelles clés de l’exécution, séparées par des virgules) et répond exactement ces clés, et une liste d’exécutions qui inclut des lignes complètes via `?include=` lit au plus 25 lignes par page et en répond au plus 8 Mio — elle s’arrête à la dernière ligne qui tient, `isDone: false`, avec un `continueCursor` sur cette ligne ; continue donc de suivre le curseur jusqu’à `isDone`.

## Se connecter à une application avec Tale

Tale est aussi un émetteur OpenID Connect. Une application enregistrée te fait passer par la connexion native de Tale et le consentement. Elle reçoit une identité signée avec une adresse e-mail vérifiée et l'appartenance à la seule organisation liée à son client. Une clé API ne remplace pas une connexion personnelle dans ce parcours.

Enregistre l'application avec une session Owner ou Admin active dont l'organisation sélectionnée correspond à `TALE_ORG_ID`. `TALE_ORIGIN` désigne l'origine de ton instance Tale et `TALE_SESSION_COOKIE` l'en-tête Cookie de cette session. Utilise l'URL de rappel HTTPS exacte de l'application ; HTTP est accepté uniquement sur la boucle locale pour le développement :

```bash
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

La première réponse est **201** avec `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Conserve le secret dans l'environnement secret de l'application. Le même identifiant avec une configuration inchangée renvoie **200**, `created: false` et le même identifiant client, sans le secret. Un rappel ou une politique modifiés donnent **409** : relancer la commande ne peut donc pas détourner silencieusement une intégration existante.

| Usage             | Endpoint ou exigence                                  |
| ----------------- | ----------------------------------------------------- |
| Émetteur          | `https://your-host.example.com/api/auth`              |
| Découverte        | `GET /api/auth/.well-known/openid-configuration`      |
| Autorisation      | `GET /api/auth/oauth2/authorize`                      |
| Échange du code   | `POST /api/auth/oauth2/token`, `client_secret_post`   |
| Clés de signature | `GET /api/auth/jwks`                                  |
| Identité actuelle | `GET /api/auth/oauth2/userinfo`, jeton d'accès Bearer |
| Scopes demandés   | `openid profile email tale:organization`              |

Utilise un client OIDC maintenu avec le flux Authorization Code, S256 PKCE, un état à usage unique et un nonce. Vérifie l'émetteur, l'audience, la signature RS256, l'expiration et le nonce du jeton d'identité, puis exige `email_verified: true`. Le claim `https://tale.dev/organization` contient `{ "id", "slug", "role" }` pour l'organisation enregistrée. Tale revérifie l'appartenance actuelle et l'exigence MFA native avant d'émettre les jetons et à chaque lecture de Userinfo. L'application reste responsable de sa propre politique d'accès. Les codes expirent après 60 secondes et ne s'échangent qu'une fois ; les jetons d'accès et d'identité expirent après cinq minutes. L'enregistrement dynamique, les flux implicites et les jetons de renouvellement sont désactivés.

Les jetons d'accès servent uniquement au point de terminaison userinfo natif ; les audiences de ressources externes sont désactivées. Utilise des clés API natives pour les requêtes REST.

Les erreurs suivent les RFC 6749 et 6750 — ce qu’un client maintenu attend. `userinfo` répond **401** `invalid_token` avec un défi `WWW-Authenticate: Bearer` pour un jeton d’accès invalide ou expiré — chaque expiration au bout de cinq minutes passe par là, traite-la donc comme une reconnexion, pas comme une nouvelle tentative — et **401** avec le défi nu quand le jeton manque ; un jeton sans le scope `openid` donne **403** `insufficient_scope`. Les endpoints de jeton et d’autorisation répondent `{ "error", "error_description" }` : un grant autre que `authorization_code` est `unsupported_grant_type`, une requête mal formée `invalid_request`. La découverte liste `https://tale.dev/organization` sous `claims_supported` ; elle annonce aussi les endpoints d’introspection, de révocation et de fin de session du fournisseur, dont le parcours ci-dessus n’a pas besoin.

Pour un identifiant client validé, `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` avec `{}` renvoie une fois un nouveau `client_secret` et invalide l'ancien. `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` avec `{ "disabled": true }` bloque les nouvelles autorisations ; `false` réactive le même client. Ces deux appels exigent, comme l'enregistrement, la même organisation active, une session administrateur, l'en-tête Origin et un contenu JSON. Supprimer une organisation supprime aussi ses clients et leurs consentements.

## Groupes d'endpoints

Pour une ressource de projet sous `/api/v1`, place l’ID du projet dans son URL. Ces corps de requête n’acceptent pas `projectId` : les schémas stricts le refusent avec **400**. La ressource doit appartenir au projet nommé et être visible pour le détenteur de la clé ; sinon, l’appel donne **404**. Les réponses peuvent contenir `projectId` comme métadonnée. Les catalogues de l’organisation, comme les définitions d’automatisations et les bundles de skills, gardent leurs chemins d’organisation.

| Groupe                     | Chemin                                                                                                                                   | Ce qu'il couvre                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatisations            | `/api/v1/automations/...`                                                                                                                | Définitions, versions, déclencheurs et projets où chacune est installée ; supprimer une définition ; démarrer et lister les exécutions sans projet.                                                                                                                                         |
| Automatisations du projet  | `/api/v1/projects/{id}/automations/...`                                                                                                  | Lister les automatisations installées, en installer ou en désinstaller une, démarrer et lister les exécutions de ce projet.                                                                                                                                                                 |
| Exécutions                 | `/api/v1/runs`, `/api/v1/projects/{id}/runs`, et une exécution seule sous `/api/v1/projects/{id}/runs/{runId}` ou `/api/v1/runs/{runId}` | Lister les exécutions de toutes les automatisations ; en lire une en entier — statut, sortie, trace, effets ; annuler une exécution en cours avec `POST .../cancel` et supprimer une exécution terminée avec `DELETE` ; une exécution de projet utilise le chemin du projet.                |
| Threads                    | `/api/v1/projects/{id}/threads/...` ou `/api/v1/threads/...`                                                                             | Les chats du détenteur dans un projet ou sans projet : lister, créer, lire, archiver ou restaurer, supprimer, envoyer des messages, suivre le tour et l’annuler.                                                                                                                            |
| Modèles                    | `GET /api/v1/models`                                                                                                                     | Modèles de chat configurés auxquels le détenteur de la clé a accès dans cette organisation, avec fenêtre de contexte, plafond de sortie, capacités, prix, et `default: true` sur le choix de l’organisation quand il est configuré et accessible.                                           |
| Agents                     | `/api/v1/projects/{id}/agents/...`                                                                                                       | Lister, lire, créer, modifier (sous condition, avec `expectedUpdatedAt`) et supprimer les agents du projet indiqué.                                                                                                                                                                         |
| Skills                     | `/api/v1/skills/...`                                                                                                                     | Lister, lire, créer ou modifier et supprimer les bundles de skills de l’organisation.                                                                                                                                                                                                       |
| Entrées de connaissances   | `/api/v1/knowledge-entries/...`                                                                                                          | Des faits par sujet : lister, créer, remplacer, supprimer.                                                                                                                                                                                                                                  |
| Recherche de connaissances | `POST /api/v1/projects/{id}/knowledge/search` ou `POST /api/v1/knowledge/search`                                                         | Rechercher dans les fichiers indexés d’un projet, ou dans les documents visibles du hub sans projet et les sites web.                                                                                                                                                                       |
| Documents                  | `/api/v1/documents/...`                                                                                                                  | Les documents de la base de connaissances : CRUD (un `PATCH` répond le document mis à jour) plus `POST .../retry-indexing` ; chaque document adossé à un fichier porte son état `indexing`. Les fichiers de projet n’apparaissent jamais ici — ils vivent sous Projets.                     |
| Sites web                  | `/api/v1/websites/...`                                                                                                                   | Les sources crawlées : CRUD (un `PATCH` répond le site mis à jour) plus `.../pages`, `.../sync`, `.../search`.                                                                                                                                                                              |
| Sessions de navigateur     | `/api/v1/browser-sessions/...`                                                                                                           | Le pool de cookies préchauffés derrière l’[ingestion vidéo](/fr/self-hosted/configuration/video-ingestion) : liste masquée, `POST .../import` et `DELETE .../{id}` pour les opérateurs sur l’allowlist — une session vit 14 jours par défaut et 180 au plus.                                |
| Produits                   | `/api/v1/products/...`                                                                                                                   | Les entrées du catalogue produit : CRUD (un `PATCH` répond le produit mis à jour).                                                                                                                                                                                                          |
| Contacts                   | `/api/v1/contacts/...`                                                                                                                   | Les fiches contact : CRUD (un `PATCH` répond le contact mis à jour) plus `POST /api/v1/contacts/bulk`.                                                                                                                                                                                      |
| Conversations              | `/api/v1/conversations/...`                                                                                                              | Refléter les conversations externes dans la boîte de réception sous forme d’instantanés versionnés, lire le reçu d’instantané d’une source, récupérer les réponses natives et confirmer leur livraison ou la signaler en échec ; les schémas exacts figurent dans `/docs` sur ton instance. |
| Projets                    | `/api/v1/projects/...`                                                                                                                   | L’accès machine des workers externes : lister les projets ou en chercher un par id externe, créer, archiver et restaurer, supprimer ; préparer les dossiers, charger, télécharger et supprimer des fichiers, supprimer des dossiers.                                                        |
| Tâches                     | `/api/v1/projects/{id}/tasks/...`                                                                                                        | Créer une tâche depuis une référence externe sans doublon, lire son état, démarrer un workflow (la réponse donne le `runId` à suivre) et commenter dans le projet nommé.                                                                                                                    |
| MCP                        | `POST /api/v1/mcp`                                                                                                                       | L'[endpoint MCP](/fr/develop/mcp-endpoint) — même clé, JSON-RPC au lieu de REST.                                                                                                                                                                                                            |
| Déclencheur webhook        | `POST /api/projects/{id}/automations/webhook/{token}` ou `POST /api/automations/webhook/{token}`                                         | Démarrer une automatisation déployée avec son token ; [Webhooks](/fr/develop/webhooks) décrit les URL avec et sans projet.                                                                                                                                                                  |

Les contacts, les produits et les documents partagent la même précondition de concurrence optimiste : transmets la dernière valeur `updatedAt` lue dans le champ facultatif `expectedUpdatedAt` de `PATCH /api/v1/contacts/{id}`, `PATCH /api/v1/products/{id}` ou `PATCH /api/v1/documents/{id}`. Une modification concurrente renvoie **409** — `CONTACT_STALE`, `PRODUCT_STALE` ou `DOCUMENT_STALE` ; recharge la ressource et fusionne tes changements avant de réessayer. Chaque `PATCH` — contact, produit, document et site web — répond **200** avec la ressource mise à jour, pour que l’écriture suivante ait son `updatedAt`.

Les contacts et les produits partagent un même vocabulaire d’édition. Les chaînes sont nettoyées de leurs espaces ; l’`email` d’un contact est stocké en minuscules, les doublons se reconnaissent donc sans tenir compte de la casse, et la partie avant `@` fait 64 caractères au plus. `null` vide n’importe quel champ facultatif, et sur `PATCH` une chaîne vide vaut `null` — un champ requis vide (le `name` d’un produit) donne **400**, `INVALID_BODY` ; à la création et à l’import en masse, une chaîne vide vaut champ omis, une ligne au format CSV s’importe donc proprement. Un contact est classé sous au moins un des champs `name`, `email` et `externalId` : un patch qui viderait le dernier donne **400**, `CONTACT_IDENTITY_REQUIRED`. `PATCH` fusionne `metadata` selon la RFC 7396 — les clés envoyées sont posées, les clés omises restent, une clé envoyée à `null` est retirée, et le champ entier envoyé à `null` le vide — tandis qu’`address` est remplacée en bloc, une adresse formant un tout. `address` et `metadata` (les `metadata` d’un document aussi) sont bornés à 64 Kio de JSON, 8 niveaux d’imbrication et 500 clés au total ; une valeur plus grande donne **400**, `INVALID_BODY`, qui nomme le chemin. La `currency` d’un produit est un code ISO 4217 (`USD`, `EUR`), accepté dans n’importe quelle casse et stocké en majuscules, et son `imageUrl` une URL `http(s)` absolue — toute autre valeur donne **400**. Le `domain` d’un site web est immuable : `PATCH /api/v1/websites/{id}` accepte la valeur stockée renvoyée telle quelle (un client peut envoyer la ressource qu’il a lue) et donne **400**, `WEBSITE_DOMAIN_IMMUTABLE`, pour toute autre.

`PUT /api/v1/skills/{slug}` crée le skill quand le slug est libre et le met à jour sur place sinon : `description` et `body` sont requis, un `icon`, `labels`, `teams` ou `visibility` omis garde sa valeur stockée, et `null` vide `icon` ou `labels`. Le corps est du Markdown de 507 893 octets d’UTF-8 au plus — des octets, pas des caractères : le `SKILL.md` composé, frontmatter compris, est plafonné à 512 Kio et ce budget y tient toujours — et un corps qui ne finit pas par un saut de ligne en reçoit un, un `GET` le relit donc un octet plus long. Envoie `If-None-Match: *` pour créer seulement : un slug qui a déjà un bundle répond alors **412**, `SKILL_EXISTS`, et rien n’est écrit. Chaque skill porte `canEdit` — si cette clé peut modifier le bundle ; les skills livrés sont des bundles d’organisation qu’un administrateur peut écraser — vérifie-le donc avant un enregistrement destiné à en remplacer un. Les skills acceptent les visibilités `org` et `team` ; `teams` doit désigner des équipes de cette organisation. La visibilité `private` des skills a été retirée : elle ne peut plus être posée, et un bundle qui la porte encore ne la garde que si l’enregistrement omet `visibility`. Un slug fait 64 caractères au plus, en minuscules, chiffres et tirets simples, et `anthropic` et `claude` sont réservés ; `PUT` refuse un slug mal formé avec **400**, `INVALID_SKILL_SLUG`, en nommant la règle enfreinte, tandis que `GET` et `DELETE` le traitent comme absent avec **404**, `SKILL_NOT_FOUND`.

Un miroir de conversation est un instantané versionné : `POST /api/v1/conversations/sync` applique une `version` entière plus récente, ignore une version plus ancienne, et répond **409**, `CONVERSATION_SNAPSHOT_CONFLICT`, pour la même version avec un contenu différent — sauf le démontage, qui n’est pas un contenu : `deleted: true` s’applique à la version stockée ou à toute version supérieure et se rejoue sans effet une fois la source démontée, si bien qu’une source à court de versions peut encore fermer son miroir. Un message né comme réponse native de la boîte de réception — une réponse que tu as récupérée par `POST /api/v1/conversations/deliveries/claim` — porte `taleMessageId`, le `messageId` de cette réponse, et doit d’abord avoir été confirmé sous son `externalId` (**409**, `DELIVERY_UNACKNOWLEDGED`) ; un message sans `taleMessageId` appartient à la source, quoi que dise `isCustomer`. Une récupération nomme une source que tu as reflétée : une source qu’aucun instantané n’a jamais nommée donne **404**, `CONVERSATION_SOURCE_NOT_FOUND`, et une source que seuls d’autres utilisateurs de service possèdent **403**, `INTEGRATION_NOT_OWNED` — une source mal tapée n’interroge jamais une file vide à l’air sain. `GET .../deliveries/{id}/attachments/{index}` distingue ses absences : aucune livraison récupérée sous cet id, c’est `DELIVERY_NOT_FOUND` ; une position que la livraison ne porte pas — ou qui n’est pas un entier entre 0 et 9 — c’est `ATTACHMENT_NOT_FOUND`. Les chargements en attente de liaison (`POST /api/v1/conversations/uploads`) n’ont pas de suppression : un chargement jamais lié est nettoyé au chargement suivant dans l’organisation, une fois passées sa fenêtre de deux heures et 24 heures de grâce, tandis qu’une référence liée vit et meurt avec son message. Chaque corps de conversation est strict : une clé inconnue, dans un message ou une pièce jointe aussi, donne **400**, `INVALID_BODY`, qui la nomme.

Pour créer un document du hub, envoie son contenu dans `content` à `POST /api/v1/documents`. Ce contenu inline reste stocké et lisible, mais il n’est jamais indexé : la recherche ne trouve que les documents adossés à un fichier chargé, et `POST .../retry-indexing` répond `{"status": "skipped", "reason": "content-only"}` pour un document sans fichier (les autres motifs sont `untracked-blob` et `rag-opt-out`). L’alternative `fileId` exige un chargement du hub encore sans liaison, effectué depuis l’app par le détenteur de la clé dans l’organisation choisie. REST ne crée pas ce chargement. Pour mettre du texte dans le corpus de recherche depuis REST, crée plutôt une entrée de connaissances : `POST /api/v1/knowledge-entries` produit un document du hub adossé à un fichier et indexé (`sourceProvider: knowledge`, 8 000 caractères au plus, une entrée active par sujet), un remplacement le réindexe sous le même `documentId`, et une suppression le met à la corbeille. Ce document refuse un `DELETE /api/v1/documents/{id}` direct, ou un `PATCH` de son titre ou de son contenu, avec **409**, `DOCUMENT_HAS_KNOWLEDGE_ENTRY` et `data.entryId` — l’entrée est le moyen de le changer. Chaque document adossé à un fichier porte `indexing` — `status` vaut `pending`, `queued`, `running`, `completed`, `failed`, `unsupported` ou `skipped`, avec `indexedAt`, `error` et `errorCode` quand ils sont posés — interroge donc le document après une création ou un `retry-indexing` au lieu de dormir. Un fichier déjà lié à un document, un thread ou une conversation ne peut pas servir ici. Un chargement absent, appartenant à un autre utilisateur ou déjà lié donne **404**, `FILE_NOT_FOUND`. Cette route ne transforme pas les chargements de projet, de chat ou de conversation en documents du hub. Les documents supprimés ou expirés, y compris les fichiers d’un projet supprimé, restent absents de cette interface. Les corps de `POST` et `PATCH` sont stricts : un `projectId` donne **400**. Crée les fichiers de projet avec les routes de chargement et de fichiers du projet.

## Gérer les agents d’un projet

Chaque agent appartient à un projet. L’ID du projet est obligatoire dans l’URL de chaque opération ; les réponses incluent `projectId` et l’`id` de l’agent. Ce sont les mêmes agents que dans l’onglet **Agents** du projet, avec les mêmes droits d’accès.

| Opération                          | Route                                           | Réussite       |
| ---------------------------------- | ----------------------------------------------- | -------------- |
| Lister les agents                  | `GET /api/v1/projects/{id}/agents`              | `200 {agents}` |
| Créer                              | `POST /api/v1/projects/{id}/agents`             | `201 {agent}`  |
| Lire                               | `GET /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Enregistrer toute la configuration | `PUT /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Supprimer                          | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204`          |

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

`POST` et `PUT` exigent `name`, `harness`, `model`, `skills` et `connectors`. Les champs facultatifs sont `modelProvider`, `tools`, `secrets` et `instructions`. Un `PUT` enregistre toute la configuration : omettre le fournisseur ou les instructions les remet à `null`, omettre les outils ou les secrets vide ces listes. L’ID doit déjà exister ; un `PUT` ne crée pas un nouvel agent. Transmets l’`updatedAt` lu en dernier dans `expectedUpdatedAt` pour rendre l’enregistrement conditionnel : un agent modifié entre-temps répond **409**, `PROJECT_AGENT_STALE`, avec l’`updatedAt` courant dans `data`, et rien n’est écrit — recharge-le et fusionne avant d’enregistrer de nouveau.

Un projet contient au maximum 50 agents. Leurs noms sont distincts dans le projet sans tenir compte de la casse, avec 120 caractères au plus ; chaque liste d’équipement accepte 25 entrées et les instructions 20 000 caractères. Une configuration invalide, un nom déjà pris ou une limite dépassée renvoie **400**. `model` doit être un modèle que le catalogue de l’organisation liste (nomme `modelProvider` quand plusieurs fournisseurs le servent) et `tools` ne doit nommer que des autorisations d’outils connues — une valeur fausse renvoie **400** avec `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` ou `PROJECT_AGENT_TOOL_UNKNOWN`, qui nomme ce qu’il faut corriger, plutôt qu’un agent qui échoue à sa première tâche. `secrets` contient des noms de secrets de l’organisation, jamais leurs valeurs ; un nom que l’organisation n’a pas enregistré est refusé avec **400**, `PROJECT_AGENT_SECRET_UNKNOWN`, qui le nomme dans `data.secrets` (le dialogue de l’app écarte ces noms, l’API non — une faute de frappe ne produit donc jamais un agent qui tourne sans ses identifiants). Seuls les Propriétaires et Admins peuvent modifier ces autorisations. Un Éditeur doit donc conserver les autorisations existantes dans sa configuration complète.

Le droit de lire un projet permet de lire ses agents ; les modifications exigent un projet actif et le droit de le modifier. Un projet invisible ou absent, ou un ID d’agent d’un autre projet, renvoie **404**. Si le titulaire de la clé appartient à plusieurs organisations, chaque lecture et écriture doit inclure `X-Organization-Slug`. [Agents de projet](/fr/platform/projects/project-agents) explique leur travail sur les tâches ; le chat direct utilise toujours l’assistant intégré.

## Les noms d'automatisation dans les URL

Le nom d'une automatisation est un chemin en `/` — `billing/dunning` — et un chemin ne tient pas dans un seul segment d'URL. Dans chaque URL `.../automations/{name}/...`, écris le nom avec `__` à la place de chaque `/` :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Les réponses portent toujours le vrai nom (`"name": "billing/dunning"`) ; la forme `__` n'existe que dans les URL. Les slugs de skills sont plats et ne s’encodent pas. Les agents de projet utilisent l’ID du projet et celui de l’agent.

`GET /api/v1/automations` liste chaque automatisation avec `latestVersion`, `deployedVersion` et `projectIds` — les projets où elle est installée, ceux que les routes d’exécution ci-dessous exigent — plus ce qu’un lanceur doit savoir sans second appel : sa `description`, le schéma `inputs` qu’une exécution doit respecter (celui de la version déployée, sinon celui de la dernière version enregistrée) et son `trigger` — le type et s’il est activé, ou `null`. `GET /api/v1/automations/{name}` répond par défaut la dernière version enregistrée, qui peut être un brouillon ; une exécution live exécute la version déployée, lis donc le contrat du code qui tourne vraiment avec `?version=deployed` (un nombre désigne n’importe quelle version enregistrée). Une version que l’automatisation n’a pas donne **404** `AUTOMATION_VERSION_UNKNOWN` — `?version=deployed` sans rien de déployé aussi — là où une automatisation inconnue donne `AUTOMATION_NOT_FOUND`. `GET /api/v1/automations/{name}/versions` nomme la `deployedVersion` et marque chaque ligne `deployed`. `DELETE /api/v1/automations/{name}` supprime l’automatisation avec ses versions, ses déclencheurs et ses liaisons de projet, et répond **409** `AUTOMATION_HAS_ACTIVE_RUNS` tant qu’une exécution est en cours ; il demande la capacité développeur.

## Déclencheurs

Un déclencheur démarre une automatisation sans appel de ta part : selon un planning, depuis une URL de webhook, ou quand la plateforme émet un événement. Lie-en un avec `PUT /api/v1/automations/{name}/triggers` — un déclencheur par automatisation, et le `PUT` remplace ce qui était lié :

```bash
curl -sS --compressed -X PUT "https://your-host.example.com/api/v1/automations/billing__dunning/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "event", "event": "contact.created" }'
# → 200 { "name": "billing/dunning" }
```

`kind` vaut `schedule` (avec un `cron` à cinq champs et un `timezone` IANA facultatif), `webhook` (la réponse porte le `token` de l’URL une seule fois — la [page Webhooks](/fr/develop/webhooks) couvre cette porte) ou `event`. Un déclencheur qui ne pourrait jamais se déclencher est refusé avec **400** `AUTOMATION_TRIGGER_INVALID` et une phrase qui nomme la correction : un cron qui ne correspond à rien, un fuseau qui n’est pas une zone IANA, un événement que la plateforme n’émet pas. Un déclencheur d’événement se lie à l’un des événements que la plateforme émet aujourd’hui, et l’entrée de l’exécution est `{ "trigger": "event", "event": "<name>", "payload": <les données de l'événement> }` :

| Événement                                               | Émis quand                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact.created`, `contact.updated`, `contact.deleted` | un contact est créé, modifié ou supprimé — par l’API, l’app ou un import                                                                                         |
| `conversation.created`                                  | une conversation s’ouvre dans la boîte de réception — un e-mail qui arrive, ou une conversation externe reflétée                                                 |
| `conversation.message_received`                         | un message arrive sur une conversation existante                                                                                                                 |
| `project.created`                                       | un projet est créé                                                                                                                                               |
| `task.created`                                          | une tâche est créée — sur un board, par l’API ou par un intake                                                                                                   |
| `task.status_changed`                                   | une personne déplace une tâche vers un autre statut (les déplacements d’un agent n’émettent rien, une automatisation ne peut donc pas se redéclencher elle-même) |
| `comment.created`                                       | un commentaire arrive sur une tâche                                                                                                                              |
| `comment.mentioned`                                     | un commentaire de tâche mentionne quelqu’un avec `@`                                                                                                             |

`GET .../triggers` relit la liaison : `lastFiredAt` est la dernière fois que cette liaison s’est déclenchée, et une reliaison vers un autre type remet ce compteur à zéro. `enabled: false` met un déclencheur en pause sans le perdre ; `DELETE .../triggers` le retire — et, pour un webhook, révoque l’URL.

## Démarrer une exécution, puis la suivre

Une exécution est durable et peut prendre des minutes — le démarrage répond donc **202** avec l'identité de l'exécution, pas son résultat :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

Interroge `GET /api/v1/projects/{id}/runs/{runId}?fields=status,finishedAt` jusqu’à ce que `status` quitte `queued`/`running`/`waiting` — nommer les clés garde la requête à une ligne au lieu de toute l’exécution, et renvoyer l’`ETag` de la réponse en `If-None-Match` transforme une interrogation sans changement en **304** sans corps ([cache](#cache-compression-et-lectures-partielles)) ; lis ensuite l’exécution en entier : elle porte `output`, la `trace` nœud par nœud et les `effects` produits. `POST /api/v1/projects/{id}/runs/{runId}/cancel` arrête une exécution à sa prochaine frontière de nœud — ce qu’un nœud a déjà fait n’est pas défait.

Un démarrage se relance sans risque quand tu le nommes : envoie `Idempotency-Key: <ta clé>`, et une répétition dans les 24 heures — un timeout relancé, une réponse perdue — répond **202** avec l’exécution que la première tentative a lancée et `"duplicate": true`, donc aucune seconde exécution n’existe ; la même clé avec un corps différent donne **409** `IDEMPOTENCY_KEY_REUSED`. La clé est limitée à l’automatisation et au projet de l’URL, et un démarrage refusé ne retient rien, la même clé s’exécute donc une fois le refus corrigé.

`mode` vaut `live` par défaut. Les exécutions live à entrée libre et les annulations exigent la capacité développeur. Une exécution de projet demande aussi l’accès en édition à un projet actif, y compris avec `mode: "mock"`. Les mocks sont déterministes ; sans projet, une exécution mock demande seulement l’appartenance. Aucun déclencheur n’est nécessaire. Sans version déployée, l’appel donne **409**, sauf si tu choisis explicitement une version enregistrée pour une exécution mock.

Une automatisation inconnue répond **404**. Une exécution live accepte uniquement la `version` déployée ; une autre version enregistrée donne **409**. Teste-la avec `mode: "mock"`. Sans corps, l’entrée vaut `{}` ; un JSON mal formé donne **400** et ne démarre rien. Si l’automatisation définit un schéma `inputs`, l’entrée doit le respecter avant la création de l’exécution : un écart donne **400** `AUTOMATION_INPUT_INVALID` avec chaque problème sous `data.issues` (`path`, `message`), comme pour un corps refusé. `input` ne vaut `{}` par défaut que s’il est absent — `null` est envoyé comme null, au schéma d’en juger.

Le projet dans l’URL fournit le contexte aux outils de tâches et de documents de l’exécution. Une automatisation liée à des projets ne peut tourner que dans l’un d’eux. `GET /api/v1/projects/{id}/automations/{name}/runs` lit l’historique de ce projet pour une automatisation, `GET /api/v1/projects/{id}/runs` pour toutes. Les listes répondent des résumés — identité, périmètre, statut et horodatage — les plus récents d’abord, sous la forme `{ "runs": [...], "isDone": ..., "continueCursor": ... }` : ajoute `?status=failed` (un ou plusieurs statuts, séparés par des virgules) pour les filtrer, `?include=input,output` (ainsi que `trace`, `effects`, `checkpoints`) pour inclure les champs complets qu’un résumé laisse de côté — une page qui inclut lit au plus 25 lignes, est bornée à 8 Mio d’entre elles et s’arrête plus tôt, `isDone: false`, quand la ligne suivante ne tient plus —, et renvoie `continueCursor` en `?cursor=` jusqu’à `isDone`. `GET /api/v1/runs` est la vue transversale : chaque exécution que le détenteur de la clé peut voir, exécutions d’organisation et exécutions des projets visibles confondues, chaque ligne nommant son `projectId`. Sans aucune liaison, `POST /api/v1/automations/{name}/runs` démarre une exécution sans projet ; une automatisation liée y donne **409**. `GET /api/v1/automations/{name}/runs` et `/api/v1/runs/{runId}` exposent uniquement les exécutions sans projet. Pour lire, annuler ou supprimer une exécution de projet, utilise l’URL de ce projet. `DELETE /api/v1/projects/{id}/runs/{runId}` (ou `/api/v1/runs/{runId}`) supprime une exécution terminée — entrée et sortie stockées comprises — sous la capacité développeur ; une exécution encore en cours donne **409** `RUN_ACTIVE`, annule-la d’abord.

## Envoyer un message, puis suivre le tour

Le chat de projet suit aussi la séquence 202, puis suivi. Choisis un projet que tu peux lire, crée un thread, envoie un message, interroge la génération, puis lis les messages :

Liste les modèles avant d’envoyer un message. Chaque entrée porte ce qu’il faut pour choisir — `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `pricing` quand le catalogue publie un prix, `tags` — et `default: true` marque le choix de l’organisation pour ce détenteur de clé ; il n’apparaît que si l’organisation a épinglé un modèle par défaut, ne l’attends donc pas. Reprends `id` dans `model` ; ajoute `providerSlug` quand le même id est listé sous plusieurs fournisseurs. La liste respecte les règles d’accès aux modèles de l’organisation et ne contient que ceux que REST peut appeler directement. Une liste vide signifie qu’aucun modèle de chat n’est disponible pour le détenteur de la clé. La liste est le catalogue configuré de l’organisation, pas une promesse du compte fournisseur : un opérateur exclut un modèle que le forfait du fournisseur ne couvre pas via la liste des modèles autorisés des identifiants du fournisseur, dans Paramètres. Le couple est vérifié à l’envoi, dès la porte : un id absent de la liste donne **400**, `CHAT_MODEL_UNKNOWN` ; un id servi par plusieurs fournisseurs sans qu’aucun soit nommé, **400**, `CHAT_MODEL_AMBIGUOUS` avec les candidats dans `data.providers` ; un `providerSlug` absent de la liste, **400**, `CHAT_PROVIDER_UNKNOWN`, et un fournisseur qui ne sert pas le `model` choisi, **400**, `CHAT_MODEL_NOT_ON_PROVIDER`. Le 202 nomme le fournisseur sur lequel le tour s’exécute, et le tour ne bascule jamais en silence vers un autre.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# Aucun modèle disponible → 200 { "models": [] }
```

```bash
# 1. Un thread à toi
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" -d '{}'
# → 201 { "id": "<threadId>" }

# 2. Envoyer un message — sur cette API le modèle est toujours explicite, jamais choisi pour toi
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Résume-moi ce trimestre.", "model": "<model-id>", "providerSlug": "<provider-slug>" }'
# → 202 { "threadId": "...", "status": "accepted", "model": "...", "providerSlug": "...", "messageId": "<assistantMessageId>", "poll": "/api/v1/projects/<projectId>/threads/<threadId>/generation" }

# 3. Interroger jusqu'à idle, puis lire
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/generation" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "status": "queued", "messageId": "..." } … puis { "status": "streaming", "messageId": "...", "text": "Le trimestre…", "reasoning": "", "cancelRequested": false, "updatedAt": 1774... } … puis { "status": "idle" }
```

`{"status": "idle"}` signifie qu’aucun tour ne tourne. Lis `GET /api/v1/projects/{id}/threads/{threadId}/messages` pour obtenir la réponse. `queued` signifie que l’envoi est accepté et attend un worker ; `streaming` que le modèle est en train de streamer sa réponse vers le serveur, et `text` et `reasoning` portent ce qui est arrivé jusque-là — il n’y a pas de canal push sur cette surface, interroge donc toutes les deux à cinq secondes avec un délai client d’au moins trente secondes. Garde le `messageId` que nomme le 202 : c’est le message d’assistant dans lequel la réponse atterrit. Si tu perds le 202 (une connexion coupée après l’envoi), interroge `.../generation` — `queued` ou `streaming` veut dire que le tour tourne, `idle` veut dire lis les messages et retrouve la réponse par ce `messageId`, ou par la ligne `user` la plus récente qui porte ton `content`.

Chaque tour passe par l’assistant intégré de l’espace de travail : ses instructions, ses règles de sécurité et ses trois outils de recherche accompagnent chaque requête — environ 3 000 tokens de prompt, comptés dans `usage.inputTokens` — et une demande de livrable (un document, un rapport) est redirigée vers Tâches à dessein. C’est une conversation avec l’espace de travail, pas un appel de modèle nu. Deux champs facultatifs bornent un tour : `reasoningEffort` choisit la profondeur de raisonnement sur la même échelle à cinq crans que l’app (`low`, `medium`, `high`, `extra`, `max` ; ignoré par un modèle sans `capabilities.reasoning`), et `maxOutputTokens` plafonne la réponse — il ne doit pas dépasser le `maxOutputTokens` du modèle dans `GET /api/v1/models`, sinon l’envoi donne **400**, `INVALID_BODY`, qui nomme le plafond ; un modèle qui réfléchit garde son budget de raisonnement sous ce plafond. Les listes, détails, messages et statuts montrent uniquement les threads du détenteur de la clé dans ce projet. Ceux d’un autre utilisateur restent invisibles, même dans un projet commun. `GET /api/v1/projects/{id}/threads` liste tes threads ; `GET /api/v1/projects/{id}/threads/{threadId}` en lit un.

`content` est nettoyé de ses espaces avant la vérification : un prompt vide donne **400** au lieu de consommer un tour ; `locale` est un tag BCP 47 (`de`, `en-GB`) qui nomme la langue dans laquelle l’assistant répond. Chaque message porte un `status` : pendant qu’un tour tourne, sa ligne d’assistant figure déjà sur la page en `pending` avec des `parts` vides — la ligne que `.../generation` nomme dans `messageId` — et passe à `complete`, à `cancelled` après un arrêt (avec la sortie partielle déjà streamée), ou à `failed` avec `error` et `errorCode`, quand le tour se termine. `usage` porte les compteurs de tokens et le coût : `reasoningTokens` est la part d’`outputTokens` passée à réfléchir, `cachedInputTokens` la part d’`inputTokens` servie depuis le cache du fournisseur, et `costEstimateCents` (en cents US, avec décimales) l’estimation du catalogue que le registre d’usage de l’organisation inscrit pour le même tour — absente quand le catalogue ne publie aucun prix pour le modèle. `usage` est absent sur un tour qui a échoué avant que le fournisseur ait rapporté le moindre compteur. `parts` est une liste ordonnée distinguée par `type` — `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval`, `human-input` — et le document OpenAPI type chaque sorte. Une part `reasoning` est la réflexion du modèle et peut citer mot pour mot les instructions de l’assistant : affiche-la comme telle, jamais comme la réponse. Le vocabulaire est additif ; une sorte que tu ne connais pas, affiche-la comme opaque.

Pour un chat personnel sans projet, utilise `/api/v1/threads` et ses chemins de détail, de messages et de génération. Ces URL ne donnent pas accès aux threads de projet. Un mauvais projet dans l’URL donne **404**. Les deux types de chat utilisent l’assistant intégré ; `projectId`, `agentSlug` ou `agentId` dans un corps de création ou de message donne **400**. Les lecteurs du projet, y compris les Membres, peuvent créer et envoyer. Un projet archivé refuse ces écritures avec **403**. Un thread archivé refuse un message avec **409**, `CHAT_THREAD_ARCHIVED`, un thread sandbox avec **409**, `CHAT_THREAD_NOT_DIRECT`, et un thread dont le tour tourne encore avec **409**, `CHAT_TURN_IN_PROGRESS` — réessaie le dernier une fois que le suivi répond idle, jamais les deux autres.

Le cycle de vie t’appartient par les mêmes URL. `PATCH .../threads/{threadId}` avec `{ "archived": true }` archive un thread et `false` le restaure, et `{ "title": "Q3 review" }` le renomme (envoie au moins l’un des deux) ; un thread créé sans titre est nommé par l’assistant après son premier message, et le `title` du thread porte le nom dans les deux cas. Archiver pose `archivedAt` sur le thread et laisse `updatedAt` intact — `updatedAt` est la dernière activité de messages, une synchronisation qui le surveille doit donc lire `archived` et `archivedAt` pour voir un archivage ou une restauration. `DELETE .../threads/{threadId}` le met à la corbeille (**409**, `CHAT_TURN_IN_PROGRESS` tant qu’un tour tourne) ; `DELETE .../threads/{threadId}/generation` demande au tour en cours de s’arrêter — **202** `{ "status": "cancelling" }`, puis interroge jusqu’à idle ; la réponse arrêtée se fixe en `status: "cancelled"` avec ce qui avait été streamé ; **404**, `CHAT_TURN_NOT_RUNNING` quand rien ne tourne. Un projet archivé refuse les trois avec **403**.

Un échec du modèle peut apparaître dans un message d’assistant avec un texte lisible dans `error` et, si disponible, un `errorCode`. La liste des modèles est le catalogue configuré de l’organisation, pas une promesse du compte fournisseur : deux codes désignent donc le compte plutôt que la requête, `credit_exhausted` (solde épuisé) et `model_not_entitled` (le forfait du fournisseur n’inclut pas ce modèle). Choisis un autre modèle ou remets le compte en ordre — attendre ne change rien, et aucun des deux n’est un `rate_limited`. Avant d’ouvrir le tour, le worker revérifie le thread accepté et l’accès au projet. Si le thread change de projet ou que l’accès disparaît pendant l’attente, il n’exécute pas le tour et n’ajoute pas d’erreur dans le nouveau contexte.

## Rechercher dans les fichiers d’un projet

Utilise l’URL du projet quand tous les résultats doivent en provenir. La recherche porte uniquement sur ses fichiers indexés et exige l’accès en lecture, même si le projet est archivé. Les documents du hub ou des équipes, les autres projets, les sites web et les pièces jointes d’e-mails sont exclus. Omets `corpus` ou donne-lui la valeur `"documents"`. Un autre corpus ou un champ `projectId` dans le corps donne **400**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Date limite de déclaration du premier trimestre", "limit": 10 }'
```

Le corps exige `query` (nettoyé de ses espaces avant la vérification) et accepte aussi `limit` (1–50, 10 par défaut) et `minSimilarity` (0–1). `limit` est la taille de la page, pas celle de la recherche : la plateforme fusionne un vivier de candidats plus large, vérifie chaque candidat contre son document vivant, et ne découpe la page qu’ensuite — `limit: 1` renvoie donc le meilleur passage lisible. `minSimilarity` impose un plancher à la seule branche dense (vectorielle) ; il n’y a pas de valeur par défaut, donc sans lui les passages les plus proches répondent, aussi faibles soient-ils, et la branche par mots-clés n’a jamais de plancher (l’outil de recherche de l’assistant intégré utilise 0,45). Les résultats reviennent dans l’ordre fusionné, le meilleur d’abord : `fusedScore` est cette clé de tri, comparable seulement au sein d’une même réponse — ni une confiance, ni une valeur stable d’une recherche à l’autre — et `legs` dit combien de branches de recherche ont trouvé le passage (2 quand la branche par mots-clés et la branche vectorielle étaient d’accord). Chaque résultat porte son passage, le `score` de sa branche et sa `source` ; un résultat de document porte aussi `source.documentId` à côté de la `ref` du blob sous laquelle l’index le classe : pour un résultat du hub (`source.projectId` à null), c’est l’id que prend `GET /api/v1/documents/{id}` ; pour un résultat de projet, l’id de fichier que prennent les routes du projet (`GET /api/v1/projects/{projectId}/files/{documentId}/content`, `DELETE .../files/{documentId}`) — `/api/v1/documents/{id}` répond **404** pour un fichier de projet. Sans modèle d’embedding, la réponse est **409**, `EMBEDDING_NOT_CONFIGURED`. Le même **409** arrive en `EMBEDDING_CREDIT_EXHAUSTED` quand le fournisseur d’embedding refuse pour une raison de compte — solde épuisé, plafond de dépenses atteint, ou forfait qui n’inclut pas le modèle. Une clé que le fournisseur rejette, ou à laquelle il refuse le modèle, donne **409**, `EMBEDDING_CREDENTIAL_REJECTED` — corrige les réglages du fournisseur. Ni l’un ni l’autre n’est une limite de débit : attendre ne change rien, un admin doit intervenir. Toute autre panne côté fournisseur donne **503**, `EMBEDDING_UPSTREAM_ERROR`, avec `Retry-After` — celle-là, réessaie-la avec un backoff. Pour rechercher dans les documents visibles du hub et des équipes sans projet, ou dans les sites web enregistrés, utilise `POST /api/v1/knowledge/search`. Son champ `corpus` accepte `"documents"`, `"web"` ou `"all"`, la valeur par défaut. Cette URL exclut les fichiers de projet et les pièces jointes d’e-mails. Les deux recherches ne trouvent que les documents adossés à un fichier — un `content` inline n’entre jamais dans l’index.

## Refléter un système externe dans un projet

Le groupe Projets est fait pour un worker sans surveillance qui reflète un système externe — un CRM, un logiciel de cabinet — dans Tale : trouver ou créer le projet du client, préparer ses dossiers, charger des fichiers, vérifier. Chaque appel agit comme l'utilisateur qui a créé la clé : un projet que cet utilisateur ne voit pas répond comme un projet qui n'existe pas, et écrire demande un rôle qui édite (Éditeur ou au-dessus — Membre ne fait que lire ici) plus l'accès en édition au projet.

Ces routes — et les routes Tâches plus bas — ne devinent jamais l'organisation : une clé dont l'utilisateur appartient à plusieurs organisations doit envoyer `X-Organization-Slug` à chaque appel — une requête sans le header répond **400**. Crée les clés machine pour un utilisateur dédié avec une seule appartenance, et la question ne se pose plus ; les exemples gardent le header quand même — il est toujours vérifié contre l'appartenance, jamais ignoré.

### Trouver ou créer le projet

`externalItemId` est ta clé, pas celle de Tale — une chaîne opaque (l’id d’enregistrement de ton CRM), unique par organisation, jamais interprétée par la plateforme. Elle est stockée et comparée après normalisation NFC et nettoyage des espaces, si bien qu’une clé transmise en NFD par un système de fichiers macOS trouve le projet qu’un worker a créé en NFC depuis un CSV, et qu’un saut de ligne final venu d’une variable de shell ne crée jamais un second projet. Cherche-la d’abord ; la recherche répond au plus un projet, et une correspondance que l’utilisateur de la clé ne peut pas voir ressemble exactement à aucune :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — ou [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

Une correspondance porte `archivedAt` quand le projet est archivé — décide avant coup ce que ton worker fait de ce cas. Sans `externalItemId`, la même route liste chaque projet que l’utilisateur de la clé peut voir, les plus récents d’abord, paginé comme la liste des fichiers — `{projects, isDone, cursor?}` ; renvoie `cursor` tel quel jusqu’à `isDone` — les projets archivés laissés de côté sauf si tu les demandes (`?archived=include`, ou `?archived=only`). Chaque ligne porte `createdAt` et `updatedAt`, un worker peut donc rapprocher ce qu’il a créé :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?limit=50" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711", "createdAt": 1774..., "updatedAt": 1774... } ], "isDone": true }
```

Une recherche vide veut dire créer :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key` (le préfixe des identifiants de tâches) et `description` sont optionnels — le key se dérive du nom quand tu l’omets. Une seconde création avec le même `externalItemId` — le même après normalisation NFC et nettoyage des espaces — répond **409** ; la même chaîne dans une autre organisation passe, l’unicité vaut par organisation. Une clé vide une fois nettoyée donne **400**, `INVALID_BODY`.

Un `key` de projet explicite contient 2 à 6 lettres ou chiffres, convertis en majuscules. Une valeur invalide donne **400**, sans troncature. Si le nom ne permet pas de former un key valide, le projet est créé sans key. Un key dérivé qui entre en collision est dérivé de nouveau jusqu’à être libre ; un key explicite qui entre en collision donne **409**, `PROJECT_KEY_TAKEN` — fournis-en un libre. Le même `externalItemId` deux fois donne **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

### Créer les dossiers

La création de dossier est un get-or-create : le même nom sous le même parent — comparé sans tenir compte de la casse, `inbox` et `INBOX` sont donc un seul dossier — répond le dossier existant, avec son nom stocké et `created: false` (**200**), au lieu d’un doublon ; un worker rejoue son étape de préparation à l’aveugle après un crash, et deux workers qui créent le même dossier en même temps obtiennent un seul dossier. Les noms de dossiers n’ont aucun sens réservé côté plateforme — l’agencement t’appartient :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

`parentId` (un dossier de ce projet) imbrique plus profond ; omets-le pour un dossier racine. Un nom fait 128 caractères au plus, nettoyé de ses espaces, et n’est jamais un chemin — `a/b`, `.` et `..` donnent **400**, `FOLDER_NAME_INVALID` — et un dossier à 20 niveaux de profondeur n’accepte aucun enfant (**400**, `FOLDER_DEPTH_EXCEEDED`). `GET .../folders` liste les dossiers racine.

### Charger un fichier en deux étapes

Un chargement est un handoff, puis une liaison. Demande d'abord le handoff — il répond où vont les octets :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/uploads" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "application/pdf" }'
# → 200 { "uploadId": "...", "url": "https://...", "method": "PUT", "s3Ref": "...", "expiresAt": 1774... }
```

Chaque blob est stocké dans le stockage objet, donc `url` est toujours un `PUT` présigné : envoie les octets là avec cette méthode et sans en-tête `Authorization` — l’URL porte sa propre signature, et le bucket refuse une requête qui s’authentifie deux fois — avec un en-tête `Content-Type` strictement identique au `contentType` déclaré au moment du mint — le type déclaré est signé dans l’URL, le bucket refuse donc un PUT qui en porte un autre (sans `contentType` au mint, le PUT n’impose aucun en-tête) — puis lie la `s3Ref` du handoff comme `fileId`. Nomme le fichier dès le mint (`"fileName": "ledger-2026-q1.pdf"`) et les règles de type de la liaison s’appliquent avant toute présignature : un nom que la politique de chargement de l’organisation ou la liste des formats autorisés de la plateforme refuse donne **400** ici (`UPLOAD_POLICY_REJECTED`, `UNSUPPORTED_FILE_TYPE`), les octets ne voyagent donc jamais. La liaison termine le chargement :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/files" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "uploadId": "<uploadId>", "fileId": "<s3Ref>", "folderId": "<folderId>", "fileName": "ledger-2026-q1.pdf" }'
# → 201 { "file": { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "projectId": "<projectId>" } }
```

Le `uploadId` sert une seule fois et expire après 30 minutes, et l’`url` présignée expire avec lui — `expiresAt` est la seule échéance pour les deux — donc un worker qui a crashé en plein chargement demande un handoff frais au lieu de rejouer l’ancien. `fileName` est un simple nom : un séparateur de chemin ou un caractère de contrôle dedans donne **400**. La politique de chargement s’applique à la liaison : un blob trop gros ou un type hors de la liste autorisée est refusé avec **400** et un code de raison ; une liaison dont les octets n’ont jamais atteint l’URL présignée donne **404**, `BLOB_NOT_FOUND`, et l’intention est annulée, donc envoie le fichier en PUT et lie le même handoff de nouveau. Un déploiement sans stockage objet répond **503**, `OBJECT_STORE_UNCONFIGURED`, au mint comme à la liaison.

Les fichiers qui passent par cet accès sont du matériel de travail du projet, pas des connaissances de l'organisation : ils sautent l'indexation des connaissances par défaut (`skipRagIndexing` vaut `true` par défaut à la liaison ; envoie `false` pour les indexer), et ils n'apparaissent jamais sous `/api/v1/documents` — cette famille reste la surface de la base de connaissances.

### Vérifier ce qui est arrivé

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "createdAt": 1774... } ] }
```

La liste répond `{files, isDone, cursor?}` : un `cursor` dans la réponse veut dire d’autres pages — renvoie-le en `?cursor=` tel quel (c’est un jeton signé opaque), borne la page avec `?limit=` (100 au plus).

### Supprimer ce dont tu n’as plus besoin

Rien de ce que cet accès crée n’a à rester pour toujours. Un fichier part avec `DELETE .../files/{documentId}` — définitivement : sa ligne de document, ses lignes du corpus de recherche et son blob sont purgés par la même voie que toute suppression définitive, la réponse est donc **204** ou un refus, jamais un non-événement silencieux :

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

Un dossier part avec `DELETE .../folders/{folderId}`, et tout ce qui est dessous part aussi — chaque fichier qu’il contient et que contiennent ses sous-dossiers est purgé d’abord (leurs lignes de corpus libérées d’un coup, la recherche du projet cesse donc de les trouver), puis le sous-arbre. Un document maîtrisé protégé ou une conservation légale n’importe où dessous refuse toute la suppression avec **409** avant que quoi que ce soit soit retiré ; une purge que le stockage objet n’a pas pu terminer donne **503**, `PURGE_INCOMPLETE`, sans rien retirer — réessaie-la. Les deux suppressions demandent l’accès en édition à un projet actif ; un fichier ou un dossier d’un autre projet, ou déjà parti, donne **404** (`FILE_NOT_FOUND`, `FOLDER_NOT_FOUND`).

Le projet lui-même a aussi un cycle de vie, réservé aux admins de l’organisation (**403**, `ROLE_FORBIDDEN`, pour tous les autres). `PATCH /api/v1/projects/{id}` avec `{ "archived": true }` l’archive — il reste lisible par cet accès, refuse toute écriture avec **403**, `PROJECT_ARCHIVED`, garde son `externalItemId` occupé, et `{ "archived": false }` le restaure. `DELETE /api/v1/projects/{id}` le supprime et libère la clé : par défaut en cascade — chaque document expire dans le pipeline de rétention, tes propres chats vont à la corbeille, chaque tâche est retirée et ses exécutions en cours annulées — ou, avec le corps `{ "mode": "detach" }`, les documents et les chats sont relâchés dans l’organisation à la place. Les agents et les dossiers partent avec le projet dans les deux cas, et une cascade puise dans le même budget par utilisateur que la suppression dans l’app (5 par minute) :

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

La suppression est refusée avec **409**, avant toute écriture, tant qu’une automatisation est installée dans le projet — `PROJECT_HAS_BOUND_AUTOMATIONS`, avec `data.automations` qui les nomme ; désinstalle chacune d’abord via `DELETE /projects/{id}/automations/{name}` — tant qu’une cascade détruirait un document maîtrisé en relecture, approuvé ou qui conserve une version approuvée (`PROJECT_HAS_PROTECTED_RECORDS`, `data.documents` les nomme), ou tant qu’une conservation légale couvre l’un de ses documents (`PROJECT_LEGAL_HOLD`).

## Créer une tâche, puis l'exécuter

Les routes de tâches transforment un élément externe en tâche sur le board du projet, y démarrent un workflow déployé et en récupèrent les résultats. Une automatisation liée à des projets doit d’abord être installée dans celui-ci. L’installation est idempotente : **201** au premier appel, **200** si la liaison existe. Elle exige la capacité développeur et l’accès en édition à un projet actif. Prépare la liaison en amont si le compte du worker n’a pas ces droits :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` liste les automatisations installées dans ce projet. Une automatisation sans aucune liaison peut aussi tourner dans un projet accessible si l’appelant possède les droits d’édition requis, mais elle ne figure pas dans cette liste. `DELETE /api/v1/projects/{id}/automations/{name}` la désinstalle — **204**, ou **404** `AUTOMATION_NOT_INSTALLED` si elle n’y était pas installée — sous la même capacité développeur et le même accès en édition.

La création est idempotente par `(projectId, externalSystem, externalId)` : le premier appel crée la tâche (**201**, `created: true`), un nouvel appel renvoie la même (**200**, `created: false`). Les deux clés sont stockées et comparées après normalisation NFC et nettoyage des espaces — la même règle que l’`externalItemId` d’un projet — donc une répétition avec des espaces autour ou une normalisation différente reste la même tâche, et une clé vide une fois nettoyée donne **400**. Le `projectId` vient de l’URL ; l’envoyer dans le corps donne **400**. La création exige l’accès en édition à un projet actif.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Un nouvel appel avec la même référence externe d’une tâche active met à jour son titre et sa description. Omettre `description` l’efface ; les libellés changent uniquement s’ils sont envoyés. Une tâche archivée reste inchangée. L’identifiant de tâche reste le même et `runWorkflowSlug` ne démarre aucune autre exécution. Garde les mêmes données lorsque tu réessaies après une réponse perdue.

`description`, `labels` et `externalUrl` sont optionnels ; `title` accepte jusqu’à 200 caractères et `externalUrl` doit être une URL `http(s)` absolue — un titre plus long ou un autre schéma donne **400** plutôt qu’une tâche modifiée en silence. Envoie `automationSlug` quand la tâche appartient à une automatisation : elle devient l’assignee, et c’est là-dessus que s’appuie le panneau de travail du dialogue de tâche — le bouton Start, la progression de l’exécution et les questions qu’une exécution pose à l’opérateur (un re-pick ultérieur comble une attribution manquante, mais n’écrase jamais un assignee). `runWorkflowSlug` démarre dans le même appel un workflow déployé sur une tâche fraîchement créée — l’exécution démarre en ligne, donc la réponse porte son `runId` (l’id d’exécution à suivre ; `executionId` le répète et est déprécié), ou `runId: null` quand le slug ne nomme aucune automatisation déployée. Démarre plutôt explicitement quand tu veux nommer le workflow dans un appel séparé. L’`automationSlug` responsable doit désigner une automatisation déployée, sinon l’appel donne **404**. Un workflow lié uniquement à d’autres projets donne **403**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "runId": "<runId>", "executionId": "<runId>" }
```

Le démarrage exige l’accès en édition à un projet actif et une tâche active — une tâche archivée répond **403**, `TASK_ARCHIVED`. L’entrée contient la tâche dans `{task: ...}` ; aucune capacité développeur supplémentaire n’est requise. Le journal attribue le démarrage à ta clé. Suis `GET /api/v1/projects/{id}/runs/{runId}` avec le `runId` (`executionId` porte la même valeur et est déprécié). La réponse est **200** qu’une exécution ait démarré ou non, branche donc sur `started`, jamais sur le seul statut : avec `started: false`, `reason: "already_running"` fournit le `runId` de l’exécution en cours — suis celle-là — et `reason: "not_started"` signifie que le slug ne désigne aucune automatisation déployée.

Rends compte et lis l’état — le commentaire est posté comme l’utilisateur qui a créé la clé, indiscernable de la même personne dans l’app, @mentions comprises. Les lecteurs du projet, y compris les Membres, peuvent commenter une tâche active dans un projet actif ; une tâche archivée refuse le commentaire avec **403**, `TASK_ARCHIVED`, comme un projet archivé avec `PROJECT_ARCHIVED`. La tâche et ses commentaires restent lisibles après archivage. Chaque URL de tâche est jugée de gauche à droite : un projet absent ou invisible répond **404**, `PROJECT_NOT_FOUND`, et seule une tâche absente ou appartenant à un autre projet répond `TASK_NOT_FOUND`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Filed. Confirmation 2026-8842." }'
# → 201 { "comment": { "id": "..." } }

curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "task": { "id": "<taskId>", "title": "...", "status": "in_progress", "externalId": "case-991", "labels": [], ... } }
```

Et récupère les résultats. Ce que l’automatisation a rapporté se trouve dans la discussion de la tâche ; ce qu’elle a déposé arrive comme fichiers dans le dossier du trimestre — les deux se lisent par le même accès. La discussion arrive par pages, la plus récente d’abord (`limit`, 200 par défaut, 500 au plus), en ordre chronologique dans la page ; tant que `isDone` vaut `false`, renvoie `continueCursor` tel quel comme `cursor` pour lire les commentaires plus anciens — c’est un jeton signé opaque, pas un nombre. L’endpoint de contenu streame lui-même les octets (**200**, aucune redirection à suivre), nommés par un `Content-Disposition` RFC 6266, donc un simple `curl -o` dépose le fichier et `--fail-with-body` transforme un refus en code de sortie non nul au lieu d’un fichier plein de JSON :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/comments?limit=100" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "comments": [ { "id": "...", "authorType": "agent", "body": "…", ... } ], "isDone": false, "continueCursor": "<jeton opaque>" }

curl -sS --compressed --fail-with-body "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>/content" \
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

- **400** — requête mal formée : champ requis manquant, mauvais type, clé inconnue, corps illisible, corps qui n’est pas de l’UTF-8, chaîne contenant un caractère NUL, entier au-delà de 2^53 − 1 — la réponse porte `code: "INVALID_BODY"` et liste sous `data.issues` chaque problème avec le champ (`price`, `contacts.2.email` ; une clé inconnue est un problème à part, sous son nom) et la raison, donc corrige ce qu’elle nomme. Les corps sont lus comme du JSON quoi que dise `Content-Type` ; la porte ne répond jamais 415 ; un `cursor` que la liste n’a jamais renvoyé (`INVALID_CURSOR`), un `limit` qui n’est pas un entier (`INVALID_LIMIT` — une valeur hors bornes est ramenée dans la plage à la place) ou un autre paramètre de requête que la route refuse (`INVALID_QUERY`) — aucun n’est lu comme la première page ; une entrée d’exécution que le schéma `inputs` de l’automatisation refuse (`AUTOMATION_INPUT_INVALID`, `data.issues` encore) ou un déclencheur qui ne pourrait jamais se déclencher (`AUTOMATION_TRIGGER_INVALID`) ; un patch de contact qui viderait son dernier champ d’identité (`CONTACT_IDENTITY_REQUIRED`) ; ou une clé multi-organisations qui n’a pas nommé son organisation (`ORG_SLUG_REQUIRED`).
- **401** — clé API absente ou invalide (`UNAUTHORIZED`), avec un défi `WWW-Authenticate: Bearer`.
- **403** — le rôle (`ROLE_FORBIDDEN`) ou l’accès en édition manque, le projet ou la tâche est archivé pour l’écriture demandée (`PROJECT_ARCHIVED`, `TASK_ARCHIVED`), l’automatisation ne peut pas tourner dans ce projet, ou `X-Organization-Slug` nomme une organisation dont le détenteur de la clé n’est pas membre (`ORG_FORBIDDEN`).
- **404** — la ressource est absente, invisible pour le détenteur, appartient au thread d’un autre utilisateur ou à un autre projet que celui de l’URL ; chaque famille nomme son propre code (`PROJECT_NOT_FOUND`, `THREAD_NOT_FOUND`, …), un `X-Organization-Slug` qui ne nomme aucune organisation répond `ORG_SLUG_INVALID`, et une route inconnue répond `NOT_FOUND`.
- **405** — la route existe, mais pas pour ce verbe (`METHOD_NOT_ALLOWED`) ; `Allow` liste les verbes qu’elle sert.
- **409** — l’état empêche l’action : pas de version déployée, automatisation liée appelée sans URL de projet, exécution encore en cours à la suppression (`RUN_ACTIVE`), `Idempotency-Key` réutilisé avec un autre corps (`IDEMPOTENCY_KEY_REUSED`), thread archivé ou tour déjà en cours, sujet, e-mail ou `externalItemId` en double, entrée de connaissances remplacée (`KNOWLEDGE_ENTRY_SUPERSEDED`), `expectedUpdatedAt` périmé (`CONTACT_STALE`, `PRODUCT_STALE`, `DOCUMENT_STALE`), document derrière une entrée de connaissances active (`DOCUMENT_HAS_KNOWLEDGE_ENTRY` — supprime ou modifie l’entrée à la place), ou recherche sans modèle d’embedding.
- **412** — une précondition a échoué : `If-None-Match: *` sur un slug de skill qui a déjà un bundle (`SKILL_EXISTS`) ; rien n’a été écrit.
- **413** — le corps est trop gros (`BODY_TOO_LARGE`) : chaque corps JSON à son plafond (1 Mio sauf mention contraire de l’opération — les plafonds sont listés plus haut), le déclencheur webhook à sa limite de 256 Kio (262 144 octets). Un fichier chargé qui dépasse la politique de taille ou de type est refusé à la liaison avec **400** et un code de raison à la place.
- **422** — un corps de skill que la couche de fichiers ne peut pas lire (`SKILL_MALFORMED`).
- **429** — limite de débit atteinte (`RATE_LIMITED` — sur ce seul refus, `error` répète le code), avec `Retry-After` en secondes entières et `data.retryAfterMs` ; voir [Limites de débit](/fr/develop/rate-limits).
- **431** — l’URL de la requête dépasse 32 Kio ; la réponse vient d’en amont, sans enveloppe.
- **500** — erreur interne (`INTERNAL_ERROR`) ; l’enveloppe porte un `requestId` à citer quand tu la signales.
- **503** — une dépendance dont la requête avait besoin est indisponible : le fournisseur d’embedding (`EMBEDDING_UPSTREAM_ERROR`, avec `Retry-After`), le stockage objet derrière un téléchargement de fichier (`OBJECT_STORE_UNAVAILABLE`, avec `Retry-After`) ou un déploiement qui n’en a pas (`OBJECT_STORE_UNCONFIGURED`), ou une purge de document qui n’a pas pu aboutir (`PURGE_INCOMPLETE`) — réessaie avec un backoff.

Délier le déclencheur d’une automatisation existante (`DELETE .../triggers`) répond **204**, même si aucun déclencheur n’était lié. Une automatisation inconnue donne **404**. Supprimer une ressource absente donne aussi **404**, y compris un contact déjà dans la corbeille ou une entrée de connaissances déjà supprimée. Supprimer une entrée de connaissances active retire chaque version de son sujet et met à la corbeille le document du hub qui la porte — et retire aussitôt les passages de ce document du corpus de recherche ; supprimer ce document directement est refusé. Annuler une exécution inconnue donne **404** ; `{cancelled: false}` signifie qu’elle existe mais qu’elle est déjà terminée.

## Versionnage

Le préfixe REST actuel est `/api/v1/`. Le document OpenAPI sous `/openapi.json` décrit les routes et les schémas de requête et de réponse de l’instance qui tourne, avec `servers` réglé sur cette instance ; `/docs` l’affiche. Prends-le comme contrat pour ton client.

Quelques portes vivent hors de ce document, à dessein : `GET /api/health` est la sonde de liveness sans authentification (`{"status":"ok","version":"<build>"}`), `GET /status` et `/status.json` la [page de statut](/fr/develop/status-page) du déploiement lui-même, `/openapi.json` et `/docs` le contrat lui-même ; les surfaces [WebDAV](/fr/develop/webdav-api) et OpenID Connect (ci-dessus) parlent leurs propres protocoles.

## Où ça se place

Cette page est la moitié REST de la surface externe. L'[endpoint MCP](/fr/develop/mcp-endpoint) expose la même plateforme aux clients MCP — l'écriture d'automatisations vit là-bas, pas dans REST. La [page Webhooks](/fr/develop/webhooks) couvre le déclencheur entrant qui démarre des exécutions sans clé. Si tu construis dans le produit — agents de projet, automatisations — l'onglet [Platform](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
