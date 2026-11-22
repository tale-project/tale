---
title: Mettre à niveau et rétablir un déploiement
description: Prévisualise une mise à niveau, déploie avec un plan de reprise, vérifie le résultat et choisis le retour arrière adapté.
---

Pour un déploiement dans un workspace, `tale update` modifie la CLI et les fichiers locaux ; `tale deploy` modifie les services actifs. Choisis la version cible et le point de reprise avant ces étapes. Le déploiement bleu-vert fait coexister les réplicas applicatifs, mais snapshots, drainage et remplacement des services persistants peuvent interrompre le travail.

Les déploiements gérés utilisent des révisions de sources fixées et des bundles préparés. Suis [Déploiements gérés](/fr/self-hosted/install/cli-install#managed-deployments) pour ce parcours, ou [Releases de configuration](/fr/self-hosted/configuration/config-releases) si seul le contenu client change.

## Préparer la mise à niveau

1. Lance `tale status` dans le bon workspace. Note la version active, celle du workspace et l’état du déploiement.
2. Lis les notes de la version cible : compatibilité, configuration requise et limites connues. Une instance antérieure à 0.5 exige le changement d’installation décrit plus bas, et un workspace en v0.5.77 ou antérieure franchit une fois le changement de protocole d’écriture des automatisations, décrit lui aussi plus bas.
3. Confirme une sauvegarde externe restaurable, les clés correspondantes et la couverture des bases et buckets externes. [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) décrit les éléments nécessaires.
4. Prévois la capacité pour les anciens et nouveaux réplicas ensemble. Réserve une maintenance si les snapshots ou remplacements de sandbox et de services persistants peuvent interrompre un travail nécessaire.
5. Prévisualise la mise à jour et le déploiement. Examine les avertissements : un aperçu réussi ne prouve pas qu’une migration réelle aboutira.

## Sélectionner la version

Les commandes du workspace essaient d’aligner la CLI sur la version de `tale.json`. Si le téléchargement échoue, la CLI avertit puis continue avec le programme actuel. Résous tout décalage inattendu avant de modifier le déploiement.

Sans argument de version, `tale update` choisit la dernière release de la ligne `major.minor` du workspace. Pour changer de ligne, indique la version :

```bash
tale update --dry-run
tale update --version <target-version> --dry-run
tale update --version <target-version>
```

La mise à jour remplace la CLI et synchronise les modèles du workspace, sans toucher aux conteneurs actifs. Si la synchronisation échoue, elle tente de remettre le programme à la version précédente du workspace. Vérifie les fichiers et la sortie avant de déployer.

## Prévisualiser et déployer

```bash
tale deploy --dry-run
tale deploy
tale status
```

Un changement de version ou un remplacement de configuration de l’hôte prend un snapshot local avant modification, sauf avec `--skip-backup`. Cette protection supplémentaire ne remplace pas une sauvegarde hors de l’hôte.

| Groupe de services | Déploiement ordinaire | Quand prévoir une interruption supplémentaire ? |
| --- | --- | --- |
| `platform`, avec `backend-api` et `backend-worker` là où ils tournent à part | Déploiement commun dans la nouvelle couleur applicative. | Anciens et nouveaux réplicas coexistent ; le drainage peut refuser de nouveaux tours. |
| `sandbox`, `sandbox-egress` | Remplacement sur place après drainage du travail concerné. | Ce sont des dépendances d’exécution communes, pas un second groupe applicatif bleu-vert. |
| `db`, `object-store`, `proxy` | Conservation des services actifs ; la CLI signale les mises à jour ignorées. | Ajoute `--stop` lorsque ces services doivent être remplacés. |

```bash
tale deploy --stop
```

Sur un déploiement installé avant cette version, cette commande déplace aussi les fichiers de MinIO vers versitygw, comme l’explique [Les fichiers passent de MinIO à versitygw](#blob-store).

`TALE_PLATFORM_REPLICAS` fixe le nombre de réplicas `platform` d’une couleur, de 1 à 16 ; chacun est l’application entière. Définir `TALE_BACKEND_WORKER_REPLICAS` ou `TALE_BACKEND_API_REPLICAS` [fait tourner les workers à part](#one-process), pour les dimensionner séparément. Augmente ce dont les mesures montrent la saturation ; ajouter des workers ne corrige ni une base indisponible ni un quota fournisseur épuisé.

## Comprendre la bascule

La CLI démarre la couleur inactive et attend que ses réplicas passent les contrôles de santé avant de terminer la bascule. Les deux versions peuvent servir pendant le chevauchement. Les releases doivent donc rester compatibles avec l’application précédente pendant les migrations.

L’ancienne API est drainée avant son retrait : de nouveaux tours de chat peuvent être refusés, tandis que les tours en cours disposent d’un délai pour finir. Le drainage des chats attend jusqu’à trois minutes ; celui du service web utilise `DRAIN_TIMEOUT`, par défaut 30 secondes. La route de santé web reste saine tant que son alias est partagé. Déconnecter les anciens conteneurs des réseaux de service les retire du DNS et peut couper les connexions restantes ; cette étape vient donc après les drainages.

Le drainage couvre aussi les automatisations. Les workers de l’ancienne couleur ne démarrent plus de nouveau job et transmettent chaque exécution d’automatisation à sa prochaine étape, si bien qu’elle continue sur la nouvelle couleur ; la CLI attend aussi ces étapes, dans les mêmes trois minutes. Quand les anciens conteneurs s’arrêtent, chaque worker dispose de 120 secondes pour transmettre ce qu’il détient encore (davantage si tu augmentes `SHUTDOWN_DRAIN_MS` : la CLI garde ce délai 15 secondes au-dessus), et une étape qui travaille encore 20 secondes après le début de l’arrêt est interrompue et s’exécute à nouveau sur la nouvelle couleur. Une étape qui envoyait quelque chose à un service externe fait exception, car le service l’a peut-être déjà reçu : l’exécution attend alors qu’une personne choisisse comment continuer, comme l’explique [Examiner les exécutions et corriger les échecs](/fr/platform/automations/execution-logs). La première mise à jour vers le protocole d’écriture des automatisations 2 est différente : la migration met en attente toutes les anciennes exécutions en file, en cours ou déjà en attente, en conservant leur état précédent et leurs effets externes non déterminés. Elles ne reprennent pas automatiquement. Un travail déjà admis ou envoyé par un ancien worker peut encore se terminer. Une demande d’arrêt explicite enregistre son auteur et demande l’annulation de la session concernée, sans prouver son arrêt ni le résultat d’une écriture externe. Elle ne libère ni la tâche retenue ni ses preuves. Vérifie le résultat réel avant de prévoir un travail de remplacement.

Les deux couleurs montent le volume `static-assets` du déploiement. Avant qu’une réplique web soit prête, elle y publie les scripts, feuilles de style, polices et images immuables de sa compilation. Chaque couleur peut ainsi servir les fichiers référencés par le HTML de l’autre. Les répliques actives actualisent leurs fichiers chaque heure ; les fichiers retirés restent disponibles pendant sept jours après leur dernière actualisation. Monte aussi ce volume partagé sur chaque réplique web dans ta propre configuration Compose. Lors de la première mise à niveau depuis une version qui ne prend pas en charge ce mécanisme, les anciennes répliques n’ont pas encore accès à ce recours partagé.

Un onglet ouvert continue normalement à fonctionner pendant la bascule. Si une partie nécessaire n’est plus disponible, Tale attend que son API et sa base de données répondent, puis recharge la page une fois. Si cette partie ne se charge toujours pas, Tale affiche **Une nouvelle version est disponible** avec l’action **Recharger**, sans répéter le rechargement automatique. Pendant une panne, l’avis de connexion reste visible. Les lectures ayant échoué sont actualisées quand la connexion revient ; les écritures ayant échoué ne sont pas renvoyées automatiquement.

Si le nouveau groupe ne devient pas sain avant `HEALTH_CHECK_TIMEOUT`, la CLI ne termine pas la bascule. Examine l’état enregistré et les journaux avant de réessayer. Un déploiement interrompu peut laisser les deux groupes ou un transfert en attente. Suis les indications de reprise de la CLI plutôt que de supprimer manuellement conteneurs ou fichiers d’état.

## Mettre à niveau un workspace sur Incus {#incus}

Un workspace sur le [runtime Incus](/fr/self-hosted/install/incus) expérimental se met à niveau avec les mêmes `tale update` et `tale deploy`. Ce qui change, c’est la façon dont la CLI modifie la stack et fait passer le trafic d’une couleur à l’autre. Un déploiement géré sur Incus n’a pas de couleurs, remplace chaque service sur place, et sa mise à niveau est refusée pour l’instant ; voir [les limites actuelles](/fr/self-hosted/install/incus#limits).

### Revoir d’abord le plan {#incus-plan}

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
```

`--plan-only` affiche un plan par périmètre, pour les volumes, l’infrastructure, les services persistants et la couleur qu’il démarre, et ne change rien. `--plan` n’applique le plan revu que tant que le nœud a encore besoin exactement de lui, et vérifie chaque périmètre avant de changer quoi que ce soit. Avant tout changement, `tale deploy` vérifie le nœud par rapport au contrat de la stack ; après avoir augmenté un nombre de réplicas, relance `tale incus bootstrap` pour que les limites du projet suffisent. Le snapshot qui précède un changement de version est un ensemble natif, pris sous un gel de bien moins d’une seconde, comme le décrit [Snapshots sur Incus](/fr/self-hosted/operate/backups-and-restore#incus).

### Remplacer les services soumis à l’arrêt {#incus-stop-gated}

Sur Incus, le niveau soumis à l’arrêt est plus large : outre `db`, `object-store` et `proxy`, les résolveurs (`names`, `names-sessions`) et le switch de trafic gardent l’image qu’ils exécutent jusqu’à un déploiement avec `--stop`, et la CLI signale ce qu’elle a laissé. Remplacer le switch ou le proxy interrompt tout le trafic jusqu’à ce que la nouvelle instance soit en bonne santé : prévois donc une courte fenêtre pour `tale deploy --stop`.

### Suivre la bascule de couleur {#incus-flip}

Le switch de trafic est une instance de l’image du proxy placée devant les réplicas de `platform` et de `backend-api`, ainsi que devant le relais de modèles que les réplicas de `backend-api` servent sur le port 8080. Il connaît dès le départ chaque adresse de réplica des deux couleurs et n’est jamais rechargé pendant une bascule, un remplacement progressif ou un retour arrière. Chaque réplica de la nouvelle couleur reçoit du trafic dès qu’il passe la sonde d’admission du switch, à laquelle un réplica ne répond qu’une fois prêt, et la CLI attend que chaque réplica soit en bonne santé.

La CLI retire ensuite l’ancienne couleur : elle marque chaque ancien réplica pour que sa sonde d’admission échoue, et en quelques secondes le switch ne lui envoie plus de nouvelle requête. Le `/api/health` du réplica garde son sens et n’échoue qu’après son signal d’arrêt, si bien que le contrôle de santé propre à l’edge n’est pas perturbé. Les flux ouverts, comme les mises à jour en direct d’une page, restent ouverts sur l’ancienne couleur. Les drainages se déroulent ensuite comme décrit plus haut, chaque ancien réplica s’arrête dans son délai de grâce puis est supprimé, et ses flux se terminent là : les clients se reconnectent à la nouvelle couleur. Sur Docker, l’ordre diffère, car les anciens conteneurs ne quittent les réseaux de service qu’après les drainages.

Si un déploiement s’arrête au milieu de la bascule, le `tale deploy` suivant reprend à la phase enregistrée, et `tale status` signale la bascule inachevée d’ici là ; ne supprime pas d’instances à la main. `--services` remplace plutôt les réplicas de la couleur active un par un : chacun est retiré, drainé, remplacé et en bonne santé avant que le suivant ne passe. `tale rollback` suit les mêmes étapes vers la version précédente.

### Arrêter et démarrer l’environnement {#incus-stop-start}

```bash
tale stop
tale start
```

`tale stop` arrête l’environnement en trois groupes : l’edge, le switch et les deux couleurs ; puis les services sandbox ; puis les bases de données, le stockage d’objets et les résolveurs. Chaque service dispose de son propre délai de grâce. `tale start` démarre les groupes dans l’ordre inverse, chacun en bonne santé avant le suivant, démarre aussi un service qu’Incus a arrêté après des plantages répétés, et refuse tant qu’une restauration est en attente. `--dry-run` affiche l’ordre et ne change rien. Sur un hôte qui fait tourner d’autres projets à côté de Tale, lance `tale stop` avant l’arrêt de l’hôte : Incus arrête sinon les groupes de tous les projets l’un après l’autre, jusqu’à 30 secondes chacun, et les bases de données peuvent être coupées avant leur signal d’arrêt, comme l’explique [Prévoir l’arrêt de l’hôte](/fr/self-hosted/install/incus#host-shutdown).

## Vérifier les migrations et le résultat utilisateur

Au démarrage, le backend applique ses migrations numérotées dans l’ordre des noms de fichier, sous un verrou consultatif de session. Les migrations SQL modifient le schéma ; les migrations de données en TypeScript mettent à jour les lignes existantes selon les règles de l’application. La table `app_migrations` enregistre les deux types par nom de fichier, si bien que chaque migration ne s’exécute qu’une fois par base. Les autres réplicas attendent cette étape. Une erreur de migration empêche le nouveau backend de démarrer normalement ; examine l’erreur et la base avant de réessayer. Changer un tag d’image n’annule pas des migrations conçues pour avancer uniquement.

`tale migrate` ajoute les fichiers de configuration fournis qui manquent à une organisation, et le projet de démarrage à une organisation qui n’a aucun projet. Cette commande n’ajoute aucune automatisation et ne sert pas à annuler une migration de la base. Avant de remplacer la configuration de l’hôte, vérifie que les adaptations locales doivent réellement être écrasées.

Après le déploiement, vérifie certificat public et connexion, ouvre un projet ou une conversation existante et télécharge un fichier connu. Teste de façon contrôlée les parcours de connaissances et d’automatisation utilisés. Vérifie l’avancement des workers, les stockages et la version effectivement active. Conserve les éléments de reprise antérieurs jusqu’à l’acceptation du déploiement.

## Choisir un retour arrière

| Situation | Reprise |
| --- | --- |
| Revenir à la version précédente enregistrée dans la même ligne `major.minor` | `tale rollback` vérifie cette limite et demande confirmation avant de redéployer. Lis aussi les notes de compatibilité de la release. |
| Revenir au-delà d’une limite mineure ou majeure | Restaure les données coordonnées d’avant la mise à niveau et déploie leur version correspondante. `tale rollback` refuse ce retour limité aux images. Un workspace qui exécute l’application en un seul processus [ramène d’abord ses trois services](#one-process). |
| Version cible ou compatibilité des données inconnue | Résous la version et la provenance des sauvegardes avant de démarrer un programme plus ancien. |

```bash
tale rollback
```

`--yes` supprime la confirmation pour une opération sans surveillance déjà approuvée. La vérification de ligne de version est un garde-fou, pas une preuve indépendante de compatibilité de chaque intégration externe ou configuration personnalisée. Une liste d’anciennes migrations qui forme le préfixe de la nouvelle ne suffit pas à rendre un retour arrière sûr.

`tale rollback` remplace uniquement les images de l’application : celles de `platform` et, là où ils tournent à part, celles de `backend-api` et `backend-worker`. Il ne restaure aucun volume, laisse la base de données, les stockages, le proxy et les services de sandbox tels quels, et ne redémarre jamais la passerelle de modèles, comme l’explique [Le relais de modèles remplace la passerelle de modèles](#model-relay). Aucune étape de déploiement ne restaure non plus de données d’elle-même : un déploiement ordinaire (sans `--services`) qui échoue à ses contrôles de santé laisse la couleur applicative précédente en service, mais les services qu’il a déjà remplacés sur place le restent. Seul `tale restore` remet en place les volumes d’un snapshot.

## Le relais de modèles remplace la passerelle de modèles {#model-relay}

Jusqu’à cette version, un service à part, `sandbox-llm-gateway`, se tenait entre un agent de programmation dans une sandbox et le fournisseur de modèles, et servait les [endpoints de modèles pour les clés API](/fr/platform/admin/governance/content-models#model-endpoints). C’est désormais le backend qui fait ce travail, dans son [relais de modèles](/fr/self-hosted/configuration/environment-reference#model-relay). Chaque appel de modèle d’un tour d’agent et chaque appel des endpoints de modèles passent par le relais, qui appelle chaque fournisseur avec les identifiants de l’organisation, à l’endpoint que nomme la définition du fournisseur. Le relais tourne dans le processus qui sert l’API ; un déploiement exécute donc un conteneur de moins, et la limite de mémoire de la passerelle, de 512 Mio à plusieurs Gio, disparaît.

Quand **Traiter les prompts uniquement dans l'UE/EEE** est activé, le modèle d’un agent de programmation ou d’un endpoint de modèles est désormais jugé à l’endpoint qu’appelle le relais, comme dans le chat. Un fournisseur du catalogue comme OpenRouter dirigé vers `eu.openrouter.ai` passe désormais, là où la passerelle le refusait ; [Traiter les prompts uniquement dans l’UE/EEE](/fr/platform/admin/governance/content-models#eu-processing) indique ce qui compte.

Un nouveau déploiement n’exécute aucune passerelle, et `tale init` comme `tale deploy` ne génèrent plus `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD`. Un déploiement qui exécute une passerelle la garde tant que des clés qu’elle a émises restent ouvertes : celles des tours d’agent commencés avant la mise à niveau et pas encore réglés. Le backend lit les dépenses de ces tours auprès de la passerelle et révoque leurs clés avec le mot de passe administrateur : laisse donc ce mot de passe tel quel dans le `.env` tant que la passerelle est gardée. Sous Docker, chaque `tale deploy` demande au backend en cours d’exécution combien de ces clés sont ouvertes. `<id>` est l’`id` de `tale.json` :

- **Aucune** : le déploiement supprime le conteneur `<id>-sandbox-llm-gateway`, jamais son volume, et affiche comment supprimer le volume.
- **Quelques-unes** : le déploiement laisse le conteneur tel quel et indique combien de clés de la passerelle sont encore ouvertes : celles des tours commencés avant la mise à jour, des sessions qui tournent encore et d’une organisation en cours de suppression. Un `tale deploy` ultérieur repose la question.
- **Pas de réponse** : le déploiement garde le conteneur et dit pourquoi. Au premier déploiement de cette version, le backend qu’il interroge est encore celui de la version précédente, qui ne sait pas répondre. Le `tale deploy` suivant repose la question.

`tale deploy --dry-run` pose la même question et indique ce que le déploiement ferait.

Le volume `<id>_llm-gateway-data` reste quand le conteneur s’en va. Il contient les clés des fournisseurs que la passerelle joignait, dans sa base SQLite, et les dépenses des clés qu’elle a émises. Supprime-le dès qu’aucun tour n’en a plus besoin, avec la commande qu’a affichée le déploiement :

```bash
docker volume rm <id>_llm-gateway-data
```

Les autres commandes traitent la passerelle et son volume ainsi :

- Les snapshots pris à partir de cette version n’archivent plus le volume. Restaurer un snapshot plus ancien qui le contient le restaure toujours.
- `tale reset --all` supprime le conteneur d’une passerelle gardée et son volume avec les autres volumes de données, jamais le volume `backups`.
- `tale restore` arrête une passerelle gardée qui tourne, comme les autres conteneurs avec état.
- `tale runtime migrate --finish` supprime le volume avec les autres volumes de données Docker : la stack Incus n’en a pas l’usage.
- `tale rollback` ne redémarre jamais la passerelle. Une version antérieure au relais fait passer les tours d’agent et les endpoints de modèles par la passerelle : après un retour arrière vers une telle version, ils ne fonctionnent donc que tant que le conteneur de la passerelle tourne encore. `tale deploy` ne retire le conteneur que pendant qu’une version dotée du relais tourne, et `tale rollback` revient à la version qui tournait avant le dernier déploiement : un retour arrière après le retrait revient donc à une version dotée du relais.

Avec tes propres fichiers Compose ou sur Kubernetes, personne n’interroge le backend à ta place. Les sessions joignent le relais sur le port 8080 de l’API backend : sur Kubernetes, le Service `backend-api` doit l’exposer et les Pods de session doivent pouvoir le joindre, comme le montre [Déployer sur Kubernetes](/fr/self-hosted/install/kubernetes), et `kubectl apply` laisse en place le Deployment, les Services et le claim de la passerelle. Supprime le service de la passerelle dès qu’aucune clé qu’elle a émise n’est plus ouverte, et son volume ou son claim dès qu’aucun tour n’en a plus besoin. Si [`TALE_CONTROL_TOKEN`](/fr/self-hosted/configuration/environment-reference) est défini sur le backend, interroge-le comme le fait `tale deploy` : il répond `{"open":0}` dès qu’aucune n’est plus ouverte.

```bash
docker compose exec backend-api sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
kubectl -n tale exec deploy/backend-api -- sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
```

## L’application en un seul processus {#one-process}

Un workspace exécute l’application dans un processus `platform` par réplica : le service web, l’API et les workers. Les versions précédentes les exécutaient en trois services, `platform`, `backend-api` et `backend-worker`, et leurs images le font toujours.

Le premier `tale deploy` d’une version capable de tourner en un seul processus démarre ainsi la nouvelle couleur à côté de l’ancienne couleur à trois services, puis retire l’ancienne après la bascule, comme tout autre déploiement. `tale deploy --dry-run` nomme les services que la nouvelle couleur exécuterait. Ensuite :

- Il n’existe plus de conteneur `backend-api` ni `backend-worker`. `tale logs backend-api` et `tale logs backend-worker` lisent à la place le log de `platform`. Adapte ce que tu maintiens toi-même et qui nomme ces conteneurs, comme un collecteur de logs ou une alerte.
- Les autres services atteignent toujours l’API sous le nom `backend-api`, auquel `platform` répond désormais aussi.
- `PLATFORM_MEMORY_RESERVATION` dimensionne ce processus unique et vaut `256m` par défaut pour lui, au plus sa limite de mémoire de `12g`. `BACKEND_API_MEMORY_RESERVATION` et `BACKEND_WORKER_MEMORY_RESERVATION` ne s’appliquent à ces services que là où ils existent.
- `tale deploy --services platform` remplace sur place l’application entière et draine donc d’abord les tours de chat. Nommer un service que la couleur active n’exécute pas est refusé, avec la liste de ceux qu’elle exécute.

Pour dimensionner les workers séparément, définis `TALE_BACKEND_WORKER_REPLICAS`, `TALE_BACKEND_API_REPLICAS` ou les deux, sur une valeur de 1 à 16, puis déploie. La nouvelle couleur exécute alors `backend-worker` avec son nombre de réplicas, à côté d’un `platform` qui est le service web et l’API et qui en compte autant que la plus grande des valeurs `TALE_PLATFORM_REPLICAS` et `TALE_BACKEND_API_REPLICAS`. Retire les deux variables et le déploiement suivant revient à un seul processus.

`TALE_APP_TIER` nomme la forme directement et l’emporte sur les nombres de réplicas : `one-process`, `workers-apart` ou `three-services`. Avec `three-services`, même une version capable de tourner en un seul processus exécute `platform` comme service web seul, à côté de `backend-api` et `backend-worker`.

Une CLI d’avant ce changement ne déploie que par-dessus trois services. Elle cherche les conteneurs `backend-api` et `backend-worker` et, sans eux, refuse de déployer ou de revenir en arrière sans rien modifier : avec `The installed backend database connection is unknown` par-dessus un seul processus, et avec `The installed backend database inventory is incomplete` là où seuls les workers tournent à part. Avant de revenir à une telle CLI, par exemple pour restaurer un snapshot d’une ligne de versions antérieure, définis `TALE_APP_TIER=three-services` et lance `tale deploy` avec la CLI actuelle : le workspace exécute alors les services que l’ancienne connaît. Fais-le avant la restauration : ensuite, les données appartiennent à la version antérieure, et seule la CLI de cette version peut les démarrer. `tale restore` le vérifie lui-même là où l’image de la version antérieure est encore sur l’hôte, et refuse avant de modifier quoi que ce soit. Retire la variable une fois revenu sur une version qui tourne en un seul processus. `tale rollback` n’a pas besoin de cette étape : la CLI actuelle démarre elle-même les trois services de la version antérieure.

Chaque couleur exécute les services que sa propre image prend en charge. `tale rollback` vers une version antérieure à ce changement ramène donc ses trois services. Le fichier Compose du dépôt, les [manifestes Kubernetes](/fr/self-hosted/install/kubernetes) et le [runtime Incus](/fr/self-hosted/install/incus) gardent les trois services.

## Une base dimensionnée pour un petit hôte {#database-profile}

`tale deploy` démarre la base fournie avec le profil `small` : 32 Mo de shared buffers au lieu de 256 Mo, 4 Mo pour un tri au lieu de 32 Mo, 40 connexions au lieu de 100, un seul worker d’autovacuum et aucune requête parallèle. La base occupe ainsi, sous la même charge, moins de la moitié de la mémoire qu’elle occupait, ce dont un déploiement a besoin sur un hôte d’un demi-gigaoctet. L’application ouvre moins de connexions en conséquence, [15 au plus depuis son unique processus](/fr/self-hosted/configuration/environment-reference#database).

Le premier déploiement de cette version redémarre la base avec ces tailles. Rien ne change sur le disque, et la recherche fonctionne comme avant : au-delà de ses shared buffers, PostgreSQL lit à travers le cache de pages de l’hôte.

Si ton hôte a de la mémoire à revendre et une grande base de connaissances, les tailles précédentes te conviendront mieux. Avant de déployer, ajoute ceci au `.env` de l’espace de travail :

```dotenv
DB_PROFILE=standard
```

Pour ne changer qu’une taille, nomme celle-là à la place, par exemple `DB_SHARED_BUFFERS=1GB`. Une taille que tu nommes l’emporte sur le profil.

## Le fournisseur de jetons pour les liens YouTube est désactivé par défaut {#token-provider}

Les versions précédentes démarraient `bgutil-provider` avec chaque déploiement. `tale deploy` ne le démarre plus que là où le `.env` de l’espace de travail définit `VIDEO_INGEST_POT_PROVIDER=true`, et le premier déploiement de cette version retire sinon celui qui tourne.

Les liens YouTube continuent de fonctionner depuis une adresse que YouTube ne met pas à l’épreuve. Depuis une autre, un lien échoue et nomme le fournisseur. Si tes membres collent des liens YouTube et que ton hôte est dans un centre de données, [active le fournisseur](/fr/self-hosted/configuration/video-ingestion#token-provider) avant la mise à niveau.

## Les fichiers sont lus dans une limite de mémoire {#file-memory-limit}

Un réplica lit désormais chaque fichier dans un processus à part, un fichier à la fois, et interrompt la lecture d’un fichier qui demande plus de mémoire que la limite. Jusqu’à cette version, un gros tableur ou un gros PDF était lu dans le processus de l’application, qui pouvait grossir de plusieurs centaines de mégaoctets pendant la lecture.

La limite est de 512 Mio, et de 96 Mio là où `tale deploy` exécute l’application en un seul processus, ce dont un déploiement a besoin sur un hôte d’un demi-gigaoctet. Sous 96 Mio, un tableur de 100 000 lignes sur 10 colonnes passe toujours, tout comme environ 20 Mo de texte brut. Un fichier qui en demande davantage affiche **Échoué**, avec une explication qui nomme la limite. Si tes documents sont plus gros et que ton hôte a de la mémoire à revendre, ajoute ceci au `.env` de l’espace de travail avant de déployer :

```dotenv
HEAVY_SLOT_MEMORY_MB=512
```

Utilise ensuite **Relancer l'indexation** sur un document en échec. [Mémoire pour lire les fichiers](/fr/self-hosted/configuration/environment-reference#file-memory) indique ce qui passe et comment lire plusieurs fichiers à la fois.

## Les liens vidéo sont récupérés dans une session sandbox {#video-sandbox}

Jusqu’à cette version, le backend lançait `yt-dlp` à côté de lui pour lire un lien vidéo. Il l’exécute désormais dans une session sandbox propre au lien. Ce qu’un membre colle est ainsi récupéré selon les règles de la sandbox et admis par l’hôte des sandboxes, pas dans l’application.

Vérifie quatre points avant la mise à niveau :

- **Les destinations de la sandbox.** Les requêtes d’un lien sortent désormais par le proxy de sortie de la sandbox. Si `SANDBOX_EGRESS_ALLOWLIST` est défini, ajoute les plateformes vidéo que tes membres utilisent et les hôtes depuis lesquels elles servent leurs médias. Le backend lui-même ne se connecte plus à une plateforme vidéo, seulement à un proxy que tu as configuré pour la vidéo.
- **Les sessions de rendu.** Chaque lien en cours occupe l’une des **Sessions de rendu** de l’organisation, que l’analyse des sites utilise aussi. La valeur par défaut est 2. Un lien qui n’en trouve aucune de libre attend ; si des liens restent **En file d'attente** pendant l’analyse de sites, augmente la limite sous **Paramètres > Sandboxes**.
- **Les réglages de développement.** `VIDEO_INGEST_BIN_DIR`, `VIDEO_INGEST_FFMPEG_LOCATION` et `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` désignent des outils sur la machine du backend. La session d’un déploiement utilise les outils de son image et les ignore.
- **Les images que tu construis ou fixes toi-même.** L’image de l’application ne contient plus `yt-dlp` ; l’image d’exécution de la sandbox le contient. Utilise l’image d’exécution de la sandbox de cette version : avec une image plus ancienne, chaque lien échoue avec « Le traitement vidéo n'est pas encore activé — contacte ton administrateur ».

L’audio d’une vidéo sans sous-titres est désormais stocké tel que la plateforme le sert, le plus souvent dans un fichier WebM ou M4A, alors qu’il était converti en MP3. Les transcriptions ne changent pas. [Configurer l’import de transcriptions vidéo](/fr/self-hosted/configuration/video-ingestion#where-retrieval-runs) décrit où un lien est récupéré et ses limites.

## Les fichiers passent de MinIO à versitygw {#blob-store}

Un nouveau déploiement conserve ses fichiers dans versitygw, un serveur S3 qui enregistre chaque objet comme un fichier à part dans le volume `blob-data`. Ce serveur n’utilise qu’une fraction de la mémoire de MinIO et dispose d’une image pour ARM64. Un déploiement installé auparavant conserve ses fichiers dans `object-store-data`, dans un format propre à MinIO que versitygw ne sait pas lire. `tale deploy` y garde donc MinIO, et l’indique :

```text
The blob store stays MinIO: this deployment's blobs are in <id>_object-store-data, in MinIO's format. A new install runs versitygw. `tale deploy --stop` moves the blobs to versitygw, pausing the application for the last copy.
```

Un déploiement qui remplace le stockage déplace les fichiers : `tale deploy --stop`, `tale deploy --services object-store`, ou tout déploiement qui trouve le stockage arrêté. Avec `--dry-run`, il annonce le déplacement sans l’effectuer. Avant de copier quoi que ce soit, la CLI vérifie trois points, et garde MinIO si l’un d’eux échoue :

- `OBJECT_STORE_SECRET_KEY` est défini dans le `.env` de l’espace de travail.
- Le système de fichiers qui accueille `blob-data`, en général celui de `/var/lib/docker`, a assez de place pour le volume de MinIO, plus un dixième de sa taille et 1 Gio. Les deux volumes y restent jusqu’à ce que tu supprimes celui de MinIO.
- Un objet que versitygw y écrit se relit avec son type de contenu et son ETag. versitygw conserve les deux dans des attributs étendus, pris en charge par ext4, XFS et Btrfs. Sur un système de fichiers sans attributs étendus, chaque fichier se relirait sans son type.

La CLI copie alors chaque bucket pendant que l’application continue de fonctionner. Elle met ensuite l’application en pause pour une dernière copie : celle-ci reprend ce qui a été écrit depuis le début de la première et supprime ce qui a été effacé entre-temps. Elle compare les buckets, les objets et les octets des deux côtés, démarre versitygw comme stockage et remet l’application en marche. Les requêtes attendent pendant la pause : prévois donc une courte fenêtre de maintenance. La pause s’allonge avec ce qui change pendant la première copie et avec le nombre de fichiers, que la comparaison liste des deux côtés.

Quand le déplacement réussit, le déploiement indique ce qu’il a déplacé et laisse le volume de MinIO tel qu’il était :

```text
Moved <n> object(s), <size>, to versitygw on <id>_blob-data. <id>_object-store-data is left as it was: remove it once you no longer need it (docker volume rm <id>_object-store-data).
```

Quand une vérification ou une étape échoue, MinIO sert les fichiers comme avant. La CLI supprime ce que le déplacement a écrit dans `blob-data`, indique la cause et poursuit le déploiement avec MinIO :

```text
The blobs stay in MinIO (<id>_object-store-data), which serves them as before: <reason>.
```

Corrige la cause et relance `tale deploy --stop`. Après un déplacement réussi :

1. Télécharge quelques fichiers connus et ouvre-les.
2. Prends un snapshot avec `tale backup`. Il archive `blob-data` avec ses attributs étendus.
3. Supprime le volume de MinIO quand tu n’en as plus besoin : `docker volume rm <id>_object-store-data`.

`tale rollback` garde versitygw. Ne ramène pas l’espace de travail à une version antérieure avec `tale update --version` : la CLI de cette version ne connaît que MinIO, et le démarrerait sur son volume tel qu’il était avant le déplacement, sans les fichiers importés depuis, ou sur un volume vide si tu as déjà supprimé celui-ci. Pour revenir à une telle version, restaure un snapshot pris avant le déplacement, comme l’explique [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore).

`tale deploy` déplace les fichiers sur Docker. Pour une stack sur tes propres fichiers Compose ou sur Kubernetes, suis [Déplacer les blobs de MinIO vers versitygw](/fr/self-hosted/install/own-compose#blob-store).

## Mise à niveau depuis v0.5.77 ou antérieure

À partir de v0.5.78, les versions écrivent les exécutions d’automatisation avec le protocole d’écriture 2. Leur migration `0163` fait passer à l’état **Suspendue** chaque exécution encore en file d’attente, en cours ou en attente, et une exécution suspendue ne reprend jamais. La première mise à niveau depuis v0.5.77 arrête donc l’ancien backend une fois toutes les exécutions terminées, et ne démarre qu’ensuite la nouvelle version. `tale deploy` s’en charge lui-même, une seule fois.

1. Si le workspace exécute une version antérieure à v0.5.77, amène-le d’abord en v0.5.77. Le changement ne part que de cette version :

   ```bash
   tale update -v 0.5.77
   tale deploy
   ```

   Ces étapes utilisent `-v` : les CLI antérieures à la correction comprennent `tale update --version` comme une demande de leur propre version et ne changent rien.

2. Laisse chaque exécution d’automatisation de chaque organisation se terminer, ou annule-la, et mets en pause les planifications et déclencheurs qui en lanceraient de nouvelles jusqu’à la fin de la mise à niveau.
3. Confirme ta sauvegarde externe, puis mets à jour et prévisualise. L’aperçu signale tout ce qui bloque encore le changement :

   ```bash
   tale update -v <target-version>
   tale deploy --dry-run
   ```

4. Déploie, sans `--stop` ni `--services`. Si db, object-store ou proxy doivent être mis à jour, lance ensuite `tale deploy --stop` :

   ```bash
   tale deploy
   ```

Avant de modifier quoi que ce soit, `tale deploy` vérifie la version du backend en cours, l’historique des migrations de la base et les exécutions d’automatisation. Si l’un de ces éléments n’est pas prêt, il s’arrête en indiquant l’étape suivante et laisse le workspace fonctionner tel quel. Sinon, il prend son snapshot et remplace les services sandbox comme d’habitude. Juste avant le démarrage de la nouvelle couleur, il bloque les nouvelles exécutions d’automatisation, confirme qu’aucune n’est inachevée, arrête proprement les anciens conteneurs `backend-api` et `backend-worker` et les consigne dans `.tale/automation-cutover.json`. L’API reste indisponible de cet arrêt jusqu’à ce que la nouvelle couleur soit opérationnelle.

Le premier démarrage de la nouvelle couleur applique toutes les migrations de base depuis v0.5.77 avant de se déclarer opérationnel ; avec une grande base de connaissances, la copie des vecteurs peut dépasser `HEALTH_CHECK_TIMEOUT`. Si le déploiement s’interrompt après l’arrêt de l’ancien backend, relance `tale deploy` avec la même version : il reconnaît son propre relais, y compris un premier démarrage interrompu au milieu de ses migrations, attend la couleur déjà en cours de démarrage au lieu de la recréer et termine la mise à niveau. Conserve `.tale/automation-cutover.json` et ne redémarre pas les anciens conteneurs à la main. Dès que le changement a commencé, `tale rollback` refuse de revenir à v0.5.77 ; répare avec une version compatible, comme le décrit la section suivante.

Sans `tale deploy`, avec tes propres fichiers Compose ou les [manifestes Kubernetes](/fr/self-hosted/install/kubernetes), personne ne tient cette barrière pour toi, et une mise à jour progressive démarre les nouveaux conteneurs backend pendant que les anciens tournent encore. Tiens-la à la main, dans cet ordre : mets en pause les planifications et déclencheurs et laisse les exécutions se terminer ; arrête chaque `backend-api` et `backend-worker` de v0.5.77 et vérifie qu’aucun ne tourne encore ; vérifie que la requête ci-dessous répond `0` ; et ne déploie la nouvelle version qu’ensuite. Si elle répond davantage, redémarre l’ancien backend, laisse ces exécutions se terminer et arrête-le de nouveau. Avec Compose, `docker compose stop backend-api backend-worker` arrête les deux et rend la main une fois qu’ils sont arrêtés.

```bash
kubectl -n tale scale --replicas=0 deployment/backend-api deployment/backend-worker
kubectl -n tale get pods -l 'app in (backend-api, backend-worker)'
psql "$DATABASE_URL" -Atc "select count(*) from app.automation_runs where status is null or status not in ('success', 'failed', 'cancelled')"
```

## Changement de protocole des automatisations : réparer avec une version compatible

Dès que la base enregistre le protocole d’écriture des automatisations 2, utilise un runtime qui implémente ce protocole et la CLI correspondante. Avant de modifier les fichiers de déploiement, l’infrastructure ou le trafic, la CLI lit le registre des migrations installé et vérifie le protocole, la révision source et le digest immuable de l’image backend choisie. Une ancienne image, des métadonnées de protocole absentes ou non prises en charge, un registre illisible ou ambigu, ou une identité de base modifiée arrêtent le déploiement et le retour en arrière. Une couleur en attente doit contenir la même image admise dans chaque rôle backend avant la bascule. Une base arrêtée n’est pas démarrée implicitement pour effectuer cette vérification.

Un backend de protocole 2 déjà créé exige aussi une cible compatible, même s’il est arrêté ou si sa première migration n’est pas encore validée. La CLI relit le protocole minimal installé après le téléchargement des images et avant de modifier le déploiement. Une ancienne CLI ou une commande Docker manuelle utilisée en parallèle échappe à cette coordination.

La vérification actuelle des déploiements par tag ne prend en charge que la base applicative fournie. Un `DATABASE_URL` explicite, un `APP_DB_NAME` personnalisé ou un backend installé qui pointe encore ailleurs sont refusés jusqu’à ce qu’un chemin de lecture vérifié séparément soit disponible. Retirer une surcharge de `.env` ne prouve pas que le backend en cours a changé sa connexion. Conserve le runtime existant et répare la vérification ; ne contourne pas le refus avec une ancienne CLI.

Les anciennes CLI et le remplacement manuel d’images n’appliquent pas cette protection du déploiement. La barrière d’écriture de la base et les files d’exécution séparées restent nécessaires pendant la coexistence des versions. Une sauvegarde restaure les données stockées, pas les messages, paiements ou autres effets déjà envoyés à un service externe ; elle n’autorise pas un runtime utilisant l’ancien protocole après ce changement. Répare avec une version compatible et conserve les exécutions retenues et leurs preuves.

## Vérifie le seuil d’espace disque des sandboxes avant la mise à niveau

Le spawner Docker refuse désormais toute nouvelle session avec HTTP 429 `host_disk` quand le disque contenant les espaces de travail des sessions passe sous `SANDBOX_MIN_FREE_DISK`. Cela concerne aussi un hôte déjà sous le seuil au moment de la mise à niveau, même avec une valeur explicite de `SANDBOX_MAX_SESSIONS`. Les sessions existantes continuent de fonctionner, mais les nouveaux travaux attendent que de l’espace se libère. Arrêter des sessions inactives ne libère pas leurs espaces de travail conservés.

Vérifie l’espace libre avant le déploiement. Le seuil par défaut est un vingtième de ce disque, au moins 2 GiB et au plus 20 GiB. Libère de l’espace sans mettre tes données en danger ou choisis délibérément un autre seuil. `SANDBOX_MIN_FREE_DISK=0` désactive cette protection ; tu dois alors éviter toi-même que le disque se remplisse. Le spawner peut supprimer les caches de build inutilisés d’organisations arrêtées, mais interrompt cette récupération pendant six heures après trois suppressions consécutives apportant chacune moins de 1 MiB. Ne compte pas sur ces suppressions pour sauver un hôte plein. Consulte la [référence d’environnement](/fr/self-hosted/configuration/environment-reference) pour la configuration et les limites de récupération.

## Bifrost 1.6 → 2.2 : le stockage de la passerelle de modèles est migré

Ceci concerne les versions qui exécutent encore la passerelle de modèles. À partir de la version qui la remplace par le [relais de modèles](#model-relay), `tale deploy` ne met plus à jour la passerelle : il la garde ou la supprime comme le décrit cette section.

Une version postérieure à 0.5.64 fait passer la passerelle de modèles (`sandbox-llm-gateway`) de Bifrost 1.6 à Bifrost 2.2 ; ses notes de version signalent ce changement. À son premier démarrage, la nouvelle passerelle migre sur place son stockage dans `llm-gateway-data` et conserve ses fournisseurs, clés, budgets et compte d’administration ; rien n’est à faire à la main. La migration indexe aussi le journal des requêtes de la passerelle, si bien que ce démarrage peut durer plus longtemps sur une instance à long historique de requêtes.

`tale deploy` remplace la passerelle avant de démarrer la nouvelle couleur applicative : si le déploiement échoue ensuite, le stockage peut donc déjà être migré. Le snapshot qu’un `tale deploy` avec changement de version prend auparavant contient `llm-gateway-data` avec les autres volumes et sert donc aussi de point de reprise pour la passerelle. Les snapshots pris avant que la CLI capture le stockage de la passerelle ne contiennent pas cette archive ; `tale restore` les signale comme `without gateway`. Si tu déploies avec `--skip-backup`, copie d’abord le volume toi-même. Arrête la passerelle, ce qui termine les tours d’agent et les appels de modèle en cours, copie le volume, puis déploie. `<id>` est l’`id` de `tale.json` :

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v <id>_llm-gateway-data:/from:ro -v "$PWD/llm-gateway-data-backup:/to" alpine:3.22 cp -a /from/. /to/
```

La passerelle d’une version antérieure à ce changement démarre sur le stockage migré et sert Tale, mais elle journalise des erreurs `no such column: oauth_configs.token_id`, et Bifrost ne prend pas en charge ce retour en arrière. `tale rollback` ne démarre pas cette passerelle : il laisse la passerelle sur l’image et le stockage plus récents. Elle démarre quand une version antérieure au changement est de nouveau déployée, par exemple avec `tale update --version` et `tale deploy` après la restauration d’un snapshot. Remets donc d’abord le stockage en place. Restaurer le snapshot pris avant la mise à niveau remet `llm-gateway-data` en place avec les autres volumes. Si `tale restore` signale ce snapshot comme `without gateway`, arrête la passerelle et remets ta copie en place avant de déployer la version antérieure :

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v "$PWD/llm-gateway-data-backup:/from:ro" -v <id>_llm-gateway-data:/to alpine:3.22 sh -c 'find /to -mindepth 1 -delete && cp -a /from/. /to/'
```

Une passerelle sans compte d’administration, sur une nouvelle installation ou après le remplacement de son volume, ne crée désormais ce compte que pour un appelant qui présente son jeton de configuration, que l’image tire de `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD`. `tale deploy`, le fichier Compose du dépôt et les manifestes Kubernetes de cette documentation donnent déjà cette variable à la passerelle. Un fichier Compose ou un manifeste écrit à la main qui ne la passe qu’au backend doit aussi la passer à la passerelle.

Deux comportements changent. Quand un appelant raccroche, la passerelle met désormais fin à l’appel de modèle, qu’il ait demandé une réponse entière ou un flux : une requête abandonnée n’occupe donc plus un modèle auto-hébergé, et les endpoints de modèles imputent un tel appel pour son prompt et la sortie qui avait atteint l’appelant. Et un modèle en amont qui retient les en-têtes de réponse d’une réponse en flux, comme un routeur qui met les requêtes en file d’attente jusqu’à ce qu’un modèle se libère, doit commencer sa réponse dans le délai de requête de la passerelle : 600 secondes, ou davantage quand `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` le relève.

## 0.4 → 0.5 : une installation séparée

En 0.5, Postgres a remplacé l’ancien stockage applicatif Convex. Aucun importeur ne permet une mise à niveau directe entre ces bases. Garde l’ancienne instance et ses sauvegardes intactes pendant que tu prépares un déploiement neuf, avec un workspace et des données séparés.

Recrée organisations et utilisateurs, examine et transfère la configuration compatible, puis réimporte les documents nécessaires. Des fichiers laissés dans un bucket externe ne reçoivent pas automatiquement de références dans la nouvelle base applicative. Valide l’environnement de remplacement avant de retirer l’ancien.

La CLI refuse ce changement non pris en charge par défaut. L’option experte `--accept-data-loss` n’est pas un outil de migration et ne préserve pas les anciennes données applicatives. Des volumes ou bases historiques peuvent subsister après de précédentes mises à niveau ; leur seule présence ne justifie pas de les supprimer pendant cette procédure.

## 0.3 → 0.4 : l’API compatible OpenAI a été retirée

De la 0.2.10 à la 0.3, Tale proposait sous `/api/v1` une couche compatible OpenAI : `POST /api/v1/chat/completions` et `POST /api/v1/images/generations`, avec requêtes et réponses au format OpenAI, ainsi qu’un `GET /api/v1/models` au format OpenAI. Son champ `model` pouvait désigner un agent. La reconstruction de la 0.4 a retiré cette couche. Les appelants de ces routes, y compris les SDK OpenAI pointés sur l’instance, cessent de fonctionner, car la 0.4 ne sert aucune des trois routes, et les versions ultérieures ne les rétablissent pas. Une version actuelle répond aux chat completions et à la génération d’images par `404 NOT_FOUND`, ou par `400 ORG_SLUG_REQUIRED` quand le titulaire de la clé appartient à plusieurs organisations et que la requête ne porte pas de `X-Organization-Slug`, qu’un SDK OpenAI n’envoie pas par défaut. Son `GET /api/v1/models` renvoie la liste propre à Tale, avec les modèles et les environnements d’agents, qu’un client OpenAI ne sait pas lire.

Repère ces appelants avant la mise à niveau et prévois leur remplacement. Un appelant qui a besoin de la réponse d’un modèle peut passer aux endpoints de modèles encadrés que proposent les versions à partir du contrat d’API 3.7.0. Ils diffèrent de la couche de la 0.3 : l’URL de base est `/api/v1/openai`, ou `/api/v1/anthropic` pour les clients Anthropic, au lieu de `/api/v1` ; `model` désigne un modèle sous la forme `<providerSlug>/<modelId>`, jamais un agent ; la génération d’images n’est pas servie ; et les endpoints restent désactivés tant qu’un admin n’a pas activé **Endpoints de modèles pour les clés API** dans **Paramètres > Gouvernance > Modèles**. Ensuite, chaque appel passe par l’accès aux modèles, les garde-fous d’entrée et les budgets. Les endpoints de modèles joignent les modèles par le même relais de modèles que les agents gérés. Les questions posées par script à l’assistant passent à l’API REST de chat, asynchrone, qui répond en tant qu’assistant de l’espace de travail et non comme un modèle brut. Les intégrations d’éditeur qui ont besoin des connaissances de Tale utilisent l’endpoint MCP, et le travail qui doit se faire dans Tale, dans une sandbox et avec la revue d’une personne, revient à un agent de projet sur une tâche. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) décrit chacune de ces voies.
