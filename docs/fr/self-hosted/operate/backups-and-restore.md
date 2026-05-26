---
title: Backups et restauration
description: Backups Postgres via le volume `db-backup`, ce qu'il faut capturer en plus, et le drill de restauration depuis un dump.
---

Le volume Postgres `db-data` est le seul morceau stateful dans une instance Tale qui compte pour les backups. Tout le reste — code Convex, définitions d'agents, fichiers téléversés référencés par la base — est soit re-dérivable depuis le repo source, soit logé sous `convex-data`, qui est principalement un cache. Une histoire de backup qui marche capture Postgres plus le répertoire `providers/` et la config opérateur sous `TALE_CONFIG_DIR`. Cette page est le drill.

Le contexte d'architecture vit dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) ; cette page couvre le snapshot réel, la copie hors-hôte et le walk de restauration.

## Quoi sauvegarder

| Chemin                | Source                          | Pourquoi                                              |
| --------------------- | ------------------------------- | ----------------------------------------------------- |
| Volume `db-data`      | Données Postgres                | Toute la base — agents, runs, audit, fichiers         |
| Volume `db-backup`    | Dumps Postgres                  | Où le dump planifié écrit                             |
| `providers/`          | Clés et config des fournisseurs | Secrets chiffrés et listes de modèles par fournisseur |
| `${TALE_CONFIG_DIR}/` | Branding, bornes de rétention   | Fichiers de config fixés par l'opérateur              |
| `.env`                | Toutes les variables d'env      | Requis pour redéployer sur un hôte frais              |

Les deux volumes sont gérés par Docker ; le répertoire `providers/` et `TALE_CONFIG_DIR` sont montés dans le conteneur plateforme depuis ton système de fichiers hôte. L'outillage de backup qui snapshotte les disques hôtes capture les trois d'un coup ; les outils volume-aware (`restic`, `velero`) ont besoin des deux.

## Dumps Postgres planifiés

Le conteneur `tale-db` ship un cron job qui écrit un `pg_dump` quotidien vers `/var/lib/postgresql/backup` — monté comme le volume `db-backup`. La rétention par défaut est de sept jours ; les dumps plus vieux sont taillés. Le planning convient à la plupart des équipes ; resserre-le en éditant la crontab du conteneur ou en faisant tourner un sidecar.

```bash
# Inspecte les dumps que le conteneur a produits
docker compose exec db ls -lh /var/lib/postgresql/backup
```

Chaque dump est un fichier SQL compressé nommé `tale-YYYYMMDD-HHMMSS.sql.gz`. Ils ne sont délibérément pas chiffrés au repos — chiffre-les avec ton outillage de backup existant sur le chemin vers hors-hôte.

## Copie hors-hôte

Le pattern supporté est ton outillage de snapshot existant (Restic, Borg, Velero, snapshots de cloud provider) pointé sur le disque hôte ou les volumes nommés. Tale ne ship pas d'étape d'upload — garder la copie hors-hôte sous ton contrat de backup existant est délibéré.

Un exemple Restic minimal qui écrit le volume de dump vers S3 toutes les heures :

```bash
# crontab sur l'hôte
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/tale_db-backup/_data
```

Capture `providers/`, `${TALE_CONFIG_DIR}` et `.env` dans le même job. Le premier drill de restauration te dira si le snapshot couvre ce dont tu avais besoin.

## Restaurer depuis un dump

La restauration remplace toute la base. Mets d'abord les conteneurs plateforme et convex en bas, restaure Postgres isolément, puis remonte tout.

```bash
# 1. Arrête tout ce qui écrit dans la DB
docker compose stop tale-platform tale-convex

# 2. Drop la DB existante et recrée-la vide
docker compose exec db psql -U tale -c "DROP DATABASE tale;"
docker compose exec db psql -U tale -c "CREATE DATABASE tale;"

# 3. Pipe le dump en retour
docker compose exec -T db gunzip -c \
  /var/lib/postgresql/backup/tale-20250126-020000.sql.gz \
  | docker compose exec -T db psql -U tale -d tale

# 4. Remonte le reste
docker compose up -d
```

La première requête après le redémarrage réchauffe les caches de la plateforme ; attends-toi à ce que l'UI se sente lente la première minute. Les entrées d'audit log font partie du dump, donc l'instance restaurée a tout l'historique.

## Drill de restauration

Fais tourner le drill trimestriellement sur un hôte non-production. Le drill n'est pas « le dump existe-t-il » — c'est « un hôte frais peut-il être reconstruit depuis le snapshot et un checkout propre en moins d'une heure ». Les deux modes d'échec que le drill attrape : un snapshot `providers/` manquant (clés de fournisseur disparues), et un `.env` périmé qui ne correspond plus aux exigences du binaire courant.

## Où cela s'inscrit

Les backups sont la partie bon marché ; le drill de restauration est la partie chère, et la seule qui prouve que le backup marche. La checklist de hardening qui nomme les backups comme une ligne vit dans [Durcissement](/fr/self-hosted/operate/security/hardening). Si tu conçois un setup multi-hôte, l'architecture vit dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture).
