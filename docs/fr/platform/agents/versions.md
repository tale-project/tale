---
title: Versions d'agent
description: L'onglet History de l'agent — chaque changement instantané, avec comparaison et restauration pour toute version passée.
---

Chaque enregistrement d'un agent crée un instantané. L'onglet **History** de l'agent fait apparaître les instantanés en ordre chronologique inverse ; comparer deux instantanés montre le diff de ce qui a changé, et restaurer un instantané passé remplace l'état courant par cette version. Il n'y a pas de distinction enregistrement-manuel versus enregistrement-auto — chaque changement persisté est une version.

Le mécanisme est petit mais porteur. La plupart des équipes ajustent les instructions d'un agent chaque semaine ; sans l'historique, l'équipe ne ferait jamais confiance aux modifications.

## Un diff déroulé

Ouvre l'agent et passe à **History**. La liste montre **Current version** en haut et chaque **Snapshot version** précédent en dessous, avec l'auteur et l'horodatage par ligne. Clique deux lignes et **Compare changes** ouvre un diff côte à côte ; les champs changés ressortent. Ferme le diff pour revenir à la liste.

## Restaurer une version

Ouvre un instantané passé et clique **Restore this version**. L'état courant de l'agent est écrasé par l'instantané, et l'acte de restaurer crée lui-même un nouvel instantané sur la chronologie — les restaurations ne sont pas destructrices, juste additives. Les chats déjà en cours contre la version courante précédente continuent à tourner dessus jusqu'à leur fin ; la version restaurée s'applique aux nouveaux chats à partir de ce moment.

## Ce qui est versionné

La versioning couvre les instructions, les choix de modèle, les liaisons de connaissances, les bascules d'outils, les amorces de conversation et les métadonnées. Elle ne couvre pas les sources de connaissances sous-jacentes elles-mêmes — remplacer un document auquel l'agent est lié change ce que l'agent récupère sans incrémenter la version de l'agent. Pour auditer un changement de connaissances, voir [Journaux d'audit](/fr/platform/admin/governance/audit-logs).

## Où ça s'inscrit

Les versions sont le filet de sécurité de l'agent pour la même raison que git est celui du code : tout ce qui est enregistré est récupérable. La page compagne est [Journaux d'audit](/fr/platform/admin/governance/audit-logs) — elle couvre la piste qui-a-fait-quoi à l'échelle de l'organisation ; les versions couvrent la piste par-agent qu'est-ce-que-c'était.
