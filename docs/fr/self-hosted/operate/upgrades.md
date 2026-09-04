---
title: Montées de version
description: Comment `tale update` fait avancer une instance Tale — l'alignement automatique de version entre la CLI et l'instance, le pattern de redémarrage rolling, quoi faire avant une montée de version et l'histoire de la compatibilité de versions.
---

Les montées de version sur une instance Tale auto-hébergée passent par deux commandes : `tale update` bouge le binaire CLI à la nouvelle version et synchronise tes fichiers projet pour correspondre, puis `tale deploy` roule les conteneurs plateforme. Le déploiement utilise un pattern blue-green — la nouvelle couleur démarre à côté de l'ancienne, les healthchecks passent, le trafic bascule, l'ancienne couleur draine. Zéro downtime est le défaut ; si une release patch se comporte mal, `tale rollback` ramène le patch précédent en une commande, et tout ce qui est plus gros se récupère depuis le snapshot pré-upgrade.

**Une exception dure :** il n'existe aucun chemin de montée de version vers la 0.5 depuis une ligne antérieure. La 0.5 est une rupture qui exige un déploiement neuf — lis [0.4 → 0.5 : rupture de version](#04--05--rupture-de-version) avant toute chose si ton instance est en 0.4.x ou plus ancienne (la 0.4 était la rupture précédente du même genre, qui a coupé la 0.3.x).

Ce que tu ne fais plus, c'est garder la CLI synchronisée à la main : la CLI s'aligne elle-même sur l'instance automatiquement (voir plus bas), donc le seul pas délibéré est de choisir quand bouger de version avec `tale update`.

L'installation de la CLI vit dans [Installer la CLI tale](/fr/self-hosted/install/cli-install). Cette page couvre ce que fait chaque commande et comment le modèle de versions fonctionne.

## La CLI suit l'instance automatiquement

Le binaire CLI est toujours à la même version que l'instance qu'il gère. Le workspace enregistre cette version dans `tale.json` ; à chaque commande, la CLI compare sa propre version à celle-là et, si elles diffèrent, se met à jour pour correspondre (en montant ou en descendant) avant de tourner. Quand elles correspondent déjà — le cas largement le plus fréquent — c'est un no-op sans appel réseau, donc tu ne le remarques jamais.

Cela veut dire que tu lances rarement `tale update`, sauf quand tu veux délibérément bouger vers une nouvelle version. Un coéquipier qui a installé une CLI plus récente que ton instance, ou restauré un snapshot plus ancien, obtient la bonne version de CLI automatiquement à sa prochaine commande. Il n'y a aucun flag pour désactiver ça — garder l'outil et l'instance au pas l'un de l'autre est ce qui rend les déploiements sûrs.

## Avant de monter de version

Deux choses valent la peine d'être confirmées d'abord :

- Ta copie hors-hôte du volume `backups` est à jour — voir [Backups et restauration](/fr/self-hosted/operate/backups-and-restore). `tale update` snapshotte automatiquement les volumes de données avant toute étape qui peut migrer des données, mais le snapshot vit sur le même hôte ; la copie hors-hôte est ce qui survit à un disque mort.
- Les notes de version pour la version cible ne nomment pas un changement breaking. Les notes sont liées depuis la page de release GitHub ; les changements breaking sont flaggés comme tels en haut.

Si la montée de version traverse une version majeure (1.x → 2.x), lis les notes de migration de bout en bout avant de commencer. Les versions majeures sont où atterrissent les migrations de schéma et les changements de format de fichier de config.

## Les deux commandes

`tale update` met à jour le binaire CLI, puis synchronise tes fichiers projet sur les templates de cette version. Il ne **touche pas** aux conteneurs en marche — c'est le boulot de `tale deploy`. Si la synchro des fichiers échoue, la CLI fait reculer son propre binaire à la version sur laquelle ton workspace était, pour que le binaire et `tale.json` ne dérivent jamais l'un de l'autre.

Lancée sans argument, la commande vise la release la plus récente **de ta ligne x.y actuelle** — une instance 0.3.x bouge vers la 0.3.x la plus récente. Les releases d'une ligne plus récente peuvent porter des changements breaking, donc la commande ne franchit jamais cette frontière d'elle-même : quand une ligne plus récente existe, elle le dit et reste en place. Changer de ligne est un pas délibéré — lis d'abord les notes de version de la nouvelle ligne, puis fixe la version cible avec `--version`.

```bash
# Bouge la CLI et les fichiers projet à la release la plus récente de la ligne x.y actuelle
tale update

# Fixe une version précise — le seul moyen de changer de ligne (autorise les downgrades — voir Rollback)
tale update --version 0.10.2

# Aperçu du changement de version et de la synchro des fichiers sans rien toucher
tale update --dry-run
```

`tale deploy` fait le vrai redémarrage rolling, et il déploie toujours la version propre à la CLI — qui, grâce à l'alignement, est la version qu'enregistre ton workspace. Il trie les services en trois étages :

- **Étage app** — `platform` — roule à **chaque** déploiement, sans downtime (blue-green : la nouvelle couleur démarre à côté de l'ancienne, les healthchecks passent, le trafic bascule, l'ancienne couleur draine).
- **Backend et compute** — `backend-api`, `backend-worker`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` — roulent à chaque déploiement eux aussi, pour ne jamais dériver en version d'avec `platform`. Chacun se recrée **en place** quand son image a réellement changé ; le déploiement draine d'abord le travail en cours (tours de chat pour le backend, runs d'agent pour `sandbox`) pour que le bref redémarrage ne coupe pas une requête en vol.
- **Étage à arrêt requis** — `db`, `object-store`, `proxy` — laissés **en marche et intacts** par défaut (recréer Postgres, le store de blobs ou le proxy est une brève coupure que tu ne veux pas sur un roll de routine). Passe `--stop` pour les mettre à jour ; le déploiement prévient et les nomme quand il les saute.

```bash
# Après tale update, roule les conteneurs pour correspondre (étage app + backend)
tale deploy

# Mets aussi à jour db/proxy (brève coupure pendant qu'ils se recréent)
tale deploy --stop

# Roule seulement des services spécifiques
tale deploy --services platform

# Aperçu sans changement
tale deploy --dry-run
```

`--dry-run` mérite d'être lancé avant chaque montée de version en production — il fait remonter les images manquantes, les migrations manquantes et les mismatches de dépendances sans toucher aux conteneurs en marche.

## Le pattern blue-green

Une instance en marche est l'une des deux couleurs (blue ou green) à un instant donné. La phase de déploiement monte l'autre couleur, attend qu'elle passe les healthchecks, puis bascule l'upstream de Caddy sur la nouvelle couleur. L'ancienne couleur draine ses requêtes en vol (défaut 30 s), puis sort.

Trois garanties que le pattern te donne :

- **Aucune fenêtre où les deux couleurs servent du trafic.** Un constraint de base impose single-active — Caddy route vers la saine.
- **Le rollback de patch est une commande.** `tale rollback` redéploie la release patch précédente sur la couleur inactive et rebascule le trafic. Il refuse les downgrades minor et major — ceux-là peuvent laisser la base en avance sur le binaire, et leur chemin de récupération est une restauration de snapshot.
- **Les healthchecks échoués bloquent la bascule.** Si la nouvelle couleur ne passe pas dans le timeout, le déploiement abandonne et l'ancienne couleur continue à servir.

La procédure complète de déploiement, y compris la phase de cleanup, vit dans `tale --help` ; la recette côté opérateur est `tale update && tale deploy && tale status` et confirmation visuelle dans le navigateur.

## Comment les changements de schéma arrivent sur un déploiement

Les changements de schéma de la base de données ne sont pas une étape séparée que tu exécutes. Le backend de chaque version applique ses propres migrations SQL **au démarrage**, sous un verrou consultatif : les conteneurs api et worker (et toute réplique mise à l'échelle) les appliquent exactement une fois pendant que les autres attendent. Un conteneur déployé est donc toujours sur son propre schéma — il n'y a rien à vérifier, appliquer ou rattraper à la main.

Les migrations sont **uniquement vers l'avant** et écrites pour être sûres sous un déploiement progressif : la version précédente continue de servir pendant que la nouvelle migre, donc une version ne livre jamais un changement qui casse celle qu'elle remplace. Revenir EN ARRIÈRE d'une version est une restauration de snapshot, pas une migration descendante — c'est pourquoi `tale rollback` refuse les downgrades mineurs et majeurs (voir ci-dessous).

```bash
# Reprovisionner les valeurs par défaut intégrées dans chaque organisation (idempotent).
# La même étape que chaque déploiement exécute — à la demande.
tale migrate
```

Si le backend ne peut pas appliquer une migration, il ne démarre pas, et le healthcheck du déploiement bloque le basculement du trafic : l'ancienne couleur continue de servir pendant que tu lis `docker compose logs` et corriges la cause. Rien de à moitié migré n'est jamais mis devant les utilisateurs.

## Rollback

```bash
# Retour à la version patch précédente (demande confirmation)
tale rollback

# Ignorer l'invite en mode non-interactif
tale rollback --yes
```

`tale rollback` est limité aux pas de patch : il ne cible que la version précédente enregistrée, et refuse si cette version ne partage pas `major.minor` avec la plateforme qui tourne. Les releases patch ne portent jamais de migrations, donc redéployer le patch précédent est toujours sûr. Tout ce qui est plus gros peut avoir migré les données vers l'avant — déployer un binaire plus vieux sur des données migrées corrompt l'instance au lieu de la sauver. Pour ces cas, le chemin de récupération est de restaurer le snapshot pré-upgrade et de revenir à la version qui lui correspond avec `tale update --version <version>` suivi de `tale deploy --stop` (pour que `db`/`proxy` reculent aussi) ; le message de refus imprime les commandes exactes, et le walk complet vit dans [Backups et restauration](/fr/self-hosted/operate/backups-and-restore).

Comme le rollback démolit les conteneurs en cours d'exécution, la commande prévient de ce qu'elle s'apprête à faire et demande confirmation avant de tirer la moindre image ; passe `--yes` pour ignorer cette invite dans les scripts ou en CI.

## Compatibilité de versions

Les versions Tale sont en semver. Les règles de compatibilité :

- Patch (`0.9.0 → 0.9.1`) — pas de migrations, pas de changements de config, `tale rollback` est toujours sûr.
- Minor (`0.9.x → 0.10.x`) — peut inclure des migrations forward-only ; `tale rollback` refuse, la récupération est restauration-de-snapshot plus redéploiement.
- Major (`0.x → 1.x`) — lis les notes de migration, planifie la fenêtre de maintenance, attends-toi à des surprises.
- **La baseline 0.5.0** — les versions sous la 0.5.0 et les versions à partir de la 0.5.0 sont deux mondes séparés : aucune montée ni descente entre eux, voir la section rupture ci-dessous.

Sauter des versions mineures (passer de 0.9 à 0.11) est supporté tant que les migrations de schéma intermédiaires sont encore dans l'image ; les notes de version le mentionnent quand ce n'est pas le cas. La baseline 0.5.0 est le cas permanent de cette exception : le store applicatif lui-même a changé à la 0.5, donc aucune release 0.5+ ne peut lire ce qui existait avant.

Pour descendre _délibérément_ d'une version — disons qu'une release minor se comporte mal — fixe la cible avec `tale update --version <version>`. La commande prévient quand la cible est plus ancienne que la version qui tourne ; ne descends que vers une version dont les migrations de schéma sont un préfixe de ce que la base a appliqué, ou restaure un snapshot de volume antérieur à la montée. Descendre sous la 0.5.0 traverse la rupture à rebours et n'est pas supporté : une release 0.4.x ne peut pas lire des données créées par la 0.5+ — restaure un snapshot pré-0.5 ou déploie la 0.4.x à neuf.

## 0.4 → 0.5 : rupture de version

La 0.5 a remplacé le runtime et le store du backend applicatif : les données applicatives vivent désormais dans Postgres, là où la 0.4 les gardait dans la base propre du service Convex embarqué. Aucun importateur ne relie les deux, donc **une instance 0.4.x ne peut pas être montée en place — la 0.5 exige un déploiement neuf.**

**Ce que ça veut dire concrètement :**

- `tale deploy` avec une CLI 0.5+ **refuse** de toucher une instance dont la version qui tourne est sous la 0.5.0, avant de tirer une image ou d'écrire quoi que ce soit.
- Rien de la base d'une instance 0.4 n'est repris : chats, automatisations et leur historique d'exécution, entrées de connaissance, historique des tâches, utilisateurs et connexions. L'**arbre de configuration** de l'organisation (agents, skills, fournisseurs, politiques de gouvernance) vit en fichiers sur le volume de configuration partagé et suit, lui ; les fichiers d'un bucket BYO-S3 restent physiquement dans le bucket, mais la nouvelle instance n'a aucune référence vers eux.
- La ligne 0.4.x reste maintenue pour la sécurité et les correctifs critiques sur la branche `release/0.4` — rester en 0.4.x un moment est un choix supporté ; passer à la 0.5 est un ré-embarquement, pas une montée de version.

**Passer à la 0.5 :**

```bash
# 1. Laisser l'instance 0.4 intacte (elle continue de servir).
# 2. Créer un NOUVEAU répertoire projet avec une CLI 0.5 :
mkdir tale-05 && cd tale-05
tale init
tale deploy

# 3. Ré-embarquer : organisations, utilisateurs (invitation / SSO),
#    configuration, re-téléversement des documents et connaissances.
# 4. Décommissionner l'instance 0.4 une fois la nouvelle validée.
```

Le contournement expert — `tale deploy --accept-data-loss` — existe pour le cas rare où tu réutilises délibérément un hôte dont tu as déjà traité les anciens volumes. Il fait exactement ce que son nom dit : les données pré-0.5 de cette instance deviennent définitivement illisibles.

**L'ancienne base `tale_platform`.** Chaque conteneur `tale-db` créait au démarrage une base `tale_platform` vide — la base que le service Convex embarqué utilisait en 0.4 et que rien dans la 0.5 ne lit. Les installations neuves ne la créent plus, et rien ne la supprime pour toi : une instance déployée d'abord avec une version 0.5 antérieure la porte encore, comme un hôte 0.4 réutilisé. Elle ne gêne pas. Quand tu es sûr de n'avoir plus besoin de rien de l'ère Convex, prends un snapshot puis supprime-la à la main — sur `db`, et sur `knowledge-db` si ton déploiement en a un :

```bash
tale backup
docker compose exec db psql -U tale -d tale -c 'DROP DATABASE IF EXISTS tale_platform;'
```

## Où cela s'inscrit

Le flow de montée de version noue chaque autre page d'exploitation — les backups sont ce qui rend une montée de version échouée récupérable, l'observabilité est ce qui te dit que la nouvelle couleur est saine, le durcissement est ce que tu reparcours après une version majeure. Si tu mets en place la CLI pour la première fois, [Installer la CLI tale](/fr/self-hosted/install/cli-install) couvre le setup côté workstation ; si tu prends le pager en plein rollout, [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) nomme les symptômes.
