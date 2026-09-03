---
title: Backups et restauration
description: Snapshots de volumes via `tale backup`, le snapshot automatique pré-migration, la rétention, la copie hors-hôte et le drill `tale restore`.
---

L'unité de backup de Tale est le snapshot de volume : un tar checksummé, pris à containers en pause, des volumes de données principaux de l'instance, écrit dans un volume `backups` dédié qui vit à côté des données qu'il protège. La CLI en prend un automatiquement avant toute étape de déploiement qui peut migrer des données, et `tale backup` en prend un à la demande. La récupération, c'est `tale restore <snapshot-id>` plus un redéploiement de la version correspondante — cette paire est la réponse à une montée de version échouée, et la raison pour laquelle `tale rollback` peut se permettre de refuser tout ce qui dépasse un pas de patch.

Le contexte d'architecture vit dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) ; cette page couvre ce qu'un snapshot contient, quand il est pris, comment la copie quitte l'hôte et le walk de restauration.

## Ce qu'un snapshot contient

| Volume                       | Contient                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-data`                    | Postgres — le magasin applicatif (agents, runs, l'audit log) et le corpus de connaissances (fragments de documents, embeddings, pages crawlées) |
| `convex-data`                | Config d'org, secrets de fournisseurs, branding téléversé                                                                                       |
| `caddy-data`, `caddy-config` | Certificats TLS et état du proxy                                                                                                                |

Chaque snapshot est un répertoire nommé comme `20260611-142530-deploy` dans le volume `backups` du projet : un `.tar.gz` par volume, un sidecar `.sha256` chacun et un `manifest.json` écrit en dernier. Un répertoire sans manifest est un snapshot incomplet — il n'apparaît jamais dans les listings et ne peut jamais être restauré. Le snapshot saute délibérément `object-store-data` — le store de blobs qui détient les fichiers téléversés et les médias générés — donc ces blobs demandent leur propre capture off-host, aux côtés des deux choses qui vivent entièrement hors des volumes : le workspace du projet (le répertoire qui contient `tale.json`) et `.env`.

## Quand les snapshots sont pris

`tale deploy` snapshotte avant sa première étape mutante dès que le déploiement peut changer des données : la version cible diffère de celle qui tourne, ou un push de config hôte (`--override` / `--override-all`) est demandé. Pendant que chaque volume est mis en tar, les conteneurs qui l'utilisent sont mis en pause quelques secondes pour que l'archive soit cohérente après crash — une copie à chaud d'un répertoire Postgres en marche n'est pas restaurable.

Un snapshot échoué interrompt le déploiement. `--skip-backup` outrepasse cela sur `tale deploy` — tes propres backups externes deviennent alors le seul chemin de récupération, et c'est exactement pour ça que le flag logge un avertissement bien visible.

```bash
# Prendre un snapshot tout de suite
tale backup
```

## Rétention

La rotation garde les cinq snapshots les plus récents et tout ce qui date des 14 derniers jours — selon ce qui est le plus généreux. Un snapshot n'est supprimé que s'il est à la fois au-delà de la fenêtre de compte et plus vieux que la fenêtre d'âge ; une instance calme garde donc ses derniers snapshots indéfiniment. Ajuste les fenêtres avec `BACKUP_KEEP_COUNT` et `BACKUP_KEEP_DAYS` dans `.env`.

## Copie hors-hôte

Les snapshots vivent sur le même hôte que les données qu'ils protègent — un disque mort emporte les deux. Pointe ton outillage de backup existant (Restic, Borg, Velero, snapshots de cloud provider) sur le volume `backups`, et capture le workspace du projet et `.env` dans le même job. Tale n'embarque pas d'étape d'upload — garder la copie hors-hôte sous ton contrat de backup existant est délibéré.

```bash
# crontab sur l'hôte — copie Restic horaire du volume backups vers S3
0 * * * * restic -r s3:s3.amazonaws.com/bucket/tale backup \
  /var/lib/docker/volumes/<project-id>_backups/_data
```

Trouve le chemin hôte du volume avec `docker volume inspect <project-id>_backups` ; l'id du projet vit dans `tale.json`.

## Restaurer un snapshot

`tale restore` sans argument liste ce qui est disponible ; avec un id, il vérifie les checksums, vide les volumes de données et extrait le snapshot. Il refuse tant qu'un conteneur du projet tourne — passe `--stop` pour les arrêter — et demande confirmation avant de toucher à quoi que ce soit.

```bash
# Voir ce qui est disponible
tale restore

# Arrêter le stack et restaurer
tale restore 20260611-142530-deploy --stop

# Remonter le stack sur la version qui correspond aux données
tale update --version 0.9.6
tale deploy --stop
```

Le redéploiement de la version correspondante fait partie de la restauration, ce n'est pas un extra optionnel : le snapshot a capturé les données exactement comme cette version de la plateforme les a laissées, et un binaire plus récent relancerait immédiatement ses migrations dessus. La sortie de la restauration imprime la version exacte enregistrée dans le manifest du snapshot.

## Drill de restauration

Fais tourner le drill trimestriellement sur un hôte non-production. Le drill n'est pas « un snapshot existe-t-il » — c'est « un hôte frais peut-il être reconstruit depuis la copie hors-hôte du volume `backups`, le workspace du projet et `.env` en moins d'une heure ». Les modes d'échec que le drill attrape : un job hors-hôte qui n'a jamais capturé le workspace, et un `.env` périmé qui ne correspond plus aux exigences du binaire courant.

## Où cela s'inscrit

Les snapshots sont la partie bon marché ; le drill de restauration est ce qui prouve qu'ils marchent, et la règle redéployer-la-version-correspondante est la seule chose à retenir — la récupération n'est jamais « faire reculer le binaire », c'est « restaurer les données et déployer la version à laquelle elles appartiennent ». Le flow de montée de version que ces snapshots protègent vit dans [Montées de version](/fr/self-hosted/operate/upgrades) ; la checklist de durcissement qui nomme les backups comme une ligne est dans [Durcissement](/fr/self-hosted/operate/security/hardening).
