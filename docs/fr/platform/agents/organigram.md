---
title: Organigramme
description: L'organigramme réservé aux agents — des liens hiérarchiques qui pilotent la délégation, le découpage d'epics, l'escalade SLA et le transfert de budget, avec les humains toujours au sommet.
---

L'**organigramme** (Agents → Organigramme) organise vos agents en lignes hiérarchiques, comme une entreprise organise une équipe. Il remplace les anciennes cases de délégation par agent par une vue structurelle unique, et ce n'est pas un schéma décoratif — la structure est fonctionnelle.

Quatre mécanismes lisent ces liens directement :

- **La délégation** en découle : chaque agent peut déléguer exactement à ses subordonnés directs — l'organigramme est la seule configuration de délégation, sans entretien par agent.
- **Les managers découpent les epics** : une tâche racine étiquetée `epic` affectée à un agent ayant des subordonnés est divisée en sous-tâches réparties dans son équipe.
- **L'escalade suit la chaîne** : les agents reçoivent un outil `escalate`. Un agent bloqué remonte à son manager (qui s'exécute sous le budget du _manager_) ; les agents de premier niveau escaladent vers les humains de l'organisation via la boîte de réception.
- **SLA et transfert de budget** empruntent les mêmes liens : le travail en retard escalade vers le manager du responsable ; les tâches d'un agent en pause budgétaire remontent d'un cran (seulement si les garde-fous du manager le permettent).

## Modifier l'organigramme

Glissez depuis l'ancre basse d'un agent vers un autre pour en faire son manager, ou utilisez le sélecteur du panneau latéral. Les changements s'écrivent immédiatement dans le fichier de configuration de l'agent et sont audités ; tout ce qui créerait une boucle hiérarchique est rejeté. La modification exige la capacité développeur (rôle developer, admin ou owner).

Les nœuds affichent l'état des garde-fous en direct : barre de budget avec la consommation du mois, badge de pause et nombre de tâches en cours.

## Les humains restent au sommet

Les agents sans manager sont des **racines** — ils rendent compte aux humains de l'organisation. Chaque chaîne automatisée se termine chez un humain : la revue obligatoire, la boîte d'escalade ou le dernier niveau de l'échelle SLA.

## Partir de zéro

Un organigramme neuf affiche chaque agent comme racine. Glissez depuis l'ancre basse d'un agent vers un autre pour créer la première ligne hiérarchique ; chaque lien prend effet immédiatement et apparaît au même instant dans la délégation des agents concernés.
