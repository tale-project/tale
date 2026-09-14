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

Si le nouveau groupe ne devient pas sain avant `HEALTH_CHECK_TIMEOUT`, la CLI ne termine pas la bascule. Examine l’état enregistré et les journaux avant de réessayer. Un déploiement interrompu peut laisser les deux groupes ou un transfert en attente. Suis les indications de reprise de la CLI plutôt que de supprimer manuellement conteneurs ou fichiers d’état.

## Vérifier les migrations et le résultat utilisateur

Le backend applique les migrations SQL numérotées au démarrage sous un verrou consultatif de session. Les autres réplicas attendent cette étape. Une erreur de migration empêche le nouveau backend de démarrer normalement ; examine l’erreur et la base avant de réessayer. Changer un tag d’image n’annule pas des migrations conçues pour avancer uniquement.

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

## 0.4 → 0.5 : une installation séparée

En 0.5, Postgres a remplacé l’ancien stockage applicatif Convex. Aucun importeur ne permet une mise à niveau directe entre ces bases. Garde l’ancienne instance et ses sauvegardes intactes pendant que tu prépares un déploiement neuf, avec un workspace et des données séparés.

Recrée organisations et utilisateurs, examine et transfère la configuration compatible, puis réimporte les documents nécessaires. Des fichiers laissés dans un bucket externe ne reçoivent pas automatiquement de références dans la nouvelle base applicative. Valide l’environnement de remplacement avant de retirer l’ancien.

La CLI refuse ce changement non pris en charge par défaut. L’option experte `--accept-data-loss` n’est pas un outil de migration et ne préserve pas les anciennes données applicatives. Des volumes ou bases historiques peuvent subsister après de précédentes mises à niveau ; leur seule présence ne justifie pas de les supprimer pendant cette procédure.
