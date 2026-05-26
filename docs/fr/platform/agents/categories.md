---
title: Catégories d'agent
description: Un court tag sur un agent qui le groupe dans le sélecteur du chat et la liste des agents de l'organisation — défini par organisation, optionnel par agent.
---

Une **catégorie** est un court tag sur un agent — `Sales`, `Support`, `Marketing`, `Engineering` — qui le groupe dans le sélecteur du chat et dans la liste des agents de l'organisation. Les catégories sont un outil de tri organisationnel, pas une frontière de permissions ; l'accès basé sur le rôle d'un agent n'est pas changé par la catégorie qu'il porte.

Cette page est volontairement courte — les catégories sont un petit mécanisme. La machinerie plus riche est un onglet plus loin dans les paramètres de l'organisation.

## Régler une catégorie

Ouvre l'agent et regarde dans l'onglet **Instructions & model** ; le champ catégorie est une liste déroulante à sélection unique. Choisis une catégorie et enregistre ; l'agent apparaît sous cette catégorie dans le sélecteur la prochaine fois que quelqu'un l'ouvre. Un agent sans catégorie atterrit dans un bucket par défaut au bas de la liste.

## Où les catégories sont définies

La liste des catégories est à l'échelle de l'organisation et vit dans les paramètres de l'organisation. Les Admins peuvent ajouter ou renommer des catégories ; renommer une catégorie se propage à chaque agent qui l'a utilisée. Supprimer une catégorie laisse les agents qui l'ont utilisée dans le bucket par défaut — aucun agent n'est supprimé.

## Où ça s'inscrit

Les catégories sont le regroupement le plus léger disponible pour les agents — elles trient le sélecteur, rien de plus. Des séparations plus grandes (agents de Projet versus agents d'organisation, allowlists par équipe) vivent respectivement sur [Agents de projet](/fr/platform/projects/project-agents) et [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
