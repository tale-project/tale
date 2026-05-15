---
title: Analyse d'usage
description: Vue chronologique de la consommation de tokens, du coût et de la performance des workflows — filtrée par équipe, utilisateur, agent et plage temporelle, avec export CSV pour la finance et la planification de capacité.
---

L'analyse d'usage est le tableau de bord que les Admins consultent quand la question est « combien l'organisation dépense-t-elle, sur quels modèles, pour quel travail ? ». C'est un sur-ensemble des chiffres instantanés qu'affiche la surface des budgets : les budgets répondent à « sommes-nous au-dessus du plafond maintenant », et cette page répond à « quelle est la tendance, qui la pousse, et quel workflow est responsable ». La surface est **Paramètres > Gouvernance > Tableau de bord d'usage**, et elle est réservée à l'Admin.

Le public, c'est l'Admin qui fait l'abgleich finance, la planification de capacité ou une revue d'usage post-incident. Pour la pile d'observabilité côté opérateur (Prometheus, logs, health-checks), [Opérations](/fr/self-hosted/operate/observability/operations) est la page ; celle-ci reste dans le produit.

## Diagrammes disponibles

| Diagramme                  | Ce qu'il montre                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Tokens dans le temps**   | Tokens d'entrée et de sortie par jour, empilés par modèle.                                                     |
| **Coût dans le temps**     | Coût quotidien et mensuel, empilé par fournisseur.                                                             |
| **Top utilisateurs**       | Utilisateurs classés par consommation de tokens sur la période choisie.                                        |
| **Top équipes**            | Équipes classées par consommation de tokens sur la période choisie.                                            |
| **Mix de modèles**         | Part des requêtes par modèle — utile au déploiement d'un nouveau modèle ou pour une passe d'optimisation coût. |
| **Mix de fonctionnalités** | Part des requêtes par fonctionnalité — chat, arena, agents, automatisations.                                   |
| **Métriques de workflow**  | Par automatisation : nombre d'exécutions, taux de succès, durée médiane et p95.                                |

Chaque diagramme respecte la barre de filtres globale, de sorte qu'un seul changement de filtre rafraîchisse tout le tableau de bord.

## Filtres

La barre de filtres en haut expose quatre bornes :

- **Plage temporelle** — 7 derniers jours, 30 derniers jours, ce mois, dernier trimestre, ou plage personnalisée.
- **Équipe** — borne aux membres des équipes choisies.
- **Utilisateur** — vue mono-utilisateur pour les enquêtes individuelles.
- **Agent** — borne aux conversations et automatisations qui utilisent un agent précis.

Les filtres se composent : choisis **Équipe = Support** et **Agent = Support client** pour voir la dépense en tokens d'un agent dans une équipe. Le jeu de filtres actif est inclus dans chaque export CSV, de sorte qu'une feuille de calcul en aval garde la borne visible.

## Exporter

Le bouton **Export** au-dessus de chaque diagramme produit un CSV des lignes sous-jacentes, en respectant chaque filtre actif. Sers-t'en pour le reporting board, l'abgleich finance ou pour nourrir un outil BI externe — les lignes correspondent aux points de données du diagramme un pour un, de sorte que les postes du tableau se réconcilient avec le tableau de bord.

## Fenêtres plafonnées

Quand une fenêtre de filtre contient plus de 5 000 exécutions, le tableau de bord fait remonter une bannière indiquant qu'il affiche les 5 000 exécutions les plus récentes dans cette fenêtre. Les exécutions plus anciennes dans la même période sont exclues des totaux. Resserre la fenêtre — choisis une plage temporelle plus serrée ou une équipe ou un agent plus précis — pour voir des chiffres complets sur la période qui rentre dans le plafond.

## Rétention

Les lignes d'analyse d'usage suivent le réglage **Registre d'usage** sous [Gouvernance > Rétention](/fr/platform/admin/governance#retention). Par défaut, les enregistrements détaillés d'usage sont gardés assez longtemps pour les comparaisons année-sur-année ; les totaux mensuels agrégés restent indéfiniment. Raccourcir la rétention du registre d'usage tronque l'analyse historique sur laquelle s'appuie cette page, c'est pourquoi le formulaire de rétention fait remonter un avertissement avant qu'une réduction ne soit enregistrée.

## Où cela s'insère

L'analyse d'usage est la vue chronologique de la consommation — tokens, coût, exécutions, par utilisateur et par équipe. Elle s'apparie à [Gouvernance](/fr/platform/admin/governance), où sont posés les budgets et limites contre lesquels mesure le tableau de bord, et à [Opérations](/fr/self-hosted/operate/observability/operations) pour la pile d'observabilité côté opérateur. Quand un diagramme penche du mauvais côté, l'action retourne à Gouvernance pour serrer la politique — ajuster un budget, restreindre un modèle, resserrer un défaut — et c'est ici que tu vérifies au prochain rafraîchissement que le changement a pris effet.
