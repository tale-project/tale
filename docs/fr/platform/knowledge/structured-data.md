---
title: Données structurées
description: La base de connaissances Tale ship quatre entités structurées intégrées — Clients, Produits, Fournisseurs, Sites web — aux côtés des Documents. Cette page donne le modèle mental pour choisir un enregistrement structuré plutôt qu'un document.
---

La base de connaissances Tale ship deux formes côte à côte. Les documents sont des blobs de texte dont l'agent récupère des chunks ; les enregistrements structurés sont des lignes typées dont l'agent lit des champs. La forme que tu choisis est la décision la plus importante pour la manière dont un agent utilisera tes connaissances — un mauvais choix et l'agent dilue une réponse claire ou devine une valeur que tu as au dossier.

Cette page te donne le modèle mental pour décider quand chaque forme est la bonne. Lis-la avant de charger un dossier de fichiers ; reviens-y quand tu es tenté de téléverser un tableur en PDF.

## Documents vs enregistrements structurés

Un document est libre : le pipeline d'indexation extrait le texte, le découpe en chunks, embed les chunks et les sert via RAG à la réponse. L'agent voit des passages et les cite par nom de fichier. C'est la bonne forme quand la source est de la prose — contrats, manuels, articles de base de connaissances, notes de réunion.

Un enregistrement structuré est typé : l'entité a des champs connus (un client a `nom`, `email`, `secteur` ; un produit a `sku`, `prix`, `stock`). L'agent lit les champs directement, joint entre entités et répond avec la valeur. C'est la bonne forme quand la source est une ligne de base de données — comptes, commandes, pièces, fournisseurs.

## Les quatre modèles intégrés

Quatre types d'entités structurées sont fournis dans chaque instance Tale :

- **Clients** — les personnes et organisations avec qui tu fais affaire.
- **Produits** — ce que tu vends.
- **Fournisseurs** — ceux à qui tu achètes.
- **Sites web** — pages qu'un crawler récupère selon une planification ; structurées comme URL + contenu crawlé + métadonnées.

Plus **Documents** pour tout le reste.

## Modèles de contenu pour des formes personnalisées

Quand les quatre intégrés ne suffisent pas, les modèles de contenu te laissent définir un type d'enregistrement structuré sur mesure. Un modèle de contenu est une définition au format JSON-schema sous [gouvernance modèles de contenu](/fr/platform/admin/governance/content-models) : nomme l'entité, déclare ses champs, fixe l'accès au niveau du champ, et le nouveau type apparaît aux côtés des Clients, Produits, Fournisseurs et Sites web.

Les modèles de contenu coûtent de l'attention gouvernance — chaque politique d'accès et de rétention des champs est à toi de fixer — donc vas-y quand les données sont véritablement une nouvelle forme, pas une légère variation d'un des quatre intégrés.

## Mis bout à bout — un agent CRM

Un agent CRM qui répond « où en est-on avec Acme ? » utilise les deux formes. L'entité Clients a l'enregistrement canonique d'Acme — nom, contact principal, secteur, statut. Les documents tiennent les notes d'appel et les contrats. L'agent lit les champs du client directement, récupère des chunks dans les documents et répond avec les deux : le statut structuré depuis Clients, le contexte récent depuis la note d'appel la plus récente.

Sans enregistrements structurés, l'agent doit trouver Acme par nom à travers des PDF et risque de confondre deux clients aux noms similaires. Sans documents, l'agent connaît le statut d'Acme mais ne peut pas te dire ce qui s'est passé à l'appel de mardi.

## Quand y recourir

| Utilise … quand                                             | Documents | Enregistrement structuré |
| ----------------------------------------------------------- | --------- | ------------------------ |
| La source est de la prose libre                             | ✓         |                          |
| La source a des champs typés et tu veux les valeurs exactes |           | ✓                        |
| Tu dois joindre sur de nombreux enregistrements             |           | ✓                        |
| L'agent doit citer les passages par emplacement             | ✓         |                          |

Les documents libres et les enregistrements typés ne sont pas interchangeables ; la mauvaise forme rend l'agent moins bon au travail que tu voulais.

## Où cela s'inscrit

Les données structurées sont la couture entre tes données opérationnelles et la surface agent. Utilise les quatre intégrés pour ce qu'ils couvrent ; va vers les [modèles de contenu](/fr/platform/admin/governance/content-models) quand une cinquième forme apparaît. La lecture suivante à mettre en file est [Documents](/fr/platform/knowledge/documents) — elle couvre le pipeline d'indexation des documents et comment les agents vont chercher des chunks à la réponse.
