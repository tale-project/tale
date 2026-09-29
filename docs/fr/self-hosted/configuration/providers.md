---
title: Fournisseurs
description: Configure des endpoints IA personnalisés, comprends les définitions de fournisseurs et fournis les identifiants depuis les secrets du déploiement.
---

Pour configurer un fournisseur IA, distingue sa définition de fournisseur, les identifiants de l’organisation et le serveur de modèles. La définition décrit l’endpoint et le protocole ; les identifiants contrôlent l’accès ; l’opérateur de l’endpoint exploite le service.

Cette page couvre les définitions personnalisées et les secrets issus de l’environnement. Pour créer des identifiants et choisir les valeurs par défaut dans l’application, suis [Fournisseurs IA](/fr/platform/admin/providers).

## Endpoints de fournisseurs locaux

Un serveur d’inférence local exige une définition de fournisseur et l’autorisation pour le backend d’atteindre son hôte. La définition n’installe pas le serveur et ne charge aucun modèle.

1. Rends le serveur joignable depuis chaque rôle backend qui l’appelle. Dans un conteneur, `localhost` désigne ce conteneur, pas la machine hôte. Vérifie la résolution du nom, l’accès réseau et, si nécessaire, le certificat TLS depuis le réseau d’exécution réel.
2. Pour un endpoint privé ou de boucle locale, définis `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` dans l’environnement du backend. Cette option autorise les hôtes de fournisseurs privés pour tout le déploiement ; ce n’est pas une liste d’autorisation par fournisseur. Les endpoints de métadonnées cloud restent bloqués. Recrée les conteneurs concernés pour appliquer le changement : un redémarrage conserve leur environnement Compose actuel.
3. Déclare le fournisseur dans `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml` ou avec la [procédure de configuration gérée](/fr/self-hosted/configuration/config-releases). Respecte le schéma natif et choisis un nom distinct des définitions fournies. Un admin de l’organisation peut aussi créer le même fichier depuis l’app : **Ajouter des identifiants** > **Fournisseur personnalisé** sous **Paramètres > Fournisseurs IA** ; voir [Définir un fournisseur personnalisé](/fr/platform/admin/providers#definir-un-fournisseur-personnalise).

Dans cet exemple, remplace l’IP privée et le port par ceux de ton serveur. HTTP est accepté uniquement pour les hôtes reconnus comme privés ou de boucle locale ; les endpoints publics exigent HTTPS. Un nom DNS interne ne contourne pas le contrôle des hôtes privés effectué à chaque requête.

```yaml
name: local-models
displayName: Local models
apiFormat: openai
baseUrl: http://192.168.1.20:8000/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

Cette définition utilise une API de chat compatible OpenAI et découvre les modèles à partir de `/v1/models`. Vérifie la compatibilité réelle du serveur : une liste de modèles ne prouve pas que la génération, les appels d’outils ou le streaming fonctionnent. Si le serveur ne peut pas lister ses modèles, utilise `catalog.source: none` et saisis leurs identifiants exacts dans la liste autorisée de l’accès. Un fournisseur personnalisé ne charge pas de fichier de modèles statique propre à l’organisation.

Un administrateur ajoute ensuite un accès dans [Fournisseurs IA](/fr/platform/admin/providers), actualise le catalogue et sélectionne un modèle précis pour un court chat. Vérifie la requête terminée dans les journaux du serveur prévu. Les embeddings, la parole et les outils nécessitent leur propre contrôle des destinations ; un endpoint de chat local ne les rend pas locaux.

## Configurer la transcription audio

La politique de l’organisation se trouve dans `TALE_CONFIG_DIR/<org>/governance/transcription-model.yml`, sous le type `transcription_model`. La page [Modèles](/fr/platform/admin/governance/content-models) modifie la même sélection. Un fichier absent ou un objet vide signifie une sélection automatique :

```yaml
{}
```

Pour fixer un modèle, fournis les deux champs. Cet exemple utilise le modèle OpenAI Whisper fourni et exige toujours un accès actif et utilisable dans l’organisation :

```yaml
providerSlug: openai
modelId: whisper-1
```

Une sélection partielle est invalide. Un modèle fixé mais indisponible n’est jamais remplacé automatiquement : rétablis son accès fournisseur ou les modèles autorisés pour cet accès, ou reviens explicitement à la sélection automatique. Un échec de lecture ou de validation de la configuration refuse aussi la transcription serveur. La politique couvre les fichiers audio et vidéo, le recours à l’audio pour les liens vidéo et la dictée serveur. La reconnaissance vocale du navigateur reste indépendante.

Avec un accès OpenRouter actif défini par défaut, Tale découvre aussi les modèles de reconnaissance vocale via `/models?output_modalities=transcription`. Le même accès et ses modèles autorisés s’appliquent. Pour fixer un modèle, reprends son identifiant exact dans ce catalogue, ou conserve la sélection automatique. Le [guide de reconnaissance vocale d’OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/stt) décrit l’API du fournisseur.

Pour un endpoint personnalisé compatible OpenAI, utilise `catalog.source: models-endpoint`. Sa réponse à `/models` doit déclarer le modèle audio avec un identifiant `id` exact et soit `type: transcription`, soit `architecture.output_modalities: [transcription]`. Un modèle dédié uniquement à la transcription peut omettre `context_window` ou indiquer `0` ; les autres modèles exigent toujours une valeur positive. Un modèle de chat avec entrée audio ou un modèle de synthèse vocale ne devient pas automatiquement un candidat à la transcription.

Tale envoie les champs multipart `file` et `model` à `POST <baseUrl>/audio/transcriptions`, avec une authentification Bearer. Pour OpenRouter, Tale demande `response_format: json`, car certains de ses modèles refusent `verbose_json`. Les autres endpoints compatibles doivent accepter `response_format: verbose_json`. La réponse JSON fournit la transcription dans `text`. Pour la durée, Tale privilégie une valeur `duration` valide, sinon une valeur `usage.seconds` valide. Si aucune ne convient, Tale utilise la durée mesurée localement lorsqu’elle est disponible. Des `segments` horodatés peuvent fournir les horodatages vidéo ; sans eux, la transcription reste du texte brut. La présence au catalogue ne prouve pas que cette API fonctionne. Actualise le catalogue, sélectionne le modèle, puis teste un court enregistrement et vérifie la requête dans les journaux de cet endpoint.

## Configurer la génération d’images {#configure-image-generation}

La politique de l’organisation se trouve dans `TALE_CONFIG_DIR/<org>/governance/image-generation.yml`, sous le type `image_generation`. La page [Modèles](/fr/platform/admin/governance/content-models#let-agents-generate-images) modifie les mêmes réglages. Une nouvelle organisation démarre avec la génération d’images désactivée, et un fichier absent signifie aussi désactivée :

```yaml
enabled: false
```

Indique `enabled: true` pour la sélection automatique, ou fixe un modèle en renseignant les deux champs :

```yaml
enabled: true
providerSlug: openai
modelId: gpt-image-1
```

Un modèle fixé à moitié ou un champ inconnu est invalide. Un fichier invalide ou illisible laisse la génération d’images désactivée, et la page Modèles nomme le problème. La sélection automatique essaie `google/gemini-2.5-flash-image`, `gpt-image-1-mini`, `gpt-image-1` et `black-forest-labs/flux.2-pro`, dans cet ordre, via un identifiant par défaut OpenRouter ou OpenAI. Si le modèle fixé est indisponible, Tale ne passe jamais à un autre modèle. Un modèle fixé peut rester dans le fichier tant que `enabled` vaut `false`.

Le backend appelle le modèle d’images avec l’identifiant de l’organisation ; aucune clé n’entre dans la sandbox. Pour OpenRouter, il envoie `POST <baseUrl>/images`, l’API d’images d’OpenRouter, et enregistre le coût que la réponse indique. Pour tout autre fournisseur, il utilise l’API d’images d’OpenAI : `POST <baseUrl>/images/generations`, ou `POST <baseUrl>/images/edits` en formulaire multipart quand l’agent transmet des images de référence. Tale évalue ensuite les tokens indiqués par la réponse avec les tarifs de l’entrée du modèle dans le catalogue. Tale découvre les modèles d’images d’OpenRouter via `/models?output_modalities=image`, et le catalogue OpenAI fourni contient `gpt-image-1` et `gpt-image-1-mini`.

La réponse `/models` d’un endpoint personnalisé compatible OpenAI doit déclarer un modèle d’images avec `image` parmi `architecture.output_modalities` ou `modalities.output`, et un `context_length` ou `context_window` positif. Tale n’enregistre que des images matricielles (PNG, JPEG, WebP, GIF) et refuse le SVG d’un modèle. Une entrée de catalogue ne prouve pas que l’endpoint fonctionne : active la génération d’images, fixe le modèle, fais créer une image de test par un agent, puis vérifie la requête dans les journaux de l’endpoint.

## Vérifier l’accès aux modèles depuis la sandbox

Le chat appelle un fournisseur depuis le backend. Les agents de programmation passent par `sandbox-llm-gateway` : un chat réussi ne valide donc pas leur connexion. L’endpoint doit être résolvable et joignable depuis le backend et la passerelle. Chaque client HTTPS doit faire confiance à son certificat. Un nom comme `https://models.internal/v1` exige lui aussi l’autorisation des fournisseurs privés lorsque le DNS renvoie une adresse privée. HTTP reste limité aux formes d’hôtes acceptées par le schéma, comme une IP privée, `localhost` ou `.local`.

Au démarrage d’une nouvelle session sandbox, le backend contrôle le nom du fournisseur personnalisé et ses réponses DNS avant de le configurer dans la passerelle. Les destinations privées exigent `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` ; les métadonnées restent bloquées même avec cette option. Ce contrôle préalable ne fixe pas les réponses DNS des requêtes ultérieures de la passerelle. Garde la définition du fournisseur et le DNS sous le contrôle d’opérateurs de confiance.

Recrée les processus backend concernés avec le nouvel environnement, puis démarre une nouvelle session sandbox avec le fournisseur, le modèle et un environnement d’exécution compatible. Envoie une demande sans contenu sensible et vérifie la réponse complète ainsi que l’entrée correspondante dans les journaux du serveur d’inférence. Si le chat fonctionne mais que l’agent n’atteint pas son modèle, examine les journaux de `sandbox-llm-gateway`. `SANDBOX_EGRESS_ALLOWLIST` contrôle l’accès web général de la sandbox, pas cette connexion distincte au modèle.

Les agents de programmation s’appuient aussi sur la fenêtre de contexte que le catalogue indique pour le modèle : la valeur `context_length` ou `context_window` que ton serveur publie sur `/v1/models`, ou 128 000 tokens lorsque la liste n’indique ni l’une ni l’autre, comme pour un fournisseur configuré avec `catalog.source: none`. Fais en sorte que cette liste indique le contexte que ton serveur sert réellement. Lorsque cette fenêtre, ou une [limite de contexte](/fr/platform/admin/governance/policies-and-limits) plus basse pour la personne qui a lancé l’exécution, reste sous 200 000 tokens, une session Claude Code gérée condense sa conversation en un résumé avant que le prompt ne la dépasse. Claude Code traite toute valeur inférieure à 100 000 tokens comme 100 000 : un modèle qui offre moins de contexte peut donc recevoir des prompts plus longs qu’il ne peut en contenir. Réserve Claude Code aux modèles qui offrent au moins ce contexte.

Sur un modèle autre que Claude, une session Claude Code gérée omet aussi la ligne d’attribution que Claude Code place sinon au début de chaque prompt système. Cette ligne change à chaque requête : un serveur qui met en cache le début des prompts devrait sinon recalculer toute la conversation à chaque tour.

## Où vivent les connecteurs

Les définitions fournies se trouvent dans `configs/platform/system/providers/<slug>/provider.yml` et leurs catalogues statiques dans `configs/platform/system/models/<slug>/models.yml`. Anthropic utilise par exemple `providers/anthropic/provider.yml` et `models/anthropic/models.yml`. Ces fichiers appartiennent à l’image et évoluent avec sa version.

<Warning>

Les fichiers fournis sont des entrées d’image en lecture seule, remplacées lors des mises à niveau. Pour un fournisseur externe, utilise la déclaration vérifiée `configuration` décrite dans [Installation CLI](/fr/self-hosted/install/cli-install#configurer-la-plateforme). Elle crée un connecteur propre à l’organisation sous `TALE_CONFIG_DIR/<org>/providers/` avec le schéma natif ; les modifications d’identifiants et de politiques passent par les API natives. L’entrée **Fournisseur personnalisé** d’**Ajouter des identifiants** dans l’app écrit le même fichier propre à l’organisation et conserve chaque version enregistrée sous `.history/`.

</Warning>

## Ce qu’un connecteur déclare

Une définition décrit le protocole, l’endpoint, le catalogue et les méthodes d’authentification admises. Elle ne contient aucun identifiant d’organisation. Ces deux extraits en montrent le format :

<CodeGroup>

```yaml anthropic.yml
name: anthropic
displayName: Anthropic
apiFormat: anthropic
baseUrl: https://api.anthropic.com
catalog:
  source: static
auth:
  - method: api-key
  - method: env
  - method: subscription-broker
    constraints:
      execution: sandbox
      harness: claude-code
```

```yaml openrouter.yml
name: openrouter
displayName: OpenRouter
apiFormat: openai
baseUrl: https://openrouter.ai/api/v1
catalog:
  source: openrouter-api
auth:
  - method: api-key
  - method: env
```

</CodeGroup>

| Champ | Rôle |
| --- | --- |
| `apiFormat` | Format de requête : `openai` ou `anthropic`. |
| `wireDialect: openai-modern` | Pour le format OpenAI : utilise `max_completion_tokens` et omet la température personnalisée pour les modèles de raisonnement. Laisse-le absent pour les endpoints qui exigent les champs classiques. |
| `baseUrl` | Endpoint fixe partagé par les accès correspondants. |
| `endpointMode: per-credential` | Utilise un endpoint propre à chaque accès à la place de `baseUrl`, comme Azure OpenAI. |
| `catalog.source` | `static`, `openrouter-api`, `models-endpoint` ou `none`. Les entrées statiques viennent du catalogue de modèles décrit plus haut. |
| `embedding` | Indique si le fournisseur sert des embeddings : `supported` quand son catalogue fournit une largeur de vecteurs vérifiée, `unsupported` quand il ne propose aucun modèle d’embedding, si bien que **Paramètres > Résidence des données > Modèle d’embedding** le refuse, ou `unknown`, la valeur par défaut, quand un admin saisit le modèle et sa largeur de vecteurs. Ne déclare `unsupported` que si la documentation du fournisseur lui-même l’indique. |
| `auth` et `constraints` | Méthodes d’accès admises et conditions d’exécution, par exemple un harness sandbox précis. |

## Source de clé par variable d’environnement

Avec la méthode **Variable d’environnement**, l’accès enregistre un nom de variable ; le backend en lit la valeur dans son environnement au moment de la requête. Fournis cette valeur avec le gestionnaire de secrets du déploiement. Cette méthode ne stocke pas la clé API dans la base applicative.

Seuls les noms commençant par `TALE_PROVIDER_KEY_` sont acceptés. Le nom complet est limité à 40 caractères ; le suffixe accepte lettres, chiffres et traits de soulignement. Le formulaire ajoute le préfixe automatiquement.

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

Le préfixe réservé empêche un accès de désigner un autre secret tel que `SOPS_AGE_KEY` ou `BETTER_AUTH_SECRET`. La validation refuse les noms invalides avant l’enregistrement.

</Note>

Après avoir ajouté ou renouvelé la valeur, recrée `backend-api` et `backend-worker` avec le nouvel environnement. Un redémarrage Compose conserve les anciennes valeurs. Les espaces au début et à la fin sont supprimés avant utilisation. Vérifie une vraie requête après le déploiement.

## Connecter un courtier d’abonnement

Un courtier d’abonnement fournit un pool de jetons d’accès OAuth ; Tale choisit un compte utilisable pour chaque tour d’agent. Les intégrations livrées sont Anthropic avec Claude Code et OpenAI ChatGPT avec Codex, pour les agents de tâche et d’automatisation. Conserve des identifiants API directs pour les chats et les autres appels directs aux modèles. Un jeton OAuth n’est pas une clé API de fournisseur.

Utilise une adresse distincte pour chaque fournisseur. Tale AI Gateway expose `/api/tokens/anthropic` et `/api/tokens/openai`, avec sa clé API comme jeton Bearer pour l’authentification. L’adresse combinée `/api/tokens` ne convient pas à des identifiants associés à un seul fournisseur. Le backend doit pouvoir joindre le courtier selon la politique d’accès aux hôtes décrite plus haut pour les fournisseurs.

L’exemple ci-dessous est le document d’identifiants du courtier construit par le [formulaire des fournisseurs IA](/fr/platform/admin/providers#connecter-un-courtier-dabonnement), pas un fichier de définition de fournisseur. Remplace le nom d’hôte par celui de ton courtier et fournis sa clé API dans `TALE_TOKEN_SOURCE_AI_GATEWAY` aux deux processus backend. Les noms de propriétés correspondent à Tale AI Gateway ; adapte-les à la réponse si tu utilises un autre courtier.

```json
{
  "endpoint": "https://broker.example.com/api/tokens/anthropic",
  "httpMethod": "GET",
  "auth": {
    "method": "bearer",
    "secretEnv": "TALE_TOKEN_SOURCE_AI_GATEWAY"
  },
  "responseMapping": {
    "tokensPath": "$.tokens",
    "tokenField": "access_token",
    "statusField": "status",
    "activeValue": "active",
    "expiresField": "expires_at"
  },
  "targetEnvVar": "CLAUDE_CODE_OAUTH_TOKEN",
  "selection": "round-robin"
}
```

Pour OpenAI, remplace la fin de l’adresse par `/api/tokens/openai` et `targetEnvVar` par `TALE_SUBSCRIPTION_TOKEN`. Chaque entrée OpenAI utilisable doit aussi contenir l’`account_id` du fournisseur. Tale transmet cette valeur dans `TALE_SUBSCRIPTION_ACCOUNT_ID`, avec le jeton, à la connexion ChatGPT de Codex. N’utilise ni l’`id` de la passerelle ni `CODEX_ACCESS_TOKEN` à la place de ces valeurs. Limite les modèles autorisés de ces identifiants aux modèles pris en charge par l’abonnement ChatGPT ; le catalogue de l’API OpenAI peut contenir des modèles indisponibles avec les abonnements.

Pour Anthropic OAuth, utilise `CLAUDE_CODE_OAUTH_TOKEN`. La cible historique `ANTHROPIC_AUTH_TOKEN` reste prise en charge lorsqu’elle est configurée explicitement ; elle utilise l’authentification Bearer générique de Claude Code. Tale retire les autres variables d’identifiants du fournisseur avant de transmettre le jeton choisi. Une variable cible non prise en charge par l’environnement d’agent sélectionné est refusée.

### Identité des comptes et quotas

En plus des champs de jeton, de statut et d’expiration configurés, chaque entrée peut fournir les champs standard suivants. Leurs noms sont fixes et ne demandent aucune configuration supplémentaire de la réponse.

| Champ | Rôle |
| --- | --- |
| `id` | Identifiant du courtier |
| `provider` | Fournisseur |
| `account_id` | Compte du fournisseur |
| `available` | Disponibilité pour un nouveau travail |
| `available_at` | Moment où le compte redevient disponible |
| `hold` | Raison pour laquelle un compte indisponible est retenu |
| `usage` | Relevé d’usage |

L’`id` doit rester stable lorsque le jeton d’accès change, afin de reconnaître le compte lors des nouvelles tentatives. Il est distinct de l’`account_id` du fournisseur requis par OpenAI. Si `provider` désigne un autre fournisseur que celui des identifiants, l’entrée est exclue.

`available: false` exclut le compte jusqu’à l’horodatage ISO dans `available_at`. Si le renouvellement est inconnu, omets cet horodatage ou utilise `null` ; le compte reste alors exclu jusqu’à ce que le courtier le déclare disponible. Le statut et l’expiration du jeton sont vérifiés séparément. Tale AI Gateway calcule la disponibilité à partir d’un relevé `usage` contenant `checked_at` et `windows`, chaque fenêtre indiquant son type, son utilisation et son horodatage de renouvellement.

Les anciens courtiers peuvent omettre ces métadonnées facultatives. Sans `id`, Tale utilise une empreinte du jeton pour identifier le compte lors des nouvelles tentatives ; il ne peut donc pas le reconnaître après un changement de jeton. L’absence de données de quota laisse le compte sélectionnable, sans prouver qu’il reste du quota.

Tale AI Gateway exclut un compte lorsqu’un relevé récent indique qu’une fenêtre globale de session ou hebdomadaire est utilisée à 100 % et que son renouvellement n’a pas encore eu lieu. Un signal explicite de limite du fournisseur (`usage.limited: true`) rend aussi le compte indisponible, même si le taux d’utilisation affiché est inférieur ou absent. Les limites propres à un modèle n’excluent pas le compte entier. Un relevé devient périmé après 15 minutes : des données inconnues ou périmées laissent donc le compte sélectionnable. Une fenêtre épuisée sans horodatage de renouvellement bloque le compte uniquement tant que le relevé est récent. La demande de jetons suivante actualise les données périmées lorsque le fournisseur le permet. Après le renouvellement du quota concerné, le compte peut rejoindre le pool. Le fournisseur peut encore refuser une requête entre deux actualisations. Tale AI Gateway signale aussi un compte comme indisponible jusqu’à l’actualisation prévue de son jeton (`refresh_at`) dès qu’elle est à moins d’une heure, soit la durée de validité qu’il garantit par défaut à un jeton distribué, et qu’un autre compte peut prendre le travail. Un tel compte porte `hold: "refresh"`, tandis qu’un quota épuisé porte `hold: "quota"`. La passerelle juge qu’un autre compte peut prendre le travail sans connaître les règles propres à Tale : le délai d’attente après un HTTP 429 décrit plus bas et l’`account_id` exigé par OpenAI. Si ces règles ne laissent aucun compte disponible, Tale utilise, parmi les comptes retenus pour leur actualisation, celui dont l’actualisation est la plus lointaine, au lieu de refuser le travail. Une exécution ne démarre donc avec un jeton sur le point d’être révoqué que si le pool n’a rien de mieux, et un pool d’un seul compte n’est jamais retenu de cette façon. Un courtier qui n’envoie pas de champ `hold` laisse exclus tous les comptes indisponibles.

### Sélection et résolution des erreurs

`random` est le choix initial du formulaire ; `first` suit l’ordre du courtier. `round-robin` choisit le compte utilisable dont la dernière sélection est la plus ancienne, avec un historique conservé par organisation et par identifiants. Les requêtes simultanées de plusieurs processus backend mettent cet historique à jour de façon atomique ; l’ordre des réponses et les redémarrages ne le réinitialisent pas. Conserver l’historique d’un compte après un changement de jeton exige un `id` stable. Ces stratégies répartissent les sélections de comptes, pas la consommation de jetons ni la capacité des agents en cours. Les identifiants existants conservent leur stratégie enregistrée.

Lorsqu’un compte répond HTTP 429, Tale l’exclut des nouvelles sélections pendant 60 secondes pour cette organisation et ces identifiants. Les nouvelles tentatives privilégient les comptes encore inutilisés pendant la série d’échecs de l’exécution. Si tous les comptes autrement utilisables ont été essayés, une tentative peut en réutiliser un ; les exclusions liées au quota et au délai d’attente restent applicables. Lorsque tous les comptes sont dans ce délai d’attente, une nouvelle tentative automatique d’une tâche ou d’une automatisation est mise en file d’attente aussitôt, mais ne démarre que lorsque le premier compte redevient disponible. Cette attente ne consomme aucune tentative automatique si l’exécution refusée relançait elle-même un échec en HTTP 429.

Un HTTP 401 pendant une exécution utilisant un jeton du courtier peut indiquer que ce jeton a changé pendant le travail. Tale redemande des identifiants au courtier et reprend la conversation si sa référence et sa session sandbox sont encore disponibles ; sinon, un nouveau tour commence. Les deux premières interruptions de ce type d’affilée ne consomment pas de tentative automatique et n’excluent pas le compte, pour permettre l’utilisation d’un jeton de remplacement du même compte. La troisième compte comme n’importe quel autre échec. Cette limite couvre aussi un 401 dû à une autorisation invalide plutôt qu’à un changement de jeton. Après au moins quinze minutes de travail, le décompte repart de zéro.

Sans valeur personnalisée, une demande de pool expire après 10 secondes et accepte au plus 262 144 octets. L’expiration d’un jeton, lorsqu’un champ est configuré pour la lire, doit se situer au-delà de la marge de sécurité `expirySkewMs`, de cinq minutes par défaut. Avec Tale AI Gateway, conserve les champs de statut et d’expiration pour écarter les jetons inactifs ou proches de leur expiration ; la passerelle retient déjà elle-même les comptes dont le jeton va bientôt être actualisé. Son champ `refresh_at` indique le moment où son actualisation met fin à un jeton, avant l’`expires_at` du fournisseur. Configurer `refresh_at` comme champ d’expiration et relever `expirySkewMs` (3 600 000 ms au plus) rend cette règle stricte : aucune exécution ne démarre alors avec un jeton valable moins longtemps que la marge, mais tant que tous les comptes sont aussi proches de leur actualisation, le pool refuse tout nouveau travail, et un pool d’un seul compte le fait avant chaque actualisation. Les dates d’expiration peuvent être des horodatages ISO ou Unix, en secondes ou en millisecondes.

La durée minimale restante protège le démarrage d’une exécution, pas toute sa durée. Une longue tâche ou automatisation peut dépasser la durée d’un jeton et nécessiter la reprise limitée décrite ci-dessus. Une nouvelle demande au courtier ne garantit pas que le compte fournira des identifiants valides.

Si aucun compte n’est utilisable, vérifie l’authentification auprès du courtier, le statut des comptes, les expirations et les actualisations prévues des jetons, les renouvellements de quota et les champs de réponse configurés. Renouvelle l’autorisation du compte, ou attends le renouvellement du quota ou l’actualisation du jeton selon le cas, puis vérifie qu’une tâche ou automatisation termine sa réponse avec le fournisseur et l’environnement prévus. Une requête réussie auprès du courtier ne teste pas à elle seule la connexion au fournisseur.

## Secrets de courtier depuis l’environnement

Des identifiants de type **Courtier d'abonnement** peuvent lire le secret du courtier dans l’environnement du déploiement. Utilise le préfixe distinct `TALE_TOKEN_SOURCE_` dans **Secret depuis une variable d'environnement** et laisse **Secret du courtier** vide. Les autres noms sont refusés. Si tu fournis les deux valeurs, le secret stocké du courtier est prioritaire. Recrée les processus concernés lorsque tu changes une valeur issue de l’environnement.

Si la nouvelle configuration du courtier utilise encore une authentification, laisser les deux champs de secret vides conserve le secret déjà stocké. Saisir une référence d’environnement sans nouveau secret du courtier active la source d’environnement. Choisir **Aucune** pour l’authentification du courtier retire le secret stocké de la configuration de remplacement.

## Gérer les réglages propres à l’organisation

Les noms des accès, modèles autorisés, valeurs par défaut et états actifs restent des données d’organisation, généralement gérées sous [Fournisseurs IA](/fr/platform/admin/providers). Une version de configuration gérée peut créer des accès précis liés à l’environnement via les API natives après vérification de l’organisation et de l’opérateur. Elle n’installe aucun serveur d’inférence et ne prouve pas le comportement du modèle. Effectue les contrôles de l’endpoint local décrits plus haut après le déploiement.
