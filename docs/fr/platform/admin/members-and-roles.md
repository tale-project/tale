---
title: Membres et rôles
description: La matrice canonique des six rôles — qui voit et fait quoi dans une organisation Tale, et comment les Admins invitent, modifient et retirent des membres.
---

Chaque personne dans une organisation Tale appartient à un seul des six rôles, et ce rôle décide quels écrans elle voit, quels boutons sont actifs et quels appels API passent. Cette page est pour les Admins et les Propriétaires qui gèrent l'organisation, et elle sert aussi de référence canonique vers laquelle le reste de la doc renvoie quand une fonctionnalité dit « Éditeur ou plus » ou « Développeur uniquement ». La même personne peut tenir des rôles différents dans des organisations différentes — les rôles s'attachent à l'organisation, pas à l'utilisateur.

La liste des rôles est fermée : `Propriétaire`, `Admin`, `Développeur`, `Éditeur`, `Membre`, `Désactivé`. Il n'y a pas d'éditeur de rôles personnalisés, et la matrice ci-dessous est la source de vérité — quand un bouton est caché pour ton rôle, cette page en est la raison.

## Gérer les membres

Ouvre **Paramètres > Membres**. La table liste chaque utilisateur de l'organisation avec son courriel, son nom affiché, son rôle et sa date d'arrivée, plus un menu d'actions par ligne pour les Admins.

- **Ajouter un membre** — ouvre une boîte de dialogue qui demande le courriel, un mot de passe initial optionnel, le nom affiché et le rôle. Si le courriel existe déjà dans Tale, ce compte est rattaché à l'organisation plutôt qu'un doublon créé. Les nouveaux comptes avec mot de passe sont marqués **L'utilisateur doit changer son mot de passe à la prochaine connexion**, afin que le mot de passe temporaire posé par l'Admin ne survive pas à la première connexion.
- **Modifier un membre** — change le nom affiché, le rôle ou pose un nouveau mot de passe. Les Admins ne peuvent pas changer leur propre rôle depuis cette boîte (utilise **Transférer la propriété** plus bas pour cela). Rétrograder un Admin vers un rôle inférieur est bloqué si cela laisserait l'organisation avec moins de deux Admins.
- **Réinitialiser le double facteur** — désactive l'inscription TOTP du membre, termine toutes ses sessions actives et l'oblige à se réinscrire à la prochaine connexion. Utilise l'action quand un membre perd son authentificateur et a épuisé ses codes de secours. Chaque réinitialisation est inscrite au journal d'audit.
- **Retirer le membre** — détache le membre de cette organisation. Le compte sous-jacent n'est pas supprimé ; il garde accès à toute autre organisation à laquelle il appartient.
- **Transférer la propriété** — disponible uniquement pour le Propriétaire actuel. Élève le membre choisi au rang de Propriétaire et rétrograde le Propriétaire actuel en Admin. Une organisation a exactement un Propriétaire.

Pour la mécanique de connexion (mot de passe, Microsoft Entra ID SSO, en-têtes de reverse-proxy de confiance, rotation de mot de passe), voir [Authentification](/fr/self-hosted/admin/authentication). Pour la politique de double facteur au niveau de l'organisation, voir [Authentification à double facteur](/fr/platform/admin/two-factor-authentication).

## Les six rôles

| Rôle         | À quoi sert ce rôle                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propriétaire | La personne qui a créé l'organisation. Mêmes permissions qu'Admin, plus le transfert de propriété et la suppression de l'organisation. Exactement un Propriétaire par organisation.             |
| Admin        | Contrôle complet de l'organisation. Gère membres, fournisseurs, image de marque, gouvernance, rétention, journal d'audit et tout ce qui se trouve en dessous.                                   |
| Développeur  | Le siège construction-et-intégration. Crée et modifie agents et automatisations, configure intégrations et serveurs MCP, gère les clés API. Pas d'accès aux surfaces d'admin.                   |
| Éditeur      | Le siège curation de contenu. Téléverse et modifie le contenu de la base, gère produits, clients, fournisseurs et sites web, répond aux conversations, décide des approbations, modifie agents. |
| Membre       | Le consommateur en lecture seule. Discute avec l'IA et les agents, lit la base de connaissances, lit conversations et approbations. Ne peut écrire dans aucune de ces surfaces.                 |
| Désactivé    | Compte suspendu. La connexion est refusée pour cette organisation. L'enregistrement utilisateur sous-jacent reste afin que le compte puisse être réactivé par un changement de rôle.            |

`Propriétaire` est un sur-ensemble strict d'`Admin` — chaque permission d'Admin ci-dessous appartient aussi au Propriétaire. La matrice à partir d'ici liste `Admin` pour garder les colonnes courtes.

## Matrice de permissions

La matrice est regroupée par surface produit. `✓` signifie que le rôle a l'action ; `—` signifie que l'action est cachée ou refusée pour le rôle.

### Chat IA

| Action                             | Membre | Éditeur | Développeur | Admin |
| ---------------------------------- | ------ | ------- | ----------- | ----- |
| Créer et envoyer des messages      | ✓      | ✓       | ✓           | ✓     |
| Voir son propre historique de chat | ✓      | ✓       | ✓           | ✓     |
| Choisir un agent dans le chat      | ✓      | ✓       | ✓           | ✓     |

### Base de connaissances

| Action                                          | Membre | Éditeur | Développeur | Admin |
| ----------------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir toutes les entrées                         | ✓      | ✓       | ✓           | ✓     |
| Téléverser, modifier ou supprimer des documents | —      | ✓       | ✓           | ✓     |
| Gérer Produits, Clients, Fournisseurs           | —      | ✓       | ✓           | ✓     |
| Ajouter et configurer le crawling de sites      | —      | ✓       | ✓           | ✓     |

### Conversations

| Action                                       | Membre | Éditeur | Développeur | Admin |
| -------------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les conversations                       | ✓      | ✓       | ✓           | ✓     |
| Répondre aux clients                         | —      | ✓       | ✓           | ✓     |
| Fermer, rouvrir ou archiver une conversation | —      | ✓       | ✓           | ✓     |
| Marquer une conversation comme spam          | —      | ✓       | ✓           | ✓     |

### Approbations

| Action                           | Membre | Éditeur | Développeur | Admin |
| -------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les approbations en attente | ✓      | ✓       | ✓           | ✓     |
| Approuver ou refuser une action  | —      | ✓       | ✓           | ✓     |

### Agents

| Action                     | Membre | Éditeur | Développeur | Admin |
| -------------------------- | ------ | ------- | ----------- | ----- |
| Voir la liste des agents   | —      | ✓       | ✓           | ✓     |
| Créer ou modifier un agent | —      | ✓       | ✓           | ✓     |
| Supprimer un agent         | —      | ✓       | ✓           | ✓     |

### Automatisations

| Action                                | Membre | Éditeur | Développeur | Admin |
| ------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir la liste des automatisations     | —      | —       | ✓           | ✓     |
| Créer ou modifier une automatisation  | —      | —       | ✓           | ✓     |
| Publier et activer une automatisation | —      | —       | ✓           | ✓     |
| Voir les logs d'exécution             | —      | —       | ✓           | ✓     |

### Intégrations, MCP, clés API

| Action                         | Membre | Éditeur | Développeur | Admin |
| ------------------------------ | ------ | ------- | ----------- | ----- |
| Voir les intégrations          | —      | —       | ✓           | ✓     |
| Configurer les intégrations    | —      | —       | ✓           | ✓     |
| Configurer les serveurs MCP    | —      | —       | ✓           | ✓     |
| Créer ou révoquer des clés API | —      | —       | ✓           | ✓     |

### Administration de l'organisation

| Action                                                     | Membre | Éditeur | Développeur | Admin |
| ---------------------------------------------------------- | ------ | ------- | ----------- | ----- |
| Voir les paramètres de l'organisation                      | —      | —       | —           | ✓     |
| Modifier le nom et l'image de marque                       | —      | —       | —           | ✓     |
| Configurer les Fournisseurs IA                             | —      | —       | —           | ✓     |
| Configurer la gouvernance (budgets, rétention, garde-fous) | —      | —       | —           | ✓     |
| Lire et exporter le journal d'audit                        | —      | —       | —           | ✓     |
| Ajouter ou retirer des membres                             | —      | —       | —           | ✓     |
| Changer le rôle des membres                                | —      | —       | —           | ✓     |
| Gérer les équipes                                          | —      | —       | —           | ✓     |
| Déposer des demandes des personnes concernées              | —      | —       | —           | ✓     |

### Réservé au Propriétaire

Seul le Propriétaire peut faire ceci :

- **Transférer la propriété** à un autre membre (rétrograde le Propriétaire actuel en Admin).
- **Supprimer l'organisation** — retire ses agents, automatisations, fournisseurs et intégrations ; chaque membre perd l'accès. C'est irréversible.

## Comment les vérifications de rôle sont appliquées

Les rôles sont vérifiés côté serveur sur chaque query, mutation et action Convex — les boutons cachés dans l'interface sont un confort, pas la barrière. Une page qui « ne devrait pas s'afficher » est tout de même refusée avec `insufficient role` si tu l'atteins par URL. Le rôle `Désactivé` court-circuite le reste de la matrice : l'écran d'accès refusé est la seule surface qu'un utilisateur Désactivé voit.

La règle des deux Admins minimum est appliquée lors d'un changement de rôle et lors du retrait d'un membre, afin qu'une organisation ne se retrouve jamais sans Admin ou avec un seul. La même règle ne s'applique pas au Propriétaire : une organisation avec un Propriétaire et un Admin est légale parce que le Propriétaire est lui-même un Admin.

## Où cela s'insère

Membres et rôles est la page que toute autre page admin présuppose. [Authentification](/fr/self-hosted/admin/authentication) décide _qui peut se connecter du tout_ et par quelle méthode ; [Fournisseurs IA](/fr/platform/admin/providers) décide _quels modèles l'organisation peut faire tourner_ ; [Gouvernance](/fr/platform/admin/governance) décide _quelles règles s'appliquent à ce qu'ils font_ — aucune de ces questions n'a de réponse utile tant que tu n'as pas décidé qui peut faire quoi, et c'est ici que cela vit.

L'étape suivante dépend de la question avec laquelle tu es venu. Pour la connexion au-delà du couple courriel et mot de passe, [Authentification](/fr/self-hosted/admin/authentication) couvre SSO et en-têtes de confiance. Pour regrouper des membres en accès partagé, [Équipes](/fr/platform/admin/teams) est la page. Pour auditer qui a fait quoi, le journal d'audit vit sous [Gouvernance](/fr/platform/admin/governance).
