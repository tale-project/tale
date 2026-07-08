---
title: Versions d’agent
description: La vue Historique de l’éditeur d’agent — chaque enregistrement pris en instantané, avec un diff contre la version actuelle et une restauration en un clic.
---

Chaque enregistrement d’un agent crée un instantané. Le bouton **Historique** en haut à droite de l’éditeur d’agent ouvre ces instantanés du plus récent au plus ancien ; comparer montre ce qui a changé, et restaurer remplace l’état courant par une version passée. Il n’y a pas de distinction entre enregistrement manuel et automatique — chaque changement persisté est une version.

La mécanique est petite mais porteuse. La plupart des équipes ajustent les instructions d’un agent chaque semaine ; sans l’historique, l’équipe ne ferait jamais confiance aux modifications.

## Passer un changement en revue

Ouvre l’agent et clique sur **Historique**. La liste montre **Version actuelle** en haut et chaque **Version de l'instantané** antérieure en dessous, avec l’auteur et l’horodatage sur chaque ligne. Choisis un instantané et **Comparer les modifications** passe en revue les différences entre lui et la version actuelle — les champs modifiés se surlignent — avant que tu décides de restaurer.

## Restaurer une version

Depuis un instantané, clique sur **Restaurer cette version**. L’état courant de l’agent est remplacé par l’instantané — un toast confirme **Agent restauré depuis l'historique** — et la restauration atterrit sur la frise comme sa propre entrée, donc les restaurations s’additionnent, elles ne détruisent rien. Les chats déjà en cours sur la version précédente y restent jusqu’à leur fin ; la version restaurée s’applique à partir du chat suivant.

## Ce qui est versionné

Le versionnage couvre la configuration de l’agent : les instructions, la liste de modèles, la sélection d’outils, les réglages de connaissances, les amorces de conversation et les métadonnées. Il ne couvre pas les sources de connaissances sous-jacentes — remplacer un document depuis lequel l’agent récupère change ce que l’agent répond sans incrémenter la version de l’agent. Pour auditer un changement de connaissances, voir [Journaux d’audit](/fr/platform/admin/governance/audit-logs).

## Où ça se situe

Les versions sont le filet de sécurité de l’agent pour la même raison que git est celui du code : tout ce qui est enregistré est récupérable. La page à lire en regard est [Journaux d’audit](/fr/platform/admin/governance/audit-logs) — elle couvre la piste qui-a-fait-quoi à l’échelle de l’organisation ; l’Historique couvre la piste qu’était-ce, agent par agent.
