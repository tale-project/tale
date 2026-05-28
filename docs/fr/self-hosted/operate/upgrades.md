---
title: Montées de version
description: Comment `tale upgrade` et `tale deploy` font avancer une instance Tale — le pattern de redémarrage rolling, quoi faire avant une montée de version et l'histoire de la compatibilité de versions.
---

Les montées de version sur une instance Tale auto-hébergée passent par la CLI `tale` en deux étapes : `tale upgrade` pour bouger le binaire lui-même à la nouvelle version, puis `tale deploy` pour rouler les conteneurs plateforme pour correspondre. Le déploiement utilise un pattern blue-green — la nouvelle couleur démarre à côté de l'ancienne, les healthchecks passent, le trafic bascule, l'ancienne couleur draine. Zéro downtime est le défaut ; le rollback vers la couleur précédente est une commande unique si un smoke check échoue.

L'installation de la CLI vit dans [Installer la CLI tale](/fr/self-hosted/install/cli-install). Cette page couvre ce que fait chaque sous-commande et l'ordre dans lequel les exécuter.

## Avant de monter de version

Deux choses valent la peine d'être confirmées d'abord :

- Un backup fonctionnel a atterri dans les dernières 24 heures — voir [Backups et restauration](/fr/self-hosted/operate/backups-and-restore). Les montées de version qui échouent en milieu de migration sont rares, mais le chemin de recovery est « restaurer depuis le dump ».
- Les notes de version pour la version cible ne nomment pas un changement breaking. Les notes sont liées depuis la page de release GitHub ; les changements breaking sont flaggés comme tels en haut.

Si la montée de version traverse une version majeure (1.x → 2.x), lis les notes de migration de bout en bout avant de commencer. Les versions majeures sont où atterrissent les migrations de schéma et les changements de format de fichier de config.

## Les deux commandes

`tale upgrade` met à jour le binaire CLI lui-même. La version plateforme déployée correspond à la version de la CLI — ce couplage est intentionnel, pour que la CLI que tu lances ne puisse pas déployer une version qu'elle ne connaît pas.

```bash
# Bouge la CLI à la dernière release
tale upgrade

# Puis roule la plateforme pour correspondre
tale deploy
```

`tale deploy` fait le redémarrage rolling réel : il pull les nouvelles images, démarre la nouvelle couleur blue ou green à côté de celle qui tourne, attend les healthchecks, bascule le proxy, draine et retire l'ancienne couleur. Le défaut cible les services rotables (`platform`, `rag`, `crawler`) ; les services stateful (`db`, `proxy`) ont besoin de `--all` pour être mis à jour en place.

```bash
# Inclus les services stateful
tale deploy --all

# Roule seulement des services spécifiques
tale deploy --services platform,rag

# Aperçu sans changements
tale deploy --dry-run
```

`--dry-run` mérite d'être lancé avant chaque montée de version en production — il fait remonter les images manquantes, les migrations manquantes et les mismatches de dépendances sans toucher aux conteneurs en marche.

## Le pattern blue-green

Une instance en marche est l'une des deux couleurs (blue ou green) à un instant donné. `tale deploy` monte l'autre couleur, attend qu'elle passe les healthchecks, puis bascule l'upstream de Caddy sur la nouvelle couleur. L'ancienne couleur draine ses requêtes en vol (défaut 30 s), puis sort.

Trois garanties que le pattern te donne :

- **Aucune fenêtre où les deux couleurs servent du trafic.** Un constraint de base impose single-active — Caddy route vers la saine.
- **Le rollback est inverser un fichier d'état.** `tale rollback` re-bascule l'upstream ; l'ancienne couleur tourne encore quelques minutes après un déploiement au cas où tu doives revenir.
- **Les healthchecks échoués bloquent la bascule.** Si la nouvelle couleur ne passe pas dans le timeout, le déploiement abandonne et l'ancienne couleur continue à servir.

La procédure complète de déploiement, y compris la phase de cleanup, vit dans `tale --help` ; la recette côté opérateur est `tale deploy && tale status` et confirmation visuelle dans le navigateur.

## Rollback

```bash
# Retour à la version précédente
tale rollback

# Ou pin sur une version spécifique
tale rollback --version 0.9.0
```

Le rollback est rapide (c'est juste basculer la couleur) mais ne défait pas les migrations de schéma. Si la montée de version a fait tourner une migration que l'ancienne version ne comprend pas, le rollback laisse la base en avance sur le binaire — l'ancienne version refuse de démarrer. Les notes de version nomment quand ça se produit ; pour ces montées de version, restaurer-depuis-dump est le vrai chemin de rollback.

## Compatibilité de versions

Les versions Tale sont en semver. Les règles de compatibilité :

- Patch (`0.9.0 → 0.9.1`) — pas de migrations, pas de changements de config, le rollback est toujours sûr.
- Minor (`0.9.x → 0.10.x`) — peut inclure des migrations forward-only ; le rollback restaure le binaire mais pas le schéma.
- Major (`0.x → 1.x`) — lis les notes de migration, planifie la fenêtre de maintenance, attends-toi à des surprises.

Sauter des versions mineures (passer de 0.9 à 0.11) est supporté tant que les migrations intermédiaires sont encore dans le binaire ; les notes de version le mentionnent quand ce n'est pas le cas.

## Où cela s'inscrit

Le flow de montée de version noue chaque autre page d'exploitation — les backups sont ce qui rend une montée de version échouée récupérable, l'observabilité est ce qui te dit que la nouvelle couleur est saine, le durcissement est ce que tu reparcours après une version majeure. Si tu mets en place la CLI pour la première fois, [Installer la CLI tale](/fr/self-hosted/install/cli-install) couvre le setup côté workstation ; si tu prends le pager en plein rollout, [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) nomme les symptômes.

## Migration vers la disposition de config org-first

Les anciennes versions de Tale stockaient la config dans une arborescence plate à la racine du workspace (`agents/`, `workflows/`, `integrations/`, `branding/`, `providers/`, `skills/`). La version actuelle utilise une disposition **org-first** où chaque org — y compris la canonique `default` — possède son propre sous-arbre : `<root>/<org>/<domain>/...`. La migration est opt-in et tourne une seule fois par workspace. La nouvelle plateforme refuse de lire les anciens chemins ; tant que tu n'as pas migré, tes secrets de provider et personnalisations vivent dans des répertoires que le runtime ne regarde plus.

La migration tient en trois commandes. Pour l'étape 1, le conteneur Convex de l'**ancienne** image doit encore tourner — garde la plateforme en ligne sur l'ancienne version et lance l'étape 1 contre ce conteneur en cours avant de monter de version.

```bash
# 1. Copier les secrets de provider depuis la disposition plate vers
#    `default/providers/...`. cp et non mv, donc les anciens chemins
#    restent intacts au cas où un rollback serait nécessaire. Le scope
#    couvre uniquement les secrets de provider ; tous les autres
#    domaines (agents, workflows, integrations, skills, branding,
#    retention) sont re-seedés côté serveur à l'étape 2 depuis le
#    catalogue builtin.
tale migrate config-layout

# 2. Recréer le conteneur Convex contre la disposition de volume org-first
#    et lancer le reseed côté serveur sur chaque org enregistrée. Implique
#    `--all` ; `-y` saute le prompt destructif pour les runs CI / scripts.
tale deploy --override-all -y

# 3. Une fois la nouvelle disposition vérifiée intacte, supprimer les
#    anciens chemins. Vérifie byte-à-byte que le nouveau fichier
#    correspond à l'ancien avant unlink ; refuse de supprimer en cas
#    de mismatch.
tale migrate config-layout --cleanup-old
```

L'étape 1 est sûre et réversible — la rejouer est un no-op une fois les chemins existants. L'étape 2 est destructive : chaque config d'org au nom canonique (`*.json` sous `agents/`, `workflows/`, `integrations/`, `skills/`, `branding/branding.json`, `retention.json`) est écrasée par le catalogue builtin. Les fichiers `*.secrets.json`, les traces `.history/` et les `branding/images/*` uploadés sont préservés côté serveur. Après l'étape 2, la plateforme lit exclusivement depuis la disposition org-first.

L'étape 3 est le point de non-retour pour les downgrades — voir ci-dessous.

### Annuler la migration org-first

Entre les étapes 1 et 3, tu peux downgrader proprement. L'entrypoint Convex marque chaque run de seed avec un token qui inclut la version de disposition (`.seeded-<version>-orgfirst`) ; un binaire plus ancien qui ne reconnaît pas ce token re-seede idempotemment dans ses propres chemins (plats), et le `cp` de l'étape 1 a laissé les anciens chemins intacts. Le downgrade est un `tale rollback` normal.

Après l'étape 3 (`--cleanup-old`), les anciens chemins sont partis. Le downgrade continue à re-seeder la disposition correctement via le mécanisme du token-marker, mais l'app démarre avec des secrets de provider vides — restaure-les depuis le backup (voir [Backups et restauration](/fr/self-hosted/operate/backups-and-restore)) avant de reprendre le trafic.

### Et si je saute l'étape 1 ?

`tale deploy` et `tale start` refusent tous les deux de démarrer s'ils détectent des répertoires restants de la disposition plate (`agents/`, `workflows/`, `integrations/`, `branding/`, `providers/`, `skills/`, `retention/`) à la racine du workspace. L'erreur nomme les répertoires concernés et pointe vers ce runbook. La correction reste les étapes 1 + 2 dans cet ordre ; il n'existe pas de mode « déploie quand même et ignore les chemins legacy » — les résolveurs runtime ne lisent pas ces chemins, donc démarrer sans migrer laisserait la plateforme avec une config vide.
