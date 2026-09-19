---
title: Analyse de l’usage
description: Examine la consommation de tokens, les requêtes et les coûts enregistrés par modèle, assistant et personne.
---

En tant qu’admin ou propriétaire, ouvre **Paramètres > Métriques > Utilisation** pour comprendre quelles tâches consomment des ressources d’IA. Choisis d’abord la période, puis les répartitions utiles pour expliquer une variation de coût ou de volume.

## Examiner une hausse d’usage

1. Ouvre **Filtre** et choisis une **Période** de 7, 30 ou 90 jours. La vue initiale couvre 30 jours.
2. Compare les requêtes, les tokens, le coût total et les utilisateurs actifs. Une hausse du nombre de requêtes et des réponses plus longues ont des causes différentes.
3. Choisis la mesure et la granularité du graphique dans le menu de filtre pour repérer le début du changement.
4. Examine les tableaux par assistant, par modèle et par personne. Sélectionne un assistant ou un modèle pour réduire la vue ; retire sa pastille de filtre pour revenir à la vue plus large.

Les noms d’assistants peuvent inclure des tâches auxiliaires, comme la création des titres de chat. Le nombre de requêtes ne correspond donc pas toujours au nombre de messages envoyés. La synthèse vocale possède son propre tableau de modèles vocaux.

**Utilisation par utilisateur** attribue chaque requête à une personne : le membre qui a envoyé le message de chat ou lancé l’exécution d’agent, y compris par l’API REST ou le point d’accès MCP. Les exécutions démarrées par une planification, un webhook ou un événement n’ont personne derrière elles. Leur usage apparaît sur une seule ligne nommée **Automatisations (déclencheurs)**, qui ne compte pas comme utilisateur actif. Dans le tableau des assistants, un agent de projet et une automatisation apparaissent chacun sous leur nom.

## Lire les coûts avec les tokens

Le tableau de bord utilise les données d’usage et de consommation enregistrées. Les tokens d’entrée et de sortie sont séparés. Des services comme la voix ou la génération d’images peuvent utiliser d’autres unités de facturation. Le total de tokens ne suffit donc pas à expliquer tous les coûts.

Lis le coût affiché comme l’usage enregistré par l’application, pas comme une facture du fournisseur. Tarifs, abonnements, crédits et appels non mesurés peuvent modifier la comparaison. Un zéro affiché ne prouve pas que le fournisseur n’a rien facturé.

## Réagir à une alerte de budget

Utilise la même période et la tâche concernée pour examiner une alerte. Identifie la personne, l’assistant ou le modèle à l’origine de la hausse. Décide ensuite de modifier le fonctionnement, de choisir un autre modèle ou d’ajuster un plafond dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

Consulte l’[analyse des retours](/fr/platform/admin/governance/feedback-analytics) avant de changer de modèle uniquement pour son coût : dépenser moins reste utile si les résultats répondent toujours au besoin.

## Comprendre un historique incomplet

Les graphiques reflètent les données d’usage que Tale conserve encore. Les règles de l’organisation et du déploiement déterminent l’historique disponible ; il n’existe pas de garantie universelle de 365 jours. Vérifie la période, les filtres et la rétention du registre d’usage si une activité attendue manque.
