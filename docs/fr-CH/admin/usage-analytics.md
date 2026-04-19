---
title: Analyses d'utilisation
description: Analyses temporelles de la consommation de tokens, des coûts et des performances des workflows.
---

Le tableau de bord Usage Analytics sous **Paramètres > Gouvernance > Usage Dashboard** donne aux admins une vue temporelle de la façon dont l'organisation utilise Tale. C'est un sur-ensemble des chiffres ponctuels affichés dans les budgets — ici tu vois les tendances, descends jusqu'à des utilisateurs ou équipes précis et exportes pour la finance ou la planification de capacité.

## Graphiques disponibles

| Graphique                  | Affiche                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Tokens dans le temps**   | tokens entrée et sortie par jour, empilés par modèle.                                                 |
| **Coûts dans le temps**    | coût journalier et mensuel, empilé par fournisseur.                                                   |
| **Top utilisateurs**       | classement par consommation de tokens sur la période.                                                 |
| **Top équipes**            | classement par consommation de tokens.                                                                |
| **Mix de modèles**         | parts de requêtes par modèle — utile lors du rollout d'un nouveau modèle ou pour optimiser les coûts. |
| **Mix de fonctionnalités** | parts de requêtes par fonctionnalité — chat, arena, agents, automatisations.                          |
| **Métriques de workflows** | nombre de runs, taux de succès, durée médiane et p95 par automatisation.                              |

## Filtres

Chaque graphique respecte la barre de filtres globale :

- **Plage temporelle** — 7 derniers jours, 30 derniers jours, ce mois, trimestre, personnalisé.
- **Équipe** — limiter aux membres des équipes choisies.
- **Utilisateur** — vue mono-utilisateur pour des investigations.
- **Agent** — limiter aux conversations et automatisations utilisant un agent précis.

## Export

Le bouton **Export** au-dessus d'un graphique produit un CSV avec les lignes sous-jacentes, en respectant les filtres actifs. Utile pour le reporting board, la réconciliation finance ou l'alimentation d'un BI externe.

## Rétention

Les données analytiques suivent la [politique de rétention](/fr-CH/admin/governance) générale. Par défaut, les enregistrements détaillés sont gardés 13 mois pour permettre des comparaisons année/année ; les totaux mensuels agrégés restent indéfiniment.

## Lié

- [Gouvernance](/fr-CH/admin/governance) — régler les budgets et limites affichés ici.
- [Operations](/fr-CH/operate/observability/operations) — observabilité côté opérateur (Prometheus, logs, health).
