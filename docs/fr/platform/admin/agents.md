---
title: Agents (vue Admin)
description: Encadre les accès, les fournisseurs, l’équipement et les secrets des agents avec les droits du projet et les ressources de l’organisation.
---

Les agents appartiennent à des projets et suivent leurs permissions. En tant que Propriétaire ou Admin, tu contrôles les ressources disponibles et les personnes qui peuvent modifier leur configuration. Cette page explique ces limites ; [Agents de projet](/fr/platform/projects/project-agents) couvre la configuration au quotidien.

## Définir qui gère les agents

Les personnes qui peuvent lire un projet voient ses agents. Le droit de modifier un projet actif permet d’y créer, modifier et supprimer des agents ; un projet archivé reste lisible. Chaque projet accueille jusqu’à 50 agents dont les noms sont distincts dans ce projet.

L’ID d’un agent appartient à son projet. Même avec accès à deux projets, tu ne peux pas modifier l’agent de l’un en passant par l’autre. [Membres et rôles](/fr/platform/admin/members-and-roles) et [Équipes](/fr/platform/admin/teams) expliquent les droits qui s’appliquent.

## Encadrer les ressources disponibles

- Les **fournisseurs** apportent les modèles et les identifiants d’exécution. [Fournisseurs](/fr/platform/admin/providers) décrit les moteurs disponibles.
- Les **connectors, skills et outils** déterminent les services, les références et les opérations accessibles. Accorde l’équipement nécessaire à la tâche.
- Les **autorisations de secrets** donnent à l’exécution les valeurs des secrets nommés de l’organisation. Seuls les Propriétaires ou Admins peuvent changer les noms autorisés. Un Éditeur peut modifier d’autres réglages en conservant ces autorisations.
- Les **budgets et politiques** régissent les dépenses et les actions dans l’organisation ; voir [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

Les valeurs des secrets restent chiffrées et n’apparaissent jamais dans la configuration renvoyée par l’API. Renouveler un secret change la valeur utilisée par les agents qui font référence à son nom.

## Appliquer les mêmes droits aux intégrations

L’API publique exige un ID de projet pour chaque opération sur un agent et applique les permissions du titulaire de la clé. Elle lit et modifie les mêmes agents que l’interface du projet. La [Référence API](/fr/develop/api-reference#gerer-les-agents-dun-projet) donne les routes et un exemple complet.

Une mise à jour contient toute la configuration, y compris les autorisations de secrets à conserver. Omettre ces autorisations demande de les retirer ; cela exige les mêmes droits d’administration que leur ajout.

## Vérifier la configuration du projet

Vérifie les membres du projet avec le modèle, l’équipement et les autorisations de secrets de l’agent. [Comprendre les agents](/fr/platform/agents/concepts) explique ces choix, et [Agents de projet](/fr/platform/projects/project-agents) la configuration utilisée pour les tâches.
