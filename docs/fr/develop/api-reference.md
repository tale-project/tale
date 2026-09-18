---
title: Référence API
description: Appeler l’API REST de Tale, choisir le périmètre d’une requête, parcourir les listes, suivre les traitements asynchrones et gérer les erreurs.
i18nLintExclude:
  - terminology-loanword
---

L’API REST permet de lire et modifier les ressources Tale avec une clé API : projets, fichiers, tâches, automatisations, exécutions et fils de conversation. Vérifie l’accès avec [ta première requête API](/fr/get-started/developers), puis utilise les sections consacrées aux opérations.

Ton instance sert le schéma OpenAPI détaillé sur `/openapi.json` et une référence interactive sur `/docs`. Utilise son schéma pour générer un client. Cette page explique les droits, le périmètre, les traitements asynchrones et les erreurs communs à ces opérations.

## Une première requête

Définis `TALE_URL` comme origine de l'application, `TALE_API_KEY` comme ta clé et `TALE_ORG_SLUG` comme l'organisation visée. Conserve les secrets dans l'environnement. Vérifie d'abord l'identité avant de créer des ressources :

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/me" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

Une réponse `200` contient `user`, l'`organization` sélectionnée, toutes les `organizations` actuelles, les `capabilities` du déploiement et le nom et l’expiration de la clé sous `key`. Vérifie l’organisation et le rôle avant de continuer. Les exemples suivants emploient des IDs de projet, fichier et exécution fictifs : reprends les vrais IDs dans les réponses précédentes, sans copier un nom affiché ni deviner une valeur.

### Lire toutes les pages d’une liste

Les réponses contiennent des collections nommées, pas un tableau nu. Les schémas OpenAPI `200` de l'instance déclarent `x-tale-pagination` pour choisir la bonne boucle.

| Famille | Requête | Réponse et condition d'arrêt |
| --- | --- | --- |
| Keyset | `cursor`, `limit` | Éléments, `isDone` et `continueCursor` ; arrêter à `isDone: true` |
| Offset : pages de sites uniquement | `cursor` ou `offset`, jamais les deux | `pages`, `total`, `offset`, `hasMore`, plus `isDone` et `continueCursor` signé |
| Sans pagination | Ni `cursor` ni `limit` | Tableau nommé contenant l'ensemble complet ou la sélection bornée annoncée |

Pour les listes keyset, renvoie `continueCursor` sans le modifier. Ne le décode pas et ne l'incrémente pas. À la dernière page, il est vide ; le renvoyer produit `400 INVALID_QUERY`, pas un retour à la première page. Chaque opération indique son plafond : généralement 100 ou 200, et 500 pour les commentaires de tâche. Les valeurs de `limit` supérieures au plafond sont ramenées à ce maximum.

Contacts, produits, documents, entrées de connaissance, fils, messages, sites et exports de notifications placent leurs lignes keyset sous `page`. Exécutions, livraisons, commentaires de tâche, projets et fichiers de projet utilisent le nom de leur ressource, comme `runs` ou `files`. Les exécutions sont classées de la plus récente à la plus ancienne, par 50 par défaut, avec une limite de 1–200. `GET /api/v1/runs` couvre les exécutions visibles de toutes les automatisations.

Automatisations, agents, skills, dossiers, modèles, sessions navigateur, versions et déclencheurs ne sont pas paginés. Une requête de pages de site contenant `cursor` et `offset` reçoit `400 INVALID_QUERY`. Le curseur signé du prochain offset fonctionne aussi avec la boucle keyset habituelle.

Les contacts et produits sont triés par `updatedAt`, puis `id`, dans l’ordre décroissant. Modifier une ligne pendant le parcours peut la déplacer avant ton curseur : ce passage peut donc manquer la modification. Pour un rapprochement complet, compare le `updatedAt` de chaque ligne et répète des parcours entiers. Un curseur ne garantit pas un instantané d’un répertoire qui évolue. Les documents du centre, projets, fichiers de projet et sites sont triés par `createdAt`, du plus récent au plus ancien.

## Authentification

Crée les clés dans **Paramètres > API > REST** avec un accès administrateur ou développeur ; [Clés API](/fr/platform/admin/api-keys) explique l'interface. Une clé n'apparaît qu'une fois et agit comme la personne qui l'a créée. Cette surface REST ne crée, liste, renouvelle ni révoque les clés.

| En-tête | Règle |
| --- | --- |
| `Authorization: Bearer <key>` | Seul emplacement accepté ; conserver toute la chaîne opaque, y compris son préfixe `tale` |
| `X-Organization-Slug: <slug>` | Sélectionner une appartenance actuelle ; toujours l'envoyer dans une intégration réutilisable |
| `x-api-key` | Refusé avec `401`, même avec un Bearer valide ; ne transforme pas la clé en session applicative |

Une personne appartenant à une seule organisation peut omettre l'en-tête d'organisation. Avec plusieurs appartenances, il est nécessaire à chaque appel, lectures comprises. L'organisation ouverte dans le tableau de bord ne sélectionne jamais le périmètre API. La casse du slug est ignorée ; une valeur vide ou composée d'espaces compte comme absente.

| Sélection d'organisation | Résultat |
| --- | --- |
| Plusieurs appartenances, aucun slug | `400 ORG_SLUG_REQUIRED` ; slugs disponibles dans `data.organizations` |
| Slug inconnu | `404 ORG_SLUG_INVALID` |
| Organisation existante sans appartenance | `403 ORG_FORBIDDEN` |
| Appartenance valide | La requête continue avec cette organisation et ce rôle |

`GET /api/v1/me` renvoie aussi les appartenances sous `organizations`. `key.expiresAt` est un horodatage Unix en millisecondes, ou `null` pour une clé sans expiration. Renouvelle les identifiants des traitements autonomes avant que l'expiration provoque `401`. `key.name` identifie la clé utilisée.

Avant de proposer une opération, vérifie le rôle et l’accès à la ressource. Un lecteur de projet peut discuter et commenter ; les modifications et les démarrages de tâches demandent un accès en écriture.

| Capacité renvoyée par `/me` | Autorisation |
| --- | --- |
| `developer` | Les rôles Propriétaire, Admin et Développeur peuvent démarrer des exécutions réelles arbitraires, annuler ou supprimer des exécutions, lier ou retirer des déclencheurs, supprimer des automatisations et installer ou retirer celles d’un projet. Sinon, ces opérations REST donnent `403 ROLE_FORBIDDEN`. MCP vérifie aussi cette capacité pour enregistrer, déployer et utiliser d’autres outils privilégiés, avec son propre format d’erreur. La validation et les outils de simulation restent accessibles aux membres. L’accès au projet est vérifié séparément. |
| `deploymentEditor` | La liste d’autorisation de l’opérateur permet d’importer ou de révoquer des sessions de navigateur. Un rôle administratif seul ne donne pas cette capacité. |
| `notificationExport` | La clé peut exporter les notifications des membres avec `GET /api/v1/notifications/sync`. Les Propriétaires et Admins disposent de cette capacité par leur rôle ; les autres membres seulement tant qu’une attribution `tale:notifications.export` accordée par un Admin est active. Voir [Déléguer l’export sans rôle Admin](#deleguer-lexport-sans-role-admin). Sinon, l’export renvoie `403 ROLE_FORBIDDEN`. |
| `actAs` | La clé peut nommer un `actor` — le membre vérifié pour lequel un geste relayé est enregistré — sur `POST …/runs/{runId}/asks/{askId}` et `POST …/tasks/{taskId}/review`. Les Propriétaires et les Admins l’ont par leur rôle ; tout autre membre seulement tant qu’une attribution `tale:rest.act-as` faite par un Admin est active — voir [Nommer le membre pour lequel on agit](#nommer-le-membre-pour-lequel-on-agit). Sans ce droit, un `actor` envoyé donne `403 ROLE_FORBIDDEN`. |

## Ce que chaque requête doit respecter

### Valider le JSON et les paramètres de requête

Envoie du JSON en UTF-8. L’API refuse l’UTF-8 invalide, les caractères NUL, les substituts UTF-16 non appariés dans les clés ou les valeurs et les entiers au-delà de 2^53 − 1 avec `400 INVALID_BODY`. Représente les grands identifiants par des chaînes. Les erreurs imbriquées donnent le chemin complet, comme `messages.0.createdAt`. Les IDs sont des chaînes et les dates des horodatages Unix en millisecondes. Le `updatedAt` d’un skill correspond à l’écriture de son `SKILL.md`.

| Entrée | Règle |
| --- | --- |
| Clé inconnue dans le corps | `400 INVALID_BODY`, avec le nom de la clé dans le détail de l’erreur |
| Clé JSON répétée | La dernière valeur gagne |
| Paramètre de requête inconnu, répété ou vide | `400 INVALID_QUERY` |
| Paramètres d’URL sur une écriture | Refusés ; les écritures n’acceptent aucun paramètre de requête |
| `limit` dans l’URL hors plage | Ramené à la plage de l'opération |
| Valeur numérique hors plage dans le corps | `400 INVALID_BODY`, par exemple `limit` de recherche ou `maxOutputTokens` |
| `Content-Type` | Le corps est lu comme du JSON indépendamment de cet en-tête ; pas de `415` sur cette surface |

Les opérations JSON renvoient du JSON quel que soit `Accept`, même si cet en-tête demande un autre format ou exclut JSON. Elles ne renvoient pas de `406`.

### Limites de taille et de réception

| Corps | Maximum |
| --- | --- |
| Requête JSON ordinaire | 1 Mio |
| Contenu de document intégré | 32 Mio |
| Import groupé de contacts | 8 Mio |
| Instantané de conversation | 8 Mio |
| Chargement préparé pour une conversation | 30 Mio |
| Enregistrement de skill | 4 Mio |
| Réservation, signalement d’échec ou confirmation de livraison | 64 Kio |

Un corps trop grand reçoit `413 BODY_TOO_LARGE`. Si la longueur déclarée dépasse déjà la limite, la plateforme refuse sans lire le corps ; sinon elle s'arrête au premier bloc qui la dépasse. Elle ne garde jamais le corps trop volumineux en entier. Les règles d'envoi peuvent imposer un plafond inférieur à ces limites de transport.

En-têtes et corps doivent arriver en moins de 15 minutes. Un corps de 30 Mio demande environ 35 Ko/s pour respecter ce délai. Une requête plus lente reçoit `408 REQUEST_TIMEOUT` et la connexion se ferme. Utilise une connexion plus rapide, de plus petites requêtes prises en charge ou l'envoi de projet en deux étapes, qui transfère les octets hors de cette fenêtre JSON.

### Méthodes et identifiants de réponse

Les routes de lecture existantes acceptent `HEAD`, avec la taille du `GET` non compressé et sans corps. `HEAD` n'est jamais compressé. `OPTIONS` est sans clé et renvoie `204` avec `Allow`. Une méthode non prise en charge sur une route existante reçoit `405 METHOD_NOT_ALLOWED` et les méthodes permises. Une barre oblique finale est tolérée.

La surface REST de production est destinée aux appels serveur à serveur et n'active pas CORS. Conserve les clés API dans ton propre backend. Le JSON de statut sans clé est une surface distincte avec CORS.

Chaque réponse API contient `X-Request-Id`. Pour relier un appel aux logs, envoie jusqu'à 255 caractères parmi lettres, chiffres, `_`, `-` et `=`. Une valeur invalide est remplacée par un UUID neuf ; la réponse indique la valeur réellement utilisée. Les réponses `429`, `500`, `413` et `414` ajoutent aussi `requestId` à l'enveloppe JSON. Deux refus font exception, parce que l’analyseur HTTP du frontal y répond avant qu’une requête existe à journaliser : le `431` nu pour des en-têtes au-delà du budget de 64 Kio et le `400` nu pour un caractère de contrôle dans une valeur d’en-tête ne portent ni `X-Request-Id`, ni enveloppe, ni `X-Tale-Api-Version` — il n’y a rien à citer, et c’est la requête elle-même qu’il faut changer.

`Idempotency-Key` n’est lu que par les opérations qui déclarent l’en-tête — un démarrage d’exécution, un envoi de chat ; le document OpenAPI les liste, et les portes webhook le lisent comme id de livraison selon leur propre règle. Toute autre opération ignore l’en-tête : sa garantie au-plus-une-fois est la clé naturelle que nomme son corps — l’`externalId` d’un contact, le `(externalSystem, externalId)` d’une tâche, l’`externalItemId` d’un projet. Un `Expect: 100-continue` obtient un `100 Continue` du frontal dès qu’il commence à transmettre le corps ; le verdict de la plateforme — un `413` pour une longueur déclarée au-delà du plafond — arrive quand même avant qu’un octet du corps soit lu.

Les réponses de `/api/v1` et des webhooks portent `X-Tale-Api-Version` ; voir [Versionnage](#versionnage). Les routes sans clé `/api/health`, `/status`, `/status.json` et `/openapi.json` n'implémentent pas ce contrat et n'ont pas cet en-tête.

<Accordion title="Détails HTTP et comportement du proxy">

L’URL, paramètres de requête compris, est limitée à 32 Kio ; au-delà, elle reçoit `414 URI_TOO_LONG` avant recherche de route. Le proxy accorde 64 Kio aux en-têtes. HTTP/1.1 laisse quelques Kio de marge avant un `431` sans enveloppe ; une URL de 66 Kio peut donc atteindre la plateforme et recevoir `414`. HTTP/2 applique exactement la limite en fermant la connexion sans réponse.

Les caractères de contrôle inférieurs à 0x20, sauf tabulation, et DEL dans les en-têtes sont refusés avant la plateforme : HTTP/1.1 renvoie un `400` en texte brut, sans `X-Request-Id` ; HTTP/2 réinitialise le flux ou ferme une connexion portant un corps.

Pour un corps dont la longueur déclarée dépasse la limite, le proxy HTTP/1.1 peut évacuer jusqu'à 256 Kio avant de transmettre le refus, bien que la plateforme ne lise rien. Si le corps finit avant sa longueur déclarée, HTTP/2 renvoie `400 BODY_LENGTH_MISMATCH`, sauf si le `413` de dépassement est arrivé en premier. HTTP/1.1 attend les octets manquants jusqu'au délai de 15 minutes.

Les refus du proxy ont leur propre identifiant et aucun `X-Tale-Api-Version` : le proxy ne connaît pas le contrat applicatif. Cela inclut les `404` sur des segments de chemin comme `..`, `BODY_LENGTH_MISMATCH` et `502`/`503`/`504 UPSTREAM_UNAVAILABLE` lors d'un redémarrage. Ne suppose pas que chaque intermédiaire renvoie l'enveloppe JSON de l'API.

Une requête HTTP/1.1 dont le découpage en chunks est mal formé, par exemple une taille non hexadécimale ou un CRLF manquant, reçoit `400 BODY_CHUNK_MALFORMED` au proxy. Corrige le client HTTP ou l’intermédiaire qui encode la requête ; renvoyer les mêmes octets ne résout pas le problème. Ce refus porte sa propre `requestId` et aucun `X-Tale-Api-Version`.

</Accordion>

## Cache, compression et lectures partielles

### Réutiliser les réponses inchangées

Une lecture JSON réussie (`GET`, **200**) inclut un `ETag` calculé à partir du corps de la réponse et `Cache-Control: private, no-cache`. Conserve cette réponse et envoie son tag dans `If-None-Match` à la lecture suivante. Si elle n’a pas changé, le serveur répond **304**, sans corps. Tu peux ainsi suivre une exécution, un fil inactif ou une indexation sans retransférer les mêmes données.

Renvoie le tag sans le modifier. Le proxy ajoute `-gzip` ou `-zstd` au tag des réponses compressées ; l’API reconnaît ces formes et la forme faible `W/"…"`. Sa réponse **304** contient le tag qu’elle a calculé.

Les téléchargements `GET /api/v1/projects/{id}/files/{documentId}/content` et `GET /api/v1/documents/{id}/content` acceptent aussi `If-None-Match` et `If-Modified-Since`. Utilise les valeurs `ETag` et `Last-Modified` qu’ils ont renvoyées.

Les dates sont comparées à la seconde près, conformément au format HTTP. Si les deux en-têtes conditionnels sont présents, seul `If-None-Match` détermine le résultat. Pour un document dont le contenu est stocké directement dans `content`, `Last-Modified` correspond à `updatedAt` : modifier le titre ou les métadonnées change donc aussi cette date. Privilégie l’`ETag` pour détecter uniquement une modification des octets. Une **304** compte dans les [limites de débit](/fr/develop/rate-limits).

```bash
# La première lecture répond 200 et son ETag ; la répétition avec ce tag répond 304
curl -sS --compressed -D - -o /dev/null "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H 'If-None-Match: "<ETag de la réponse précédente>"'
```

### Demander la compression

Demande `gzip` ou `zstd` dans `Accept-Encoding`, par exemple avec `curl --compressed`. Le serveur compresse les réponses JSON et texte à partir d’environ 512 octets ; il ne sert pas `br`.

Lorsqu’il est présent, `Content-Length` indique la taille compressée. Les réponses volumineuses transmises en flux peuvent l’omettre. L’`ETag` reçoit le suffixe `-gzip` ou `-zstd`. Une réponse `HEAD` reste non compressée et indique la longueur non compressée.

Active cette option pour réduire le volume transféré par les listes et les réponses contenant beaucoup de données répétées. La compression ne réduit pas le nombre de requêtes décomptées de ton quota.

### Lire uniquement les champs nécessaires

Certaines opérations permettent de limiter les données renvoyées. Pour une exécution, `?fields=status,finishedAt` retourne uniquement ces deux champs ; tu peux demander d’autres clés de l’exécution en les séparant par des virgules.

Les listes d’exécutions qui demandent des lignes complètes avec `?include=` sont limitées à 25 lignes et 8 Mio par page. Si la limite de taille est atteinte, la page s’arrête à la dernière ligne qui tient et renvoie `isDone: false` avec son `continueCursor`. Continue jusqu’à `isDone: true`, même si une page contient moins de 25 lignes.

## Se connecter à une application avec Tale

Tale peut servir de fournisseur d’identité OpenID Connect pour une application enregistrée. L’utilisateur s’authentifie dans Tale et donne son consentement. L’application reçoit une identité signée, une adresse e-mail vérifiée et l’appartenance à l’organisation associée au client. Ce parcours utilise une connexion personnelle, pas une clé API.

Pour enregistrer l’application, utilise une session active de Propriétaire ou d’Admin dont l’organisation sélectionnée correspond à `TALE_ORG_ID`. Définis `TALE_ORIGIN` avec l’origine de ton instance et `TALE_SESSION_COOKIE` avec l’en-tête Cookie de cette session. Fournis l’URL de rappel HTTPS exacte ; HTTP est accepté uniquement sur la boucle locale, pour le développement.

```bash
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/identity/clients?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"key":"office-app","name":"Office application","redirectUri":"https://office.example.com/api/auth/oauth2/callback/tale"}'
```

La création répond **201** avec `{ "created": true, "client": { "client_id": "…", "client_secret": "…", … } }`. Stocke le secret dans l’environnement protégé de l’application. Répéter la requête avec la même clé et la même configuration répond **200**, `created: false`, avec le même identifiant client mais sans secret. Si l’URL de rappel ou la politique diffère, la réponse est **409** : une nouvelle tentative ne peut pas modifier silencieusement une intégration existante.

| Usage             | Endpoint ou exigence                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| Émetteur          | `https://your-host.example.com/api/auth`                                     |
| Découverte        | `GET /api/auth/.well-known/openid-configuration`                             |
| Autorisation      | `GET /api/auth/oauth2/authorize`                                             |
| Échange du code   | `POST /api/auth/oauth2/token`, `client_secret_basic` ou `client_secret_post` |
| Clés de signature | `GET /api/auth/jwks`                                                         |
| Identité actuelle | `GET /api/auth/oauth2/userinfo`, jeton d'accès Bearer                        |
| Scopes demandés   | `openid profile email tale:organization`                                     |

Utilise une bibliothèque OIDC maintenue avec le flux Authorization Code, PKCE S256, un paramètre `state` à usage unique et un nonce. Vérifie l’émetteur, l’audience, la signature RS256, l’expiration et le nonce du jeton d’identité, puis exige `email_verified: true`. Le claim `https://tale.dev/organization` contient `{ "id", "slug", "role" }` pour l’organisation du client.

Le jeton contient toujours `acr: "urn:mace:incommon:iap:bronze"`, valeur également annoncée dans `acr_values_supported` et `claims_supported`. Elle ne prouve pas un niveau d’authentification plus fort, notamment une authentification MFA. N’en déduis aucune autorisation supplémentaire.

La découverte annonce `none`, `login` et `consent` dans `prompt_values_supported`. `select_account` et `create` ne sont pas pris en charge. Tale vérifie l’appartenance actuelle à l’organisation et l’exigence MFA native avant d’émettre les jetons, puis à chaque appel à Userinfo. L’application applique sa propre politique d’accès.

Un code d’autorisation expire après 60 secondes et ne peut être échangé qu’une fois. Les jetons d’accès et d’identité expirent après cinq minutes. L’enregistrement dynamique, le flux implicite et les jetons de renouvellement sont désactivés.

Les jetons d’accès servent uniquement au point de terminaison natif `userinfo` ; les audiences de ressources externes sont désactivées. Pour appeler l’API REST, utilise une clé API Tale.

### Traiter les erreurs du fournisseur d’identité

Les erreurs suivent les RFC 6749 et 6750. Sur `userinfo` :

- Un jeton invalide ou expiré donne **401**, `invalid_token`, avec `WWW-Authenticate: Bearer`. Après son expiration à cinq minutes, relance la connexion : réessayer avec le même jeton ne suffit pas.
- Sans jeton, la réponse est **401** avec le défi Bearer sans détail d’erreur.
- Sans scope `openid`, la réponse est **403**, `insufficient_scope`.

Les endpoints d’autorisation et de jeton renvoient `{ "error", "error_description" }`. Un type de flux autre que `authorization_code` donne `unsupported_grant_type`. Une requête mal formée donne `invalid_request`, notamment si `grant_type` manque. La description précise le paramètre concerné : `grant_type is required`, `client_id is required` ou `response_type must be one of "code"`.

Un type de contenu incorrect, par exemple un formulaire envoyé à l’endpoint JSON `register`, donne **400**, `invalid_request`, avec le type attendu. Cette interface ne renvoie pas **415** dans ce cas.

Si `client_id` est inconnu, Tale redirige vers sa propre page d’erreur, jamais vers la `redirect_uri` fournie. Le paramètre `error=invalid_client` et sa description distinguent un client inconnu d’un identifiant manquant.

La découverte inclut `https://tale.dev/organization` dans `claims_supported`. Elle annonce également les endpoints d’introspection, de révocation et de fin de session ; le parcours décrit ici n’en a pas besoin.

### Renouveler ou désactiver un client applicatif

Les opérations suivantes exigent les mêmes conditions que l’enregistrement : une session administrateur, l’organisation active correspondante, l’en-tête Origin et un corps JSON.

- `POST /api/app/identity/clients/office-app/rotate-secret?orgId=<orgId>` avec `{}` renvoie le nouveau `client_secret` une seule fois et invalide l’ancien.
- `POST /api/app/identity/clients/office-app/status?orgId=<orgId>` avec `{ "disabled": true }` bloque les nouvelles autorisations. Envoie `false` pour réactiver le même client.

La suppression d’une organisation supprime aussi ses clients et leurs consentements.

## Groupes d'endpoints

Pour une ressource de projet sous `/api/v1`, place l’ID du projet dans son URL. Ces corps de requête n’acceptent pas `projectId` : les schémas stricts le refusent avec **400**. La ressource doit appartenir au projet nommé et être visible pour le détenteur de la clé ; sinon, l’appel donne **404**. Les réponses peuvent contenir `projectId` comme métadonnée. Les catalogues de l’organisation, comme les définitions d’automatisations et les bundles de skills, gardent leurs chemins d’organisation.

Chaque **201** qui crée une ressource adressable porte `Location` — le chemin propre de la ressource, relatif à l’URL de la requête —, si bien qu’un client générique la suit quelle que soit la forme du corps (`{id}` pour un contact, `{project}` pour un projet, `{task}` pour une tâche) ; l’import en masse de contacts en crée plusieurs et n’en porte aucune.

| Ressource | Chemin et portée |
| --- | --- |
| Automatisations | `/api/v1/automations/...`<br>Consulter les définitions, versions, déclencheurs et projets associés ; supprimer une définition ; démarrer et lister les exécutions sans projet. |
| Automatisations du projet | `/api/v1/projects/{id}/automations/...`<br>Lister, installer ou désinstaller les automatisations ; démarrer et lister leurs exécutions dans ce projet. |
| Exécutions | `/api/v1/runs/...` ou `/api/v1/projects/{id}/runs/...`<br>Lister les exécutions ; lire leur statut, sortie, trace et effets ; annuler avec `POST .../{runId}/cancel` ou supprimer une exécution terminée avec `DELETE .../{runId}` ; lire la question d’une exécution en attente avec `GET .../ask` et y répondre avec `POST .../asks/{askId}`. |
| Fils de conversation | `/api/v1/projects/{id}/threads/...` ou `/api/v1/threads/...`<br>Gérer les chats du détenteur de la clé, dans un projet ou sans projet : lister, créer, lire, archiver, restaurer et supprimer ; envoyer un message, suivre ou annuler son tour. |
| Modèles | `GET /api/v1/models`<br>Consulter les modèles de chat configurés et accessibles au détenteur de la clé dans l’organisation, leurs capacités et leurs tarifs ; `harnesses` liste les harness de code sur lesquels un agent de projet peut tourner. |
| Agents | `/api/v1/projects/{id}/agents/...`<br>Lister, lire, créer, modifier ou supprimer les agents du projet ; protéger une modification avec `expectedUpdatedAt`. |
| Skills | `/api/v1/skills/...`<br>Lister, lire, créer, modifier ou supprimer les bundles de l’organisation ; lire leurs fichiers — une lecture validée (`ETag` et `Last-Modified` sur les octets ; `If-None-Match` / `If-Modified-Since` répondent **304**) ; protéger une écriture avec `If-Match`. Un skill n’a pas d’historique de versions sur cette surface : la lecture répond le bundle courant, rien d’autre. |
| Entrées de connaissances | `/api/v1/knowledge-entries/...`<br>Lister avec `?topic=` et `?status=`, créer, remplacer ou supprimer une entrée ; lire l’historique d’un sujet avec `GET .../{id}/versions`. |
| Recherche de connaissances | `POST /api/v1/projects/{id}/knowledge/search` ou `POST /api/v1/knowledge/search`<br>Rechercher dans les fichiers indexés d’un projet, ou dans les documents visibles de la base de connaissances hors projet et les sites web. |
| Documents | `/api/v1/documents/...`<br>Créer, lire, modifier et supprimer les documents de la base de connaissances ; télécharger leur contenu avec `GET .../content` ; relancer l’indexation avec `POST .../retry-indexing`. Les fichiers de projet ont leurs propres routes. |
| Sites web | `/api/v1/websites/...`<br>Créer, lire, modifier et supprimer les sources web ; consulter leurs pages avec `.../pages`, les synchroniser avec `.../sync` et y rechercher du contenu avec `.../search`. La découverte respecte les règles `Disallow` du `robots.txt` sur chaque chemin par lequel une URL peut entrer — les URL listées exceptées — et une page qu’une règle couvre quitte l’index à l’analyse suivante ; les compteurs de pages sont posés par la synchronisation corpus → ligne (`metadata.lastStatusSyncAt` dit quand, `POST .../sync` la force) et `lastScannedAt` est la fin de la dernière analyse ; `POST /api/v1/websites` refuse un domaine en `http://` (`WEBSITE_DOMAIN_INVALID` — le crawler ne compose qu’en https) et laisse tomber un point final ; le `lastError` d’une page est une ligne qui nomme la cause, jamais le journal d’appels d’un framework. |
| Sessions de navigateur | `/api/v1/browser-sessions/...`<br>Consulter une liste masquée, importer avec `POST .../import` et révoquer avec `DELETE .../{id}` les sessions utilisées pour l’[ingestion vidéo](/fr/self-hosted/configuration/video-ingestion). |
| Produits | `/api/v1/products/...`<br>Créer, lire, modifier et supprimer les entrées du catalogue produit. |
| Contacts | `/api/v1/contacts/...`<br>Créer, lire, modifier et supprimer les contacts ; importer un ensemble avec `POST /api/v1/contacts/bulk`. |
| Conversations | `/api/v1/conversations/...`<br>Synchroniser des instantanés externes dans la boîte de réception et lire leurs reçus ; consulter la file de livraison, réserver les réponses, confirmer ou signaler un échec de livraison, puis relancer un échec définitif. |
| Notifications | `GET /api/v1/notifications/sync`<br>Export en lecture seule du flux personnel ou d’organisation d’un membre vérifié ; réservé aux Propriétaires/Admins et aux membres auxquels un Admin a accordé `tale:notifications.export`. Pagination signée, textes localisés, IDs stables et empreintes du contenu et de l’état de lecture. |
| Projets | `/api/v1/projects/...`<br>Lister les projets ou en chercher un par identifiant externe ; créer, archiver, restaurer ou supprimer un projet ; gérer ses dossiers et charger, télécharger, supprimer ou indexer ses fichiers. |
| Tâches | `/api/v1/projects/{id}/tasks/...`<br>Créer une tâche depuis une référence externe sans doublon, lire son état, démarrer un workflow, commenter, et traiter sa relecture : `GET .../review` la lit, `POST .../review` la décide pour un membre. Le démarrage renvoie le `runId` à suivre. |
| MCP | `POST /api/v1/mcp`<br>Appeler l’[endpoint MCP](/fr/develop/mcp-endpoint) avec la même clé, en JSON-RPC. |
| Déclencheur webhook | `POST /api/projects/{id}/automations/webhook/{token}` ou `POST /api/automations/webhook/{token}`<br>Démarrer une automatisation déployée avec son jeton ; voir [Webhooks](/fr/develop/webhooks) pour les URL avec ou sans projet. |

**Exécutions.** `GET /api/v1/runs` liste les exécutions visibles de toutes les automatisations. Pour lire une exécution de projet, utilise `/api/v1/projects/{id}/runs/{runId}`, y compris pour l’annuler ou la supprimer. `/api/v1/runs/{runId}` expose uniquement une exécution sans projet.

**Modèles.** Chaque modèle expose `contextWindow` et ses capacités. `pricing` est présent lorsque le catalogue renseigne les tarifs. `maxOutputTokens` est absent si le catalogue ne déclare aucun plafond ; dans ce cas, l’API ne contrôle pas ce plafond à l’envoi. Le modèle choisi par défaut dans l’organisation porte `default: true` s’il est configuré et accessible.

**Exploration des sites web.** Une page porte `status: discovered` jusqu’à ce qu’une récupération en stocke le contenu, puis `status: active`. Elle expose `failCount` et, si sa dernière tentative a échoué, `lastError`, `lastErrorKind` et `lastErrorAt`. Ces champs distinguent une page encore jamais récupérée d’une tentative refusée, par exemple après une redirection vers une adresse privée. Au niveau du site, `crawledPageCount` compte toutes les pages dont la récupération a été tentée, qu’elles aient été stockées ou non. `failedPageCount` compte celles dont la dernière tentative a échoué.

**Recherche dans un site.** `.../search` renvoie `{results, total}`. Chaque résultat contient `url`, `title`, `content`, `chunkIndex` et `score`. Cette réponse diffère de `{hits, diagnostics}`, utilisé par la recherche de connaissances. Le champ `limit` se trouve dans le corps et accepte 1 à 100, avec 10 par défaut. Une valeur hors plage donne **400**, `INVALID_BODY` ; elle n’est pas ramenée au plafond.

**Sessions de navigateur.** Les membres peuvent consulter la liste masquée des sessions de leur organisation. L’import et la révocation exigent les droits d’administration de l’instance et l’inscription sur la liste d’autorisation du déploiement. Vérifie `capabilities.deploymentEditor` dans `GET /api/v1/me` avant ces écritures. Une session expire après 14 jours par défaut et peut durer au maximum 180 jours.

Pour enregistrer, valider, tester et déployer des définitions d’automatisation, utilise le [point d’accès MCP](/fr/develop/mcp-endpoint) ou l’éditeur de l’application. Cette interface REST ne propose pas ces opérations de création. `tale deploy` publie la configuration d’un déploiement ; ce n’est pas une route REST de création de définitions.

### Préserver une modification concurrente

Si ta modification dépend de la dernière ligne lue, transmets son `updatedAt` dans `expectedUpdatedAt` lors du `PATCH` d’un contact, produit ou document. Une valeur périmée donne `409 CONTACT_STALE`, `PRODUCT_STALE` ou `DOCUMENT_STALE`. Recharge la ressource, fusionne ta modification avec celle survenue entre-temps, puis envoie la nouvelle précondition.

Pour les documents du centre, `If-Match` protège aussi la représentation lue : envoie l’`ETag` fort reçu lors du `GET`. La comparaison se fait dans la transaction d’écriture du document. Un tag qui ne correspond plus donne `412 PRECONDITION_FAILED`, avec le tag courant dans `data.etag`, sans écriture. Une liste de tags ou `*` est acceptée ; un tag faible `W/` ne correspond jamais. Le tag couvre toute la réponse, y compris `indexing` : l’avancement de l’indexation peut le changer sans modifier le `updatedAt` de la ligne du document.

Un `PATCH` réussi sur un contact, produit, document ou site renvoie `200` avec la ressource actualisée ; un `PATCH` de document porte aussi l’`ETag` de la nouvelle représentation, la valeur que le prochain `If-Match` envoie. Pour les contacts, produits, documents et projets, si toutes les valeurs enregistrées restent identiques, aucune écriture n’a lieu et `updatedAt` est conservé. Les préconditions sont vérifiées d’abord : un corps sans changement ne contourne pas un `expectedUpdatedAt` ou un `If-Match` périmé.

### Modifier contacts, produits et identité des sites

Les espaces en début et fin de chaîne sont supprimés. L’`email` d’un contact est enregistré en minuscules et sa partie avant `@` est limitée à 64 caractères. Les doublons sont détectés à la création comme à la modification :

- Même `email` ou `externalId` de contact : **409**, `CONTACT_DUPLICATE_EMAIL` ou `CONTACT_DUPLICATE_EXTERNAL_ID`.
- Même `name` de produit, sans distinction de casse, ou même `externalId` : **409**, `DUPLICATE_PRODUCT_NAME` ou `DUPLICATE_PRODUCT_EXTERNAL_ID`.

La valeur `null` efface un champ facultatif. Sur `PATCH`, une chaîne vide produit le même effet. Un champ requis vide, comme le `name` d’un produit, donne **400**, `INVALID_BODY`. À la création ou à l’import en masse, une chaîne vide — ou `null` — est traitée comme un champ omis, ce qui permet de reprendre les cellules vides d’un CSV ou un export JSON (le document OpenAPI déclare pour cette raison les champs facultatifs de la création comme nullables).

Un import de contacts doit contenir au moins une ligne : `contacts: []` donne **400**, `INVALID_BODY`. Un contact doit garder au moins un identifiant parmi `name`, `email` et `externalId`. Effacer le dernier donne **400**, `CONTACT_IDENTITY_REQUIRED`.

Lis le résultat d’un import de contacts ligne par ligne. `POST /api/v1/contacts/bulk` attend un objet contenant un seul champ, `contacts`, dont la valeur est un tableau de 1 à 500 lignes. Chaque ligne est validée séparément ; la réponse reste `201` même si certaines échouent :

| Champ de réponse | Utilisation |
| --- | --- |
| `success`, `failed` | Nombre de lignes acceptées et refusées |
| `created[]` | `id` de chaque contact créé et son `index` initial, à partir de zéro |
| `errors[]` | `index` et `contact` d’origine, `error` lisible, `errorCode` stable et `issues` par champ pour les erreurs de schéma |

Un e-mail mal formé, une clé inconnue ou une identité absente produit une erreur de ligne `INVALID_BODY`. Les doublons ont leurs propres codes. Corrige et renvoie uniquement les lignes en échec. Une structure globale invalide, un dépassement des limites de transport ou un encodage JSON invalide refuse toujours la requête entière avant le traitement des lignes.

Le filtre `source` de la liste des contacts accepte la même énumération que les écritures, notamment `manual_import`, `api_import`, `shopify`, `hubspot`, `webhook` et `custom`. Consulte l’énumération complète dans le schéma OpenAPI de l’instance. Une valeur inconnue donne `400 INVALID_QUERY`.

Pour les contacts, produits et documents, `PATCH` fusionne `metadata` selon la RFC 7396 : il conserve les clés omises, ajoute ou remplace les valeurs fournies et supprime les clés envoyées à `null`. Envoyer `metadata: null` efface l’ensemble. En revanche, `address` est remplacé entièrement. `address` et `metadata` sont limités à 64 Kio de JSON, 8 niveaux d’imbrication et 500 clés au total. Un dépassement donne **400**, `INVALID_BODY`, avec le chemin du champ concerné.

La `currency` d’un produit est un code ISO 4217, comme `USD` ou `EUR`, accepté sans distinction de casse et enregistré en majuscules. Son `imageUrl` doit être une URL absolue HTTP ou HTTPS avec un hôte public. Un chemin relatif, un autre protocole, une adresse IP privée ou de boucle locale, un nom sans domaine ou un hôte de métadonnées cloud donne `400 INVALID_BODY`. La validation examine l’URL sans résolution DNS et ne télécharge pas l’image. Le réglage opérateur `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` autorise les cibles de réseau privé, mais jamais les hôtes de métadonnées.

Une image importée depuis le formulaire produit suit un autre parcours. L’application accepte les fichiers PNG, JPEG, WebP, GIF ou SVG jusqu’à 5 Mio, vérifie leur contenu et renvoie une URL protégée qui reste utilisable. Les réponses de lecture REST donnent cette adresse sous forme d’URL absolue. Tu peux la renvoyer dans `imageUrl`, même sur un déploiement privé, si l’image appartient à cette organisation et que tu l’as importée ou qu’un produit existant l’utilise déjà. Une image absente ou inaccessible donne `404 FILE_NOT_FOUND` ; une URL gérée modifiée donne `400 INVALID_BODY`. L’accès aux octets exige une session autorisée dans l’application. L’URL n’est pas un lien de partage public et une clé API REST ne donne pas accès à cette route de l’application. Envoie `imageUrl: null` dans PATCH pour retirer l’image du produit. L’import du fichier passe par le formulaire de l’application ; il n’existe pas de route REST d’import d’image produit.

Le `domain` d’un site web est immuable. `PATCH /api/v1/websites/{id}` accepte la valeur déjà enregistrée, pour permettre de renvoyer une ressource lue auparavant. Toute autre valeur donne **400**, `WEBSITE_DOMAIN_IMMUTABLE`.

À la création, `POST /api/v1/websites` conserve l’hôte fourni, préfixe `www.` compris. Il considère toutefois les formes avec et sans `www.` comme le même site. Un doublon donne **409**, `WEBSITE_DUPLICATE_DOMAIN`, avec l’ID et le domaine existants dans `data.websiteId` et `data.domain`.

Une exception permet d’étendre une liste d’URL existante : si le site est déjà de type liste et que le domaine est écrit exactement de la même manière, l’ajout répond **200** avec l’ID existant. Envoyer une liste à un site configuré pour une exploration complète donne **409**, sans changer son type ni lancer d’exploration. Vérifie `kind` avant l’appel et utilise la forme du domaine indiquée dans le **409**.

Le `status` d’un site décrit le cycle de son exploration. `GET /api/v1/websites?status=` accepte `scanning` (un site enregistré commence ici), `active`, `error` ou `deleting` ; une autre valeur donne `400 INVALID_QUERY`, comme `?scanInterval=` hors de ses sept valeurs. `active` signifie qu’après l’exploration terminée, au moins une page est enregistrée, sans garantir leur actualisation à toutes. `error` signale une exploration en échec ou l’absence de pages enregistrées après les tentatives de récupération ; consulte `metadata.lastSyncError`.

Le `lastErrorKind` d’une page distingue notamment réseau ou TLS (`network_error`, `tls_error`), cible refusée (`private_ip`), échec HTTP (`http_error`), extraction ou rendu en échec, contenu impossible à convertir en texte (`unsupported_content`) et le refus `robots_noindex` — l’origine a répondu `X-Robots-Tag: noindex` ou la page porte une balise `<meta name="robots" content="noindex">`. Une actualisation ratée peut conserver l’ancien contenu indexé. Lis donc les erreurs de pages en plus du statut du site.

`POST /api/v1/websites/{id}/search` cherche des mots-clés dans les passages enregistrés de ce site. Son `score` BM25 n’a pas de plafond et se compare uniquement au sein d’une réponse. Sans ParadeDB, l’instance recherche des sous-chaînes et renvoie `0` pour chaque résultat. Pour la similarité sémantique et `minSimilarity`, utilise `POST /api/v1/knowledge/search` avec `corpus: "web"`. Cette route cherche dans le corpus web visible, pas dans un seul site choisi.

### Enregistrer et synchroniser les bundles de skills

`PUT /api/v1/skills/{slug}` crée un skill si le slug est libre (**201**) ou le met à jour (**200**). Une synchronisation peut donc envoyer le bundle sans lecture préalable et distinguer le résultat grâce au statut HTTP. `description` et `body` sont obligatoires.

À la mise à jour, omettre `icon`, `labels`, `teams`, `visibility` ou `disableModelInvocation` conserve la valeur enregistrée. `null` efface `icon` ou `labels` ; `disableModelInvocation: false` retire ce drapeau.

Le corps Markdown est limité à 507 893 octets UTF-8. Ce plafond laisse la place au frontmatter dans la limite de 512 Kio du `SKILL.md` complet. Il s’agit d’octets, pas de caractères. Un saut de ligne final est ajouté s’il manque ; la lecture du corps renvoie alors un octet de plus.

L’opération réécrit uniquement `SKILL.md`. Elle conserve les autres fichiers et les clés de frontmatter non exposées dans la requête, comme `license`, `recommended-packages` et les clés communautaires. Pour remplacer un bundle complet, utilise l’import ZIP dans l’application.

Chaque skill expose `etag`, le SHA-256 de son `SKILL.md` entre guillemets, et `updatedAt`, la date de dernière écriture de ce fichier. Une requête qui produit exactement les mêmes octets répond **200** sans écrire le fichier ni ajouter d’historique ; les deux valeurs restent inchangées. Les préconditions sont vérifiées auparavant : même pour un contenu identique, un `If-Match` périmé donne **412**.

`GET /api/v1/skills/{slug}` renvoie ce tag dans `ETag`. Si `If-None-Match` correspond, il répond **304**. Les formes faibles `W/"…"` et les tags suffixés `"…-gzip"` sont reconnus pour cette lecture. Les réponses **200** et **304** portent `Cache-Control: private, no-cache`.

`GET /api/v1/skills` inclut un tableau `failures`, normalement vide. Chaque bundle illisible y figure avec `slug`, `path` et `message` ; un bundle défectueux ne fait pas échouer la liste entière.

Protège une modification ou une suppression avec `If-Match` et le dernier `etag` lu. Si le document a changé ou n’existe plus, la réponse est **412**, `SKILL_STALE`, avec le tag courant dans `data.etag` lorsqu’il existe. Rien n’est écrit. Recharge le skill et fusionne les modifications avant de réessayer. Pour une écriture, un tag faible (`W/"…"`) ne correspond jamais, et le corps est validé avant la précondition.

Pour créer uniquement, envoie `If-None-Match: *`. Si le bundle existe déjà, la réponse est **412**, `SKILL_EXISTS`, sans écriture.

`GET /api/v1/skills/{slug}/files/{path}` renvoie les octets bruts d’un fichier, `SKILL.md` compris, avec son nom dans `Content-Disposition`. Reprends `path` depuis `files[].path` ; les barres obliques peuvent rester `/` ou être encodées `%2F`. La lecture est validée : l’`ETag` est celui des octets du fichier, `Last-Modified` sa date de modification, et `If-None-Match` ou `If-Modified-Since` répond **304**. Un chemin absent de la liste donne **404**, `SKILL_FILE_NOT_FOUND`. Un bundle refusé par la validation des fichiers, par exemple à cause d’un lien symbolique ou d’un fichier dépassant 4 Mio lors de la préparation, donne **422**, `SKILL_MALFORMED`.

Les segments `../` et `%2e%2e/` sont interceptés avant la route. La réponse est alors **404**, `NOT_FOUND`, avec un `X-Request-Id` propre à cette couche et sans `X-Tale-Api-Version`. Si les barres obliques sont aussi encodées (`%2e%2e%2f…`), la requête atteint la route et reçoit `SKILL_FILE_NOT_FOUND`.

Vérifie `canEdit` avant une écriture : ce champ indique si le détenteur de la clé peut modifier le bundle. Les skills fournis sont des bundles d’organisation qu’un administrateur peut remplacer.

Les visibilités autorisées sont `org` et `team` ; les IDs de `teams` doivent appartenir à l’organisation. `private` ne peut plus être attribué. Un ancien bundle qui utilise cette valeur la conserve uniquement si la mise à jour omet `visibility`.

Un slug contient au maximum 64 caractères : lettres minuscules, chiffres et tirets simples. `anthropic` et `claude` sont réservés. Un slug invalide donne **400**, `INVALID_SKILL_SLUG`, sur `PUT`, avec la règle enfreinte. Sur `GET` et `DELETE`, il est traité comme absent : **404**, `SKILL_NOT_FOUND`.

### Refléter les conversations et livrer les réponses

La synchronisation d’une conversation utilise des instantanés versionnés. Crée d’abord son contact avec `POST /api/v1/contacts` : `externalContactId` doit correspondre à l’`externalId` d’un contact de l’organisation.

Un contact introuvable donne **404**, `CONTACT_NOT_FOUND` ; plusieurs contacts correspondants donnent **409**, `CONTACT_AMBIGUOUS`. Aucun changement n’est appliqué. Une conversation déjà synchronisée ne peut pas être réaffectée à un autre contact : un `externalContactId` différent donne **409**, `CONVERSATION_CONTACT_CONFLICT`.

`POST /api/v1/conversations/sync` compare la `version` entière reçue à celle enregistrée. Il applique une version plus récente, ignore une version plus ancienne et refuse un contenu différent portant la même version avec **409**, `CONVERSATION_SNAPSHOT_CONFLICT`.

La fermeture avec `deleted: true` suit une règle distincte : elle est acceptée à la version courante ou à une version supérieure. La répéter après fermeture n’a aucun effet. La source peut ainsi fermer son miroir sans produire de nouvelle version. La conversation et ses messages restent dans la boîte de réception ; ils ne sont pas supprimés définitivement.

Pour récupérer une réponse écrite dans Tale, appelle `POST /api/v1/conversations/deliveries/claim`. Lorsque la source renvoie ensuite ce message dans un instantané, elle doit inclure `taleMessageId` avec le `messageId` natif. La livraison doit déjà avoir été confirmée sous son `externalId`, sinon la réponse est **409**, `DELIVERY_UNACKNOWLEDGED`. Sans `taleMessageId`, le message est considéré comme provenant de la source, quelle que soit la valeur d’`isCustomer`.

La source demandée doit avoir été synchronisée auparavant. Une source inconnue donne **404**, `CONVERSATION_SOURCE_NOT_FOUND`. Une source détenue uniquement par d’autres utilisateurs de service donne **403**, `INTEGRATION_NOT_OWNED`. Une faute dans son nom ne produit donc pas une file vide trompeuse.

Une livraison récupérée expose `attempts`, `leaseExpiresAt`, `lastErrorCode` et `firstClaimedAt`. Pour consulter la file sans réserver de livraison, utilise `GET /api/v1/conversations/deliveries?source=`. La liste contient les statuts `queued`, `leased`, `failed` ou `delivered`, les tentatives et les horodatages, sans jeton de réservation ni corps de message. Elle commence par la livraison due depuis le plus longtemps.

La pagination utilise `{ "deliveries": [...], "isDone": ..., "continueCursor": ... }` et le paramètre `?cursor=`. Filtre avec `?status=failed` pour trouver les livraisons en échec définitif. `POST /api/v1/conversations/deliveries/{id}/retry` en relance une, avec la même trace d’audit que **Réessayer** dans la boîte de réception. Pour tout autre état, la réponse est **409**, `DELIVERY_RETRY_UNAVAILABLE`.

Prépare les pièces jointes avec `POST /api/v1/conversations/uploads` avant de les inclure dans un instantané. Aucune partie de l’instantané n’est appliquée si une pièce jointe est refusée :

- Préparation absente ou expirée, `storageId` mal formé, non délivré par cet endpoint ou provenant d’une autre organisation : **400**, `ATTACHMENT_NOT_STAGED`.
- Préparation effectuée par un autre utilisateur de service de la même organisation : **403**, `ATTACHMENT_NOT_OWNED`.
- `size` déclarée différente du nombre d’octets reçus : **400**, `ATTACHMENT_SIZE_MISMATCH`.

Les `replyConstraints` limitent les futures réponses écrites dans la boîte de réception : longueur du texte, nombre de pièces jointes, taille et extensions des fichiers. Elles sont contrôlées lors de la rédaction de la réponse et ne provoquent jamais le rejet de l’instantané lui-même.

Pour `GET .../deliveries/{id}/attachments/{index}`, une livraison qui n’a pas été récupérée sous cet ID donne `DELIVERY_NOT_FOUND`. Une pièce jointe absente, ou un index qui n’est pas un entier de 0 à 9, donne `ATTACHMENT_NOT_FOUND`.

Les fichiers préparés par `POST /api/v1/conversations/uploads` n’ont pas d’opération de suppression dédiée. Un fichier jamais lié est nettoyé lors d’un chargement ultérieur dans l’organisation, après sa fenêtre de deux heures et 24 heures de grâce. Une référence liée suit la durée de vie de son message.

Tous les corps de conversation sont stricts. Une clé inconnue, y compris dans un message ou une pièce jointe, donne **400**, `INVALID_BODY`, avec le nom de cette clé.

`GET /api/v1/conversations/sync` renvoie aussi l’`externalContactId` lié, le `contactId` de la ligne liée et `contactStatus` : `active`, `trashed` ou `missing` — ainsi que `sourceDeleted` avec le `status` de l’Inbox, pour qu’un moteur qui reprend depuis le reçu sache qu’un démontage a eu lieu : un instantané de contenu sur un miroir démonté répond **409** `CONVERSATION_CLOSED` quelle que soit la version (reflète la conversation source sous un nouvel `externalId` pour recommencer). La liaison conserve la ligne du contact initial. Supprimer ce contact l’envoie à la corbeille et libère son e-mail et son identifiant externe ; un nouveau contact portant ces identifiants ne récupère jamais l’ancien historique. Un contact dont le CRM a changé la clé (un `PATCH` de son `externalId`) garde en revanche ses conversations : un instantané qui nomme l’id courant s’applique et le reçu le suit, tandis que l’id qu’il ne porte plus répond **409** `CONVERSATION_CONTACT_CONFLICT` en nommant l’id auquel la conversation est liée. `GET /api/v1/conversations?source=` liste chaque conversation que tu as reflétée sous une source — `conversationId`, `externalId`, `externalContactId`, `contactId`, `contactStatus`, `version`, `sourceDeleted`, `status`, `subject` —, la plus récente d’abord, en page keyset sous `conversations` (la même boucle `?cursor=` que pour chaque liste), et `?contactStatus=trashed` retrouve les miroirs qu’un contact supprimé a gelés.

Un instantané de contenu plus récent destiné au contact supprimé donne `409 CONVERSATION_CONTACT_TRASHED`. Restaure le contact — avec `POST /api/v1/contacts/{id}/restore`, qui applique la règle de la création (un contact vivant qui a pris entre-temps son e-mail ou son `externalId` refuse la restauration avec le **409** de la création), ou depuis la corbeille de l’application — avant d’envoyer du contenu, ou ferme le miroir avec `deleted: true` et une version égale ou supérieure ; un miroir fermé n’est pas rouvert par la restauration, un instantané de contenu ultérieur répond donc le même 409 tant que le contact reste dans la corbeille. Les versions anciennes restent ignorées, et les répétitions de même version suivent toujours les règles ci-dessus : la suppression ne transforme pas chaque répétition en erreur.

### Créer des connaissances indexées et des documents du centre

`POST /api/v1/documents` crée un document dans la base de connaissances de l’organisation. Tu peux fournir son texte dans `content` : il reste stocké et lisible, mais n’est pas indexé. Seuls les documents associés à un fichier chargé peuvent être indexés.

Pour envoyer du texte dans le corpus de recherche depuis REST, utilise plutôt `POST /api/v1/knowledge-entries`. Cette opération crée une entrée active par sujet et son document associé à un fichier (`sourceProvider: knowledge`, contenu limité à 8 000 caractères). La réponse **201** contient `{ "id", "documentId" }`. Interroge ensuite `GET /api/v1/documents/{documentId}` pour suivre `indexing` ; aucune lecture intermédiaire de l’entrée n’est nécessaire.

Un `PATCH` d’entrée crée une nouvelle version, renvoie ses IDs et relance l’indexation sous le même `documentId`. Si `topic` et `content` sont identiques après suppression des espaces en début et fin de chaîne, aucune version n’est créée et l’ID actif est conservé. Supprimer l’entrée met son document à la corbeille.

Ces écritures nécessitent le droit de modifier les connaissances. Un Membre en lecture seule reçoit **403**, `KNOWLEDGE_ENTRY_FORBIDDEN`. Si le stockage objet n’accepte pas le contenu en 30 secondes, la réponse est **503**, `KNOWLEDGE_ENTRY_STORE_TIMEOUT`, sans écriture.

Modifie ou supprime ce document par son entrée de connaissances. Un `DELETE /api/v1/documents/{id}` direct, ou un `PATCH` de son titre ou de son contenu, donne **409**, `DOCUMENT_HAS_KNOWLEDGE_ENTRY`, avec `data.entryId`.

Pour consulter l’historique, `GET /api/v1/knowledge-entries?topic=<topic>&status=superseded` liste les versions remplacées et leur `supersededAt`. `GET /api/v1/knowledge-entries/{id}/versions` accepte l’ID de n’importe quelle version et retourne la chaîne complète, de la plus récente à la plus ancienne.

Pour relancer une indexation, appelle `POST /api/v1/documents/{id}/retry-indexing`. Les résultats permettent de distinguer les cas suivants :

- `{"status": "skipped", "reason": "content-only"}` : le document contient uniquement du texte dans `content`, sans fichier.
- `untracked-blob` : le fichier n’est pas suivi par le processus d’indexation.
- `unsupported` : échec définitif d’indexation ; consulte `indexing.errorCode`.
- `in-progress` : une indexation récente est déjà en attente ou en cours ; suis l’état du document.
- `indexing` : l’indexation est demandée, y compris si elle avait été désactivée au chargement.

Un fichier de projet utilise `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`. Cet appel retire le choix `skipRagIndexing` fait lors de la liaison. Les fichiers de projet et les autres IDs hors de la base de connaissances donnent **404**, `DOCUMENT_NOT_FOUND`, sur la route des documents.

Les deux routes de relance appliquent les mêmes contrôles que **Indexer maintenant** dans l’application, avec une limite de 10 demandes par utilisateur et par minute. Un dépassement donne **429**, `RATE_LIMITED`.

L’autre mode de création de document, avec `fileId`, exige un fichier chargé depuis l’application par le détenteur de la clé, dans l’organisation sélectionnée, et encore sans liaison. REST ne crée pas ce chargement. Un fichier déjà lié à un document, un fil ou une conversation ne peut pas être réutilisé. Un fichier absent, détenu par un autre utilisateur ou déjà lié donne **404**, `FILE_NOT_FOUND`. Cette route ne convertit pas les chargements de projet, de chat ou de conversation en documents de l’organisation.

`GET /api/v1/documents` liste les documents du Hub du plus récent au plus ancien. Pour reproduire la vue par dossier de l’application, précise le périmètre :

| Paramètre de requête `folderId` | Documents renvoyés |
| --- | --- |
| Omis | Tous les documents visibles du Hub, y compris ceux rangés dans des dossiers. |
| `root` | Uniquement les documents qui ne sont dans aucun dossier. |
| Un identifiant de dossier | Les documents directement contenus dans ce dossier. |

`GET /api/v1/documents/{id}/content` télécharge les octets avec `Content-Disposition`, `Range` et `HEAD`, comme pour un fichier de projet. Il sert aussi le texte stocké directement dans `content`, avec le `mimeType` du document. La lecture JSON `GET /api/v1/documents/{id}` inclut ce texte dans `content`, ou `null` pour un document associé à un fichier.

Le champ `contentHash` contient le SHA-256 calculé par Tale pour les octets, par exemple ceux d’une entrée de connaissances ou d’un fichier synchronisé. Il vaut `null` lorsqu’aucun hash n’a été calculé. C’est un champ de premier niveau, pas une clé de tes `metadata`.

Un `PATCH` de document sans changement, qu’il soit vide ou qu’il répète les valeurs enregistrées, ne modifie pas `updatedAt`. Il ne rend donc pas périmée la précondition `expectedUpdatedAt` d’un autre client.

Pour un document soumis au contrôle des enregistrements, modifier le contenu, le type MIME, l’extension ou le fournisseur source donne **400**, `DOCUMENT_RECORD_FROZEN`, s’il est en revue ou approuvé. S’il est en brouillon, la réponse est **400**, `DOCUMENT_RECORD_REPLACEMENT_REQUIRED` : utilise le parcours de remplacement. Un `teamId` d’une équipe dont le détenteur de la clé n’est pas membre donne **403**, `TEAM_ACCESS_DENIED`.

Un document associé à un fichier expose `indexing.status` : `pending`, `queued`, `running`, `completed`, `failed`, `unsupported` ou `skipped`. `indexedAt`, `error` et `errorCode` sont présents lorsqu’ils sont disponibles. Après une création ou une relance, interroge cet état pour constater le résultat.

Les documents à la corbeille ou expirés sont absents de cette interface, y compris les fichiers supprimés avec leur projet. Si tu conserves les fichiers lors de la suppression du projet, ils sont détachés de celui-ci et restent dans la bibliothèque de connaissances. Les corps `POST` et `PATCH` sont stricts : envoyer `projectId` donne **400**. Utilise les routes du projet pour créer ses fichiers.

Branche ton client sur `indexing.errorCode`, pas sur le texte d’`error`. Le schéma OpenAPI énumère cet ensemble fermé :

| Statut et codes | Action |
| --- | --- |
| `unsupported` : `unsupported_type`, `image_no_vision`, `empty`, `not_text`, `malformed` | Remplace ou réexporte la source dans un format pris en charge. Pour `not_text`, fournis du véritable texte UTF-8. `malformed` désigne actuellement un PDF illisible ; un fichier Office corrompu peut plutôt donner `indexer_error`. La route de relance ignore ces codes définitifs, y compris sur une ancienne ligne encore marquée `failed`. |
| `failed` : `embedding_upstream`, `indexer_error`, `index_rebuilding` | Le traitement de fond réessaie. Consulte le statut avant de demander un nouvel essai. |
| `failed` : `embedding_not_configured`, `embedding_provider_refused`, `index_repair_failed` | Fais corriger la configuration du fournisseur, les autorisations ou l’état de l’index par l’opérateur, puis réessaie. |
| `failed` : `secret_detected`, `pii_blocked` | Corrige la source ou la politique de contenu approuvée de l’organisation avant de réessayer. |

## Synchroniser les notifications d’un membre

`GET /api/v1/notifications/sync`, disponible depuis le contrat API 1.8.0, exporte les notifications visibles par un membre précis. Utilise cette route pour en maintenir une copie dans une autre application. La clé API doit appartenir à un Propriétaire ou un Admin de l’organisation sélectionnée, ou à un membre auquel un Admin a accordé la capacité `tale:notifications.export` (contrat API 1.14.0). Un autre rôle seul ne suffit pas, pas même Développeur.

### Déléguer l’export sans rôle Admin

Un service qui synchronise les notifications n’a pas besoin d’un compte Admin. Le rôle Admin permet aussi de gérer les membres, d’administrer l’authentification unique et SCIM, et de réinitialiser le mot de passe des membres de rang inférieur. Exécute plutôt le service sous un compte de membre ordinaire et accorde à ce membre la seule capacité que vérifie l’export. L’attribution est une entrée du registre des compétences de l’organisation : elle ne vaut que dans cette organisation, elle est journalisée, elle peut expirer et elle est révoquée automatiquement quand un Admin retire le membre ou que ton fournisseur d’identité supprime son adhésion via SCIM.

Un Propriétaire ou un Admin l’accorde depuis une session active. Définis `TALE_ORIGIN` avec l’origine de ton instance et `TALE_SESSION_COOKIE` avec l’en-tête Cookie de cette session. `TALE_ORG_ID` et `TALE_WORKER_USER_ID` sont les valeurs `organization.id` et `user.id` que renvoie `GET /api/v1/me` avec la clé du service :

```bash
GRANT_BODY=$(jq -n --arg user "$TALE_WORKER_USER_ID" \
  '{userId:$user,competence:"tale:notifications.export",evidence:"Notification mirror worker"}')
curl -sS --compressed -X POST "$TALE_ORIGIN/api/app/governance/competences?orgId=$TALE_ORG_ID" \
  -H "Cookie: $TALE_SESSION_COOKIE" \
  -H "Origin: $TALE_ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$GRANT_BODY"
```

La réponse est **201** avec `{ "recordId": "…" }`. Ajoute `expiresAt` en millisecondes Unix pour que l’attribution prenne fin d’elle-même ; sans ce champ, elle n’expire pas. Tant qu’une attribution est active, l’accorder de nouveau renvoie **409** `COMPETENCE_ALREADY_GRANTED`. Tout autre nom sous `tale:` renvoie **400** `COMPETENCE_CAPABILITY_UNKNOWN`, un utilisateur extérieur à l’organisation **400** `COMPETENCE_USER_NOT_MEMBER`, et une session sans rôle Propriétaire ou Admin **403** `COMPETENCE_FORBIDDEN`. Avant la première page, vérifie avec la clé du service que `GET /api/v1/me` indique `capabilities.notificationExport: true`.

Pour retirer ce droit, trouve l’`id` de l’attribution dans `GET /api/app/governance/competences?orgId=<orgId>&userId=<userId>` avec la même session, puis envoie `POST /api/app/governance/competences/<recordId>/revoke?orgId=<orgId>`. La requête d’export suivante du service renvoie `403 ROLE_FORBIDDEN`. Une attribution révoquée reste dans la liste comme piste d’audit ; accorde de nouveau la capacité pour rétablir l’export.

### Choisir le destinataire et le flux

Définis `TALE_RECIPIENT_EMAIL` avec l’adresse e-mail vérifiée du membre concerné. Cette adresse doit correspondre à un seul membre actif de l’organisation. La route vérifie à nouveau l’appartenance et l’adresse confirmée à chaque page. Pour les notifications d’organisation, la visibilité dépend du rôle du destinataire : une clé d’Admin n’exporte pas de notifications de sécurité que cette personne ne pourrait pas voir dans Tale.

| Paramètre de requête | Règle |
| --- | --- |
| `recipientEmail` | Adresse e-mail valide obligatoire, de 320 caractères au maximum. La recherche ignore la casse. |
| `stream` | Obligatoire : `personal` pour les notifications personnelles ou `organization` pour celles de l’organisation visibles par ce membre. Parcours les deux séparément pour obtenir une copie complète. |
| `locale` | Facultatif : `en`, `de` ou `fr`. Sans valeur, la langue de l’organisation s’applique, avec repli sur les textes anglais. |
| `limit` | Valeur par défaut et maximum : 100 ; minimum : 1. Les entiers hors plage sont ramenés à la limite. |
| `cursor` | À omettre sur la première requête, puis à remplir avec le `continueCursor` précédent, inchangé. Aucun `offset` numérique n’est accepté. |

```bash
curl --fail-with-body --silent --show-error --compressed --get \
  "$TALE_URL/api/v1/notifications/sync" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --data-urlencode "recipientEmail=$TALE_RECIPIENT_EMAIL" \
  --data-urlencode 'stream=personal' \
  --data-urlencode 'locale=fr' \
  --data-urlencode 'limit=100'
```

Une requête réussie renvoie `200` avec `{recipientId, page, isDone, continueCursor}`. Un destinataire absent, désactivé, non vérifié ou ambigu produit `recipientId: null`, `page: []`, `isDone: true` et un curseur vide. Cet appel n’invite personne et ne crée aucun compte.

### Lire les lignes et terminer un parcours

| Champ d’une ligne | Signification |
| --- | --- |
| `id` | Identifiant source stable au format `<organizationId>:<stream>:<notificationId>`. Utilise-le pour retrouver et mettre à jour la copie de ce destinataire. Une notification d’organisation peut avoir le même ID pour plusieurs personnes ; conserve leurs copies séparément. |
| `version` | Empreinte SHA-256 de 64 caractères hexadécimaux, calculée sur la ligne exportée avant ajout de l’empreinte. Elle change avec le contenu ou l’état de lecture, et peut aussi changer avec les textes traduits. Ce n’est pas un numéro croissant. |
| `title`, `body` | Textes issus des catalogues de notifications Tale et de leurs paramètres, limités respectivement à 500 et 8 000 unités de code UTF-16. Conserve la même langue entre les synchronisations. |
| `path` | Destination sous `/dashboard/...` utilisée par la cloche de notifications, avec les identifiants encodés et les paramètres de requête. Résous ce chemin depuis l’origine web de Tale, pas depuis l’adresse interne de transport de l’API. La personne doit toujours disposer de l’accès et, si nécessaire, rejoindre le réseau privé. |
| `createdAt` | Date de création en millisecondes depuis l’époque Unix. |
| `read` | Indique si le destinataire a lu la notification dans Tale. |

Les notifications personnelles sont classées par numéro de séquence décroissant ; celles de l’organisation, par date de création puis ID décroissants. Les deux flux utilisent des curseurs keyset signés. Un curseur est lié à son organisation, à son destinataire et à son flux : ne le réutilise pas pour une autre personne ou pour l’autre flux.

Pour maintenir une copie cohérente :

1. Commence chaque flux sans curseur. Retrouve les lignes par `id` et compare `version` pour détecter les changements.
2. Tant que `isDone` vaut `false`, renvoie le curseur reçu. Arrête-toi à `true` ; n’envoie pas le curseur final vide.
3. Termine les deux flux avec succès avant de retirer des lignes absentes de ce parcours dans l’application destinataire. Si une page échoue, conserve la copie précédente et résous l’échec.
4. Repars de la première page lors des synchronisations suivantes pour repérer les changements de texte ou de lecture sur les anciennes notifications. Un curseur est une position de pagination, pas un point de reprise d’un flux de changements.

L’export ne marque aucune notification Tale comme lue et n’en supprime aucune. Il ne fournit pas d’opération d’accusé de réception ou de modification. Changer l’état de lecture dans l’autre application ne change pas celui de Tale.

### Résoudre un échec d’export

| Réponse | Action |
| --- | --- |
| `401 UNAUTHORIZED` | Remplacer la clé API absente, invalide ou expirée. |
| `403 ROLE_FORBIDDEN` | Utiliser une clé de Propriétaire ou d’Admin de l’organisation sélectionnée, ou faire accorder `tale:notifications.export` à l’utilisateur de la clé par un Admin ; `capabilities.notificationExport` dans `GET /api/v1/me` le confirme. Une attribution expirée ou révoquée ne permet plus l’export. L’appartenance du destinataire ne donne aucun droit d’export à l’appelant. |
| `400 INVALID_QUERY` | Corriger les champs destinataire, flux ou langue, les paramètres inconnus ou répétés, ou les paramètres `cursor` et `limit` vides. Consulter `data.issues`. |
| `400 INVALID_LIMIT` | Fournir un entier. |
| `400 INVALID_CURSOR` | Recommencer le flux concerné sans curseur. Une appartenance supprimée ou modifiée peut invalider le curseur précédent. |
| `200`, `recipientId: null` | Vérifier l’appartenance actuelle et l’e-mail confirmé. Une page vide terminée ne confirme pas l’existence d’un compte. |
| `429 RATE_LIMITED` | Respecter `Retry-After` et le [budget API partagé](/fr/develop/rate-limits), en conservant la copie précédente pendant l’attente. |

Les erreurs habituelles de sélection d’organisation s’appliquent aussi. Ne transforme jamais un export en échec en une liste vide considérée comme correctement synchronisée.

## Gérer les agents d’un projet

Chaque agent appartient à un projet. L’ID du projet est obligatoire dans l’URL de chaque opération ; les réponses incluent `projectId` et l’`id` de l’agent. Ce sont les mêmes agents que dans l’onglet **Agents** du projet, avec les mêmes droits d’accès.

| Opération                          | Route                                           | Réussite       |
| ---------------------------------- | ----------------------------------------------- | -------------- |
| Lister les agents                  | `GET /api/v1/projects/{id}/agents`              | `200 {agents}` |
| Créer                              | `POST /api/v1/projects/{id}/agents`             | `201 {agent}`  |
| Lire                               | `GET /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Enregistrer toute la configuration | `PUT /api/v1/projects/{id}/agents/{agentId}`    | `200 {agent}`  |
| Supprimer                          | `DELETE /api/v1/projects/{id}/agents/{agentId}` | `204`          |

Choisis un projet existant, un harness que `GET /api/v1/models` liste sous `harnesses` — ceux que la plateforme fait tourner avec ses propres identifiants — et un modèle qu’il peut utiliser. Cet exemple crée un agent Claude Code et relit sa configuration ; il ne lance aucune tâche.

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

### Enregistrer la configuration complète d’un agent

`POST` et `PUT` exigent `name`, `harness`, `model`, `skills` et `connectors` ; un `harness` hors de l’ensemble admis répond **400**, `PROJECT_AGENT_HARNESS_INVALID`, avec l’ensemble dans `data.harnesses`. `modelProvider`, `tools`, `secrets` et `instructions` sont facultatifs.

`PUT` remplace toute la configuration d’un agent existant. Omettre le fournisseur ou les instructions les remet à `null` ; omettre les outils ou les secrets vide ces listes. Cette opération ne crée pas d’agent si l’ID n’existe pas.

Pour éviter d’écraser une modification concurrente, fournis le dernier `updatedAt` lu dans `expectedUpdatedAt`. Si l’agent a changé, la réponse est **409**, `PROJECT_AGENT_STALE`, avec son `updatedAt` courant dans `data`. Rien n’est écrit : recharge la configuration et fusionne les changements avant de réessayer.

### Valider modèles, autorisations et limites

Un projet peut contenir au maximum 50 agents. Les noms sont limités à 120 caractères et doivent être uniques dans le projet, sans distinction de casse. Chaque liste de ressources attribuées accepte 25 entrées ; les instructions sont limitées à 20 000 caractères.

Une configuration invalide ou un dépassement de limite donne **400**. Un nom déjà utilisé donne **409**, `PROJECT_AGENT_NAME_TAKEN`, comme les autres conflits de doublon sur cette interface. Retrouve l’agent existant ou choisis un autre nom avant de réessayer.

Choisis `model` dans le catalogue de l’organisation et précise `modelProvider` si plusieurs fournisseurs servent ce modèle. `tools` doit contenir uniquement des autorisations connues. Une valeur invalide donne **400** avec `PROJECT_AGENT_MODEL_INVALID`, `PROJECT_AGENT_PROVIDER_UNKNOWN` ou `PROJECT_AGENT_TOOL_UNKNOWN`.

`secrets` contient des noms de secrets de l’organisation, jamais leurs valeurs. Un nom inconnu donne **400**, `PROJECT_AGENT_SECRET_UNKNOWN`, et figure dans `data.secrets`. Le formulaire de l’application filtre les noms inconnus ; l’API les refuse explicitement.

Seuls les Propriétaires et Admins peuvent modifier les autorisations de secrets. Un Éditeur qui enregistre la configuration complète doit conserver celles qui existent déjà.

Le droit de lire un projet permet de consulter ses agents. Les écritures exigent un projet actif et le droit de le modifier. Un projet absent ou invisible, ou l’ID d’un agent d’un autre projet, donne **404**. Si le détenteur de la clé appartient à plusieurs organisations, inclus `X-Organization-Slug` dans chaque requête.

[Agents de projet](/fr/platform/projects/project-agents) explique leur travail sur les tâches. Le chat direct utilise l’assistant intégré.

## Les noms d'automatisation dans les URL

Un nom d’automatisation peut contenir des `/`, par exemple `billing/dunning`. Dans chaque URL `.../automations/{name}/...`, remplace ces séparateurs par `__` pour garder le nom dans un seul segment.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/automations/billing__dunning/versions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Les réponses portent toujours le vrai nom (`"name": "billing/dunning"`) ; la forme `__` n'existe que dans les URL. Les slugs de skills ne contiennent pas de `/` et n’ont pas besoin de cette transformation. Les agents de projet utilisent l’ID du projet et celui de l’agent.

### Lire la version qui sera exécutée

`GET /api/v1/automations` fournit les informations nécessaires pour choisir et lancer une automatisation :

- `latestVersion` et `deployedVersion` distinguent la dernière version enregistrée de celle utilisée en production.
- `projectIds` indique les projets où l’automatisation est installée.
- `description` décrit son rôle.
- `inputs` contient le schéma d’entrée de la version déployée ou, à défaut, de la dernière version enregistrée.
- `trigger` contient le type de déclencheur, son activation et `lastFiredAt`, `lastSkippedAt`, `lastSkipReason`. Il vaut `null` si aucun déclencheur n’est configuré. Ces données sont également disponibles dans `GET .../triggers`.

`GET /api/v1/automations/{name}` lit par défaut la dernière version enregistrée, qui peut être un brouillon. Utilise `?version=deployed` pour lire celle qu’une exécution réelle utilisera, ou un numéro pour lire une version précise. Une version absente, y compris `deployed` si rien n’est déployé, donne **404**, `AUTOMATION_VERSION_UNKNOWN`. Une automatisation inconnue donne `AUTOMATION_NOT_FOUND`.

`GET /api/v1/automations/{name}/versions` expose `deployedVersion` et marque chaque ligne avec `deployed`. Il indique aussi le résultat des tests de chaque version :

- `testsPassed: null` : les tests n’ont pas été exécutés. Une version sans tests conserve cette valeur.
- `testsPassed: true` ou `false` : résultat de la dernière exécution des tests, soit lors d’un enregistrement par `save_automation` sur MCP, soit lors de la vérification préalable au déploiement. Un refus de déploiement est également enregistré.
- `testsCheckedAt` : date de cette vérification. Elle peut être `null` pour un résultat antérieur à la version 0.5.24. Lis le verdict dans `testsPassed` et utilise la date uniquement pour en évaluer l’ancienneté.

`DELETE /api/v1/automations/{name}` exige la capacité développeur. Il supprime la définition, ses versions, ses déclencheurs et ses associations aux projets. Une exécution active bloque la suppression avec **409**, `AUTOMATION_HAS_ACTIVE_RUNS`.

Les anciennes exécutions sont conservées. `GET /api/v1/runs` continue de les lister et elles restent lisibles par ID, sous le nom utilisé à leur lancement. En revanche, lire la définition supprimée donne **404**.

REST permet de consulter les automatisations, de les installer, de les exécuter et de configurer leurs déclencheurs. Pour créer, enregistrer ou déployer une définition, utilise `save_automation` et `deploy_automation` sur [MCP](/fr/develop/mcp-endpoint), l’éditeur visuel de l’application ou une release de configuration via `tale deploy`.

## Déclencheurs

Un déclencheur lance une automatisation selon une planification, un appel webhook ou un événement de la plateforme. Configure-le avec `PUT /api/v1/automations/{name}/triggers`. Une automatisation possède au maximum un déclencheur : `PUT` remplace celui qui existe.

```bash
curl -sS --compressed -X PUT "https://your-host.example.com/api/v1/automations/billing__dunning/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "event", "event": "contact.created" }'
# → 200 { "name": "billing/dunning", "deployed": true }
```

### Choisir le type de déclencheur

Choisis `kind` selon le mode de démarrage :

- `schedule` exige un `cron` à cinq champs et accepte un `timezone` IANA facultatif.
- `webhook` renvoie une seule fois le `token` utilisé dans l’URL. Voir [Webhooks](/fr/develop/webhooks).
- `event` exige le nom d’un événement émis par la plateforme.

Une configuration impossible à déclencher donne **400**, `AUTOMATION_TRIGGER_INVALID`, avec une explication : expression cron sans occurrence, comme `0 0 30 2 *`, fuseau non IANA ou événement non pris en charge.

Chaque type accepte uniquement ses propres champs : `cron` et `timezone` pour `schedule`, `event` pour `event`, `rotateToken` pour `webhook`. Un champ d’un autre type donne **400**, `INVALID_BODY`, et figure dans `data.issues`. Un webhook ne peut donc pas conserver implicitement une planification.

Pour un déclencheur d’événement, l’entrée de l’exécution est `{ "trigger": "event", "event": "<name>", "payload": <les données de l'événement> }`. Les événements disponibles sont :

| Événement                                               | Émis quand                                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact.created`, `contact.updated`, `contact.deleted` | un contact est créé, modifié ou supprimé — par l’API, l’application ou un import                                                                                         |
| `conversation.created`                                  | une conversation s’ouvre dans la boîte de réception — un e-mail qui arrive, ou une conversation externe reflétée                                                 |
| `conversation.message_received`                         | un message arrive sur une conversation existante                                                                                                                 |
| `project.created`                                       | un projet est créé                                                                                                                                               |
| `task.created`                                          | une tâche est créée — sur un tableau, par l’API ou par un formulaire de collecte                                                                                                   |
| `task.status_changed`                                   | une personne déplace une tâche vers un autre statut (les déplacements d’un agent n’émettent rien, une automatisation ne peut donc pas se redéclencher elle-même) |
| `comment.created`                                       | un commentaire arrive sur une tâche                                                                                                                              |
| `comment.mentioned`                                     | un commentaire de tâche mentionne quelqu’un avec `@`                                                                                                             |

### Vérifier le déclencheur et le suspendre

`GET .../triggers` renvoie `triggers`, une liste contenant au maximum un élément. Les horodatages distinguent les exécutions réellement lancées des occurrences ignorées :

- `lastFiredAt` et `lastRunId` correspondent à la dernière exécution lancée. Ils restent `null` tant qu’aucune exécution n’a démarré.
- `lastSkippedAt` et `lastSkipReason` décrivent la dernière occurrence qui n’a rien lancé. Une livraison de webhook que le schéma `inputs` de la version déployée refuse est un autre cas : l’expéditeur reçoit **400** `AUTOMATION_INPUT_INVALID`, rien ne démarre et aucun de ces horodatages ne bouge — la liaison n’était pas due, un webhook dont chaque livraison est refusée se lit donc comme un webhook jamais appelé. Vérifie les livraisons côté expéditeur.

Les motifs d’occurrence ignorée sont `not_deployed` si aucune version n’est déployée, `unusable_cron` si l’expression ou le fuseau ne peut pas être interprété, et `start_refused` si le schéma `inputs` déployé refuse l’entrée. Dans le cas `unusable_cron`, le planificateur cesse de traiter ce déclencheur jusqu’à sa modification.

Compare `lastFiredAt` à la cadence attendue. Si `lastSkippedAt` est plus récent, consulte la raison avant de relancer. Changer le type de déclencheur réinitialise ces horodatages.

`enabled: false` suspend le déclencheur en conservant sa configuration. `DELETE .../triggers` le retire et, s’il s’agit d’un webhook, révoque son URL.

Remplacer un webhook par un autre type révoque également son URL. Le `PUT` répond **200** avec `"revoked": "webhook"` à côté du nom. Configurer ensuite un nouveau webhook produit un nouveau jeton ; l’ancienne URL reste invalide.

La réponse `PUT` indique aussi `deployed`. Il est possible de configurer le déclencheur avant le déploiement, mais ses occurrences sont ignorées avec `not_deployed` jusqu’à ce qu’une version soit déployée. Le champ `trigger` de `GET /api/v1/automations` permet de constater cet état.

## Démarrer une exécution, puis la suivre

Le démarrage d’une exécution répond **202** avec son identité. Le travail continue ensuite, éventuellement pendant plusieurs minutes ; cette réponse ne contient pas encore son résultat.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "customerId": "cus_123" } }'
# → 202 { "runId": "...", "version": 2, "name": "billing/dunning", "mode": "live" }
```

### Interpréter les états en cours et en attente

Interroge `GET /api/v1/projects/{id}/runs/{runId}?fields=status,finishedAt` tant que `status` vaut `queued`, `running` ou `waiting`. La sélection de champs évite de transférer toute l’exécution. Avec `If-None-Match`, une réponse inchangée devient une **304** sans corps ; voir [Cache](#cache-compression-et-lectures-partielles).

Une fois l’exécution terminée, lis-la en entier pour obtenir `output`, la `trace` de chaque nœud et les `effects` produits.

`status: waiting` ne signifie pas nécessairement qu’une personne doit intervenir. Consulte `waitingFor` :

- `approval` attend une décision humaine ; `ask` attend une réponse à une question.
- `agent` attend la fin d’un tour d’agent ; `repeat` attend qu’un nœud atteigne sa condition `repeatUntil`. Ces deux états peuvent durer plusieurs minutes sans anomalie.

Pour repérer les exécutions qui nécessitent une personne, filtre donc sur `waitingFor` égal à `approval` ou `ask`. `detail` identifie le point d’attente, par exemple `approval:<approvalId>`, `agent:<nodeId>` ou `repeat:<nodeId>`. Après un échec, il contient l’explication de cet échec.

`POST /api/v1/projects/{id}/runs/{runId}/cancel` arrête l’exécution à la prochaine limite entre nœuds. Il n’annule pas les effets déjà produits.

Une exécution en échec expose un `failureCode` stable en plus du message lisible dans `detail`. Les autres états renvoient `null` ; une ancienne exécution en échec peut aussi ne pas avoir de code. Les résumés omettent un code non renseigné.

| Origine de l’échec | Exemples et action |
| --- | --- |
| Automatisation | `node_error`, `connector_error`, `llm_output_invalid`, `approval_rejected`, `execution_limit`, `automation_deleted` : examine le nœud en échec et sa trace. Corrige les données ou la définition. Si une opération a été refusée, tiens compte du motif du refus avant de demander une nouvelle exécution. |
| Fournisseur de modèle | Par exemple `credit_exhausted` ou `rate_limited` : résous le problème du fournisseur avant un nouvel essai. |
| Exécution d’agent | Par exemple `harness_error`, `session_gone`, `deadline` ou `budget_exceeded` : examine le détail et les limites de l’agent. L’énumération complète figure dans OpenAPI. |

Le code identifie la cause sans garantir qu’un redémarrage complet soit sans effet indésirable : des nœuds précédents peuvent déjà avoir modifié un système externe. `startedAt` indique l’acceptation du démarrage, avant sa prise en charge par un worker. Aucun horodatage distinct ne marque cette prise en charge ; `finishedAt - startedAt` inclut donc la file et les autres attentes.

La réponse de `POST .../cancel` contient `cancelled` et le `status` obtenu. Une annulation effective donne `cancelled: true`, `status: "cancelled"` et remet le `detail` de l’exécution à `null`. Si elle était déjà terminée, `cancelled: false` accompagne son état final : `success`, `failed` ou `cancelled`.

### Relancer un démarrage sans créer une seconde exécution

Envoie `Idempotency-Key: <ta clé>` pour pouvoir répéter une demande après un délai dépassé ou une réponse perdue. Pendant 24 heures, la même clé et le même corps renvoient **202** avec l’exécution initiale et `"duplicate": true`, sans en créer une deuxième.

La même clé avec un corps différent donne **409**, `IDEMPOTENCY_KEY_REUSED`. Sa portée est limitée à l’automatisation et au projet de l’URL. Une demande refusée ne réserve pas la clé : tu peux la réutiliser après avoir corrigé le refus.

L’en-tête facultatif `Idempotency-Key` doit contenir de 1 à 255 caractères ASCII imprimables après suppression des espaces extérieurs. S’il est présent mais vide, trop long ou contient d’autres caractères, la réponse est `400 INVALID_HEADER` ; `data.issues` nomme l’en-tête et rien ne démarre. Pour une répétition, conserve la même valeur normalisée et le même corps. Omets l’en-tête seulement si tu ne souhaites pas cette protection contre une double exécution.

### Choisir une exécution réelle ou simulée

`mode` vaut `live` par défaut. Les exécutions réelles à entrée libre et les annulations exigent la capacité développeur. Dans un projet, une exécution exige aussi le droit de modifier ce projet et un projet actif, même en `mode: "mock"`. Sans projet, une exécution simulée exige seulement l’appartenance à l’organisation. Les simulations utilisent des réponses fictives déterministes. Le démarrage d’une exécution, réelle ou simulée, ne nécessite aucun déclencheur.

Une automatisation inconnue donne **404**. Une exécution réelle utilise uniquement la version déployée : demander une autre version enregistrée donne **409**. Pour tester cette version, précise `mode: "mock"`. Sans version déployée, le démarrage donne également **409**, sauf si une simulation choisit explicitement une version enregistrée.

Sans corps de requête, l’entrée vaut `{}`. Un JSON mal formé donne **400**, sans démarrage. Si la définition expose un schéma `inputs`, il est validé avant la création de l’exécution. Un écart donne **400**, `AUTOMATION_INPUT_INVALID`, avec les `path` et `message` des problèmes dans `data.issues`.

Le champ `input` vaut `{}` uniquement lorsqu’il est omis. `input: null` transmet réellement `null`, que le schéma peut accepter ou refuser.

### Choisir le périmètre et consulter l’historique

Le projet de l’URL fournit le contexte des outils de tâches et de documents. Une automatisation associée à des projets peut s’exécuter uniquement dans l’un d’eux. Sans association, elle peut s’exécuter dans tout projet que le détenteur de la clé peut modifier.

`POST /api/v1/projects/{id}/automations/{name}` installe l’automatisation dans le projet et limite ses exécutions à ses projets associés. Une automatisation encore sans association n’a donc pas besoin d’être installée pour être exécutée dans un projet.

Lis l’historique d’une automatisation avec `GET /api/v1/projects/{id}/automations/{name}/runs`, ou celui du projet entier avec `GET /api/v1/projects/{id}/runs`. Les réponses sont paginées sous `{ "runs": [...], "isDone": ..., "continueCursor": ... }`, de la plus récente à la plus ancienne.

Chaque résumé contient l’identité, le périmètre, le statut et les horodatages. `id` et `runId` contiennent le même identifiant ; `runId` correspond au nom du champ reçu au démarrage.

- `?status=failed` filtre les statuts. Sépare plusieurs valeurs par des virgules.
- `?include=input,output` ajoute des champs détaillés. `trace`, `effects` et `checkpoints` sont aussi disponibles.
- `?cursor=` permet de poursuivre avec `continueCursor`, jusqu’à `isDone: true`.

Avec `include`, une page contient au maximum 25 lignes et 8 Mio. Elle peut s’arrêter avant 25 lignes, avec `isDone: false`, si la suivante dépasse le budget de taille.

`GET /api/v1/runs` rassemble toutes les exécutions visibles pour le détenteur de la clé, celles de l’organisation comme celles des projets accessibles. Chaque ligne indique `projectId`.

Une automatisation sans association à un projet peut démarrer sans projet via `POST /api/v1/automations/{name}/runs`. Une automatisation associée donne **409** sur cette route. `GET /api/v1/automations/{name}/runs` et `/api/v1/runs/{runId}` exposent uniquement les exécutions sans projet. Pour lire, annuler ou supprimer une exécution de projet, utilise toujours la route de ce projet.

`DELETE /api/v1/projects/{id}/runs/{runId}`, ou `/api/v1/runs/{runId}`, exige la capacité développeur et supprime une exécution terminée, entrée et sortie comprises. Une exécution active donne **409**, `RUN_ACTIVE` : annule-la d’abord.

## Agir pour un membre : répondre à la question d’une exécution, décider la relecture d’une tâche

Une exécution en pause sur `waitingFor: "ask"` et une tâche en `in_review` attendent toutes deux une personne. Quand cette personne travaille dans une autre application — un portail de bureau qui reflète le poste de travail, par exemple —, l’appel machine relaie son geste et la nomme comme `actor` : Tale enregistre alors la personne, pas la clé. Ces deux points d’entrée demandent le contrat API 1.16.0.

### Répondre à la question qu’attend une exécution

`GET /api/v1/projects/{id}/runs/{runId}/ask` renvoie la question ouverte sous la forme `PendingAsk` — la phrase, un ensemble structuré `questions` facultatif, le nœud qui a posé la question et l’échéance `expiresAt` — ou `ask: null` quand personne n’est sollicité. La lecture demande le même accès que la lecture de l’exécution.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/ask" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "ask": { "askId": "...", "question": "...", "expiresAt": 1758210000000, "taskId": "..." } }
```

Envoie la réponse à `POST /api/v1/projects/{id}/runs/{runId}/asks/{askId}`. Tale l’enregistre, reprend l’exécution dans la même transaction et dépose la réponse sur la chronologie de la tâche comme commentaire de la personne qui a répondu. Pour un ensemble `questions`, envoie une ligne par question, comme le fait l’application : `<question> → <option choisie>; <texte saisi> (in their own words)`.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/runs/<runId>/asks/<askId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "answer": "Comptabiliser en février.", "actor": { "email": "reviewer@example.com" } }'
# → 200 { "ok": true, "askId": "...", "runId": "...", "answeredBy": "<userId>", "actorUserId": "<userId>", "taskId": "..." }
```

Une exécution de projet demande l’accès en écriture à un projet actif ; une exécution d’organisation demande l’appartenance à l’organisation. Sans `actor`, la clé répond en son propre nom et `answeredBy` vaut `api-key:<userId>`. Une question déjà traitée ou fermée donne **409** `HUMAN_ASK_NOT_PENDING`, une question expirée **409** `HUMAN_ASK_EXPIRED` — l’exécution échoue alors avec `failureCode: "ask_expired"` — et une question que cette exécution n’a pas posée **404** `HUMAN_ASK_NOT_FOUND`. Une réponse vide donne **400** `EMPTY_ANSWER`.

### Décider la relecture d’une tâche

`GET /api/v1/projects/{id}/tasks/{taskId}/review` renvoie l’état de la tâche et sa relecture en attente sous la forme `TaskReview`, sinon `review: null`. Un `POST` sur le même chemin la décide — ici `actor` est obligatoire, car une relecture est toujours la décision d’une personne :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/review" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "approve", "actor": { "email": "reviewer@example.com", "userId": "<userId>" } }'
# → 200 { "task": { "id": "...", "status": "done" }, "decision": "approve", "approvalId": "...", "actorUserId": "<userId>" }
```

`approve` correspond au passage en Terminé sur le tableau : l’accès au projet du membre et la `review_policy` de l’organisation s’appliquent exactement comme là (**403** `REVIEW_INDEPENDENT_REVIEWER_REQUIRED` ou `REVIEW_COMPETENCE_REQUIRED` si la politique refuse la personne), la relecture est enregistrée comme approuvée par le membre et la tâche passe à `done` ; une tâche avec des sous-tâches ouvertes donne **409** `TASK_HAS_OPEN_SUBTASKS`. `request_changes` exige `comment` et `workflowSlug` : la relecture est retirée, le commentaire est déposé sur la chronologie et le workflow redémarre sur la tâche en lisant ce commentaire comme retour ; la réponse contient le `runId` à suivre, avec `started: false` si une exécution en cours a été réutilisée. Une tâche qui n’est pas en relecture donne **409** `TASK_NOT_IN_REVIEW`. Chaque décision est auditée sous `task.review_relayed`, avec le membre et la clé qui a relayé pour lui.

### Nommer le membre pour lequel on agit

`actor.email` désigne le membre par son adresse e-mail. Tale la résout dans l’organisation selon la même règle que l’export des notifications : exactement une appartenance active dont l’adresse est vérifiée. Aucun membre correspondant donne **404** `ACTOR_NOT_FOUND`, deux membres **409** `ACTOR_AMBIGUOUS`, une adresse non vérifiée **403** `ACTOR_UNVERIFIED`, une appartenance désactivée **403** `ACTOR_DISABLED`. Chaque réponse renvoie l’`actorUserId` résolu ; fixe-le comme `actor.userId` lors des appels suivants. Une adresse passée depuis à un autre compte donne alors **409** `ACTOR_REBOUND` au lieu d’agir pour son nouveau titulaire. Un membre qui ne peut pas voir le projet – ou, sur la porte de revue, écrire sa tâche – donne **403** `ACTOR_FORBIDDEN` ; l’accès du détenteur de la clé est vérifié d’abord, ce code parle donc toujours de l’acteur.

Nommer un `actor` est un droit à part entière. Une clé de Propriétaire ou d’Admin l’a par son rôle ; tout autre titulaire de clé a besoin de la capacité `tale:rest.act-as`, attribuée et révoquée exactement comme la capacité d’export dans [Déléguer l’export sans rôle Admin](#deleguer-lexport-sans-role-admin), avec `"competence":"tale:rest.act-as"` dans le corps de l’attribution. `GET /api/v1/me` la renvoie sous `capabilities.actAs` ; un `actor` envoyé sans ce droit donne **403** `ROLE_FORBIDDEN` avant toute recherche de membre. Ce que le geste relayé peut faire reste décidé par les propres droits du membre.

## Envoyer un message, puis suivre le tour

Le chat de projet utilise le même principe : l’envoi est accepté avec **202**, puis tu suis son résultat. Choisis un projet accessible en lecture, crée un fil, envoie un message et conserve l’ID de la réponse à suivre.

### Choisir un modèle utilisable

Commence par `GET /api/v1/models`. Chaque entrée expose `contextWindow`, `maxOutputTokens`, `capabilities` (`tools`, `vision`, `reasoning`), `tags` et, si le catalogue fournit des tarifs, `pricing`. `default: true` indique le modèle par défaut de l’organisation lorsqu’il est configuré et accessible au détenteur de la clé. Ce marqueur peut être absent.

`maxOutputTokens` est absent lorsque le catalogue ne déclare aucun plafond. La route d’envoi n’applique alors aucune limite issue du catalogue. Ton client doit accepter l’absence de ce champ dans la liste des modèles.

Reprends l’`id` dans `model`. Précise `providerSlug` si plusieurs fournisseurs proposent le même ID. La liste respecte les règles d’accès de l’organisation et inclut uniquement les modèles que REST peut appeler directement.

Une liste vide signifie qu’aucun modèle de chat n’est disponible pour le détenteur de la clé.

`capabilities` et `tags` décrivent le modèle, mais ne changent pas les entrées acceptées par cet endpoint. L’envoi REST prend uniquement du texte dans `content`, même pour un modèle doté de vision. Une URI de données envoyée dans ce champ est traitée comme du texte, sans indication particulière dans la requête ou la réponse.

L’ajout d’images par REST n’est pas disponible dans cette version. Pour qu’un modèle de vision lise une image dans ce fil, poursuis-le depuis l’application et joins l’image au message.

La présence d’un modèle dans le catalogue ne garantit pas que le compte fournisseur puisse l’utiliser. Dans Paramètres, un opérateur peut l’exclure au moyen de la liste des modèles autorisés des identifiants du fournisseur.

La paire modèle/fournisseur est validée dès l’envoi :

- Modèle inconnu : **400**, `CHAT_MODEL_UNKNOWN`.
- Modèle proposé par plusieurs fournisseurs, sans fournisseur précisé : **400**, `CHAT_MODEL_AMBIGUOUS`, avec les candidats dans `data.providers`.
- `providerSlug` inconnu : **400**, `CHAT_PROVIDER_UNKNOWN`.
- Modèle absent du fournisseur choisi : **400**, `CHAT_MODEL_NOT_ON_PROVIDER`.

La réponse **202** indique le fournisseur retenu. Le tour ne bascule pas automatiquement vers un autre fournisseur.

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
# → 200 { "status": "queued", "messageId": "..." } … puis { "status": "streaming", "messageId": "...", "text": "Le trimestre…", "textOffset": 0, "textLength": 13, "reasoning": "", "reasoningOffset": 0, "reasoningLength": 0, "cancelRequested": false, "updatedAt": 1774... } … puis { "status": "idle", "lastMessageId": "<assistantMessageId>", "lastStatus": "complete" }

# 4. Lire la réponse par l'id que le 202 a nommé
curl -sS "https://your-host.example.com/api/v1/projects/<projectId>/threads/<threadId>/messages/<assistantMessageId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "id": "<assistantMessageId>", "role": "assistant", "status": "complete", "finishReason": "stop", "parts": [ … ], "usage": { … }, … }
```

### Suivre le message accepté

Les messages de chat acceptés partagent une file commune aux organisations et aux clés de l’instance, traitée des plus anciens aux plus récents. Le worker prend des lots de `WORKER_CONCURRENCY` tours au maximum, 5 par défaut ; le lot suivant attend la fin du précédent. Une acceptation ne signifie donc pas une exécution immédiate : ton fil peut attendre derrière d’autres clients. L’API ne donne ni position dans la file ni heure de démarrage estimée.

Conserve le `messageId` reçu dans la réponse **202** : il identifie le message d’assistant qui recevra le résultat. Le suivi de génération expose trois états :

- `queued` : le message est accepté et attend un worker. Tant qu’un worker n’a pas ouvert le tour, cette interrogation en est la seule vue : `GET .../messages` ne liste pas encore le tour (la page se lit comme complète sans lui) et `.../messages/{messageId}` peut répondre **404** pour l’id nommé par l’envoi.
- `streaming` : le modèle produit la réponse. `text` et `reasoning` contiennent les données reçues jusque-là.
- `idle` : aucun tour n’est en cours. `lastMessageId` et `lastStatus` décrivent le message d’assistant le plus récent.

Si `lastMessageId` correspond à l’ID conservé, `lastStatus` décrit le résultat de ton tour. Un ID différent ne prouve pas que ton tour n’a pas démarré : un autre tour peut avoir remplacé ce résumé. Lis directement ton message avec `GET /api/v1/projects/{id}/threads/{threadId}/messages/{messageId}`, ou consulte l’historique.

`GET .../messages?order=desc` parcourt les messages du plus récent au plus ancien. Un curseur reste lié à l’ordre choisi lors de sa création ; ne change pas de direction en le réutilisant.

Interroge le statut toutes les deux à cinq secondes. Fixe un délai par requête, par exemple 30 secondes, et une durée maximale distincte pour ta boucle. Le serveur n’impose pas de durée totale fixe au tour. Il abandonne une requête au fournisseur après 180 secondes sans activité ; chaque octet reçu, raisonnement compris, remet ce délai à zéro. Un raisonnement poussé peut donc garder le tour actif sans texte de réponse visible. Pour l’arrêter, appelle `DELETE .../generation` au lieu de simplement cesser le suivi.

Pour recevoir uniquement ce qui est arrivé depuis, envoie `?since=<textLength>` et `?reasoningSince=<reasoningLength>` à partir des longueurs précédentes. L’unité est l’unité de code UTF-16 — le `String.length` de JavaScript, un emoji comptant deux ; pas le point de code —, renvoie donc les longueurs que l’interrogation a répondues plutôt que de compter les caractères toi-même. `textOffset` et `reasoningOffset` indiquent le début de chaque fragment : la valeur que tu as envoyée, un de moins quand elle aurait coupé une paire de substitution (le fragment renvoie alors le caractère entier), ou 0 quand une étape d’outils réglée a remis le flux à zéro. Réassemble par une seule règle, `held = held.slice(0, textOffset) + text`, et aucun des trois cas n’a besoin d’un traitement à part.

Si la connexion coupe avant réception du **202**, consulte `.../generation`. Les états `queued` et `streaming` indiquent un tour actif, mais ne suffisent pas à identifier une demande dont tu as perdu l’ID. Vérifie le dernier message utilisateur et son `content`, ou rejoue la demande avec sa clé d’idempotence pour retrouver le même `messageId`.

### Relancer un envoi sans doublon

Envoie `Idempotency-Key: <ta clé>` pour retrouver le résultat d’une demande après un délai dépassé ou une réponse perdue. Une répétition avec la même clé et le même corps pendant 24 heures renvoie **202** avec la réponse initiale, le même `messageId` et `"duplicate": true`. Elle ne crée ni second tour ni consommation supplémentaire liée à un second tour.

Réutiliser la clé avec un autre corps donne **409**, `IDEMPOTENCY_KEY_REUSED`. La clé est limitée au fil et au projet de l’URL. Un envoi refusé, par exemple parce qu’un tour est déjà actif, ne la réserve pas. Tu peux la réutiliser une fois le refus corrigé.

L’en-tête facultatif `Idempotency-Key` doit contenir de 1 à 255 caractères ASCII imprimables après suppression des espaces extérieurs. S’il est présent mais vide, trop long ou contient d’autres caractères, la réponse est `400 INVALID_HEADER` ; `data.issues` nomme l’en-tête et rien ne démarre. Pour une répétition, conserve la même valeur normalisée et le même corps. Omets l’en-tête seulement si tu ne souhaites pas cette protection contre une double exécution.

### Comprendre l’assistant et les limites de tokens

Chaque tour utilise l’assistant intégré de l’espace de travail, avec ses instructions, ses règles de sécurité et ses trois outils de recherche. Il ne s’agit pas d’un appel direct au modèle sans instructions. Les demandes de livrables, comme un document ou un rapport, sont orientées vers les tâches.

Ces instructions représentent environ 3 000 tokens d’entrée par appel au modèle et sont incluses dans `usage.inputTokens`. Un tour qui utilise des outils peut effectuer jusqu’à cinq appels au modèle ; chacun compte à nouveau son prompt complet.

Le périmètre dépend de l’URL. Dans `/api/v1/projects/{id}/threads`, `rag_search` et `rag_fetch` peuvent consulter les fichiers de ce projet et les connaissances de l’organisation, mais aucun autre projet. Dans `/api/v1/threads`, ils consultent uniquement les connaissances de l’organisation. Le même fil garde ce comportement dans l’application.

L’assistant décide s’il doit chercher selon la question. Nommer un fichier, demander une information interne ou écrire « cherche dans les fichiers… » l’oriente vers une recherche. Une réponse disponible dans la conversation ou les connaissances du modèle peut ne pas nécessiter d’outil. Aucun champ de cette requête n’impose une consultation.

Deux champs facultatifs règlent le raisonnement et la sortie :

- `reasoningEffort` accepte `low`, `medium`, `high`, `extra` ou `max`, comme l’application. Il est ignoré si le modèle n’a pas `capabilities.reasoning`.
- `maxOutputTokens` limite la sortie du tour entier, cumulée sur tous les appels au modèle. Il ne peut pas dépasser le plafond publié par `GET /api/v1/models`. Sinon, l’envoi donne **400**, `INVALID_BODY`, avec la limite concernée.

Chaque appel au modèle reçoit le budget restant ; aucun nouvel appel ne démarre une fois celui-ci épuisé. Les tokens de raisonnement comptent dans ce budget et dans `usage.outputTokens`, au prix des tokens de sortie. Ils peuvent consommer toute l’enveloppe et produire un résultat facturé avec `status: complete`, `finishReason: length`, mais sans texte de réponse. Augmente le budget de sortie ou réduis `reasoningEffort` pour laisser de la place à une réponse visible.

Le mode à budget de réflexion, comme l’extended thinking d’Anthropic, impose un minimum de 2 048 tokens : 1 024 pour le raisonnement et autant pour la réponse. Un plafond inférieur est relevé à cette valeur. Les modèles dont le raisonnement utilise un niveau d’effort, comme les familles GLM et DeepSeek, n’ont pas ce minimum ; le plafond demandé s’applique exactement.

Une réponse arrêtée à la limite peut avoir `status: complete`. Lis `finishReason: length` pour la reconnaître. Quand un appel au modèle atteint cette limite, tous les appels d’outils de cette étape sont retenus, même si certains arguments sont complets. Chaque `tool-result` porte `status: invalid_args` ; son message distingue les arguments complets de ceux tronqués. Vérifie la raison d’arrêt et les résultats d’outils, même si le texte final semble complet.

Sur un message d’assistant terminé, `finishReason` peut valoir `stop`, `length`, `tool-calls`, `content-filter`, `cancelled` ou `other`. Il est absent si le fournisseur n’a transmis aucune raison.

Une réponse vide, ou une annulation avant tout texte, ne contient aucune partie textuelle. `parts` peut être vide ou ne contenir que du raisonnement et des outils. Vérifie la présence de texte avant d’afficher ou d’exporter une réponse.

Les listes, détails, messages et statuts sont limités aux fils du détenteur de la clé dans le projet. Les fils d’un autre utilisateur restent invisibles, même dans un projet partagé. Utilise `GET /api/v1/projects/{id}/threads` pour lister les tiens et `GET /api/v1/projects/{id}/threads/{threadId}` pour en lire un.

### Lire langue, état, consommation et parties du message

Les espaces en début et fin de `content` sont supprimés avant validation. Un prompt vide — rien que des blancs et des caractères de format invisibles, comme les espaces sans chasse — donne **400** sans consommer de tour (du Markdown qui ne rend rien, un bloc de code vide par exemple, reste un prompt).

`locale` accepte une balise BCP 47, comme `de` ou `en-GB`. Elle demande une langue de réponse, indépendamment de celle du prompt. Cette consigne est ajoutée aux instructions système et au message, mais le modèle peut ne pas la respecter. Aucune propriété de la réponse ne signale cet écart. Si la langue est une exigence de ton application, vérifie le texte reçu et prévois sa correction.

Les instructions obligatoires de l’organisation priment sur `locale`. Si ce champ est omis, l’assistant reçoit la consigne de répondre dans la langue du prompt.

Le message d’assistant existe dès le traitement du tour avec `status: pending` et `parts: []`. Son ID correspond à celui de `.../generation`. Il devient ensuite `complete`, `cancelled` avec la sortie partielle déjà reçue, ou `failed` avec `error` et `errorCode`.

Le champ `usage` décrit les tokens et le coût estimé :

- `reasoningTokens` est la part d’`outputTokens` consacrée au raisonnement. Le champ est absent si le fournisseur ne l’a pas communiqué ; `0` signifie qu’un zéro a été communiqué.
- `cachedInputTokens` est la part d’`inputTokens` servie depuis le cache du fournisseur.
- `costEstimateCents` est l’estimation du catalogue, en centimes de dollar américain, arrondie au millionième de centime. C’est la même estimation que dans le registre d’usage de l’organisation. Le champ est absent si le modèle n’a pas de tarif publié. Les entrées en cache utilisent le tarif d’entrée normal ; l’estimation représente donc une borne haute pour un tour bénéficiant du cache.
- `estimated: true` indique que Tale a estimé les compteurs faute de données du fournisseur, notamment après une annulation. Le prompt complet, outils de l’assistant compris, est inclus.
- `stepLimitHit: true` indique que la boucle d’outils a atteint son nombre maximal d’appels au modèle.

`usage` est absent si le tour a échoué avant que le fournisseur ne transmette de compteurs.

`parts` est une liste ordonnée dont les éléments sont distingués par `type` : `text`, `reasoning`, `attachment`, `tool-call`, `tool-result`, `approval` ou `human-input`. Le document OpenAPI décrit chaque forme comme un schéma nommé (`TextPart`, `ReasoningPart`, `AttachmentPart`, `ToolCallPart`, `ToolResultPart`, `ApprovalPart`, `HumanInputPart`) derrière un discriminant `type` à mapping explicite, un client généré obtient donc une classe par type. Traite un type inconnu comme un élément opaque : de nouveaux types peuvent être ajoutés.

Affiche une partie `reasoning` séparément de la réponse. Elle peut reprendre des instructions reçues par le modèle : guide de l’assistant, règles sur les sources, instructions obligatoires de l’organisation ou instructions du projet. Ne la diffuse pas à un public qui ne doit pas connaître ces instructions.

### Respecter le périmètre et l’accès au fil

Pour un chat personnel sans projet, utilise `/api/v1/threads` et ses routes de détail, de messages et de génération. Elles ne donnent pas accès aux fils des projets. Un projet incorrect dans l’URL donne **404**.

Les deux types de chat utilisent l’assistant intégré. Ajouter `projectId`, `agentSlug` ou `agentId` au corps de création ou d’envoi donne **400**. Les lecteurs du projet, y compris les Membres, peuvent créer un fil et envoyer des messages. Un projet archivé refuse ces écritures avec **403**.

Un envoi peut aussi être refusé sans mise en file :

- Fil archivé : **409**, `CHAT_THREAD_ARCHIVED`.
- Fil de sandbox : **409**, `CHAT_THREAD_NOT_DIRECT`.
- Tour actif ou envoi encore en attente : **409**, `CHAT_TURN_IN_PROGRESS`. Le tour existant conserve son `messageId`.

Seul le dernier cas se résout en attendant `idle` avant de réessayer. Les deux autres nécessitent de choisir ou restaurer un fil adapté.

### Renommer, archiver, supprimer ou arrêter un fil

`PATCH .../threads/{threadId}` accepte `{ "archived": true }` pour archiver, `false` pour restaurer, ou `{ "title": "Q3 review" }` pour renommer. Un fil dont le tour tourne, ou dont l’envoi attend encore, refuse l’archivage avec **409** `CHAT_TURN_IN_PROGRESS`, comme la suppression — annule d’abord ; restaurer et renommer restent ouverts en plein tour. Fournis au moins l’un de ces champs. Le titre, nettoyé de ses espaces en début et fin, doit contenir de 1 à 120 caractères à la création comme au renommage. Sans titre initial, l’assistant nomme le fil après le premier message ; le résultat figure toujours dans `title`.

L’archivage renseigne `archivedAt` et conserve `updatedAt`, qui suit l’activité des messages. Pour détecter archivage et restauration, une synchronisation doit donc lire `archived` et `archivedAt`, pas uniquement `updatedAt`.

`DELETE .../threads/{threadId}` met le fil à la corbeille. Un tour actif ou encore en file bloque cette opération avec **409**, `CHAT_TURN_IN_PROGRESS`.

Pour arrêter le tour, appelle `DELETE .../threads/{threadId}/generation`. La réponse est **202**, `{ "status": "cancelling", "messageId": "..." }`. Continue le suivi jusqu’à `idle`. Le message final porte `status: cancelled` et conserve les données déjà reçues.

Un envoi encore `queued` s’annule de la même manière. Le **202** reprend le message d’assistant annoncé lors de l’envoi. Aucun appel au modèle n’a lieu et ce message devient `cancelled` avec `parts: []`.

Si rien ne tourne ni n’attend, l’annulation donne **404**, `CHAT_TURN_NOT_RUNNING`. `data.lastMessageId` et `data.lastStatus` décrivent alors le dernier message d’assistant, comme le suivi `idle`. Tu peux ainsi reconnaître une réponse déjà terminée sans requête supplémentaire.

Un projet archivé refuse la modification, la suppression et l’annulation avec **403**.

### Résoudre les erreurs de modèle et d’accès

Un message d’assistant en échec contient un `error` lisible et, lorsqu’il est disponible, un `errorCode`. Deux codes signalent un problème de compte fournisseur : `credit_exhausted` pour un solde épuisé et `model_not_entitled` pour un modèle non inclus dans le forfait.

Base le traitement automatique sur `errorCode`, pas sur la phrase ni sur le seul statut HTTP du fournisseur. `error` reprend la réponse du fournisseur précédée de ce statut ; un **429** peut ainsi correspondre à `model_not_entitled` si le refus concerne le forfait. Ces deux codes ne sont pas `rate_limited` : attendre ne suffit pas. Choisis un autre modèle ou corrige le compte.

Avant de traiter un envoi accepté, le worker vérifie à nouveau le fil et l’accès au projet. Si le fil a changé de projet ou si l’accès a été retiré pendant l’attente, il n’exécute pas le tour et n’ajoute pas d’erreur dans le nouveau contexte.

## Rechercher dans les fichiers d’un projet

Utilise l’URL du projet pour limiter les résultats à ses fichiers indexés. L’accès en lecture suffit, même si le projet est archivé. Les documents de l’organisation ou des équipes, les autres projets, les sites web et les pièces jointes d’e-mails sont exclus.

Omets `corpus` ou fournis `"documents"`. Une autre valeur, ou un champ `projectId` dans le corps, donne **400**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/knowledge/search" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "Date limite de déclaration du premier trimestre", "limit": 10 }'
```

### Interpréter les scores et les erreurs de recherche

Le corps exige `query`, dont les espaces en début et fin sont supprimés avant validation. Il accepte `limit` de 1 à 50, avec 10 par défaut, et `minSimilarity` de 0 à 1.

`limit` détermine le nombre de résultats retournés. Tale recherche dans un ensemble plus large de candidats, vérifie leur accès et l’état de leur document avant de fusionner les classements, puis sélectionne les premiers résultats. Un candidat inaccessible n’occupe donc aucun rang. `limit: 1` retourne le meilleur passage accessible, sans limiter la recherche initiale à un seul candidat. À `fusedScore` égal, un passage que la branche par mots-clés a classé passe avant un passage que seule la branche vectorielle a trouvé, puis la plus petite identité de ligne — un terme exact est une preuve plus forte qu’un plus proche voisin.

`minSimilarity` filtre uniquement la recherche vectorielle avant fusion. Cette API n’applique aucun seuil par défaut : sans ce champ, elle peut renvoyer des passages dont la similarité est faible. La recherche par mots-clés n’a pas ce seuil.

L’assistant intégré utilise, lui, le seuil de l’organisation : `minSimilarity` dans [`embedding.json`](/fr/self-hosted/configuration/data-residency#le-modele-dembedding-de-lorganisation), avec 0,45 par défaut. Ce réglage ne s’applique pas automatiquement à cet appel REST.

Les résultats sont ordonnés par `fusedScore`. Ce score combine les classements des branches : somme de `1/(60+rang)` pour les branches ayant retenu le passage, normalisée par le meilleur score possible pour ce nombre de branches. Il sert à comparer les résultats d’une même réponse, pas à mesurer une probabilité de pertinence. Le premier résultat d’une recherche à une seule branche peut avoir 1,0 même si sa pertinence est faible. Le score n’est pas directement comparable entre deux recherches.

Les autres champs permettent d’examiner pourquoi un passage a été retenu :

- `similarity` contient la similarité cosinus de la branche vectorielle, sur l’échelle 0..1 du modèle d’embedding. Il vaut `null` si seule la recherche par mots-clés a trouvé le passage — garde ces résultats, une correspondance exacte d’identifiant ou d’expression est une preuve plus forte que n’importe quel cosinus (en code : `hits.filter(h => h.similarity === null ? h.keywordScore !== null : h.similarity >= floor)`).
- `keywordScore` contient le score BM25, non borné. Il vaut `null` si seule la recherche vectorielle a trouvé le passage.
- `matchedLegs` indique les branches correspondantes : `documents:keyword`, `documents:dense`, `web:keyword` ou `web:dense` selon le corpus recherché.
- `legs` est leur nombre : par exemple 2 si les branches par mots-clés et vectorielle ont toutes deux retenu le passage.
- `score` conserve le score propre à la première branche retenue.

Une similarité élevée ne garantit pas la pertinence. Un terme inventé ou mal orthographié peut obtenir un score inattendu. Examine le passage lui-même ; si `matchedLegs` ne contient pas `documents:keyword`, la recherche par mots-clés n’a pas confirmé ce résultat de document.

Chaque résultat inclut le passage et sa `source`. Pour un document, `source.documentId` identifie le document, tandis que `source.ref` contient la référence du fichier utilisée par l’index :

- Si `source.projectId` vaut `null`, lis le document avec `GET /api/v1/documents/{id}`.
- Pour un fichier de projet, utilise les routes du projet, comme `GET /api/v1/projects/{projectId}/files/{documentId}/content` ou `DELETE .../files/{documentId}`. La route `/api/v1/documents/{id}` répond **404** pour ce fichier.

`diagnostics.cached` et `diagnostics.reranked` sont réservés aux déploiements qui installent un cache sémantique ou un reclassement des résultats. Aucun des deux n’est fourni dans cette version ; ces valeurs restent donc `false`. `diagnostics.legs` nomme chaque branche qui a tourné avec les candidats admis qu’elle a apportés — `0` quand elle a tourné sans que rien survive (`documents:dense: 0` est une branche vectorielle qui n’a rien trouvé dans le périmètre, jamais une branche absente) —, et `diagnostics.dense` ne vaut `false` que quand le corpus n’a pas pu servir la branche vectorielle du tout, comme `diagnostics.bm25` pour l’index par mots-clés. Les passages ne portent aucun caractère de contrôle hors tabulation, saut de ligne et retour chariot, et un passage répété au sein d’un même document — un export d’une seule ligne, un rapport issu d’un gabarit — est indexé une fois, par sa première occurrence, si bien qu’un fichier plein de doublons n’encombre pas la branche vectorielle et ne classe pas ses copies une par une.

Les erreurs d’embedding demandent des traitements distincts :

- **409**, `EMBEDDING_NOT_CONFIGURED` : aucun modèle d’embedding n’est configuré.
- **409**, `EMBEDDING_CREDIT_EXHAUSTED` : le fournisseur refuse pour une raison de compte, comme un solde épuisé, un plafond de dépenses ou un forfait sans accès au modèle.
- **409**, `EMBEDDING_CREDENTIAL_REJECTED` : le fournisseur rejette la clé ou son accès au modèle.
- **503**, `EMBEDDING_UPSTREAM_ERROR` : autre panne du fournisseur, avec `Retry-After`. Réessaie en espaçant progressivement les tentatives.

Les refus liés au compte ou aux identifiants ne sont pas des limites de débit. Ils nécessitent une correction par un administrateur, pas une simple attente.

Pour rechercher dans les documents visibles de l’organisation et des équipes hors projet, ou dans les sites web enregistrés, utilise `POST /api/v1/knowledge/search`. Son `corpus` accepte `"documents"`, `"web"` ou `"all"`, qui est la valeur par défaut. Cette route exclut les fichiers de projet et les pièces jointes d’e-mails.

Dans les deux cas, la recherche de documents porte uniquement sur ceux associés à un fichier. Un texte stocké directement dans `content` n’entre pas dans l’index.

## Refléter un système externe dans un projet

Utilise les routes Projets pour synchroniser automatiquement un système externe, comme un CRM ou un logiciel de gestion de cabinet, avec Tale. Ton processus peut retrouver ou créer le projet d’un client, préparer ses dossiers, importer des fichiers, puis vérifier leur présence.

Les appels utilisent les droits de la personne qui a créé la clé. Un projet auquel elle n’a pas accès renvoie la même réponse qu’un projet inexistant. Pour écrire par ces routes, il faut le rôle Rédacteur ou supérieur et l’accès en édition au projet. Le rôle Membre permet uniquement la lecture.

Les routes Projets et Tâches exigent une organisation explicite lorsque la personne associée à la clé appartient à plusieurs organisations. Envoie alors `X-Organization-Slug` à chaque appel ; sans cet en-tête, la réponse est **400**.

Un compte dédié à l’intégration, membre d’une seule organisation, évite cette ambiguïté. Les exemples conservent néanmoins l’en-tête : lorsqu’il est présent, Tale vérifie toujours l’appartenance à l’organisation indiquée.

### Trouver ou créer le projet

`externalItemId` contient l’identifiant du projet dans ton système externe, par exemple celui de la fiche CRM. Tale traite cette chaîne comme une valeur opaque, unique dans l’organisation.

Avant de stocker ou comparer la valeur, Tale retire les espaces de début et de fin et applique la normalisation Unicode NFC. Un identifiant transmis en NFD par macOS retrouve donc celui enregistré en NFC depuis un CSV. Un saut de ligne final provenant d’une variable shell ne crée pas de doublon.

Si d’anciens projets avaient des identifiants différents uniquement par leur normalisation Unicode, la migration a conservé l’identifiant du projet portant la forme canonique et effacé celui des doublons. Pour réattribuer un identifiant à l’un de ces projets, utilise `PATCH /api/v1/projects/{id}`.

Commence par rechercher l’identifiant externe. La réponse contient au maximum un projet. Un projet inaccessible à la personne associée à la clé n’apparaît pas dans les résultats :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?externalItemId=crm-4711" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [] } — ou [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711" } ]
```

Un projet archivé possède une valeur `archivedAt`. Prévois le traitement de cet état dans ton intégration avant de poursuivre avec une écriture.

Sans `externalItemId`, la route liste les projets accessibles, du plus récent au plus ancien. La réponse paginée contient `{projects, isDone, continueCursor}`. Tant que `isDone` vaut `false`, transmets `continueCursor` dans `?cursor=` pour obtenir la page suivante. La pagination repose sur les derniers éléments lus, sans décalage numérique.

L’ancien champ `cursor`, déprécié depuis la version 1.5, contient le même jeton lorsqu’une autre page existe. Lis désormais `continueCursor`. Une recherche par identifiant externe renvoie directement `isDone: true` et un curseur vide.

Les projets archivés sont exclus par défaut. Utilise `?archived=include` pour les inclure, ou `?archived=only` pour ne lire qu’eux. Chaque projet fournit `createdAt` et `updatedAt` pour faciliter le rapprochement avec ton système :

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects?limit=50" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "projects": [ { "id": "...", "name": "ACME Ltd", "externalItemId": "crm-4711", "createdAt": 1774..., "updatedAt": 1774... } ], "isDone": true, "continueCursor": "" }
```

Si aucun projet ne correspond et que le compte dispose des accès attendus, crée le projet :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "ACME Ltd", "externalItemId": "crm-4711" }'
# → 201 { "project": { "id": "...", "name": "ACME Ltd", "key": "ACME", "externalItemId": "crm-4711" } }
```

`key`, le préfixe des identifiants de tâches, et `description` sont facultatifs. Sans `key`, Tale essaie de former le préfixe à partir du nom.

Créer deux projets avec le même `externalItemId` normalisé renvoie **409**. La même valeur reste autorisée dans une autre organisation. Un identifiant devenu vide après retrait des espaces renvoie **400**, `INVALID_BODY`.

Un `key` explicite doit contenir de 2 à 6 lettres ou chiffres et commencer par une lettre. Tale le convertit en majuscules. Une valeur invalide renvoie **400** ; elle n’est pas tronquée.

Si le nom ne permet pas de former un préfixe valide, le projet est créé sans `key`. Si un préfixe dérivé est déjà pris, Tale en génère un autre jusqu’à en trouver un libre. Un préfixe explicite déjà utilisé renvoie **409**, `PROJECT_KEY_TAKEN` : choisis-en un autre. Un `externalItemId` déjà utilisé renvoie **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`.

### Créer les dossiers

Créer un dossier retrouve d’abord un dossier de même nom sous le même parent. La comparaison ignore la casse : `inbox` et `INBOX` désignent donc le même dossier. S’il existe, Tale renvoie son nom enregistré avec **200** et `created: false`. Sinon, la réponse est **201** et `created: true`.

Tu peux répéter cette étape après une interruption. Deux processus qui demandent simultanément le même dossier obtiennent également un seul dossier.

Le champ `name` contient un nom de dossier, jamais un chemin. Les séparateurs `/` et `\`, les caractères de contrôle et les valeurs `.` ou `..` provoquent **400**, `FOLDER_NAME_INVALID`. Le message décrit la règle enfreinte et `data.issues` désigne le champ `name`.

Comme pour les fichiers, Tale retire les espaces de début et de fin et normalise le nom en NFC. `parentId` doit désigner un dossier du même projet ; omets-le pour créer un dossier racine. Une chaîne vide renvoie **400**, `INVALID_BODY`. Aucun nom de dossier n’a de rôle réservé dans la plateforme :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/folders" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "2026-Q1" }'
# → 201 { "folder": { "id": "<folderId>", "name": "2026-Q1" }, "created": true }
```

Utilise `parentId` pour créer un sous-dossier. Le nom, après retrait des espaces, ne peut pas dépasser 128 caractères. Un chemin comme `a/b`, `.` ou `..` renvoie **400**, `FOLDER_NAME_INVALID`. Un dossier situé au niveau 20 ne peut plus recevoir de sous-dossier : Tale renvoie **400**, `FOLDER_DEPTH_EXCEEDED`.

Parcours l’arborescence un niveau à la fois :

- `GET .../folders` liste les dossiers racine.
- `GET .../folders?parentId=<folderId>` liste les enfants du dossier indiqué.
- `GET .../folders/{folderId}` lit un dossier précis, notamment à partir du `folderId` renvoyé par `GET .../files`.

Chaque dossier possède un `parentId`, égal à `null` à la racine. Remonte cette chaîne pour reconstituer le chemin, même si ton intégration n’a pas créé l’arborescence. Un `parentId` ou `folderId` qui ne correspond pas à un dossier de ce projet renvoie **404**, `FOLDER_NOT_FOUND`.

### Charger un fichier en deux étapes

Deux appels REST encadrent un envoi direct au stockage objet : préparer le transfert, envoyer les octets, puis les rattacher au projet. L’exemple shell demande `jq`, un dossier de projet existant et un fichier local dont l’extension et le type MIME sont autorisés. N’exécute la commande suivante qu’après la réussite de la précédente.

```bash
: "${TALE_URL:?Set TALE_URL to your Tale origin}"
: "${TALE_API_KEY:?Set TALE_API_KEY}"
: "${TALE_ORG_SLUG:?Set TALE_ORG_SLUG}"
: "${TALE_PROJECT_ID:?Set TALE_PROJECT_ID}"
: "${TALE_FOLDER_ID:?Set TALE_FOLDER_ID to a folder in this project}"
: "${FILE_PATH:?Set FILE_PATH to an existing local file}"
: "${FILE_MIME:?Set FILE_MIME, for example application/pdf}"

FILE_NAME=$(basename "$FILE_PATH")
FILE_SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
UPLOAD_BODY=$(jq -n --arg name "$FILE_NAME" --arg type "$FILE_MIME" \
  --argjson size "$FILE_SIZE" '{fileName:$name,contentType:$type,size:$size}')
UPLOAD_JSON=$(curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/uploads" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$UPLOAD_BODY")
UPLOAD_ID=$(printf '%s' "$UPLOAD_JSON" | jq -er '.uploadId')
UPLOAD_URL=$(printf '%s' "$UPLOAD_JSON" | jq -er '.url')
FILE_REF=$(printf '%s' "$UPLOAD_JSON" | jq -er '.s3Ref')
printf '%s' "$UPLOAD_JSON" | jq '{uploadId,method,expiresAt,maxBytes}'
```


#### Envoyer les octets avant de lier le fichier

L’URL `url` autorise un `PUT` direct vers le stockage objet. Envoie les octets avec cette méthode, sans en-tête `Authorization` : l’URL est déjà signée et le stockage refuse une double authentification.

Si tu as déclaré `contentType` lors de la préparation, le `Content-Type` du `PUT` doit être strictement identique. Cette valeur fait partie de la signature. Si tu as omis `contentType`, l’en-tête n’est pas imposé par la signature. Après le transfert, utilise la `s3Ref` reçue comme `fileId` lors du rattachement.

Fournis `fileName` dès la préparation, par exemple `"fileName": "ledger-2026-q1.pdf"`. Tale vérifie le nom et l’extension avant de signer l’URL. Un format refusé par la plateforme ou la politique d’import de l’organisation renvoie **400**, `UPLOAD_POLICY_REJECTED` ou `UNSUPPORTED_FILE_TYPE`.

Un nom sans extension est également refusé, quelle que soit la valeur de `contentType`. Tu peux ainsi corriger le problème avant de transférer les octets.

La préparation renvoie aussi `maxBytes`, la taille maximale autorisée pour le type déclaré. Le plafond de la plateforme est de 100 Mio, soit 104 857 600 octets ; une limite d’organisation plus basse s’applique en priorité.

Le champ facultatif `size` permet d’annoncer la taille prévue. Une taille supérieure au plafond de la plateforme renvoie **400**, `FILE_TOO_LARGE`. Le dépassement de la limite d’organisation ou de ton quota total renvoie **400**, `UPLOAD_POLICY_REJECTED`, avec la limite dans `data.limitBytes`.

Déclarer `size` évite un transfert inutile lorsque le fichier est trop volumineux. Ce contrôle ne remplace pas celui du rattachement : Tale vérifie alors la taille des octets réellement reçus selon les mêmes plafonds. La taille annoncée n’a pas à correspondre exactement à la taille reçue ; la sous-estimer ne permet pas de contourner les limites.

Envoie les octets à l’URL reçue. N’y ajoute pas la clé API Tale : la signature authentifie déjà la requête au stockage objet. Attends la réussite de l’envoi avant le rattachement.

```bash
curl --fail-with-body --silent --show-error --request PUT "$UPLOAD_URL" \
  --header "Content-Type: $FILE_MIME" \
  --upload-file "$FILE_PATH"
```

```bash
BIND_BODY=$(jq -n --arg upload "$UPLOAD_ID" --arg ref "$FILE_REF" \
  --arg folder "$TALE_FOLDER_ID" --arg name "$FILE_NAME" \
  '{uploadId:$upload,fileId:$ref,folderId:$folder,fileName:$name}')
curl --fail-with-body --silent --show-error \
  "$TALE_URL/api/v1/projects/$TALE_PROJECT_ID/files" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG" \
  --header 'Content-Type: application/json' --data "$BIND_BODY"
```

Le rattachement renvoie `201 {file}` avec l’ID du nouveau document. Conserve `file.id` pour lire, télécharger, indexer ou supprimer le fichier ; il est distinct de `uploadId` et de `s3Ref`.

#### Gérer expiration, formats et envois abandonnés

L’`uploadId` est utilisable une seule fois. Il expire après 30 minutes, en même temps que l’URL présignée : `expiresAt` donne leur échéance commune. Après expiration, prépare un nouveau transfert.

Une interruption n’impose pas à elle seule de changer d’`uploadId`. Tant qu’il reste valide et que le rattachement n’a pas réussi, un transfert manquant peut être envoyé puis rattaché avec le même identifiant, comme décrit pour `BLOB_NOT_FOUND` ci-dessous.

`fileName` doit être un simple nom de fichier. Tale retire les espaces de début et de fin et le normalise en NFC. Un séparateur de chemin ou un caractère de contrôle provoque **400**.

Le nom doit se terminer par une extension autorisée. `CON` et `attachment-4711`, par exemple, provoquent `UNSUPPORTED_FILE_TYPE` à la préparation comme au rattachement. Déclarer `contentType` ne remplace jamais l’extension.

Tale vérifie de nouveau la politique d’import au rattachement. Un fichier trop volumineux ou d’un type interdit renvoie **400** avec un code de raison.

La plateforme accepte les extensions `pdf`, `doc`, `docx`, `odt`, `ppt`, `pptx`, `xls`, `xlsx`, `csv`, `txt`, `md`, `json`, `yaml`, `yml`, `py`, `jpg`, `jpeg`, `png`, `gif`, `webp` et `ac2` pour les fichiers comptables Banana. La politique de l’organisation peut restreindre cette liste. Le message `UNSUPPORTED_FILE_TYPE` énumère les formats autorisés dans l’ordre alphabétique.

Si les octets ne sont pas arrivés à l’URL présignée, le rattachement renvoie **404**, `BLOB_NOT_FOUND`. La réservation du rattachement est annulée, sans consommer l’identifiant : effectue le `PUT`, puis réessaie le rattachement avec le même `uploadId` encore valide.

Sans stockage objet configuré, la préparation et le rattachement renvoient **503**, `OBJECT_STORE_UNCONFIGURED`.

Des octets transférés mais jamais rattachés peuvent rester après un refus, une interruption ou l’expiration du transfert. Tale prend en charge leur nettoyage : 24 heures après l’expiration de l’autorisation de 30 minutes, une prochaine préparation dans l’organisation supprime un lot d’objets abandonnés et leurs autorisations associées. Ton intégration n’a pas à les supprimer elle-même.

Jusqu’à ce nettoyage, les objets restent dans le stockage. Sans rattachement, ils ne sont pas des fichiers du projet, ne comptent pas dans les quotas et n’apparaissent pas dans les listes.

#### Choisir d’indexer le fichier

Les fichiers rattachés par ces routes appartiennent au projet. Ils ne sont pas ajoutés à la bibliothèque de connaissances de l’organisation et n’apparaissent pas dans `/api/v1/documents`.

Par défaut, le rattachement utilise `skipRagIndexing: true` et ne lance pas l’indexation. Envoie `skipRagIndexing: false` pour indexer le fichier dès son rattachement.

Un fichier non indexé reste visible dans la liste du chat de projet et porte le statut **Non indexé** dans l’onglet Connaissances. La recherche ne le retrouve pas avant son indexation.

Pour l’indexer ensuite, utilise **Indexer maintenant** sur sa ligne ou `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`. Cette route utilise le même traitement et le même plafond de 10 demandes par personne et par minute que la relance d’un document de la bibliothèque. Elle renvoie `{"status": "indexing"}` quand elle lève l’exclusion de l’indexation, ou `skipped` avec un `reason`.

L’assistant peut néanmoins lire à la demande un fichier texte brut jusqu’à 4 Mio : `rag_fetch` avec son identifiant renvoie les octets comme texte, même sans indexation.

Le `mimeType` enregistré est déterminé par l’extension du fichier et devient le `Content-Type` du téléchargement. Le type multimédia d’un transfert multipart ou une indication d’upload ne remplace pas cette règle.

### Vérifier ce qui est arrivé

Le paramètre `folderId` détermine les fichiers renvoyés : omets-le pour obtenir tous les fichiers du projet, utilise `folderId=root` pour ceux qui sont à la racine, ou indique l’identifiant d’un dossier pour obtenir son contenu. Un dossier qui n’appartient pas au projet renvoie **404**, `FOLDER_NOT_FOUND`.

```bash
curl -sS --compressed "https://your-host.example.com/api/v1/projects/<projectId>/files?folderId=<folderId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 200 { "files": [ { "id": "...", "fileName": "ledger-2026-q1.pdf", "folderId": "<folderId>", "mimeType": "application/pdf", "size": 48213, "indexing": { "status": "skipped" }, "createdAt": 1774... } ], "isDone": true, "continueCursor": "" }
```

Chaque fichier fournit sa taille réelle dans `size` et son état `indexing`, avec les mêmes statuts que `GET /api/v1/documents`. Un rattachement conservant `skipRagIndexing: true` produit le statut `skipped`.

Pour rendre le fichier recherchable, appelle `POST .../files/{documentId}/retry-indexing`, puis consulte son état dans cette liste jusqu’à `completed`.

La liste renvoie `{files, isDone, continueCursor}`. Tant que `isDone` vaut `false`, transmets `continueCursor` tel quel dans `?cursor=`. Ce jeton signé est opaque. `?limit=` fixe la taille de la page, avec un maximum de 100.

Lorsqu’une autre page existe, la réponse inclut aussi l’ancien champ `cursor`, déprécié depuis la version 1.5. Il contient le même jeton ; utilise `continueCursor` dans les nouveaux clients.

Pour surveiller un seul fichier, utilise `GET /api/v1/projects/{id}/files/{documentId}`. La réponse `{file}` contient `id`, `fileName`, `folderId`, `mimeType`, `createdAt` et `size` en octets (`null` si inconnue), ainsi que l’état d’indexation lorsqu’il existe. Renvoie l’`ETag` dans `If-None-Match` pour obtenir `304` tant que rien ne change. Après `POST .../retry-indexing`, suis cette ligne jusqu’à la fin de l’indexation, sans reparcourir la liste entière. Un enregistrement absent, supprimé, hors du projet ou sans fichier donne le même `404 FILE_NOT_FOUND`.

```bash
curl --fail-with-body --compressed "$TALE_URL/api/v1/projects/<projectId>/files/<documentId>" \
  --header "Authorization: Bearer $TALE_API_KEY" \
  --header "X-Organization-Slug: $TALE_ORG_SLUG"
```

### Supprimer ce dont tu n’as plus besoin

`DELETE .../files/{documentId}` supprime définitivement le fichier : son document, ses passages dans le corpus de recherche et son objet stocké. La réponse est **204** si la suppression aboutit, sinon une erreur explique le refus :

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>/files/<documentId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

`DELETE .../folders/{folderId}` supprime tout le sous-arbre. Tale purge d’abord les fichiers du dossier et de ses sous-dossiers ainsi que leurs passages de recherche, puis retire les dossiers. Les fichiers supprimés ne sont plus retrouvés par la recherche du projet.

Si le sous-arbre contient un document maîtrisé protégé ou des données sous conservation légale, toute la suppression est refusée avec **409**, avant le retrait du moindre élément. Si le stockage objet ne peut pas terminer la purge, la réponse est **503**, `PURGE_INCOMPLETE`, sans retrait des enregistrements ; réessaie après résolution du problème.

Les suppressions de fichier et de dossier exigent l’accès en édition à un projet actif. Un élément absent, déjà supprimé ou rattaché à un autre projet renvoie **404**, avec `FILE_NOT_FOUND` ou `FOLDER_NOT_FOUND`.

#### Archiver, renommer ou supprimer le projet

L’archivage, la restauration et la suppression du projet sont réservés aux administrateurs de l’organisation. Les autres rôles reçoivent **403**, `ROLE_FORBIDDEN`.

`PATCH /api/v1/projects/{id}` avec `{ "archived": true }` archive le projet. Il reste lisible, mais ses écritures sont refusées avec **403**, `PROJECT_ARCHIVED`, et son `externalItemId` reste réservé. Envoie `{ "archived": false }` pour le restaurer.

Pour actualiser les informations du projet, le même `PATCH` accepte `name`, `description` et `externalItemId`. Ces modifications demandent un rôle d’édition et l’accès en édition à un projet actif. Chaque champ est facultatif, mais il faut en envoyer au moins un.

- `name` est nettoyé de ses espaces de début et de fin et ne peut pas être vide.
- `description: null` efface la description.
- `externalItemId` est nettoyé et normalisé en NFC. `null` libère l’identifiant. Un identifiant déjà utilisé par un autre projet provoque **409**, `PROJECT_DUPLICATE_EXTERNAL_ID`, avec la valeur concernée dans `data`.

Lorsqu’une requête combine restauration et renommage, Tale restaure d’abord le projet. Lorsqu’elle combine renommage et archivage, l’archivage intervient en dernier. Renommer un projet archivé sans le restaurer dans la même requête provoque **403**, `PROJECT_ARCHIVED`.

Si « ACME Ltd » devient « ACME Group » dans le CRM, envoie `{ "name": "ACME Group" }`. Le contenu du projet reste inchangé.

`DELETE /api/v1/projects/{id}` supprime le projet et libère son identifiant externe. Deux modes sont disponibles :

- Par défaut, la suppression en cascade fait expirer les documents dans le traitement de rétention, place tes propres chats dans la corbeille et retire les tâches en annulant leurs exécutions en cours.
- Avec `{ "mode": "detach" }`, les documents et chats sont détachés du projet et conservés dans l’organisation.

Dans les deux cas, les agents et dossiers du projet sont supprimés. La cascade partage avec la suppression dans l’application un plafond de 5 opérations par personne et par minute :

```bash
curl -sS --compressed -X DELETE "https://your-host.example.com/api/v1/projects/<projectId>" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>"
# → 204
```

La suppression du projet renvoie **409**, avant toute écriture, dans les cas suivants :

- Une automatisation est encore installée dans le projet : `PROJECT_HAS_BOUND_AUTOMATIONS`, avec les noms dans `data.automations`. Désinstalle chacune avec `DELETE /projects/{id}/automations/{name}` avant de réessayer.
- La cascade supprimerait un document maîtrisé en relecture, approuvé ou conservant une version approuvée : `PROJECT_HAS_PROTECTED_RECORDS`, avec les documents dans `data.documents`.
- Une conservation légale couvre un document du projet : `PROJECT_LEGAL_HOLD`.

## Créer une tâche, puis l'exécuter

Les routes Tâches permettent de représenter un élément externe sur le tableau d’un projet, de lancer un workflow déployé pour le traiter et de lire ses résultats.

Si l’automatisation est liée à des projets, installe-la d’abord dans celui où tu veux l’utiliser. L’installation est idempotente : **201** lors du premier appel, **200** si la liaison existe déjà. Elle exige la capacité développeur et l’accès en édition à un projet actif. Si le compte de l’intégration n’a pas ces droits, fais préparer cette liaison avant son premier appel :

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/automations/vat-return" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "name": "vat-return", "added": true }
```

`GET /api/v1/projects/{id}/automations` liste les automatisations installées dans le projet. Une automatisation sans aucune liaison peut aussi s’exécuter dans un projet accessible à un appelant disposant des droits d’édition requis. Elle n’apparaît toutefois pas dans cette liste.

Pour désinstaller une automatisation, utilise `DELETE /api/v1/projects/{id}/automations/{name}`. La réponse est **204**, ou **404**, `AUTOMATION_NOT_INSTALLED`, si elle n’était pas installée. Les mêmes droits de développeur et d’édition du projet sont requis.

### Créer ou actualiser la tâche reflétée

La combinaison `(projectId, externalSystem, externalId)` identifie la tâche de façon unique. Le premier appel la crée avec **201** et `created: true`. Un nouvel appel retrouve la même tâche avec **200** et `created: false`.

Tale retire les espaces de début et de fin des deux identifiants externes et les normalise en NFC, comme l’`externalItemId` d’un projet. Des différences de normalisation ou d’espacement ne créent donc pas de doublon. Un identifiant devenu vide provoque **400**.

Le `projectId` vient de l’URL : le répéter dans le corps provoque **400**. La création exige l’accès en édition à un projet actif.

`externalState` synchronise l’état de l’élément source :

- `closed` place la tâche en `in_review` pour qu’une personne puisse la terminer. Dans ce parcours de synchronisation, seul un appel du moteur de workflow lui-même peut directement la placer en `done`.
- `open` ramène en `backlog` une tâche que la synchronisation avait placée en `in_review`, ou une tâche en `done`.

Une mise en revue décidée par une personne ou un agent reste inchangée. Dès qu’un déplacement est effectué depuis le tableau, la synchronisation ne peut plus annuler sa propre mise en revue en envoyant `open`.

Une tâche annulée reste annulée dans les deux cas.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "externalSystem": "crm", "externalId": "case-991", "title": "Prepare the Q1 filing" }'
# → 201 { "task": { "id": "<taskId>", "created": true } }
```

Un nouvel appel pour une tâche active ayant la même référence externe actualise son titre et sa description. Omettre `description` l’efface. Les libellés changent uniquement si tu les envoies. Une tâche archivée reste inchangée.

L’identifiant de la tâche reste stable et `runWorkflowSlug` ne relance pas de workflow lors de cet appel répété. Après une réponse perdue, conserve les mêmes données pour réessayer.

### Lier un dossier de préparation et attribuer l’automatisation

`description`, `labels`, `externalUrl` et `setupFolderName` sont facultatifs. `title` accepte au maximum 200 caractères. `externalUrl` doit être une URL absolue en `http` ou `https`. Un titre trop long ou un autre schéma d’URL provoque **400**, sans modification silencieuse de la valeur.

`setupFolderName` désigne un dossier racine du projet par son nom, sans tenir compte de la casse. Tale enregistre l’identifiant de ce dossier dans le champ `externalUrl` de la tâche. Une automatisation conçue pour travailler à partir d’un dossier peut alors retrouver cette référence dans son entrée `{task: ...}`. Le dossier est résolu à nouveau à chaque appel de synchronisation.

Si aucun dossier racine ne correspond au nom, Tale renvoie **400**, `SETUP_FOLDER_MISSING`, sans créer la tâche. Envoyer à la fois `setupFolderName` et `externalUrl` provoque **400**, `INVALID_BODY`.

Les noms de libellés sont nettoyés de leurs espaces de début et de fin, puis normalisés en NFC. La comparaison avec les libellés du projet ignore la casse. Un nouveau libellé conserve l’orthographe envoyée ; un libellé existant conserve celle déjà enregistrée.

La réponse respecte l’ordre de ta liste. Ainsi, `["Bug", "P1"]` reste `["Bug", "P1"]`. Si le projet possède déjà `Bug`, envoyer `["bug"]` réutilise ce libellé au lieu d’en créer un second.

Envoie `automationSlug` pour attribuer la tâche à une automatisation. Cette attribution alimente le panneau de travail de la tâche : démarrage, progression de l’exécution et questions adressées à l’opérateur. Un appel ultérieur peut compléter une attribution manquante, mais ne remplace pas un responsable déjà défini.

`runWorkflowSlug` demande le démarrage d’un workflow déployé dans le même appel, uniquement si la tâche vient d’être créée. La réponse contient son `runId` ; l’ancien champ `executionId`, déprécié, contient la même valeur.

La tâche reste créée si le démarrage échoue ensuite. La réponse contient alors `runId: null`, notamment si `runWorkflowSlug` ne désigne aucune automatisation déployée. Vérifie donc la référence d’exécution même après une réponse de création réussie. Tu peux aussi lancer le workflow explicitement dans un appel distinct.

L’attribution par `automationSlug` a des exigences plus strictes : l’automatisation doit exister, sinon Tale renvoie **404**, `AUTOMATION_NOT_FOUND`, et posséder une version déployée, sinon **409**, `AUTOMATION_NOT_DEPLOYED`. Ces erreurs nomment l’automatisation concernée.

Une automatisation liée uniquement à d’autres projets ne peut pas s’exécuter ici : la réponse est **403**.

```bash
curl -sS --compressed -X POST "https://your-host.example.com/api/v1/projects/<projectId>/tasks/<taskId>/start" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d '{ "workflowSlug": "vat-return" }'
# → 200 { "started": true, "runId": "<runId>", "executionId": "<runId>" }
```

### Vérifier si une exécution de tâche a démarré

Le démarrage exige l’accès en édition à un projet actif et une tâche active. Une tâche archivée provoque **403**, `TASK_ARCHIVED`. L’archivage se fait depuis le tableau ; ces routes ne proposent pas d’opération pour cela. Consulte `archivedAt` dans la tâche avant de la démarrer.

L’exécution reçoit la tâche dans `{task: ...}`. Aucune capacité développeur supplémentaire n’est requise pour ce démarrage. Le journal l’attribue à la clé utilisée. Suis ensuite `GET /api/v1/projects/{id}/runs/{runId}` avec `runId` ; `executionId` est son ancien alias déprécié.

Une réponse **200** ne prouve pas qu’une nouvelle exécution a commencé. Lis `started`. Si la réponse contient `started: false` et `reason: "already_running"`, elle fournit le `runId` de l’exécution déjà en cours — une tâche ne tient qu’une exécution vivante à la fois, quelle que soit l’automatisation qui l’a démarrée, cette exécution peut donc appartenir à une autre automatisation (son `name` dit laquelle) : suis celle-ci. Un workflow lié à d’autres projets répond **403**, `AUTOMATION_PROJECT_FORBIDDEN`.

`workflowSlug` nomme l’automatisation telle que `GET /api/v1/automations` la liste — la forme avec `/` (`billing/dunning`), jamais l’orthographe `__` du chemin d’URL — et doit désigner une automatisation existante et déployée. Sinon, la route renvoie respectivement **404**, `AUTOMATION_NOT_FOUND`, ou **409**, `AUTOMATION_NOT_DEPLOYED`, en nommant l’automatisation. Ce sont les mêmes exigences que pour l’attribution d’une tâche avec `automationSlug`.

Ces vérifications précèdent la facturation du budget de démarrage. `reason: "not_started"` couvre le cas résiduel où le déploiement disparaît entre la vérification et le démarrage.

Des démarrages simultanés de la même tâche avec la même automatisation retrouvent la même exécution active. Ce mécanisme ne correspond pas à une prise en charge d’`Idempotency-Key` pour les tâches : après sa fin, un nouvel appel peut créer une autre exécution. Conserve le `runId` renvoyé et consulte-le avant de répéter un démarrage au résultat incertain.

### Commenter et lire l’état de la tâche

Les commentaires sont publiés au nom de la personne qui a créé la clé, avec le même comportement que dans l’application, y compris pour les @mentions. Toute personne pouvant lire le projet, même avec le rôle Membre, peut commenter une tâche active dans un projet actif.

Une tâche archivée refuse les nouveaux commentaires avec **403**, `TASK_ARCHIVED`. Un projet archivé les refuse avec `PROJECT_ARCHIVED`. La tâche et ses commentaires restent lisibles après archivage.

L’API vérifie d’abord le projet indiqué dans l’URL. Un projet absent ou inaccessible provoque **404**, `PROJECT_NOT_FOUND`. Elle vérifie ensuite la tâche : `TASK_NOT_FOUND` signifie que celle-ci n’existe pas ou appartient à un autre projet.

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

### Lire les commentaires et télécharger les livrables

Consulte la sortie de l’exécution et les commentaires de la tâche pour connaître le résultat. Certaines automatisations créent aussi des fichiers ; leur présence et leur dossier de destination dépendent du workflow. Ne suppose pas que chaque exécution dépose un livrable dans le dossier de préparation ou du trimestre.

Les commentaires sont paginés, avec la page la plus récente en premier. Chaque page est ordonnée chronologiquement. `limit` vaut 200 par défaut et accepte au maximum 500. Tant que `isDone` vaut `false`, retransmets `continueCursor` tel quel dans `cursor` pour lire les commentaires plus anciens. Ce jeton signé est opaque, pas numérique.

La route de contenu renvoie directement les octets avec **200**, sans redirection. L’en-tête `Content-Disposition`, conforme à la RFC 6266, indique le nom du fichier.

Utilise `curl -o` pour enregistrer les octets. Ajoute `--fail-with-body` pour qu’un refus produise un code de sortie non nul ; ton script peut ainsi distinguer un téléchargement réussi d’une réponse d’erreur JSON.

La route accepte une plage d’octets unique dans `Range`, par exemple `bytes=0-1023`, `bytes=1024-` ou `bytes=-512`. Elle renvoie alors **206** avec `Content-Range`.

Une plage commençant à la fin du fichier ou au-delà renvoie **416**, avec un corps vide et `Content-Range: bytes */<size>`. C’est notamment ce qu’envoie `curl -C -` lorsque la copie locale est déjà complète : la taille permet de reconnaître ce cas. Plusieurs plages ou un en-tête illisible sont ignorés ; le fichier entier est alors renvoyé avec **200**.

`HEAD` renvoie les mêmes en-têtes que `GET`, dont `Content-Length`, `Content-Type`, `ETag`, `Last-Modified` et `Accept-Ranges`, sans corps. Il ignore `Range`.

Utilise `curl -I`, plutôt que `curl -X HEAD` qui peut attendre un corps. Pour vérifier si le contenu a changé, retransmets l’`ETag` dans `If-None-Match` : la réponse est **304** tant que le fichier reste identique.

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

Les erreurs ordinaires produites par l’API utilisent un objet JSON plat :


```json
{ "error": "Automation not found", "code": "AUTOMATION_NOT_FOUND" }
```

`error` contient un message destiné à une personne. `code` fournit l’identifiant stable à utiliser dans ton programme. Les refus émis par l’API possèdent ce code ; OpenAPI en énumère les valeurs dans `Error.code`.

De nouveaux codes peuvent être ajoutés dans une version mineure. Prévois donc un traitement générique selon le statut HTTP pour les codes inconnus. Certains refus ajoutent `data`, par exemple `issues` pour un corps invalide, `retryAfterMs` pour une limite de débit ou `providers` pour un modèle ambigu.

Ne suppose pas que toute réponse hors 2xx contient ce JSON. Les réponses conditionnelles **304** et les réponses à `HEAD` n’ont pas de corps. Certains refus du serveur frontal, notamment **400** ou **431**, peuvent également arriver sans enveloppe JSON. Vérifie le statut et la présence d’un corps avant de le parser.

Les principaux statuts sont décrits ci-dessous. Utilise le `code` pour distinguer les cas lorsqu’il est disponible :

- **400** — la requête n’est pas valide. Le code précise le contrôle à corriger :

  - `INVALID_BODY` couvre un champ requis manquant, un mauvais type, une clé inconnue, un corps illisible ou non UTF-8, un caractère NUL, un substitut UTF-16 non apparié, un entier supérieur à 2^53 − 1 ou une valeur hors des bornes du champ. Un `limit` envoyé dans un corps de recherche au-dessus du plafond est refusé, sans être ramené à la limite.
  - `data.issues` indique chaque champ concerné, par exemple `price` ou `contacts.2.email`, et sa raison. Une clé inconnue possède son propre problème, à son nom. Les raisons restent des textes affichables, tels que `is required`, `must be a string`, `must not be blank`, `must be at most 200 characters` ou `must be one of "a", "b"`. Corrige le champ indiqué par `path` ; ton programme doit utiliser `code`, pas analyser ces phrases.
  - Les corps sont interprétés comme JSON, quelle que soit la valeur de `Content-Type`. Ces routes ne renvoient pas 415.
  - Pour les paramètres de requête, un curseur jamais fourni par la liste donne `INVALID_CURSOR`, un `limit` non entier donne `INVALID_LIMIT` et un autre paramètre refusé donne `INVALID_QUERY`. La réponse désigne aussi le paramètre dans `data.issues`. Ces erreurs ne sont pas traitées comme une demande de première page. Un `limit` entier hors des bornes, lui, est ramené dans la plage autorisée.
  - Une entrée refusée par le schéma `inputs` de l’automatisation donne `AUTOMATION_INPUT_INVALID`, avec `data.issues`. Un déclencheur impossible donne `AUTOMATION_TRIGGER_INVALID`, par exemple le 30 février dans `0 0 30 2 *`.
  - Un patch supprimant le dernier champ d’identité d’un contact donne `CONTACT_IDENTITY_REQUIRED`. Modifier le contenu d’un document maîtrisé gelé ou sans suivre son remplacement donne `DOCUMENT_RECORD_FROZEN` ou `DOCUMENT_RECORD_REPLACEMENT_REQUIRED`.
  - Une clé associée à plusieurs organisations sans organisation explicite donne `ORG_SLUG_REQUIRED`. Un `Idempotency-Key` vide après normalisation, de plus de 255 caractères ou contenant des caractères hors ASCII imprimable donne `INVALID_HEADER`, avec le nom de l’en-tête dans `data.issues`.
  - Un octet NUL dans l’URL, comme `%00` dans le chemin ou la chaîne de requête, donne `INVALID_URL` avant le routage et la vérification de la clé.
  - En HTTP/2, un corps terminé avant la longueur annoncée dans `Content-Length` donne `BODY_LENGTH_MISMATCH`. Cette réponse vient du serveur frontal, avec un nouveau `requestId` et sans `X-Tale-Api-Version`.
- **401** — la clé API est absente ou invalide : `UNAUTHORIZED`, avec `WWW-Authenticate: Bearer`.
- **403** — l’action dépasse les droits du compte : rôle insuffisant (`ROLE_FORBIDDEN`, `KNOWLEDGE_ENTRY_FORBIDDEN`), accès en édition manquant ou `teamId` désignant une équipe dont la personne n’est pas membre (`TEAM_ACCESS_DENIED`). Ce statut couvre aussi les écritures sur un projet ou une tâche archivé (`PROJECT_ARCHIVED`, `TASK_ARCHIVED`), une automatisation interdite dans le projet et un `X-Organization-Slug` désignant une organisation inaccessible (`ORG_FORBIDDEN`).
- **404** — la ressource est absente, inaccessible ou rattachée à un autre fil ou projet. Chaque famille utilise son code, par exemple `PROJECT_NOT_FOUND`, `DOCUMENT_NOT_FOUND` ou `THREAD_NOT_FOUND`. Un `X-Organization-Slug` inconnu donne `ORG_SLUG_INVALID`.

  Une route inconnue donne `NOT_FOUND` après vérification de la clé. Sans clé, **401** reste prioritaire : `/api/v1/openapi.json`, qui n’existe pas, répond **401** sans clé et **404** avec une clé valide. Le document public est disponible à `/openapi.json`, sans clé.
- **405** — la route existe mais ne prend pas en charge cette méthode : `METHOD_NOT_ALLOWED`. L’en-tête `Allow` énumère les méthodes acceptées.
- **409** — l’état de la ressource empêche l’opération. Les causes comprennent une automatisation non déployée, une automatisation liée appelée sans URL de projet, une exécution encore active à sa suppression (`RUN_ACTIVE`), un `Idempotency-Key` réutilisé avec un autre corps (`IDEMPOTENCY_KEY_REUSED`), un fil archivé ou un tour déjà en cours.

Un instantané de contenu plus récent lié à un contact dans la corbeille donne également `409 CONVERSATION_CONTACT_TRASHED`. Restaure le contact ou ferme le miroir avant de poursuivre.

  Les doublons ont des codes propres à la ressource : `CONTACT_DUPLICATE_EMAIL` et `CONTACT_DUPLICATE_EXTERNAL_ID` pour `email` et `externalId` d’un contact ; `DUPLICATE_PRODUCT_NAME` et `DUPLICATE_PRODUCT_EXTERNAL_ID` pour `name` et `externalId` d’un produit ; `KNOWLEDGE_ENTRY_DUPLICATE` pour le sujet d’une entrée ; `PROJECT_DUPLICATE_EXTERNAL_ID` pour l’`externalItemId` d’un projet.

  Ce statut couvre aussi une entrée de connaissances remplacée (`KNOWLEDGE_ENTRY_SUPERSEDED`), un `expectedUpdatedAt` périmé (`CONTACT_STALE`, `PRODUCT_STALE`, `DOCUMENT_STALE`), un document portant une entrée active (`DOCUMENT_HAS_KNOWLEDGE_ENTRY` : modifie ou supprime l’entrée), une livraison qui ne peut pas être relancée car elle n’est pas en lettre morte (`DELIVERY_RETRY_UNAVAILABLE`) et une recherche sans modèle d’embedding.
- **412** — une précondition échoue, sans écriture. Pour un skill, `If-Match` provoque `SKILL_STALE` si le `SKILL.md` a changé ou si aucun bundle n’est stocké. `data.etag` contient l’ETag courant, ou `null` en l’absence de bundle. `If-None-Match: *` provoque `SKILL_EXISTS` si le slug possède déjà un bundle.
- **413** — le corps dépasse la taille autorisée : `BODY_TOO_LARGE`, avec le plafond dans le message. La limite habituelle des corps JSON est de 1 Mio, sauf indication différente pour l’opération dans les sections précédentes. Le webhook accepte au maximum 256 Kio, soit 262 144 octets. Un fichier dépassant la politique de taille ou de type est, lui, refusé au rattachement avec **400** et un code de raison.
- **422** — le bundle de skill stocké n’est pas lisible : lien symbolique, fichier dépassant le plafond de préparation de 4 Mio ou `SKILL.md` impossible à parser (`SKILL_MALFORMED`). Les lectures peuvent produire cette réponse. Pour un `PUT`, elle concerne uniquement le bundle déjà présent : le corps envoyé est validé avec **400**, `INVALID_BODY` ou `INVALID_SKILL`, et ne provoque pas à lui seul **422**.
- **429** — le débit autorisé est dépassé (`RATE_LIMITED`). `error` décrit l’attente et `requestId` identifie la requête. Respecte `Retry-After` en secondes entières ou `data.retryAfterMs` en millisecondes avant de réessayer ; consulte [Limites de débit](/fr/develop/rate-limits).

| Statut | Sens et action |
| --- | --- |
| **414** | l’URL, chemin et chaîne de requête compris, dépasse 32 Kio : `URI_TOO_LONG`. L’enveloppe contient un `requestId`. |
| **408** | la réception complète des en-têtes et du corps a dépassé 15 minutes : `REQUEST_TIMEOUT`. La réponse contient un nouveau `requestId`, car la requête expirée n’en avait pas encore reçu. La connexion est fermée ; utilise une connexion plus rapide ou des transferts plus petits pour réessayer. |
| **431** | les en-têtes dépassent ensemble le plafond de 64 Kio du serveur frontal. En HTTP/1.1, la réponse n’a ni enveloppe JSON ni `X-Request-Id` — l’analyseur du frontal l’écrit avant qu’une route tourne. Le frontal tolère quelques Kio de marge : une URL ou un en-tête légèrement trop long peut encore atteindre la plateforme et y être refusé selon ses règles. Une URL de 66 Kio reçoit ainsi **414**. En HTTP/2, le plafond de 64 Kio est strict et son dépassement entraîne la fermeture de la connexion. |
| **500** | une erreur interne est survenue : `INTERNAL_ERROR`. Fournis le `requestId` de l’enveloppe lorsque tu la signales. |
| **503** | une dépendance nécessaire est indisponible. Cela comprend le fournisseur d’embedding (`EMBEDDING_UPSTREAM_ERROR`, avec `Retry-After`), le stockage d’un téléchargement (`OBJECT_STORE_UNAVAILABLE`, avec `Retry-After`), un stockage non configuré (`OBJECT_STORE_UNCONFIGURED`) ou une purge inachevée (`PURGE_INCOMPLETE`). `KNOWLEDGE_ENTRY_STORE_TIMEOUT` signifie que le stockage a accepté l’écriture d’une entrée de connaissances sans répondre dans les 30 secondes ; aucun enregistrement n’est créé. Réessaie avec un délai croissant. |
| **502**, **503**, **504** | le serveur frontal ne peut pas joindre la plateforme, par exemple pendant son redémarrage : `UPSTREAM_UNAVAILABLE`. Il fournit `Retry-After` et un nouveau `requestId`, sans `X-Tale-Api-Version`. Ce comportement concerne les routes destinées aux programmes : `/api/*`, `/events`, `/status.json`, `/openapi.json` et `/.well-known/*`. Une navigation dans le navigateur reçoit la page de maintenance. Réessaie avec un délai croissant. |

Un `If-Match` de document qui ne correspond plus à sa représentation lue donne aussi `412 PRECONDITION_FAILED`, avec le tag courant dans `data.etag` et aucune écriture.


Retirer le déclencheur d’une automatisation existante avec `DELETE .../triggers` renvoie **204**, même si aucun déclencheur n’était configuré. Une automatisation inconnue renvoie **404**.

Supprimer une ressource absente renvoie aussi **404**, y compris un contact déjà dans la corbeille ou une entrée de connaissances déjà supprimée. Supprimer une entrée active retire toutes les versions de son sujet, place son document dans la corbeille et retire immédiatement les passages correspondants du corpus de recherche. La suppression directe de ce document est refusée.

Annuler une exécution inconnue renvoie **404**. Une réponse `{cancelled: false}` indique qu’elle existe mais est déjà terminée.

Tu peux lire l’énumération exacte des erreurs sans clé :

```bash
curl --fail --silent --show-error "$TALE_URL/openapi.json" \
  | jq -r '.components.schemas.Error.properties.code.enum[]'
```

## Versionnage

Distingue trois versions lorsque tu connectes un client à une instance :

- Le build renvoyé par `GET /api/health` identifie la version du déploiement.
- Le préfixe `/api/v1/` désigne la génération compatible de l’API REST.
- `info.version` dans `/openapi.json` identifie la version du contrat d’échange.

Le retrait des routes `/api/v1/` nécessite une génération `/api/v2/` et une annonce au moins deux versions mineures à l’avance. Pendant ce préavis, les routes concernées portent les en-têtes `Deprecation` et `Sunset`.

Le contrat suit le versionnage sémantique. Une version mineure peut ajouter une opération, un champ, un en-tête ou un code d’erreur. Un retrait ou un changement de sens exige une version majeure.

Les réponses de l’API indiquent dans `X-Tale-Api-Version` la version implémentée, ce qui permet à un client utilisant une version précise de détecter une évolution. Le document OpenAPI décrit les routes et schémas de l’instance en cours d’exécution ; son champ `servers` désigne cette instance. La page `/docs` permet de le consulter.

Utilise ce document comme contrat de ton client. Consulte aussi **Changements du contrat API** dans les notes de version : chaque changement des échanges y indique le comportement précédent et le nouveau. Le [format des notes de version](/fr/self-hosted/operate/release-notes/format) décrit cette convention.

Certaines routes et certains protocoles sont décrits séparément :

- `GET /api/health` est une sonde de fonctionnement sans authentification. Elle renvoie `{"status":"ok","version":"<build>"}`.
- `GET /status` et `/status.json` décrivent l’état du déploiement dans la [page de statut](/fr/develop/status-page).
- `/openapi.json` et `/docs` servent le contrat lui-même.
- [WebDAV](/fr/develop/webdav-api) et OpenID Connect, décrit plus haut, suivent leurs propres protocoles.

Les notes publiées sont disponibles sur [GitHub Releases](https://github.com/tale-project/tale/releases).

## Où ça se place

Utilise cette référence pour intégrer Tale depuis une application externe via REST. Le [point d’accès MCP](/fr/develop/mcp-endpoint) donne accès à la plateforme aux clients MCP et permet d’écrire les automatisations, une opération absente de REST.

Les [webhooks](/fr/develop/webhooks) démarrent des exécutions entrantes sans clé API. Pour configurer le travail directement dans Tale, notamment les agents de projet et les automatisations, consulte la documentation [Plateforme](/fr/platform).
