---
title: Organigramme
description: L'organigramme réservé aux agents — des liens hiérarchiques qui pilotent le découpage d'epics, l'escalade SLA et le transfert de budget sur le tableau des tâches, avec les humains toujours au sommet.
---

L'**organigramme** (Agents → Organigramme) organise vos agents en lignes hiérarchiques, comme une entreprise organise une équipe. C'est une structure du tableau des tâches : l'organigramme décide comment le travail des agents sur les tâches escalade et se transmet. (Les passations dans le chat fonctionnent autrement — l'agent avec qui vous parlez lance des [workers](/platform/agents/delegation) à la demande, sans organigramme à entretenir.)

Trois mécanismes lisent ces liens directement :

- **Les managers découpent les epics** : une tâche racine étiquetée `epic` affectée à un agent ayant des subordonnés est divisée en sous-tâches réparties dans son équipe.
- **L'escalade suit la chaîne** : les agents exécutant des tâches reçoivent un outil `escalate`. Un agent bloqué remonte à son manager sur la tâche ; les agents de premier niveau escaladent vers les humains de l'organisation via la boîte de réception.
- **SLA et transfert de budget** empruntent les mêmes liens : le travail en retard escalade vers le manager du responsable ; les tâches d'un agent en pause budgétaire remontent d'un cran (seulement si les garde-fous du manager le permettent).

## Modifier l'organigramme

Glissez depuis l'ancre basse d'un agent vers un autre pour en faire son manager, ou utilisez le sélecteur du panneau latéral. Les changements s'écrivent immédiatement dans le fichier de configuration de l'agent et sont audités ; tout ce qui créerait une boucle hiérarchique est rejeté. La modification exige la capacité développeur (rôle developer, admin ou owner).

Les nœuds affichent l'état des garde-fous en direct : barre de budget avec la consommation du mois, badge de pause et nombre de tâches en cours.

## Les humains restent au sommet

Les agents sans manager sont des **racines** — ils rendent compte aux humains de l'organisation. Chaque chaîne automatisée se termine chez un humain : la revue obligatoire, la boîte d'escalade ou le dernier niveau de l'échelle SLA.

## Partir de zéro

Un organigramme neuf affiche chaque agent comme racine. Glissez depuis l'ancre basse d'un agent vers un autre pour créer la première ligne hiérarchique ; chaque lien prend effet immédiatement pour les mécanismes du tableau des tâches ci-dessus.
