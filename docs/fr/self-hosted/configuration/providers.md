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
3. Déclare le fournisseur dans `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml` ou avec la [procédure de configuration gérée](/fr/self-hosted/configuration/config-releases). Respecte le schéma natif et choisis un nom distinct des définitions fournies.

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

Pour un endpoint personnalisé compatible OpenAI, utilise `catalog.source: models-endpoint`. Sa réponse à `/models` doit déclarer le modèle audio avec `type: transcription`, une `id` exacte et un `context_window` positif. Indique la valeur de contexte réelle du modèle ; le catalogue l’exige aussi pour la transcription. Un modèle de chat avec entrée audio ou un modèle de synthèse vocale ne devient pas automatiquement un candidat à la transcription.

L’endpoint doit accepter `POST <baseUrl>/audio/transcriptions` avec les champs multipart `file`, `model` et `response_format: verbose_json`, authentifiés par un accès Bearer. Sa réponse JSON doit fournir la transcription dans `text` ; `duration` et des `segments` horodatés permettent le suivi de la durée et les horodatages vidéo. La présence au catalogue ne prouve pas que cette API fonctionne. Actualise le catalogue, sélectionne le modèle, puis teste un court enregistrement et vérifie la requête dans les journaux de cet endpoint.

## Vérifier l’accès aux modèles depuis la sandbox

Le chat appelle un fournisseur depuis le backend. Les agents de programmation passent par `sandbox-llm-gateway` : un chat réussi ne valide donc pas leur connexion. L’endpoint doit être résolvable et joignable depuis le backend et la passerelle. Chaque client HTTPS doit faire confiance à son certificat. Un nom comme `https://models.internal/v1` exige lui aussi l’autorisation des fournisseurs privés lorsque le DNS renvoie une adresse privée. HTTP reste limité aux formes d’hôtes acceptées par le schéma, comme une IP privée, `localhost` ou `.local`.

Au démarrage d’une nouvelle session sandbox, le backend contrôle le nom du fournisseur personnalisé et ses réponses DNS avant de le configurer dans la passerelle. Les destinations privées exigent `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` ; les métadonnées restent bloquées même avec cette option. Ce contrôle préalable ne fixe pas les réponses DNS des requêtes ultérieures de la passerelle. Garde la définition du fournisseur et le DNS sous le contrôle d’opérateurs de confiance.

Recrée les processus backend concernés avec le nouvel environnement, puis démarre une nouvelle session sandbox avec le fournisseur, le modèle et un environnement d’exécution compatible. Envoie une demande sans contenu sensible et vérifie la réponse complète ainsi que l’entrée correspondante dans les journaux du serveur d’inférence. Si le chat fonctionne mais que l’agent n’atteint pas son modèle, examine les journaux de `sandbox-llm-gateway`. `SANDBOX_EGRESS_ALLOWLIST` contrôle l’accès web général de la sandbox, pas cette connexion distincte au modèle.

Les agents de programmation s’appuient aussi sur la fenêtre de contexte que le catalogue indique pour le modèle : la valeur `context_length` ou `context_window` que ton serveur publie sur `/v1/models`, ou 128 000 tokens pour un fournisseur configuré avec `catalog.source: none`. Fais en sorte que cette liste indique le contexte que ton serveur sert réellement. Lorsque cette fenêtre, ou une [limite de contexte](/fr/platform/admin/governance/policies-and-limits) plus basse pour la personne qui a lancé l’exécution, reste sous 200 000 tokens, une session Claude Code gérée condense sa conversation en un résumé avant que le prompt ne la dépasse. Claude Code traite toute valeur inférieure à 100 000 tokens comme 100 000 : un modèle qui offre moins de contexte peut donc recevoir des prompts plus longs qu’il ne peut en contenir. Réserve Claude Code aux modèles qui offrent au moins ce contexte.

## Où vivent les connecteurs

Les définitions fournies se trouvent dans `configs/platform/system/providers/<slug>/provider.yml` et leurs catalogues statiques dans `configs/platform/system/models/<slug>/models.yml`. Anthropic utilise par exemple `providers/anthropic/provider.yml` et `models/anthropic/models.yml`. Ces fichiers appartiennent à l’image et évoluent avec sa version.

<Warning>

Les fichiers fournis sont des entrées d’image en lecture seule, remplacées lors des mises à niveau. Pour un fournisseur externe, utilise la déclaration vérifiée `configuration` décrite dans [Installation CLI](/fr/self-hosted/install/cli-install#configurer-la-plateforme). Elle crée un connecteur propre à l’organisation sous `TALE_CONFIG_DIR/<org>/providers/` avec le schéma natif ; les modifications d’identifiants et de politiques passent par les API natives.

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

## Secrets de courtier depuis l’environnement

Un accès de type **Courtier d’abonnement** peut aussi lire le secret du courtier dans l’environnement du déploiement. Utilise le préfixe distinct `TALE_TOKEN_SOURCE_` dans **Secret depuis une variable d’environnement**. Les autres noms sont refusés. Si le champ reste vide, le secret est chiffré avec l’accès. Recrée les processus concernés lorsque tu changes une valeur issue de l’environnement.

## Gérer les réglages propres à l’organisation

Les noms des accès, modèles autorisés, valeurs par défaut et états actifs restent des données d’organisation, généralement gérées sous [Fournisseurs IA](/fr/platform/admin/providers). Une version de configuration gérée peut créer des accès précis liés à l’environnement via les API natives après vérification de l’organisation et de l’opérateur. Elle n’installe aucun serveur d’inférence et ne prouve pas le comportement du modèle. Effectue les contrôles de l’endpoint local décrits plus haut après le déploiement.
