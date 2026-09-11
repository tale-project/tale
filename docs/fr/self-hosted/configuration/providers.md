---
title: Fournisseurs
description: Le versant opérateur des fournisseurs IA — les fichiers de connecteurs livrés avec la plateforme, et les variables d’environnement réservées qui laissent le déploiement porter les clés API à la place de la base de données.
---

Un fournisseur IA dans Tale associe un connecteur et des identifiants propres à une organisation. Le connecteur décrit l’endpoint, le catalogue et les méthodes d’authentification ; les identifiants portent les règles d’accès et une clé ou une référence d’environnement. Cette page décrit les connecteurs fournis et le déploiement générique d’un fournisseur exploité ailleurs.

## Où vivent les connecteurs

Les définitions de connecteurs sont des fichiers YAML sous `configs/platform/system/providers/`, un par fournisseur, nommés d’après son slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml`, et ainsi de suite. Ils font partie de l’image de la plateforme et évoluent avec elle. Les catalogues de modèles intégrés correspondants se trouvent à côté, sous `configs/platform/system/models/<slug>.yml`.

<Warning>

Les fichiers fournis sont des entrées d’image en lecture seule, remplacées lors des mises à niveau. Pour un fournisseur externe, utilise la déclaration vérifiée `modelSettings` décrite dans [Installation CLI](/fr/self-hosted/install/cli-install#configurer-des-fournisseurs-externes). Elle crée un connecteur propre à l’organisation sous `TALE_CONFIG_DIR/<org>/providers/` avec le schéma natif ; les modifications d’identifiants et de politiques passent par les API natives.

</Warning>

## Ce qu’un connecteur déclare

Un connecteur est court par construction. Il nomme le fournisseur, le dialecte réseau que son API parle, l’endpoint sur lequel il répond, la provenance de sa liste de modèles et les méthodes d’authentification qu’il accepte — rien de spécifique à une organisation et aucun secret.

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

`apiFormat` est le dialecte réseau — `openai` ou `anthropic`. Un connecteur au format `openai` peut aussi déclarer `wireDialect: openai-modern`, comme le font les connecteurs OpenAI et Azure livrés : la plateforme écrit alors le plafond de sortie `max_completion_tokens` et n’envoie pas de température personnalisée aux modèles de raisonnement, parce que api.openai.com rejette `max_tokens` et toute température non standard sur ces modèles, tandis que les endpoints compatibles OpenAI tiers gardent les champs classiques. `baseUrl` est l’endpoint fixe ; un connecteur qui l’omet déclare `endpointMode: per-credential` à la place, ce que fait Azure OpenAI, puisque chaque ressource Azure sert son propre endpoint et que chaque identifiant porte donc sa propre URL. `catalog.source` vaut `static` (un fichier livré sous `configs/platform/system/models/`), `openrouter-api`, `models-endpoint` ou `none`. Chaque entrée sous `auth` est une méthode que les identifiants de ce fournisseur peuvent employer, et une méthode peut porter des `constraints` qui l’épinglent à une exécution en sandbox sur un harness nommé.

## Source de clé par variable d’environnement

Si tes clés API vivent déjà dans des secrets Kubernetes, Vault ou un gestionnaire de secrets cloud, un identifiant n’a pas à porter le secret. La méthode d’authentification **Variable d’environnement** ne stocke que le _nom_ d’une variable du déploiement, et la plateforme en lit la valeur dans l’environnement du processus au moment de l’appel. C’est le chemin géré par les ops : la clé n’entre jamais dans la base de l’application, et la renouveler relève du déploiement plutôt que d’une tâche d’administration.

Le nom de la variable est protégé par un préfixe. Il doit commencer par `TALE_PROVIDER_KEY_`, et l’application fixe ce préfixe dans le formulaire, si bien que seul le suffixe se saisit :

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

La barrière est fail-closed : tout nom hors du préfixe réservé est rejeté, ce qui empêche un identifiant de désigner un secret de déploiement étranger comme `SOPS_AGE_KEY` ou `BETTER_AUTH_SECRET` et de le voir partir en jeton Bearer vers l’endpoint d’un fournisseur. Les noms sont plafonnés à 40 caractères — un nom plus long n’atteindrait jamais le runtime du backend.

</Note>

Définis la variable de façon que le backend puisse la lire — il résout l’identifiant du fournisseur au moment de la requête. Une variable ajoutée ou changée après le boot demande un redémarrage de `backend-api` et `backend-worker` avant d’être visible. Les valeurs sont nettoyées de leurs espaces, ce qui t’épargne le retour à la ligne que porte souvent un fichier de secret monté, et le `401` qui s’ensuit.

## Secrets de courtier depuis l’environnement

Des identifiants de type **Courtier d’abonnement** s’authentifient auprès du courtier avant de pouvoir récupérer un pool de jetons, et ce secret de courtier peut lui aussi venir du déploiement. Ses variables portent leur propre préfixe réservé, `TALE_TOKEN_SOURCE_`, distinct de celui des clés de fournisseur pour que les deux espaces de noms ne se confondent pas. La même règle fail-closed s’applique : un nom hors du préfixe est rejeté. Dans le formulaire, le champ s’appelle **Secret depuis une variable d’environnement** ; le laisser vide signifie que le secret du courtier est stocké chiffré avec les identifiants.

## Ce qui relève de l’organisation et non du déploiement

Identifiants, noms, modèles autorisés, valeurs par défaut et état actif restent des données d’organisation. L’application les gère normalement. Après avoir vérifié l’organisation et l’opérateur, un déploiement géré peut créer des identifiants exacts liés à l’environnement via l’API native ; il n’écrit pas directement dans les lignes de la base de données.

<Tip>

Sépare les caractéristiques du connecteur, les accès et l’exploitation du serveur. Le déploiement géré vérifie le catalogue déclaré et les politiques natives ; il n’installe aucun serveur d’inférence et ne prouve pas le comportement réel du modèle.

</Tip>

## Où cela s’inscrit

Utilise le déploiement géré pour les paramètres vérifiés de fournisseurs externes et la [Référence des variables d’environnement](/fr/self-hosted/configuration/environment-reference) pour injecter les clés. [Fournisseurs IA](/fr/platform/admin/providers) décrit les identifiants, valeurs par défaut et catalogues dans l’application ; le [Catalogue de modèles](/fr/platform/models) explique ce que voient les membres.
