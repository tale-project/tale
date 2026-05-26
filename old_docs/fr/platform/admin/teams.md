---
title: Équipes
description: Grouper les membres en équipes pour cadrer quels documents, conversations et connaissances d'agent chaque groupe voit par défaut.
---

Les équipes sont la manière de découper une organisation en Ingénierie, Ventes, Support, Juridique — ou la forme que ta boîte a réellement — et de décider quel savoir chaque tranche voit par défaut. Une équipe est un groupement souple : elle ne change pas les rôles, ne change pas les permissions et ne contrôle pas la connexion. Ce qu'elle change, c'est quels documents et conversations remontent dans les vues filtrées de chaque membre, quel savoir un agent cherche, et à quelle borne s'applique une règle de Gouvernance (un budget, un modèle par défaut, un flag de fonctionnalité). La page vit sous **Paramètres > Équipes** et est réservée à l'Admin.

Le même membre peut appartenir à n'importe quel nombre d'équipes. La plupart des organisations finissent à trois jusqu'à dix — au-delà, ça devient dur à entretenir parce que chaque filtre et chaque règle de Gouvernance bornée à l'équipe doit être rédigée contre plus de tranches que personne ne suit en tête.

## Créer une équipe

Ouvre **Paramètres > Équipes** et clique **Créer une équipe**. La boîte demande deux champs :

1. **Nom de l'équipe** — court, puisqu'il apparaît dans les menus de filtre à travers l'interface. Requis.
2. **Membres** — la checklist sous le nom choisit quels membres rejoignent l'équipe. Un membre peut être sur n'importe quel nombre d'équipes ; si tu laisses la checklist vide, l'Admin qui a créé l'équipe est ajouté automatiquement, de sorte que l'équipe ait au moins un occupant.

Clique **Créer une équipe**. L'équipe apparaît dans la table avec son nom, son compteur de membres et la date de création. Les membres peuvent être ajoutés ou retirés plus tard depuis la ligne de détail de l'équipe via **Membres**.

## Ce que les équipes cadrent réellement

| Surface                   | Ce que pilote l'appartenance à l'équipe                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents**             | Un document peut être tagué à une ou plusieurs équipes au téléversement. Les membres ne voient que les documents tagués à leurs équipes quand un filtre d'équipe est actif.                                           |
| **Conversations**         | Une conversation peut être assignée à une équipe. Les boîtes par équipe laissent Support voir les threads support et Sales voir les threads sales sans contamination croisée.                                         |
| **Agents**                | L'onglet **Connaissances** d'un agent peut être restreint aux connaissances taguées à l'équipe, de sorte qu'un agent Support ne cherche que du contenu tagué Support.                                                 |
| **Règles de Gouvernance** | Budgets, modèles par défaut, accès aux modèles et contrôle des fonctionnalités (voir [Gouvernance](/fr/platform/admin/governance)) peuvent être bornés par équipe. Précédence : utilisateur > équipe > rôle > défaut. |

Les équipes ne contrôlent _pas_ si quelqu'un _voit_ la surface tout court — c'est le travail du rôle. Un Éditeur peut toujours atteindre Conversations ; ce que les équipes décident, c'est quelles conversations entrent dans le filtre par défaut.

## Gérer les membres d'une équipe

Ouvre la ligne d'une équipe et clique **Membres**. Le tiroir affiche la liste de membres actuelle avec une checklist de membres de l'organisation à ajouter ou retirer. L'indication checklist de membres rappelle à l'Admin qu'un membre peut être sur plusieurs équipes et que l'équipe se retrouvera avec l'Admin lui-même si personne d'autre n'est sélectionné.

## Managers d'équipe

Les équipes n'ont pas de rôles de manager formels — chaque membre de l'organisation porte le même rôle dans toutes les équipes auxquelles il appartient. Pour une administration déléguée au niveau de l'équipe, sers-toi du rôle **Éditeur** au niveau de l'organisation et borne son accès aux connaissances et aux agents via la même table de cadrage ci-dessus à son équipe. Ça garde la matrice de rôles dans [Membres et rôles](/fr/platform/admin/members-and-roles) faisant autorité et évite un système de permissions parallèle.

## Fournisseurs d'identité externes

Quand SSO ou les en-têtes de confiance sont actifs, le fournisseur d'identité externe est la seule source de vérité pour l'appartenance aux équipes. Tale lit l'en-tête équipes (ou le claim de groupe IdP) à chaque connexion et met à jour la liste d'équipes de l'utilisateur. Les édits faits dans **Paramètres > Équipes** pour ces utilisateurs seront écrasés à la prochaine connexion. Voir [Authentification](/fr/self-hosted/admin/authentication) pour les noms d'en-têtes et la configuration du mapping de groupes.

## Où cela s'insère

Les équipes sont la couche de cadrage des connaissances et des conversations. Elles ne changent pas les rôles ou les permissions — ceux-là vivent sur [Membres et rôles](/fr/platform/admin/members-and-roles). Sers-toi des équipes pour décider qui voit quels documents et quels canaux de conversation par défaut ; sers-toi des rôles pour décider ce que chaque membre peut faire. Une règle de Gouvernance bornée à l'équipe (un budget plus serré, un modèle par défaut moins cher, un toggle de fonctionnalité) est la manière de composer les deux systèmes sans recouvrement.

Quand une équipe dépasse ce qu'un seul Éditeur peut curer seul, le pas suivant naturel est de la scinder ; quand elle rétrécit au point que deux équipes ont les mêmes membres, fusionne-les. Les deux édits sont bon marché depuis cette page.
