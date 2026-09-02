---
title: Fournisseurs
description: Le versant opérateur des fournisseurs IA — les fichiers de connecteurs livrés avec la plateforme, et les variables d’environnement réservées qui laissent le déploiement porter les clés API à la place de la base de données.
---

Un fournisseur IA dans Tale, ce sont deux moitiés qui vivent à deux endroits différents. Le **connecteur** — le format réseau, l’endpoint, la source du catalogue de modèles, les méthodes d’authentification acceptées — est livré avec la plateforme sous forme de fichier que tu lis sans le modifier. Les **identifiants** sont des données d’organisation, créées et renouvelées dans l’application sous **Paramètres > Fournisseurs IA**. Cette page couvre la moitié opérateur : ce que contiennent les fichiers livrés, et le seul levier qui appartienne vraiment au déploiement, à savoir porter les clés API des fournisseurs dans des variables d’environnement.

## Où vivent les connecteurs

Les définitions de connecteurs sont des fichiers YAML sous `configs/platform/system/providers/`, un par fournisseur, nommés d’après son slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml`, et ainsi de suite. Ils font partie de l’image de la plateforme et évoluent avec elle. Les catalogues de modèles intégrés correspondants se trouvent à côté, sous `configs/platform/system/models/<slug>.yml`.

<Warning>

Ces fichiers sont des entrées en lecture seule, pas de la configuration de déploiement. Modifier l’un d’eux dans un conteneur en cours d’exécution est écrasé à la mise à niveau suivante, et il n’existe aucune surcharge au niveau d’une organisation. Quand un fournisseur dont tu as besoin ne figure pas dans le jeu livré, c’est un changement de plateforme et non un changement de configuration.

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

La barrière est fail-closed : tout nom hors du préfixe réservé est rejeté, ce qui empêche un identifiant de désigner un secret de déploiement étranger comme `SOPS_AGE_KEY` ou `BETTER_AUTH_SECRET` et de le voir partir en jeton Bearer vers l’endpoint d’un fournisseur. Les noms sont plafonnés à 40 caractères.

</Note>

Définis la variable là où les conteneurs backend la lisent — dans `.env`, ou via ce que ton coffre à secrets injecte dans `backend-api` et `backend-worker`. Les deux rôles résolvent des identifiants, donc les deux ont besoin de la valeur : le worker fait pour le travail de fond les mêmes appels fournisseur que l’api fait pour un tour en direct. Une variable ajoutée ou changée après le boot demande `docker compose restart backend-api backend-worker` avant d’être visible. Les valeurs sont nettoyées de leurs espaces, ce qui t’épargne le retour à la ligne que porte souvent un fichier de secret monté, et le `401` qui s’ensuit.

## Secrets de courtier depuis l’environnement

Des identifiants de type **Courtier d’abonnement** s’authentifient auprès du courtier avant de pouvoir récupérer un pool de jetons, et ce secret de courtier peut lui aussi venir du déploiement. Ses variables portent leur propre préfixe réservé, `TALE_TOKEN_SOURCE_`, distinct de celui des clés de fournisseur pour que les deux espaces de noms ne se confondent pas. La même règle fail-closed s’applique : un nom hors du préfixe est rejeté. Dans le formulaire, le champ s’appelle **Secret depuis une variable d’environnement** ; le laisser vide signifie que le secret du courtier est stocké chiffré avec les identifiants.

## Ce qui relève de l’organisation et non du déploiement

Les identifiants, leurs noms, leurs listes de modèles autorisés, celui qui fait office de défaut et ceux qui sont actifs sont tous des données d’organisation. Ils naissent dans l’application, ils appartiennent à une seule organisation, et aucun fichier sur disque ne sert à en ajouter — y compris sur une instance auto-hébergée.

<Tip>

Cette séparation est le moyen le plus rapide de situer une tâche. Tout ce qui touche à _quel fournisseur existe et à ce qu’il sait faire_ est un connecteur livré ; tout ce qui touche à _qui peut l’appeler et avec quelle clé_ est un identifiant dans l’application. Le seul recouvrement est le chemin par variable d’environnement, où le déploiement porte le secret et l’identifiant n’en porte que le nom.

</Tip>

## Où cela s’inscrit

Toute la surface d’un opérateur tient ici à provisionner des variables d’environnement et à savoir quels connecteurs la plateforme livre ; le reste se passe dans l’application. Le parcours d’interface — ajouter des identifiants, désigner un défaut, restreindre une liste, actualiser les catalogues — c’est [Fournisseurs IA](/fr/platform/admin/providers), ce que tes utilisateurs finissent par voir c’est le [Catalogue de modèles](/fr/platform/models), et les variables elles-mêmes figurent aux côtés du reste de la configuration dans la [Référence des variables d’environnement](/fr/self-hosted/configuration/environment-reference).
