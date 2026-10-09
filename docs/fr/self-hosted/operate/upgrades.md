---
title: Mettre à niveau et rétablir un déploiement
description: Prévisualise une mise à niveau, déploie avec un plan de reprise, vérifie le résultat et choisis le retour arrière adapté.
---

Pour un déploiement dans un workspace, `tale update` modifie la CLI et les fichiers locaux ; `tale deploy` modifie les services actifs. Choisis la version cible et le point de reprise avant ces étapes. Le déploiement bleu-vert fait coexister les réplicas applicatifs, mais snapshots, drainage et remplacement des services persistants peuvent interrompre le travail.

Les déploiements gérés utilisent des révisions de sources fixées et des bundles préparés. Suis [Déploiements gérés](/fr/self-hosted/install/cli-install#managed-deployments) pour ce parcours, ou [Releases de configuration](/fr/self-hosted/configuration/config-releases) si seul le contenu client change.

## Préparer la mise à niveau

1. Lance `tale status` dans le bon workspace. Note la version active, celle du workspace et l’état du déploiement.
2. Lis les notes de la version cible : compatibilité, configuration requise et limites connues. Une instance antérieure à 0.5 exige le changement d’installation décrit plus bas.
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
| `platform`, `backend-api`, `backend-worker` | Déploiement commun dans la nouvelle couleur applicative. | Anciens et nouveaux réplicas coexistent ; le drainage peut refuser de nouveaux tours. |
| `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Remplacement sur place après drainage du travail concerné. | Ce sont des dépendances d’exécution communes, pas un second groupe applicatif bleu-vert. |
| `db`, `object-store`, `proxy` | Conservation des services actifs ; la CLI signale les mises à jour ignorées. | Ajoute `--stop` lorsque ces services doivent être remplacés. |

```bash
tale deploy --stop
```

`TALE_PLATFORM_REPLICAS`, `TALE_BACKEND_API_REPLICAS` et `TALE_BACKEND_WORKER_REPLICAS` acceptent 1–16 réplicas. Augmente le rôle dont les mesures montrent la saturation ; ajouter des workers ne corrige ni une base indisponible ni un quota fournisseur épuisé.

## Comprendre la bascule

La CLI démarre la couleur inactive et attend que ses réplicas passent les contrôles de santé avant de terminer la bascule. Les deux versions peuvent servir pendant le chevauchement. Les releases doivent donc rester compatibles avec l’application précédente pendant les migrations.

L’ancienne API est drainée avant son retrait : de nouveaux tours de chat peuvent être refusés, tandis que les tours en cours disposent d’un délai pour finir. Le drainage des chats attend jusqu’à trois minutes ; celui du service web utilise `DRAIN_TIMEOUT`, par défaut 30 secondes. La route de santé web reste saine tant que son alias est partagé. Déconnecter les anciens conteneurs des réseaux de service les retire du DNS et peut couper les connexions restantes ; cette étape vient donc après les drainages.

Le drainage couvre aussi les automatisations. Les workers de l’ancienne couleur ne démarrent plus de nouveau job et transmettent chaque exécution d’automatisation à sa prochaine étape, si bien qu’elle continue sur la nouvelle couleur ; la CLI attend aussi ces étapes, dans les mêmes trois minutes. Quand les anciens conteneurs s’arrêtent, chaque worker dispose de 120 secondes pour transmettre ce qu’il détient encore (davantage si tu augmentes `SHUTDOWN_DRAIN_MS` : la CLI garde ce délai 15 secondes au-dessus), et une étape qui travaille encore 20 secondes après le début de l’arrêt est interrompue et s’exécute à nouveau sur la nouvelle couleur. Une étape qui envoyait quelque chose à un service externe fait exception, car le service l’a peut-être déjà reçu : l’exécution attend alors qu’une personne choisisse comment continuer, comme l’explique [Examiner les exécutions et corriger les échecs](/fr/platform/automations/execution-logs). La première mise à jour vers le protocole d’écriture des automatisations 2 est différente : la migration met en attente toutes les anciennes exécutions en file, en cours ou déjà en attente, en conservant leur état précédent et leurs effets externes non déterminés. Elles ne reprennent pas automatiquement. Un travail déjà admis ou envoyé par un ancien worker peut encore se terminer. Une demande d’arrêt explicite enregistre son auteur et demande l’annulation de la session concernée, sans prouver son arrêt ni le résultat d’une écriture externe. Elle ne libère ni la tâche retenue ni ses preuves. Vérifie le résultat réel avant de prévoir un travail de remplacement.

La passerelle de modèles est remplacée sur place avant le démarrage de la nouvelle couleur. Quand son conteneur s’arrête, la passerelle n’accepte plus de nouvel appel de modèle et laisse aux appels en cours, réponses en flux comprises, jusqu’à 90 secondes pour se terminer. Elle n’enregistre ses compteurs de dépenses à la fin que si cela se termine dans les 30 secondes qui suivent l’arrêt, car la fenêtre de nettoyage de la passerelle compte à partir du signal d’arrêt. Un appel encore en flux après cela reçoit sa réponse complète, mais son coût, et celui des secondes précédentes, peut ne pas être comptabilisé. Jusqu’à ce que la nouvelle passerelle réponde, un nouvel appel de modèle échoue, et une réponse encore en flux après 90 secondes est coupée. Un déploiement peut donc attendre la passerelle jusqu’à 90 secondes.

Les deux couleurs montent le volume `static-assets` du déploiement. Avant qu’une réplique web soit prête, elle y publie les scripts, feuilles de style, polices et images immuables de sa compilation. Chaque couleur peut ainsi servir les fichiers référencés par le HTML de l’autre. Les répliques actives actualisent leurs fichiers chaque heure ; les fichiers retirés restent disponibles pendant sept jours après leur dernière actualisation. Monte aussi ce volume partagé sur chaque réplique web dans ta propre configuration Compose. Lors de la première mise à niveau depuis une version qui ne prend pas en charge ce mécanisme, les anciennes répliques n’ont pas encore accès à ce recours partagé.

Un onglet ouvert continue normalement à fonctionner pendant la bascule. Si une partie nécessaire n’est plus disponible, Tale attend que son API et sa base de données répondent, puis recharge la page une fois. Si cette partie ne se charge toujours pas, Tale affiche **Une nouvelle version est disponible** avec l’action **Recharger**, sans répéter le rechargement automatique. Pendant une panne, l’avis de connexion reste visible. Les lectures ayant échoué sont actualisées quand la connexion revient ; les écritures ayant échoué ne sont pas renvoyées automatiquement.

Si le nouveau groupe ne devient pas sain avant `HEALTH_CHECK_TIMEOUT`, la CLI ne termine pas la bascule. Examine l’état enregistré et les journaux avant de réessayer. Un déploiement interrompu peut laisser les deux groupes ou un transfert en attente. Suis les indications de reprise de la CLI plutôt que de supprimer manuellement conteneurs ou fichiers d’état.

## Vérifier les migrations et le résultat utilisateur

Au démarrage, le backend applique ses migrations numérotées dans l’ordre des noms de fichier, sous un verrou consultatif de session. Les migrations SQL modifient le schéma ; les migrations de données en TypeScript mettent à jour les lignes existantes selon les règles de l’application. La table `app_migrations` enregistre les deux types par nom de fichier, si bien que chaque migration ne s’exécute qu’une fois par base. Les autres réplicas attendent cette étape. Une erreur de migration empêche le nouveau backend de démarrer normalement ; examine l’erreur et la base avant de réessayer. Changer un tag d’image n’annule pas des migrations conçues pour avancer uniquement.

`tale migrate` actualise les valeurs d’organisation fournies ; ce n’est pas une commande de retour arrière de la base. Avant de remplacer la configuration de l’hôte, vérifie que les adaptations locales doivent réellement être écrasées.

Après le déploiement, vérifie certificat public et connexion, ouvre un projet ou une conversation existante et télécharge un fichier connu. Teste de façon contrôlée les parcours de connaissances et d’automatisation utilisés. Vérifie l’avancement des workers, les stockages et la version effectivement active. Conserve les éléments de reprise antérieurs jusqu’à l’acceptation du déploiement.

## Choisir un retour arrière

| Situation | Reprise |
| --- | --- |
| Revenir à la version précédente enregistrée dans la même ligne `major.minor` | `tale rollback` vérifie cette limite et demande confirmation avant de redéployer. Lis aussi les notes de compatibilité de la release. |
| Revenir au-delà d’une limite mineure ou majeure | Restaure les données coordonnées d’avant la mise à niveau et déploie leur version correspondante. `tale rollback` refuse ce retour limité aux images. |
| Version cible ou compatibilité des données inconnue | Résous la version et la provenance des sauvegardes avant de démarrer un programme plus ancien. |

```bash
tale rollback
```

`--yes` supprime la confirmation pour une opération sans surveillance déjà approuvée. La vérification de ligne de version est un garde-fou, pas une preuve indépendante de compatibilité de chaque intégration externe ou configuration personnalisée. Une liste d’anciennes migrations qui forme le préfixe de la nouvelle ne suffit pas à rendre un retour arrière sûr.

`tale rollback` remplace uniquement les images applicatives de `platform`, `backend-api` et `backend-worker`. Il ne restaure aucun volume et laisse la base de données, les stockages, le proxy, les services de sandbox et la passerelle de modèles tels quels. Aucune étape de déploiement ne restaure non plus de données d’elle-même : un déploiement ordinaire (sans `--services`) qui échoue à ses contrôles de santé laisse la couleur applicative précédente en service, mais les services qu’il a déjà remplacés sur place le restent. Seul `tale restore` remet en place les volumes d’un snapshot.

## Changement de protocole des automatisations : réparer avec une version compatible

Dès que la base enregistre le protocole d’écriture des automatisations 2, utilise un runtime qui implémente ce protocole et la CLI correspondante. Avant de modifier les fichiers de déploiement, l’infrastructure ou le trafic, la CLI lit le registre des migrations installé et vérifie le protocole, la révision source et le digest immuable de l’image backend choisie. Une ancienne image, des métadonnées de protocole absentes ou non prises en charge, un registre illisible ou ambigu, ou une identité de base modifiée arrêtent le déploiement et le retour en arrière. Une couleur en attente doit contenir la même image admise dans chaque rôle backend avant la bascule. Une base arrêtée n’est pas démarrée implicitement pour effectuer cette vérification.

Un backend de protocole 2 déjà créé exige aussi une cible compatible, même s’il est arrêté ou si sa première migration n’est pas encore validée. La CLI relit le protocole minimal installé après le téléchargement des images et avant de modifier le déploiement. Une ancienne CLI ou une commande Docker manuelle utilisée en parallèle échappe à cette coordination.

La vérification actuelle des déploiements par tag ne prend en charge que la base applicative fournie. Un `DATABASE_URL` explicite, un `APP_DB_NAME` personnalisé ou un backend installé qui pointe encore ailleurs sont refusés jusqu’à ce qu’un chemin de lecture vérifié séparément soit disponible. Retirer une surcharge de `.env` ne prouve pas que le backend en cours a changé sa connexion. Conserve le runtime existant et répare la vérification ; ne contourne pas le refus avec une ancienne CLI.

Les anciennes CLI et le remplacement manuel d’images n’appliquent pas cette protection du déploiement. La barrière d’écriture de la base et les files d’exécution séparées restent nécessaires pendant la coexistence des versions. Une sauvegarde restaure les données stockées, pas les messages, paiements ou autres effets déjà envoyés à un service externe ; elle n’autorise pas un runtime utilisant l’ancien protocole après ce changement. Répare avec une version compatible et conserve les exécutions retenues et leurs preuves.

## Bifrost 1.6 → 2.2 : le stockage de la passerelle de modèles est migré

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

Repère ces appelants avant la mise à niveau et prévois leur remplacement. Un appelant qui a besoin de la réponse d’un modèle peut passer aux endpoints de modèles encadrés que proposent les versions à partir du contrat d’API 3.7.0. Ils diffèrent de la couche de la 0.3 : l’URL de base est `/api/v1/openai`, ou `/api/v1/anthropic` pour les clients Anthropic, au lieu de `/api/v1` ; `model` désigne un modèle sous la forme `<providerSlug>/<modelId>`, jamais un agent ; la génération d’images n’est pas servie ; et les endpoints restent désactivés tant qu’un admin n’a pas activé **Endpoints de modèles pour les clés API** dans **Paramètres > Gouvernance > Modèles**. Ensuite, chaque appel passe par l’accès aux modèles, les garde-fous d’entrée et les budgets. Les endpoints de modèles joignent les modèles par la même passerelle de modèles que les agents gérés. Les questions posées par script à l’assistant passent à l’API REST de chat, asynchrone, qui répond en tant qu’assistant de l’espace de travail et non comme un modèle brut. Les intégrations d’éditeur qui ont besoin des connaissances de Tale utilisent l’endpoint MCP, et le travail qui doit se faire dans Tale, dans une sandbox et avec la revue d’une personne, revient à un agent de projet sur une tâche. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) décrit chacune de ces voies.
