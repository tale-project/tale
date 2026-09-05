---
title: Données structurées
description: La base de connaissances de Tale embarque trois entités structurées intégrées — Contacts, Produits, Sites web — à côté des Documents.
---

La base de connaissances de Tale embarque deux formes côte à côte. Les documents sont du texte dont l’agent récupère des fragments ; les fiches structurées sont des lignes typées dont l’agent lit les champs. La forme que tu choisis est la décision la plus lourde dans la façon dont un agent exploitera tes connaissances — trompe-toi et l’agent dilue une réponse claire, ou devine une valeur que tu as pourtant en stock.

Cette page te donne le modèle mental pour savoir quand chaque forme est la bonne. Lis-la avant de charger un dossier de fichiers ; reviens-y quand tu es tenté de téléverser un tableur en PDF.

## Documents ou fiches structurées

Un document est libre : le pipeline d’indexation extrait le texte, le découpe, calcule les embeddings et sert des passages par récupération au moment de répondre. L’agent voit des passages et les cite par source. C’est la bonne forme quand le contenu est de la prose — contrats, manuels, articles de base de connaissances, comptes rendus de réunion.

Une fiche structurée est typée : l’entité a des champs connus (un contact a un nom, un e-mail, un secteur ; un produit a un SKU, un prix, un stock). L’agent lit les champs directement, croise les entités entre elles et répond avec la valeur. C’est la bonne forme quand la source est une ligne de base de données — comptes, commandes, pièces, fiches fournisseurs.

## Les trois entités intégrées

Trois onglets structurés côtoient **Documents** et **Entrées de connaissances** dans la base de connaissances :

- **Contacts** — les personnes et organisations avec qui tu fais affaire, clients comme fournisseurs. L’annuaire réunit les deux, si bien qu’un fournisseur est un contact chez qui tu achètes.
- **Produits** — ce que tu vends.
- **Sites web** — des sites publics qu’un crawler va chercher selon un planning ; la fiche porte le domaine et les réglages d’analyse, les pages indexées portent le contenu ([Exploration de sites web](/fr/platform/knowledge/crawling)).

Les fiches structurées partagent les leviers de portée par équipe de la base de connaissances : une fiche limitée à une équipe est invisible hors de l’équipe, exactement comme un document limité à une équipe.

## Des modèles de contenu pour les formes sur mesure

Quand les trois entités intégrées ne conviennent pas, les modèles de contenu te laissent définir un type de fiche structurée sur mesure : nomme l’entité, déclare ses champs, règle l’accès champ par champ, et le nouveau type apparaît à côté des types intégrés. Les définitions vivent dans les [modèles de contenu de la gouvernance](/fr/platform/admin/governance/content-models).

<Note>

Les modèles de contenu coûtent de l’attention de gouvernance — l’accès et la politique de conservation de chaque champ sont à ta charge. Choisis-les quand la donnée est réellement une forme nouvelle, pas une variation légère d’une des trois entités intégrées.

</Note>

## En pratique — un agent CRM

Un agent CRM qui répond à « où en est-on avec Acme ? » utilise les deux formes. L’entité Contacts tient la fiche canonique — nom, contact principal, secteur, statut. Les documents tiennent les notes d’appel et les contrats. L’agent lit directement les champs du contact, récupère des passages dans les documents et répond avec les deux : le statut structuré depuis Contacts, le contexte le plus frais depuis la dernière note d’appel.

Sans fiches structurées, l’agent doit retrouver Acme par son nom à travers des PDF et risque de confondre deux contacts aux noms proches. Sans documents, l’agent connaît le statut d’Acme mais ne peut pas te dire ce qui s’est passé pendant l’appel de mardi.

## Quand y recourir

| Choisis … quand                                             | Documents | Fiche structurée |
| ----------------------------------------------------------- | --------- | ---------------- |
| La source est de la prose libre                             | ✓         |                  |
| La source a des champs typés et tu veux des valeurs exactes |           | ✓                |
| Tu dois croiser de nombreuses fiches                        |           | ✓                |
| L’agent doit citer des passages par leur emplacement        | ✓         |                  |

## Où cela s’inscrit

Les données structurées sont la couture entre tes données opérationnelles et la surface agent. Utilise les trois entités intégrées pour ce qu’elles couvrent ; passe aux [modèles de contenu](/fr/platform/admin/governance/content-models) quand une quatrième forme apparaît. La lecture suivante à mettre en file est [Documents](/fr/platform/knowledge/documents) — le pipeline d’indexation qui sert la moitié non structurée.
