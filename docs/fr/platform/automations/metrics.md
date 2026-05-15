---
title: Métriques des workflows
description: Indicateurs d’utilisation et de performance de toutes les automatisations de l’organisation.
---

La page des métriques des workflows est une vue transverse de la façon dont tes automatisations tournent. Elle agrège chaque workflow de l’organisation en quatre KPI principaux, une courbe d’exécutions dans le temps, une répartition par statut et un tableau des workflows les plus actifs. Utilise-la pour repérer le workflow qui a commencé à échouer hier, celui dont le volume a été multiplié par dix après un changement de processus, ou la longue traîne d’automatisations dont personne ne se sert plus.

La page se trouve dans **Automatisations > Métriques**. Elle est accessible aux rôles Admin et Développeur, soit le même public qui peut éditer les automatisations.

## Ce qu’elle affiche

| Carte / graphique            | Mesure                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Exécutions totales**       | Nombre d’exécutions sur la période choisie.                                                                                               |
| **Taux de réussite**         | Exécutions réussies divisées par le total — `running` et `cancelled` sont exclus.                                                         |
| **Durée moyenne**            | Durée moyenne wall-clock des exécutions terminées.                                                                                        |
| **Échecs**                   | Nombre d’exécutions terminées en erreur.                                                                                                  |
| **Exécutions dans le temps** | Série quotidienne des exécutions terminées, échouées et en cours.                                                                         |
| **Répartition par statut**   | Donut indiquant la part de chaque statut terminal sur la période.                                                                         |
| **Top workflows**            | Tableau classé par nombre d’exécutions, avec taux de réussite, durée moyenne, échecs et horodatage de la dernière exécution par workflow. |

Clique une ligne dans **Top workflows** pour aller voir les [logs d’exécution](/fr/platform/automations/execution-logs) du workflow correspondant.

## Sélecteur de période

Bascule en haut de la page entre **7 derniers jours**, **30 derniers jours** et **90 derniers jours**. Le choix de période est reflété dans l’URL (`?period=30`) pour qu’un lien vers la page reste reproductible.

Chaque requête est plafonnée aux 5 000 exécutions les plus récentes sur la fenêtre choisie. Quand la limite est atteinte, un bandeau s’affiche : _« Affichage des 5 000 exécutions les plus récentes sur cette période. Les exécutions plus anciennes ne sont pas incluses dans ces totaux. »_ — réduis la fenêtre pour avoir une image complète, ou bascule sur **Top workflows** puis ouvre les logs d’exécution par workflow, qui ne sont pas plafonnés.

## État vide

Si aucun workflow ne s’est exécuté sur la période, la page affiche un état vide intitulé _Aucune exécution_ au lieu de cartes à zéro. C’est le signal pour élargir la période ou vérifier que tes triggers s’allument bien — voir [Triggers](/fr/platform/automations/triggers).

## Où cela s'insère

Les métriques de cette page agrègent les exécutions à l'échelle d'un workflow ; elles te disent si une automatisation se comporte normalement dans le temps. Pour descendre dans une exécution précise — la requête qui a déclenché le run, la sortie de chaque étape, l'erreur qui a fait planter le tout — c'est la page des journaux d'exécution qui prend le relais. Et pour la vue inverse — les tendances de tokens et de coûts à l'échelle de toute l'organisation, pas seulement d'un workflow — passe par les analyses d'usage.

Références voisines : [Logs d'exécution](/fr/platform/automations/execution-logs) couvre l'historique par workflow avec détail par étape, et [Analyses d'utilisation](/fr/platform/admin/usage-analytics) donne la vue cross-workflow des tokens et coûts à l'échelle de l'organisation.
