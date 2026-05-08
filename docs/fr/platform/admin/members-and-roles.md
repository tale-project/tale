---
title: Membres et rôles
description: Gère qui accède à ton organisation et ce qu’il peut y faire.
---

Tale utilise six rôles. Chaque utilisateur a exactement un rôle dans une organisation. La même personne peut avoir des rôles différents dans des organisations différentes.

## Gérer les membres

La table sous **Paramètres > Membres** liste tous les utilisateurs de l’organisation avec e-mail, nom affiché, rôle et date d’arrivée. Les Admins peuvent :

- **Ajouter des membres** — e-mail, mot de passe optionnel, nom affiché et rôle. Si l’e-mail existe déjà dans Tale, l’utilisateur est ajouté à l’organisation sans créer de nouveau compte.
- **Éditer des membres** — changer le nom affiché, le rôle, ou définir un nouveau mot de passe.
- **Retirer des membres** — retire le membre de l’organisation. Le compte n’est pas supprimé ; l’utilisateur perd simplement l’accès.

Pour les options d’authentification (mot de passe, SSO Microsoft Entra ID, Trusted Headers), voir [Authentification](/fr/self-hosted/admin/authentication).

## Vue d’ensemble des rôles

| Rôle         | À qui il s’adresse                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Propriétaire | créateur de l’organisation. Mêmes permissions qu’Admin avec transfert de propriété.                                                   |
| Admin        | contrôle complet de l’organisation. Gère membres, paramètres, intégrations et tous les contenus.                                      |
| Développeur  | pour ingénieurs et intégrateurs. Accès complet aux données, mais pas à la gestion des membres ni aux paramètres de l’organisation.    |
| Éditeur      | pour les équipes contenu et support. Crée du contenu dans la base, traite les conversations, gère les agents et approuve des actions. |
| Membre       | accès en lecture seule. Peut utiliser le chat IA pour explorer, mais pas créer ni éditer de contenu.                                  |
| Désactivé    | compte suspendu. Aucun accès.                                                                                                         |

## Matrice de permissions

### Chat IA

| Fonctionnalité                | Membre | Éditeur | Développeur | Admin |
| ----------------------------- | ------ | ------- | ----------- | ----- |
| Créer et envoyer des messages | ✓      | ✓       | ✓           | ✓     |
| Voir son propre historique    | ✓      | ✓       | ✓           | ✓     |
| Choisir un agent              | ✓      | ✓       | ✓           | ✓     |

### Base de connaissances

| Fonctionnalité                                | Membre | Éditeur | Développeur | Admin |
| --------------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir toutes les entrées                       | ✓      | ✓       | ✓           | ✓     |
| Téléverser / éditer / supprimer des documents | —      | ✓       | ✓           | ✓     |
| Gérer Produits, Clients, Fournisseurs         | —      | ✓       | ✓           | ✓     |
| Ajouter et configurer le crawling             | —      | ✓       | ✓           | ✓     |

### Conversations

| Fonctionnalité              | Membre | Éditeur | Développeur | Admin |
| --------------------------- | ------ | ------- | ----------- | ----- |
| Voir les conversations      | ✓      | ✓       | ✓           | ✓     |
| Répondre aux clients        | —      | ✓       | ✓           | ✓     |
| Fermer / rouvrir / archiver | —      | ✓       | ✓           | ✓     |
| Marquer comme spam          | —      | ✓       | ✓           | ✓     |

### Approbations

| Fonctionnalité                   | Membre | Éditeur | Développeur | Admin |
| -------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les approbations en attente | ✓      | ✓       | ✓           | ✓     |
| Approuver ou refuser             | —      | ✓       | ✓           | ✓     |

### Agents

| Fonctionnalité             | Membre | Éditeur | Développeur | Admin |
| -------------------------- | ------ | ------- | ----------- | ----- |
| Voir la liste des agents   | —      | ✓       | ✓           | ✓     |
| Créer et éditer des agents | —      | ✓       | ✓           | ✓     |

### Automatisations

| Fonctionnalité            | Membre | Éditeur | Développeur | Admin |
| ------------------------- | ------ | ------- | ----------- | ----- |
| Voir la liste             | —      | —       | ✓           | ✓     |
| Créer et éditer           | —      | —       | ✓           | ✓     |
| Publier et activer        | —      | —       | ✓           | ✓     |
| Voir les logs d’exécution | —      | —       | ✓           | ✓     |

### Intégrations et API

| Fonctionnalité                   | Membre | Éditeur | Développeur | Admin |
| -------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les intégrations            | —      | —       | ✓           | ✓     |
| Configurer les intégrations      | —      | —       | ✓           | ✓     |
| Générer et révoquer des clés API | —      | —       | ✓           | ✓     |

### Administration de l’organisation

| Fonctionnalité                        | Membre | Éditeur | Développeur | Admin |
| ------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les paramètres de l’organisation | —      | —       | —           | ✓     |
| Éditer nom et image de marque         | —      | —       | —           | ✓     |
| Ajouter et retirer des membres        | —      | —       | —           | ✓     |
| Changer le rôle des membres           | —      | —       | —           | ✓     |

## Authentification

Tale supporte e-mail/mot de passe, Microsoft Entra ID SSO et Trusted Headers. Toutes les méthodes peuvent être utilisées en même temps.

Pour l’installation complète, voir le [guide d’authentification](/fr/self-hosted/admin/authentication).
