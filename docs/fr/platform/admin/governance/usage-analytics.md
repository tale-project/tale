---
title: Analyse d'utilisation
description: Le dashboard des tokens, du coût et du volume de requêtes par utilisateur, équipe, modèle et agent — avec tendances et un classement des top agents.
---

Analyse d'utilisation est le dashboard qui agrège chaque appel AI facturable dans une vue unique de tokens, coût et volume de requêtes. Il découpe par utilisateur, équipe, rôle, modèle, agent et temps, pour que la ligne inattendue sur la facture soit traçable jusqu'à la charge qui l'a portée. Les Administrateurs et Propriétaires lisent cette page quand une facture est inattendue, quand la direction veut la forme approximative des dépenses AI, ou quand une alerte de budget se déclenche et la question suivante est _qui et quoi_.

## Un drill-down mis en pratique

Ouvre **Paramètres > Métriques > Utilisation**. La vue par défaut sont les 30 derniers jours, org-wide, avec les compteurs phares — requêtes, tokens, coût et utilisateurs actifs — au-dessus de la tendance d'utilisation. Lis **Utilisation par utilisateur** pour trouver les plus gros consommateurs, **Principaux modèles** pour comparer un primaire coûteux à un repli moins cher, ou **Principaux assistants** pour trouver l'assistant qui porte la charge. Le sélecteur de période (7, 30 ou 90 jours) pilote toutes les sections à la fois.

## Les dimensions

- **Utilisateur** — chaque membre qui a déclenché un appel facturable, avec ses tokens, son coût et ses requêtes.
- **Modèle** — chaque modèle qui a produit une réponse ; les modèles vocaux gardent leur propre classement.
- **Assistant** — chaque assistant avec de l'utilisation attribuée.
- **Temps** — la courbe de tendance suit la fenêtre choisie : 7, 30 ou 90 jours.

## Le modèle de coût

Le coût est une estimation. Chaque requête atterrit dans le registre d'utilisation avec les tokens d'entrée, les tokens de sortie, le prix publié du modèle par million de tokens et la durée wall-clock. Le dashboard multiplie tokens par prix ; les appels de génération d'images atterrissent avec un coût par image que le fournisseur renvoie. La ligne du registre est la source de vérité, et le [journal d'audit](/fr/platform/admin/governance/audit-logs) porte l'acteur et l'horodatage de la ligne pour le recoupement.

## Budgets et utilisation

Les budgets vivent dans [politiques et limites](/fr/platform/admin/governance/policies-and-limits) ; ce dashboard est l'endroit où tu retraces ce qui les a portés. Quand un avertissement de budget ou un avis budget-dépassé se déclenche dans le chat, les tableaux par utilisateur et par modèle répondent ici à la question suivante — qui a dépensé, sur quel modèle, sur quels jours.

## Rétention des lignes d'utilisation

Le registre d'utilisation a sa propre fenêtre de rétention dans [politiques et limites](/fr/platform/admin/governance/policies-and-limits). Le défaut est 365 jours ; raccourcis-le et le graphique historique se tronque en conséquence. Le dashboard reflète ce que tient le registre — il n'y a pas de couche d'archive en dessous.

## Où cela s'inscrit

Analyse d'utilisation est le côté dépense et volume de la même charge que [analyse des retours](/fr/platform/admin/governance/feedback-analytics) lit pour la qualité. Ensemble elles répondent à _cet agent vaut-il son coût_. La page compagnon est [politiques et limites](/fr/platform/admin/governance/policies-and-limits) — la page où les budgets que ce dashboard superpose sont configurés.
