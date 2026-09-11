---
title: Exécuter une inférence privée sur Mac
description: Prépare des artefacts de modèles figés, vérifie un Mac Apple Silicon dédié et relie les routes privées vérifiées à Tale.
---

Utilise la CLI Tale pour exploiter un Mac dédié aux modèles de ton organisation. Le dépôt client contient la déclaration des modèles ; l’automatisation du déploiement fournit la machine, le réseau privé, le commit source et les identifiants. La préparation ne télécharge aucun poids et ne prouve aucune performance matérielle : l’activation et la validation ont lieu sur le Mac cible.

## Vérifier les prérequis

Utilise macOS 15 ou ultérieur sur Apple Silicon, avec un compte interactif dédié sans droits admin et une session graphique active. Prépare séparément l’admission de la machine, le réseau privé, SSH et l’accès distant. La CLI vérifie le compte déclaré, le nom de machine, l’adresse locale et les ressources disponibles ; elle ne configure pas le système et n’assouplit pas la sécurité Apple.

L’environnement vérifié est l’application oMLX 0.6.4 signée et notarisée. Tale fixe son téléchargement, le hash complet de l’artefact et l’identité signée du code ARM64, puis utilise le Python et les noyaux natifs inclus. Un point d’entrée Tale lié à son hash limite les requêtes de calcul via le mécanisme public de middleware FastAPI ; les fichiers signés restent inchangés. Un autre environnement exige une mise à jour vérifiée de la CLI. `.github/actions/setup-cli` construit la CLI depuis un commit Tale exact sous Linux ou macOS ARM64 ; la préparation de l’inférence Mac est distincte de celle de la pile Linux gérée.

## Étape 1 — Fixer les modèles dans le dépôt client

Committe `tale/inference/spec.json`. La version du schéma est `1` et `runtime` vaut `omlx-0.6.4-macos15`. Déclare `name`, le slug exact de l’organisation, `models`, `nodes` et une référence d’environnement `serviceKey`. Chaque nœud indique sa clé, son compte dédié, son nom de machine, son IPv4 privée, les clés des modèles affectés et une référence `adminKey` distincte. L’adresse accepte `{ "env": "TALE_INFERENCE_NODE_ADDRESS" }` ; la préparation fige la valeur résolue.

Chaque modèle déclare son dépôt, sa révision complète immuable, son ID d’API, sa capacité (`text`, `vision` ou `embedding`), son architecture, sa limite de contexte et le chemin, la taille et le SHA-256 de chaque fichier de données requis. Indique explicitement la dimension des embeddings. Sépare les rôles : un modèle texte ne garantit pas la vision. Le Python du dépôt de modèle, le bytecode et les fichiers cachés du dépôt sont refusés.

Pour un artefact GLM DSA compatible qui sélectionne du code du dépôt, seule la projection `configurationProjection.kind: "signed-omlx-glm-dsa"` est disponible. Après vérification du hash de configuration d’origine, elle retire exactement `model_file: "glm_moe_dsa.py"`, conserve les autres paramètres et vérifie le hash dérivé déclaré. Les deux hashes participent à l’identité du modèle. L’architecture intégrée à l’application signée et un chargement réel sur la cible doivent passer ; `trust_remote_code` reste désactivé.

## Étape 2 — Préparer sans télécharger les poids

Définis `INFERENCE_REPOSITORY` avec l’URL GitHub canonique du client, `INFERENCE_SOURCE_COMMIT` avec son commit complet et `INFERENCE_BUNDLE` avec un nouveau répertoire de sortie absolu. Résous d’abord les variables d’adresses publiques de la déclaration.

```bash
tale --json inference prepare \
  --repository "$INFERENCE_REPOSITORY" \
  --source-ref "$INFERENCE_SOURCE_COMMIT" \
  --spec tale/inference/spec.json \
  --output "$INFERENCE_BUNDLE"
```

Le résultat JSON comprend `bundleSha256`, `source`, `modelCount`, `nodeCount` et `modelWeightsDownloaded: false`. Conserve le hash renvoyé dans `INFERENCE_BUNDLE_SHA`. L’option `--sources <file>` accepte la correspondance existante `repository@fullSHA` vers des copies locales ; sinon, l’acquisition utilise la même limite GitHub vérifiée que les déploiements gérés. `TALE_SOURCE_SSH_KEY` sert uniquement à la préparation. Un `--spec <file>` local sans dépôt/révision reste disponible pour le développement, sans preuve de source commitée.

```bash
tale --json inference validate \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
tale --json inference plan \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
```

La validation vérifie l’inventaire complet des métadonnées, leur lien avec la source et les octets de `runtime-admission.py`. Le plan indique les besoins de capacité et `ready: false` tant que le matériel n’a pas été observé. Ces commandes ne téléchargent aucun poids et n’activent aucun service. Transfère les deux fichiers du bundle et utilise la même CLI figée sur le Mac admis.

## Étape 3 — Vérifier la capacité réelle

Exécute `inference plan` avec `--observe` sur la cible. `--hardware <file>` accepte à la place une observation explicite de planification ; cela ne contourne pas les nouvelles vérifications lors de l’activation. L’admission couvre la RAM physique, l’espace disque libre, macOS/ARM64, l’ensemble de travail recommandé par MLX et toute limite positive effective de mémoire réservée. Les noyaux natifs sont vérifiés une fois l’application disponible et authentifiée.

La RAM physique ne suffit pas. Un grand modèle quantisé, son contexte, les caches et les poids de vision et d’embedding peuvent dépasser la limite Metal effective. La CLI réserve de la mémoire, borne la concurrence et les caches, puis revérifie la capacité après préparation des fichiers et lors du statut. Elle ne modifie ni `sysctl`, ni le swap, ni le profil énergétique, ni la sécurité système. Si une politique de machine séparée change une limite, exige la confirmation de sa valeur réelle avant activation.

Les modèles restent évictables et se chargent à la demande. Le plan compare le plus grand rôle actif, sa marge et ses caches à la limite effective ; le calcul du disque inclut toujours tous les modèles. Il n’exige pas leur résidence simultanée en mémoire. Changer de rôle peut décharger un modèle puis en recharger un autre, avec une longue attente pour les poids volumineux. Un modèle déchargé se distingue d’un service indisponible.

## Étape 4 — Activer et mesurer sur la cible

Injecte des clés admin et de service distinctes via les références d’environnement déclarées. Chacune exige 32–256 caractères compatibles avec les URL. Garde la clé admin sur le Mac ; seule la clé de service rejoint le routeur et le chemin fournisseur natif. Les paramètres privés et fichiers de reprise ont le mode `0600` dans le répertoire Application Support du compte dédié.

Ces commandes cibles téléchargent l’environnement et les poids figés, vérifient les octets et signatures, puis envoient des requêtes synthétiques. Définis `INFERENCE_NODE` avec la clé du nœud déclaré. Ce sont des instructions d’exploitation ; la CI sans modèle réel ne prouve ni sa vitesse ni sa précision.

```bash
tale --json --yes inference apply \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json --yes inference benchmark \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json inference status \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
```

L’état prêt exige des ID exacts, une API authentifiée, la politique d’admission exacte et les noyaux natifs. La validation couvre le texte diffusé, une réponse d’appel d’outil sans exécution, la vision et 64 vecteurs d’embedding ordonnés aux dimensions exactes dans le délai natif de 60 secondes, attente comprise. Elle ajoute une charge mixte bornée et observe la pression mémoire, le swap utilisé et les sorties cumulées avant, pendant et après les requêtes. Toute pression, augmentation du swap ou expiration du délai d’embedding bloque l’admission. Ce n’est ni une certification de charge soutenue ni un test de précision OCR des factures ; conserve des exemples métier et des mesures cibles plus longues.

Le texte, la vision et les embeddings partagent un seul créneau de calcul natif. Quatre requêtes peuvent attendre par défaut ; `limits.queuedRequests` fixe cette borne. Les requêtes validées entrent dans leur ordre d’arrivée. `queueTimeoutSeconds` et `requestTimeoutSeconds` valent chacun 1800. Une requête annulée dans la file ne démarre jamais. Le travail accepté garde son créneau après une déconnexion jusqu’à la fin de l’activité native et de la synchronisation Metal. Un nettoyage incertain ou un dépassement du délai après acceptation bloque le nœud jusqu’à examen et redémarrage. Le surplus reçoit `503` avant d’atteindre l’application du modèle.

Avec oMLX 0.6.4, une activité d’embedding soutenue peut retarder le texte. L’exécution sérielle contient cette interférence sans modifier l’ordonnanceur. Les lots HTTP de 64 entrées restent acceptés, avec une seule passe interne à la fois. Les preuves distinguent `loadedRoles` de l’état prêt et donnent `coldRequest`, `queueWaitMs` et `coldRequestTotalMs` ; ce dernier inclut attente, chargement et génération. Elles ne promettent ni résidence simultanée ni latence interactive. Les répertoires régénérables de modèles et caches reçoivent des exclusions Spotlight ciblées ; sauvegarde toujours paramètres, clés et preuves.

## Étape 5 — Relier les routes privées à Tale

Ajoute une section `inference` à la spécification de déploiement géré. Ce fragment sélectionne du contenu client commité ; les catalogues de modèles ne passent pas dans l’automatisation du déploiement.

```json
{
  "inference": {
    "repository": "https://github.com/example-team/client-app",
    "revision": { "env": "EXAMPLE_INFERENCE_REF" },
    "specPath": "tale/inference/spec.json",
    "overlayNetwork": { "env": "TALE_INFERENCE_NETWORK" },
    "readiness": []
  }
}
```

Chaque entrée `readiness` admise fournit un fichier de statut via `file: { "env": "TALE_NODE_READY_FILE" }` et son `sha256` exact. Ce sont des observations récentes fournies par l’opérateur, pas une attestation matérielle distante. Sans nœud admis, les calculs répondent `503` ; les métadonnées du catalogue restent accessibles en interne. Prépare un nouveau bundle géré quand la liste admise change.

La CLI génère et vérifie des services Caddy et ZeroTier figés. Caddy écoute sur le pont backend de Tale à `inference-overlay.local:8081`, sans port publié sur l’hôte ; son espace réseau atteint l’API privée déclarée du Mac sur le port `18080`. La politique réseau de l’hôte doit limiter ce chemin. Les calculs exigent la clé de service ; les métadonnées du catalogue sur le pont interne n’exigent pas d’identifiants. Chaque organisation a ses propres routes, sans repli ajouté vers un fournisseur hébergé.

Les répliques sont des serveurs indépendants du même modèle exact. Le routage préfère la première réplique admise et saine, et respecte une clé facultative d’affinité de cache ; il ne déduit pas qu’un modèle est déjà chargé. L’admission native gère la file et le créneau de calcul partagé. Le routage ne rejoue jamais un flux commencé. Le partage distribué d’un modèle est refusé jusqu’à preuve indépendante d’un chemin d’exécution pris en charge.

Pour autoriser le nouvel espace réseau du routeur, définis `DEPLOYMENT_BUNDLE`, `TALE_CLI_COMMIT` et `DEPLOYMENT_COMMIT` avec la sélection exacte du déploiement. Observe ensuite la cible Linux :

```bash
tale --json deploy inference-status --bundle "$DEPLOYMENT_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --deployment-ref "$DEPLOYMENT_COMMIT"
```

Le résultat lie le bundle et la source à `nodeId`, `networkId`, `networkType`, `status`, `online` et `assignedAddresses`. L’espace privé enregistré doit fonctionner. `ACCESS_DENIED` sans adresse signifie que l’autorisation du contrôleur manque encore. Fais autoriser ce nœud exact par la gestion de flotte, puis répète la commande. Compare `PRIVATE`, `OK`, l’état en ligne et l’adresse déclarée avec son préfixe exact. `networkReady` ne certifie aucun modèle. Cette commande ne rejoint aucun réseau et n’appelle pas le contrôleur.

La préparation native crée des fournisseurs explicites `omlx-<model key>`, vérifie leurs identifiants et catalogues, puis fixe séparément la vision et les embeddings. Des identifiants actifs inconnus, des politiques contradictoires ou une modification risquée d’embeddings existants bloquent pour examen. La preuve native confirme ces liens et distingue l’état du serveur de modèles. Utilise les déclarations de nouvelle identité, projet et propriétaire des [déploiements gérés](/fr/self-hosted/install/cli-install#deploiements-geres) quand les ID natifs n’existent pas encore.

## Répartir les rôles entre machines

Si les changements de modèle à froid ou la file partagée dépassent le délai natif, répartis les rôles entre Macs sans modifier les artefacts. Pour les clés `reasoning`, `vision` et `embedding`, ce fragment remplace `nodes` ; fournis chaque adresse et référence de clé séparément :

```json
{
  "nodes": [
    { "key": "reasoning-01", "user": "inference", "hostName": "reasoning-mac", "address": { "env": "TALE_REASONING_ADDRESS" }, "models": ["reasoning"], "adminKey": { "env": "TALE_REASONING_ADMIN_KEY" } },
    { "key": "vision-01", "user": "inference", "hostName": "vision-mac", "address": { "env": "TALE_VISION_ADDRESS" }, "models": ["vision"], "adminKey": { "env": "TALE_VISION_ADMIN_KEY" } },
    { "key": "embedding-01", "user": "inference", "hostName": "embedding-mac", "address": { "env": "TALE_EMBEDDING_ADDRESS" }, "models": ["embedding"], "adminKey": { "env": "TALE_EMBEDDING_ADMIN_KEY" } }
  ]
}
```

Committe le changement, prépare un nouveau bundle et exécute l’admission et les mesures sur chaque nœud. Fournis les trois preuves de statut récentes pour préparer les routes gérées. Pour ajouter une réplique d’un rôle, affecte sa même clé de modèle à un autre nœud admis. Les machines séparées évitent la concurrence entre rôles ; les mesures cibles décident toujours de la capacité et de la latence.

## Reprendre sans remplacer un état inconnu

Conserve tout le répertoire d’état, l’intention en attente et les preuves de disponibilité. Une répétition identique vérifie les octets et l’identité du service ; une dérive bloque au lieu d’écraser des fichiers. Avant remplacement ou retour arrière, Tale exige l’absence de travail actif. Après une réponse perdue, il rapproche l’activation enregistrée ; un état inconnu ou contradictoire demande un examen de l’opérateur.

`inference rollback` prend les mêmes options de bundle, hash et nœud, ainsi que `--release <retained-sha256>` et `--yes`. Il vérifie la version conservée avant activation, sans supprimer les preuves ultérieures ni régler la mémoire de l’hôte. Les verrous locaux coordonnent une machine ; ils ne fournissent ni compare-and-swap entre hôtes ni protection contre des modifications administratives indépendantes.

## Poursuivre la validation sur la cible

Conserve les hashes de source, bundle et statut avec l’admission de la machine et les mesures de charge. La CLI fournit des entrées reproductibles et des critères de disponibilité explicites ; termine les tests métier et de charge soutenue sur la cible avant d’y envoyer les tâches de production. Les [versions de configuration](/fr/self-hosted/configuration/config-releases) fixent les automatisations avec ces routes de modèles.
