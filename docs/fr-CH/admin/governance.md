---
title: Gouvernance
description: Politiques IA à l'échelle de l'organisation, limites, contrôles de sécurité et audit logs.
---

La gouvernance est l'endroit où les admins définissent les règles d'usage de l'IA dans l'organisation. Elle est organisée en trois groupes accessibles via la navigation de gauche sous **Paramètres > Gouvernance**, plus une page d'audit logs pour la conformité.

## Contenu et modèles

### Prompt système

Définis un prompt système global ajouté en tête de chaque conversation IA dans l'organisation. Utilise-le pour imposer le ton, le périmètre et des règles de sécurité héritées par tous les agents.

### Modèles par défaut

Choisis les modèles par défaut chat, vision et embedding utilisés quand les utilisateurs n'en choisissent pas explicitement. Les modèles viennent de tout fournisseur configuré — voir [Fournisseurs IA](/fr-CH/admin/providers).

### Accès aux modèles

Contrôle quels modèles sont disponibles à des équipes ou utilisateurs précis. Restreins les modèles frontières coûteux à des staffs senior, ou n'expose que des modèles auto-hébergés à une équipe.

## Politiques et limites

### Budgets

Définis des limites de dépenses par utilisateur, par équipe ou pour l'organisation. Configure la période (quotidien, hebdo, mensuel) et l'action en cas de dépassement — avertir, bloquer les nouvelles requêtes ou désactiver le chat.

### Politique d'upload

Restreins les téléversements par type, taille ou nombre. Utile pour empêcher de gros uploads binaires ou bloquer des types exécutables.

### Rétention

Configure combien de temps les conversations, fichiers téléversés et enregistrements d'audit sont conservés avant suppression automatique. Voir [Rétention](/fr-CH/operate/configuration/retention) pour les valeurs par défaut au niveau environnement qui s'appliquent aux déploiements auto-hébergés.

### Contrôles de fonctionnalités

Active/désactive des fonctionnalités à l'échelle de l'organisation : téléversement de fichiers, recherche web, génération d'image, arena mode, etc. Les fonctionnalités désactivées ici sont masquées de l'UI pour tous les utilisateurs.

## Sécurité et monitoring

### Détection DCP

Active la détection automatique et le masquage (ou blocage) des données à caractère personnel dans les messages. Supporte des patterns intégrés (e-mail, téléphone, numéros de carte) et des regex personnalisées. Les messages bloqués n'atteignent jamais le modèle.

### Tableau de bord d'utilisation

Vois la consommation de tokens, la ventilation des coûts et les tendances d'usage. Filtre par équipe, utilisateur, modèle ou période. Pour une analyse plus poussée, voir [Usage analytics](/fr-CH/admin/usage-analytics).

## Audit logs

Enregistrement chronologique des actions significatives dans l'organisation. Catégories : événements d'authentification, changements de members, opérations sur données, mises à jour d'intégrations, publications de workflows, événements de sécurité, actions admin. Utile pour la conformité et le dépannage.

Les admins peuvent exporter les audit logs en **CSV** ou **JSON** depuis les boutons au-dessus de la table. Les exports respectent le filtre de catégorie actif.
