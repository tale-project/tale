---
title: Équipes
description: Organise les membres en équipes et cadre la visibilité des connaissances.
---

Les équipes permettent de grouper les membres — Ingénierie, Sales, Support, Legal — et de contrôler quelles connaissances chaque groupe voit. Une équipe est un regroupement souple : elle n’affecte pas la connexion, les rôles ou les permissions. Elle _affecte_ les documents et conversations qui apparaissent dans les vues filtrées de chaque membre.

La gestion des équipes est sous **Paramètres > Équipes** et réservée aux Admins.

## Créer une équipe

1. Va dans **Paramètres > Équipes** et clique **Créer une équipe**.
2. Entre un nom d’équipe — court, il apparaît dans les menus de filtres partout dans l’UI.
3. Optionnellement ajoute une description.
4. Clique **Créer**.

Les membres sont ajoutés séparément depuis la page de détail de l’équipe. La même personne peut appartenir à plusieurs équipes.

## Ce qu’affectent les équipes

| Domaine                     | Cadrage par équipe                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents**               | un document peut être tagué sur une ou plusieurs équipes à l’upload. Les membres voient seulement les documents tagués sur leurs équipes quand un filtre est actif. |
| **Conversations**           | les conversations peuvent être assignées à une équipe. Les inboxes par équipe laissent Support voir ses fils sans pollution Sales.                                  |
| **Agents**                  | l’onglet Base de connaissances d’un agent peut être restreint aux connaissances taguées par équipe pour qu’un agent Support ne cherche que du contenu Support.      |
| **Budgets et accès modèle** | les politiques de gouvernance (voir [Gouvernance](/fr/platform/admin/governance)) peuvent être cadrées par équipe.                                                  |

## Managers d’équipe

Les équipes n’ont pas de rôles de manager formels — les permissions viennent du rôle au niveau de l’organisation (Admin, Développeur, Éditeur, Membre). Pour une administration déléguée au niveau équipe, utilise le rôle Éditeur et cadre son accès agents/connaissances à son équipe.

## Fournisseurs d’identité externes

Quand SSO ou Trusted En-têtes sont utilisés, l'IdP externe est la source unique de vérité pour l'appartenance aux équipes. Tale lit l'en-tête des équipes à chaque connexion et met à jour la liste des équipes de l'utilisateur. Voir [Authentification](/fr/self-hosted/admin/authentication).

## Où ça s'inscrit

Les équipes sont la couche de cadrage des connaissances et des conversations. Elles ne changent ni les rôles ni les permissions — qui vivent sur [Membres et rôles](/fr/platform/admin/members-and-roles). Utilise les équipes pour décider qui voit quels documents et quels canaux de conversation par défaut ; va vers les rôles pour décider ce que chaque membre peut faire. La plupart des organisations finissent avec trois à dix équipes ; au-delà, la maintenance devient lourde.
