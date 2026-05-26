---
title: Analyse d'utilisation
description: Le dashboard des tokens, du coût et du volume de requêtes par utilisateur, équipe, modèle et agent — avec tendances et un classement des top agents. Les Administrateurs et Propriétaires lisent ceci quand une facture est inattendue ou quand la direction veut la forme approximative des dépenses AI.
---

Analyse d'utilisation est le dashboard qui agrège chaque appel AI facturable dans une vue unique de tokens, coût et volume de requêtes. Il découpe par utilisateur, équipe, rôle, modèle, agent et temps, pour que la ligne inattendue sur la facture soit traçable jusqu'à la charge qui l'a portée. Les Administrateurs et Propriétaires lisent cette page quand une facture est inattendue, quand la direction veut la forme approximative des dépenses AI, ou quand une alerte de budget se déclenche et la question suivante est _qui et quoi_.

## Un drill-down mis en pratique

Ouvre **Paramètres > Gouvernance > Utilisation**. La vue par défaut sont les 30 derniers jours, org-wide, avec les trois compteurs phares — tokens totaux, coût total en USD, requêtes totales. Bascule la ventilation sur **Par utilisateur** pour trouver les plus gros consommateurs, **Par modèle** pour comparer un primaire coûteux à un repli moins cher, ou **Par agent** pour trouver l'agent qui porte la charge. Chaque ligne renvoie à une série temporelle par ligne ; l'axe du graphique suit la période choisie.

## Les dimensions

- **Utilisateur** — chaque membre qui a déclenché un appel facturable. Associe au filtre équipe ou rôle pour cadrer la vue.
- **Équipe** — agrégé par membre d'équipe ; utile quand les budgets sont cadrés par équipe.
- **Rôle** — Propriétaire, Administrateur, Développeur, Éditeur, Membre.
- **Modèle** — chaque modèle qui a produit une réponse, groupé par fournisseur.
- **Agent** — chaque agent nommé (le classement trie par volume de tokens, coût ou nombre de requêtes).
- **Temps** — tendance quotidienne pour les fenêtres courtes, hebdomadaire pour les fenêtres plus longues.

## Le modèle de coût

Le coût est une estimation. Chaque requête atterrit dans le registre d'utilisation avec les tokens d'entrée, les tokens de sortie, le prix publié du modèle par million de tokens et la durée wall-clock. Le dashboard multiplie tokens par prix ; les appels de génération d'images atterrissent avec un coût par image que le fournisseur renvoie. La ligne du registre est la source de vérité, et le [journal d'audit](/fr/platform/admin/governance/audit-logs) porte l'acteur et l'horodatage de la ligne pour le recoupement.

## Superpositions de budget

Quand [politiques et limites](/fr/platform/admin/governance/policies-and-limits) a un budget pour un scope, le graphique d'utilisation superpose le plafond comme une ligne horizontale. Survoler un point affiche le pourcentage du plafond consommé et la projection de fin de mois basée sur la tendance courante. Franchir le seuil d'avertissement colore la série en ambre ; franchir le plafond la colore en rouge et fait apparaître les événements budget-dépassé comme marqueurs sur l'axe temps.

## Rétention des lignes d'utilisation

Le registre d'utilisation a sa propre fenêtre de rétention dans [politiques et limites](/fr/platform/admin/governance/policies-and-limits). Le défaut est 365 jours ; raccourcis-le et le graphique historique se tronque en conséquence. Le dashboard reflète ce que tient le registre — il n'y a pas de couche d'archive en dessous.

## Où cela s'inscrit

Analyse d'utilisation est le côté dépense et volume de la même charge que [analyse des retours](/fr/platform/admin/governance/feedback-analytics) lit pour la qualité. Ensemble elles répondent à _cet agent vaut-il son coût_. La page compagnon est [politiques et limites](/fr/platform/admin/governance/policies-and-limits) — la page où les budgets que ce dashboard superpose sont configurés.
