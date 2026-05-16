---
title: Métriques des workflows
description: Un tableau de bord transverse des exécutions totales, du taux de réussite, de la durée moyenne et des plus grands mouvements.
---

Le tableau de bord **Métriques des workflows** regroupe chaque automatisation de l'organisation dans une seule vue : quatre chiffres en haut, une tendance des exécutions dans le temps, une répartition par statut et un tableau des top workflows dans lequel tu peux plonger. Ouvre-le quand la question traverse plusieurs automatisations au lieu de se loger dans une seule — « est-ce qu'on a cassé quelque chose avec le déploiement d'hier », « quelle automatisation a vu son volume multiplié par dix après le changement de processus », « qu'est-ce qui traîne dans la longue traîne sans usage réel ». Le public cible, ce sont les rôles Admin et Développeur, les mêmes qui peuvent éditer les automatisations.

Le tableau de bord se trouve dans **Automatisations > Voir les métriques**. Il reste vide tant qu'aucune automatisation n'a tourné ; dès que les exécutions arrivent, la surface se rafraîchit quasi en temps réel.

## Les quatre chiffres en tête

Le haut de la page porte quatre cartes.

| Carte                  | Lecture                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **Exécutions totales** | Nombre d'exécutions sur la période choisie.                                                  |
| **Taux de réussite**   | Exécutions réussies divisées par le total. Les exécutions en cours et annulées sont exclues. |
| **Durée moyenne**      | Durée d'horloge moyenne des exécutions terminées.                                            |
| **Échecs**             | Nombre d'exécutions qui se sont terminées en erreur.                                         |

Les quatre ensemble répondent à « le système est-il en bonne santé sur cette période ». Un taux de réussite qui glisse pendant que le total reste stable pointe vers une automatisation précise en régression ; un taux de réussite stable pendant que le total s'effondre pointe vers une source de déclencheur devenue silencieuse.

## Tendance et statut

Sous les cartes, deux graphiques découpent la période.

**Exécutions dans le temps** est une série quotidienne des exécutions terminées, échouées et en cours sur la fenêtre choisie. La forme de la série — montée lente, cycle hebdomadaire, pic soudain — est l'indice de l'automatisation à ouvrir ensuite.

**Répartition par statut** est un donut qui montre la part que prend chaque statut terminal sur la période. Un mélange sain est dominé par « terminées » avec un fin sliver d'« échouées » ; un donut où les échecs dépassent quelques pourcents, c'est le signal pour creuser.

## Top workflows

Le tableau du bas classe les automatisations par nombre d'exécutions et fait remonter, pour chacune, le taux de réussite, la durée moyenne, le nombre d'échecs et l'horodatage de la dernière exécution. Clique une ligne pour sauter directement aux [journaux d'exécution](/fr/platform/automations/execution-logs) de cette automatisation — le classement est la lentille transverse, le journal est la vérité par exécution.

## Période et le plafond

Bascule entre **7 derniers jours**, **30 derniers jours** et **90 derniers jours** depuis le sélecteur de période en haut à droite. Le choix est reflété dans l'URL pour qu'un tableau de bord partagé reste reproductible.

Chaque requête lit les 5 000 exécutions les plus récentes sur la fenêtre. Quand le plafond est atteint, un bandeau au-dessus des cartes indique _« Affichage des 5 000 exécutions les plus récentes sur cette période. Les exécutions plus anciennes ne sont pas incluses dans ces totaux. »_ — bascule alors sur une fenêtre plus courte pour avoir l'image complète, ou ouvre la table des top workflows et plonge dans le journal d'exécution de chaque automatisation, qui n'est pas plafonné.

## Période vide

Une période sans exécution affiche l'état vide — une seule ligne **Aucune exécution** plutôt que des cartes à zéro. Cet état vide est l'indice : élargis la fenêtre ou vérifie que les déclencheurs s'allument bien ; la suite naturelle, c'est [Déclencheurs](/fr/platform/automations/triggers).

## Où ça s'inscrit

Les métriques d'automatisation sont la lentille transverse : la réponse à « est-ce que quelque chose est cassé » et « qu'est-ce qui a changé depuis la semaine dernière » sans ouvrir chaque automatisation individuellement. Quand un chiffre bouge, les [journaux d'exécution](/fr/platform/automations/execution-logs) donnent la vérité par exécution — ouvre l'automatisation concernée, trouve l'exécution fautive, lis son journal. Pour les tendances de coût LLM qui traversent automatisations et chat ensemble, [Analyses d'utilisation](/fr/platform/admin/usage-analytics) est un onglet plus loin.
