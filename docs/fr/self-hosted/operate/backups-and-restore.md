---
title: Sauvegardes et restauration
description: Réunis les éléments nécessaires à la reprise, copie les snapshots de la CLI et restaure les données avec la bonne version de Tale.
---

Une instance Tale récupérable demande plus qu’une archive de base de données. Conserve ses fichiers, la configuration des organisations, le dossier de déploiement et les clés de déchiffrement, avec la version qui a écrit les données. Définis d’abord la perte de données et la durée de reprise acceptables, puis vérifie que tes sauvegardes et ta procédure respectent ces objectifs.

Ce guide couvre les snapshots de volumes Docker de la CLI utilisée dans un workspace. Si tu gères Compose toi-même, prévois une sauvegarde des mêmes stockages. Les bases et buckets externes exigent des sauvegardes séparées et coordonnées.

## Préparer un hôte de reprise vide

Récupère le workspace d’origine et vérifie que ta connexion Docker vise l’hôte de reprise. Garde les services arrêtés. Remplace `your-project-id` ci-dessous par l’ID d’origine de `tale.json`. Pour un snapshot de développement, utilise plutôt `TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}-dev_"`. Les noms de production et de développement sont distincts ; si les deux existent, la CLI choisit la production en premier.

```bash
TALE_RESTORE_PROJECT=your-project-id
TALE_RESTORE_PREFIX="${TALE_RESTORE_PROJECT}_"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}config-data"
docker volume create --label "project=$TALE_RESTORE_PROJECT" "${TALE_RESTORE_PREFIX}backups"
docker volume inspect "${TALE_RESTORE_PREFIX}backups"
```

Ces commandes préparent les volumes de configuration et de sauvegarde sans démarrer de backend ni appliquer de migration. Avec ton système de sauvegarde, restaure le contenu complet de `backups` dans ce volume. Le point de montage affiché appartient à l’hôte Docker, qui peut être distant. Conserve la structure des répertoires et les manifestes des snapshots. `tale restore` doit ensuite afficher le snapshot attendu. Pendant la restauration effective, la CLI crée les autres volumes cibles manquants après avoir vérifié le snapshot.

## Vérifier la portée du snapshot

`tale backup` capture les volumes du projet présents dans cet inventaire :

| Volume | Données incluses |
| --- | --- |
| `db-data` | Données applicatives et, dans le stack fourni pour un hôte, base de connaissances. |
| `knowledge-db-data` | Base de connaissances séparée lorsque ce volume existe, notamment avec Compose depuis les sources. |
| `config-data` | Configuration des organisations, fichiers de secrets associés pris en charge et identité visuelle. Les identifiants de fournisseurs stockés dans Postgres font partie de la sauvegarde de la base. |
| `object-store-data` | Fichiers importés et médias générés lorsque le stockage par défaut utilise le service fourni. |
| `caddy-data`, `caddy-config` | Certificats et état du proxy. |

Un snapshot contient une archive et son fichier de somme SHA-256 pour chaque volume capturé. `manifest.json`, écrit en dernier, indique la version de la plateforme lorsqu’elle peut être déterminée. Un dossier sans manifeste est incomplet : il ne figure pas dans la liste de restauration et la rotation peut le supprimer après la création d’un snapshot complet plus récent.

Conserve aussi le workspace qui contient `tale.json`, son `.env` et les fichiers de clés montés séparément. Garde notamment `ENCRYPTION_SECRET_HEX` et l’identité age nécessaire aux fichiers SOPS. `llm-gateway-data` et les espaces de travail des sandbox ne font pas partie de cet inventaire ; ajoute-les à ton plan si tu dois conserver leur état.

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

`backup` affiche le résultat. Sans identifiant, `restore` liste seulement les snapshots disponibles, leur version enregistrée et l’éventuelle absence des fichiers. Note l’identifiant du snapshot avec ceux des sauvegardes externes.

Pendant l’archivage d’un volume, le processus suspend les conteneurs qui l’utilisent. Les imports, téléchargements et opérations de base peuvent attendre pendant cette pause, dont la durée dépend de la quantité de données et du débit. Ces archives correspondent à un état de reprise après arrêt brutal par volume, pas à une transaction atomique entre tous les stockages. Pour obtenir un point de reprise coordonné, arrête les écritures et tâches planifiées ou utilise une fenêtre de maintenance qui couvre aussi les stockages externes.

Un `tale deploy` qui change de version ou remplace la configuration de l’hôte prend un snapshot avant ses modifications. L’échec du snapshot interrompt ce déploiement. `--skip-backup` contourne cette protection ; utilise cette option uniquement si ton plan de reprise fournit déjà la sauvegarde nécessaire.

## Conserver une copie hors de l’hôte

Les snapshots résident dans le volume Docker `backups` du projet. Une panne de l’hôte ou du disque peut détruire les données et les snapshots locaux ensemble. Copie les snapshots complets, la configuration du workspace et les clés dans ton système de sauvegarde externe protégé. Tale ne les transfère pas pour toi.

Utilise l’identifiant de projet de `tale.json` pour trouver le volume :

```bash
docker volume inspect <project-id>_backups
```

Le chemin de montage appartient à l’hôte Docker, qui peut être une VM ou une machine distante. Configure ton agent de sauvegarde à cet endroit sans supposer que le chemin existe sur ton poste. Vérifie que la copie externe contient `manifest.json`, toutes les archives qu’il cite et leurs fichiers de somme de contrôle.

La rotation locale garde les cinq snapshots les plus récents **et** ceux des 14 derniers jours. Un snapshot n’est supprimé que s’il dépasse les deux limites. Modifie `BACKUP_KEEP_COUNT` et `BACKUP_KEEP_DAYS` dans `.env` pour ajuster ces fenêtres ; configure séparément la rétention des copies externes.

## Restaurer les données et leur version

<Warning>

La restauration remplace le contenu des volumes inclus. Préserve l’état actuel si tu peux en avoir besoin et vérifie le workspace cible. Garde utilisateurs et intégrations planifiées à l’écart de l’environnement de reprise jusqu’à sa validation.

</Warning>

1. Récupère le snapshot complet, le dossier de déploiement, les clés correspondantes et les sauvegardes externes. Sur un nouvel hôte, suis d’abord la préparation décrite plus haut.
2. Lance `tale restore` pour choisir un identifiant et lire sa version de plateforme. Si elle est inconnue, retrouve-la dans tes traces de déploiement avant de démarrer l’application.
3. Restaure avec le stack arrêté. `--stop` arrête les conteneurs du projet ; la CLI vérifie ensuite les sommes de contrôle et demande confirmation avant de remplacer les données.

```bash
tale restore <snapshot-id> --stop
```

4. Restaure les bases et buckets externes au point de reprise coordonné, sans rouvrir le trafic. Un snapshot marqué `without blobs` laisse le volume local de fichiers existant intact.
5. Sélectionne la version indiquée dans le snapshot et déploie-la, y compris les services persistants :

```bash
tale update --version <snapshot-platform-version>
tale deploy --stop
tale status
```

La version compte : un backend plus récent peut appliquer des migrations dès son démarrage. Restaurer les données puis lancer une image actuelle choisie arbitrairement ne rétablit pas l’état enregistré. La CLI restaure les anciennes archives de configuration `convex-data` dans le volume actuel `config-data`.

## Valider la reprise avant de rouvrir le trafic

Lors d’un exercice isolé, connecte-toi, ouvre une conversation connue, télécharge un ancien fichier, vérifie la configuration d’une organisation et lance une recherche contrôlée dans les connaissances. Vérifie l’accès aux secrets des fournisseurs et aux stockages externes sans déclencher de notifications ou d’automatisations de production. Note la période de données perdue, le temps de reprise et chaque étape manuelle.

Répète l’exercice après une modification importante du stockage, des clés ou du déploiement, et à la fréquence qu’imposent tes objectifs. [Mises à niveau](/fr/self-hosted/operate/upgrades) explique le choix de version ; [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) aide lorsqu’un service restauré ne devient pas opérationnel.
