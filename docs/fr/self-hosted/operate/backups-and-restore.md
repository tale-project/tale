---
title: Sauvegardes et restauration
description: Réunis les éléments nécessaires à la reprise, copie les snapshots de la CLI et restaure les données avec la bonne version de Tale.
---

Une instance Tale récupérable demande plus qu’une archive de base de données. Conserve ses fichiers, la configuration des organisations, le dossier de déploiement et les clés de déchiffrement, avec la version qui a écrit les données. Définis d’abord la perte de données et la durée de reprise acceptables, puis vérifie que tes sauvegardes et ta procédure respectent ces objectifs.

Ce guide couvre les snapshots de volumes Docker de la CLI utilisée dans un workspace et, à partir de [Snapshots sur Incus](#incus), ceux d’un workspace sur le runtime Incus expérimental. Si tu gères Compose toi-même, prévois une sauvegarde des mêmes stockages. Les bases et buckets externes exigent des sauvegardes séparées et coordonnées.

## Préparer un hôte de reprise vide

Récupère le workspace d’origine et vérifie que ta connexion Docker vise l’hôte de reprise. Garde les services arrêtés. Remplace `your-project-id` ci-dessous par l’ID d’origine de `tale.json`. Pour un snapshot de développement, utilise plutôt `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"`. Les noms de production et de développement sont distincts ; si les deux existent, la CLI choisit la production en premier.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

Ces commandes préparent les volumes de configuration et de sauvegarde sans démarrer de backend ni appliquer de migration. Pour transporter un snapshot sous forme d’un seul fichier, ou vers un workspace sur Incus, utilise plutôt [l’export et l’import](#export-import). Avec ton système de sauvegarde, restaure le contenu complet de `backups` dans ce volume. Le point de montage affiché appartient à l’hôte Docker, qui peut être distant. Conserve la structure des répertoires et les manifestes des snapshots. `tale restore` doit ensuite afficher le snapshot attendu. Pendant la restauration effective, la CLI crée les autres volumes cibles manquants après avoir vérifié le snapshot.

## Vérifier la portée du snapshot

`tale backup` capture les volumes du projet présents dans cet inventaire :

| Volume | Données incluses |
| --- | --- |
| `db-data` | Données applicatives et, dans le stack fourni pour un hôte, base de connaissances. |
| `knowledge-db-data` | Base de connaissances séparée lorsque ce volume existe, notamment avec Compose depuis les sources. |
| `config-data` | Configuration des organisations, fichiers de secrets associés pris en charge et identité visuelle. Les identifiants de fournisseurs stockés dans Postgres font partie de la sauvegarde de la base. |
| `object-store-data` | Fichiers importés et médias générés lorsque le stockage par défaut utilise le service fourni. |
| `caddy-data`, `caddy-config` | Certificats et état du proxy. |
| `llm-gateway-data` | Le stockage de la passerelle de modèles : son compte d’administration, les clés des fournisseurs, les clés de session avec leurs budgets et leurs dépenses, et son journal des requêtes. |

Un snapshot contient une archive et son fichier de somme SHA-256 pour chaque volume capturé. `manifest.json`, écrit en dernier, indique la version de la plateforme lorsqu’elle peut être déterminée. Un dossier sans manifeste est incomplet : il ne figure pas dans la liste de restauration et la rotation peut le supprimer après la création d’un snapshot complet plus récent. Les snapshots pris avant que la CLI capture le stockage de la passerelle ne contiennent pas d’archive de `llm-gateway-data`.

Conserve aussi le workspace qui contient `tale.json`, son `.env` et les fichiers de clés montés séparément. Garde notamment `ENCRYPTION_SECRET_HEX` et l’identité age nécessaire aux fichiers SOPS. Les espaces de travail des sandbox ne font pas partie de cet inventaire ; ajoute-les à ton plan si tu dois conserver leur état.

<Warning>

Les données Postgres externes ne sont pas capturées, même si un volume de base locale inutilisé apparaît encore dans le snapshot. La CLI n’avertit pas de cette configuration. Les buckets externes sont également exclus ; la CLI signale un bucket par défaut redirigé ou les buckets propres aux organisations qu’elle détecte. Vérifie les connexions de stockage de chaque organisation avant de considérer la couverture comme complète.

</Warning>

## Créer et vérifier un snapshot

Exécute ces commandes dans le dossier du déploiement concerné :

```bash
tale status
tale backup
tale restore
```

`backup` affiche le résultat. Sans identifiant, `restore` liste seulement les snapshots disponibles, leur version enregistrée et l’éventuelle absence des fichiers ou du stockage de la passerelle. Note l’identifiant du snapshot avec ceux des sauvegardes externes.

Pendant l’archivage d’un volume, le processus suspend les conteneurs qui l’utilisent. Les imports, téléchargements, opérations de base et appels de modèle passant par la passerelle peuvent attendre pendant cette pause, dont la durée dépend de la quantité de données et du débit. Docker signale un conteneur suspendu comme `unhealthy` jusqu’à ce que sa sonde réussisse de nouveau. Après chaque archive, le processus attend donc que chaque conteneur sain avant la pause soit de nouveau signalé comme `healthy`, ce qui prend en général un intervalle de sonde. Si un conteneur ne se rétablit pas dans la limite des tentatives que permet sa sonde, le snapshot échoue. Ces archives correspondent à un état de reprise après arrêt brutal par volume, pas à une transaction atomique entre tous les stockages. Pour obtenir un point de reprise coordonné, arrête les écritures et tâches planifiées ou utilise une fenêtre de maintenance qui couvre aussi les stockages externes.

Un `tale deploy` qui change de version ou remplace la configuration de l’hôte prend un snapshot avant ses modifications. L’échec du snapshot interrompt ce déploiement. `--skip-backup` contourne cette protection ; utilise cette option uniquement si ton plan de reprise fournit déjà la sauvegarde nécessaire.

## Conserver une copie hors de l’hôte

Les snapshots résident dans le volume Docker `backups` du projet. Une panne de l’hôte ou du disque peut détruire les données et les snapshots locaux ensemble. Copie les snapshots complets, la configuration du workspace et les clés dans ton système de sauvegarde externe protégé. Tale ne les transfère pas pour toi.

Utilise l’identifiant de projet de `tale.json` pour trouver le volume :

```bash
docker volume inspect <project-id>_backups
```

Le chemin de montage appartient à l’hôte Docker, qui peut être une VM ou une machine distante. Configure ton agent de sauvegarde à cet endroit sans supposer que le chemin existe sur ton poste. Vérifie que la copie externe contient `manifest.json`, toutes les archives qu’il cite et leurs fichiers de somme de contrôle. Sur les deux runtimes, `tale backup export` écrit aussi un snapshot sous forme d’un seul fichier que tu peux copier hors de l’hôte, comme le décrit [Déplacer un snapshot vers un autre hôte ou un autre runtime](#export-import).

La rotation locale garde les cinq snapshots les plus récents **et** ceux des 14 derniers jours. Un snapshot n’est supprimé que s’il dépasse les deux limites. Modifie `BACKUP_KEEP_COUNT` et `BACKUP_KEEP_DAYS` dans `.env` pour ajuster ces fenêtres ; configure séparément la rétention des copies externes.

## Restaurer les données et leur version

<Warning>

La restauration remplace le contenu des volumes inclus. Préserve l’état actuel si tu peux en avoir besoin et vérifie le workspace cible. Garde utilisateurs et intégrations planifiées à l’écart de l’environnement de reprise jusqu’à sa validation.

</Warning>

1. Récupère le snapshot complet, le dossier de déploiement, les clés correspondantes et les sauvegardes externes. Sur un nouvel hôte, suis d’abord la préparation décrite plus haut.
2. Lance `tale restore` pour choisir un identifiant et lire sa version de plateforme. Si elle est inconnue, retrouve-la dans tes traces de déploiement avant de démarrer l’application.
3. Restaure avec le stack arrêté. `--stop` arrête les conteneurs du projet en cours d’exécution, en redémarrage ou en pause ; la CLI vérifie ensuite les sommes de contrôle et demande confirmation avant de remplacer les données. Utilise ta CLI actuelle, avant que l’étape 5 la change : une CLI antérieure à la capture du stockage de la passerelle ignore son archive.

```bash
tale restore <snapshot-id> --stop
```

4. Restaure les bases et buckets externes au point de reprise coordonné, sans rouvrir le trafic. Un snapshot marqué `without blobs` laisse le volume local de fichiers existant intact. Un snapshot marqué `without gateway` laisse `llm-gateway-data` intact et ne peut pas ramener la passerelle au stockage qu’elle avait avant sa mise à niveau ; la CLI le signale avant de demander confirmation. Si la passerelle a été mise à niveau après ce snapshot, remets ta propre copie du volume en place avant l’étape suivante, comme l’explique [Mises à niveau](/fr/self-hosted/operate/upgrades).
5. Sélectionne la version indiquée dans le snapshot et déploie-la, y compris les services persistants :

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

La version compte : un backend plus récent peut appliquer des migrations dès son démarrage. Restaurer les données puis lancer une image actuelle choisie arbitrairement ne rétablit pas l’état enregistré. La CLI restaure les anciennes archives de configuration `convex-data` dans le volume actuel `config-data`.

## Snapshots sur Incus {#incus}

Dans un workspace qui tourne sur Incus, `tale backup`, `tale restore` et le snapshot qui précède un `tale deploy` changeant de version utilisent les snapshots de volumes propres à Incus. Les commandes, la liste et les réglages de rétention restent les mêmes ; ce qu’est un snapshot, le déroulement d’une restauration et ce qu’elle exige diffèrent.

### Ce que contient un ensemble natif {#incus-sets}

Sur Incus, un snapshot est un ensemble : un snapshot natif de chaque volume de données de la stack, dont ceux de l’inventaire ci-dessus, tous pris pendant que les services en marche qui utilisent ces volumes sont gelés. Le gel dure bien moins d’une seconde, et non le temps d’une archive ; ensuite, le snapshot attend que chaque service qui était en bonne santé le soit de nouveau. Un manifeste dans le volume `backups` nomme l’ensemble. Les volumes que la CLI écrit elle-même (les enregistrements des résolveurs, les listes d’upstreams du switch de trafic et les identifiants du spawner sandbox) ne font jamais partie d’un ensemble, car la CLI les réécrit à partir de la déclaration.

Un snapshot natif vit sur son volume, dans le même pool de stockage : il ne survit donc pas à la perte du pool ou de l’hôte. `tale backup --archive` écrit en plus une archive `tar.gz` de chaque volume dans `backups`, avec son SHA-256, au même format que sur Docker. `tale restore` marque chaque snapshot listé comme `native` ou `native + archive`. Les snapshots qu’Incus prend selon son propre calendrier (`snapshots.schedule` dans `runtime.incus.volumes`) ne sont pas des ensembles : `tale restore` ne les liste ni ne les fait tourner, et Incus les fait expirer selon `snapshots.expiry`.

La rotation garde les mêmes fenêtres que sur Docker (`BACKUP_KEEP_COUNT`, `BACKUP_KEEP_DAYS`). Elle supprime ensemble les snapshots natifs et les archives d’un ensemble expiré, ainsi qu’un volume mis de côté par une restauration dès qu’aucun snapshot conservé n’y vit plus.

### Restaurer sur Incus {#incus-restore}

Sur Incus, une restauration ne ramène jamais un volume en arrière sur place : les snapshots plus récents que celui que tu restaures restent donc disponibles. Pour chaque volume, `tale restore <snapshot-id> --stop` arrête les services qui l’utilisent, chacun dans son délai de grâce, et détache le volume. Il met le volume de côté sous le nom `<volume>.pre-restore-<horodatage>`, qui emporte son historique de snapshots, et copie le snapshot (ou extrait son archive) dans un volume neuf portant le nom d’origine. Il rattache ensuite le volume et redémarre les services. Sans `--stop`, la restauration refuse tant qu’un service utilise l’un des volumes.

Le volume mis de côté garde l’intégralité des données précédentes : une restauration demande donc environ deux fois la place du volume. Avant de changer quoi que ce soit, la restauration vérifie que l’espace libre du pool et ce qui reste de chaque quota de disque que le projet fixe (`limits.disk.pool.<pool>`, `limits.disk`) dépassent la taille des copies plus 10 %, et refuse sinon.

Chaque étape est consignée dans le journal comme restauration en attente. Quand une restauration s’arrête en cours de route, après un plantage, une connexion perdue ou un pool plein, `tale deploy`, `tale start`, `tale rollback`, `tale runtime migrate` et un nouveau snapshot refusent, et `tale status` nomme l’étape de chaque volume. Rien ne recrée entre-temps un volume de données manquant à vide. Termine la restauration, ou annule-la pour que chaque volume redevienne tel qu’il était :

```bash
tale restore --resume
tale restore --abort
```

Déploie ensuite la version que le snapshot a enregistrée, comme le décrit l’étape 5 de [Restaurer les données et leur version](#restaurer-les-donnees-et-leur-version).

`tale backup prune` liste les volumes que des restaurations ont mis de côté, avec les snapshots qui y vivent encore, et supprime, après confirmation, ceux sur lesquels ne vit plus aucun snapshot listé ; `--dry-run` se contente de les lister, `--yes` saute la question. Un volume mis de côté qui porte encore un snapshot listé n’est jamais supprimé.

## Déplacer un snapshot vers un autre hôte ou un autre runtime {#export-import}

`tale backup export` écrit un snapshot sous forme d’un seul fichier : un `tar` de son manifeste et de l’archive `tar.gz` de chaque volume, chaque archive étant vérifiée par rapport à son SHA-256 à la sortie. Sur Incus, l’export écrit d’abord les archives qui manquent à un ensemble natif, à partir de copies de ses snapshots ; les snapshots natifs eux-mêmes ne quittent jamais l’hôte. L’export n’écrase jamais un fichier.

```bash
tale backup export <snapshot-id> --to tale-snapshot.tar
```

Sans `--to`, le fichier s’appelle `tale-snapshot-<snapshot-id>.tar`, dans le dossier courant. Dans le workspace de destination, `tale backup import` lit le fichier dans `backups`, vérifie chaque archive par SHA-256 à son arrivée et écrit le manifeste en dernier, si bien qu’un import interrompu n’est jamais listé. Il refuse un identifiant de snapshot que le workspace possède déjà. Sur Incus, déploie d’abord le workspace une fois, pour que son volume `backups` existe. Restaure ensuite comme d’habitude :

```bash
tale backup import tale-snapshot.tar
tale restore <snapshot-id> --stop
```

Le format est le même sur les deux runtimes : un fichier exporté sur Docker se restaure sur Incus et inversement, avec le même `.env`, les mêmes clés et la même version des deux côtés. [`tale runtime migrate`](/fr/self-hosted/install/incus#migrate) enchaîne lui-même ces étapes quand il fait passer un workspace de Docker à Incus.

## Savoir ce que garde une réinitialisation {#reset}

`tale reset --all` supprime les volumes de données, et `tale uninstall --purge` démonte tout le projet. Ce qui reste dépend du runtime :

| Runtime | Supprimé | Conservé |
| --- | --- | --- |
| Docker | Les volumes de données. | Le volume `<project-id>_backups` avec chaque snapshot. |
| Incus | Les volumes de données, et avec eux chaque snapshot natif qui y vit. | Le volume `backups`, avec l’archive de l’ensemble le plus récent et chaque archive et manifeste qu’il contenait déjà, ainsi que les volumes mis de côté par des restaurations. |

Sur Incus, la réinitialisation archive d’abord l’ensemble le plus récent dans `backups` et vérifie l’archive. Si cela échoue, elle refuse et ne supprime rien ; `--discard-snapshots` supprime quand même les volumes et perd leurs snapshots natifs. Un ensemble plus ancien sans archive ne peut plus être restauré une fois ses volumes partis, sauf s’il vit sur un volume qu’une restauration a mis de côté : archive donc avec `tale backup --archive` ce que tu veux garder avant de réinitialiser. Le `tale deploy` suivant crée des volumes de données vides, et `tale restore` liste le snapshot archivé.

## Valider la reprise avant de rouvrir le trafic

Lors d’un exercice isolé, connecte-toi, ouvre une conversation connue, télécharge un ancien fichier, vérifie la configuration d’une organisation et lance une recherche contrôlée dans les connaissances. Vérifie l’accès aux secrets des fournisseurs et aux stockages externes sans déclencher de notifications ou d’automatisations de production. Note la période de données perdue, le temps de reprise et chaque étape manuelle.

Répète l’exercice après une modification importante du stockage, des clés ou du déploiement, et à la fréquence qu’imposent tes objectifs. [Mises à niveau](/fr/self-hosted/operate/upgrades) explique le choix de version ; [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) aide lorsqu’un service restauré ne devient pas opérationnel.
