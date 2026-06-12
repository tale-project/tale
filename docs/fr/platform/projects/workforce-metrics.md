---
title: Métriques de la workforce
description: Comment le travail des agents est mesuré — tableau de bord workforce, scorecards par agent et métriques par projet, en associant toujours résultats, interventions et coûts.
---

Tale mesure la workforce IA comme on mesure une équipe : **résultat, intervention humaine et coût — toujours ensemble**. Un agent bon marché dont le travail revient sans cesse n'est pas bon marché.

## Le tableau de bord workforce

**Agents → Workforce** est le centre opérationnel : l'interrupteur principal de l'automatisation, une bande de santé (exécutions sur 24 h, échecs, erreurs d'automatisation, plus ancienne exécution en file), des cartes KPI appariées, la tendance d'activité quotidienne, le classement des agents et quatre files « à traiter » — revues en attente, travail d'agent au point mort, exécutions en file, pauses disjoncteur — chacune avec lien direct vers le board.

Les KPIs :

- **Terminées** — tâches finies sur la période, réparties agent vs humain.
- **Taux d'intervention** — modifications demandées plus escalades par exécution, avec le taux d'approbation du premier coup.
- **Temps de cycle** — du premier _En cours_ à _Terminé_.
- **Dépenses** — avec le coût par tâche terminée, jamais seules.

## Scorecards d'agents

L'onglet **Performance** de chaque agent montre sa scorecard sur 30 jours — clôtures, taux d'approbation du premier coup avec modifications/escalades, durée moyenne d'exécution, dépenses — plus ses exécutions récentes avec statut, déclencheur, durée et coût.

## Métriques de projet

Chaque board a une vue **Métriques** : flux cumulé à partir des instantanés de fin de journée, débit créées-vs-terminées, tendance du temps de cycle, répartition agent-vs-humain et dépenses.

## D'où viennent les chiffres

Un rollup nocturne agrège par projet et par jour depuis la chronologie d'activité et les enregistrements d'exécution unifiés (exécutions internes **et** externes partagent un même enregistrement). Sommes et compteurs sont stockés — la ré-agrégation reste exacte. Les chiffres ayant atteint un plafond de scan sont marqués comme bornes basses. Des synthèses quotidiennes (et une hebdomadaire le lundi) livrent les chiffres clés dans les boîtes des admins — silence les jours calmes.
