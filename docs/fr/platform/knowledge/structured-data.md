---
title: Données structurées
description: Gère Produits, Clients et Fournisseurs comme enregistrements structurés interrogeables par l'IA.
---

Les données structurées sont la moitié lignes-et-colonnes de la base de connaissances — les trois sections (**Produits**, **Clients**, **Fournisseurs**) qui stockent des enregistrements métier avec des champs fixes que l'agent IA peut interroger à côté des documents et des sites web crawlés. Le public visé : Éditeur ou Développeur qui entretient ces enregistrements, un par un ou par import CSV. Cette page couvre ce que contient chaque section, le format CSV, et comment restreindre quelles entités voit un agent donné.

## Produits

La section Produits stocke ton catalogue produit. Chaque enregistrement contient nom, description, URL d’image, stock, prix, devise, catégorie et statut.

Les produits peuvent être ajoutés un par un ou importés en masse via CSV. Le format CSV n’a pas d’en-tête ; les colonnes suivent cet ordre :

```text
name, description, imageUrl, stock, price, currency, category, status
```

Valeurs de statut valides : `active`, `inactive`, `draft`, `archived`. Valeurs invalides retombent sur `draft`.

## Clients

La section Clients stocke ta liste de clients. Chaque client a une adresse de courriel, une locale, un statut et des métadonnées personnalisées optionnelles. Les clients importés ont par défaut le statut `churned`.

Import CSV :

```text
email, locale
```

Valeurs de locale valides : `en`, `de`, `es`, `fr`, `it`, `nl`, `pt`, `zh`. Valeurs invalides retombent sur `en`.

## Fournisseurs

La section Fournisseurs stocke les enregistrements de fournisseurs et partenaires. Les données Fournisseur sont interrogeables par l’IA et utilisables dans les workflows automatisés. Le même import CSV que Clients fonctionne aussi ici.

## Utiliser des données structurées dans les agents

Les enregistrements structurés sont indexés dans le même store que les documents. Les agents avec accès aux connaissances peuvent chercher sur tous les types. Pour limiter un agent à un sous-ensemble — par exemple un agent commercial qui ne voit que Produits et Clients — configure son onglet Base de connaissances. Voir [Créer un agent](/fr/platform/agents/create).

## Où cela s'insère

Les données structurées sont la moitié de la base de connaissances qui a des lignes et des colonnes, plutôt que des paragraphes et des titres. La moitié texte libre (documents, sites web crawlés) est pour le contenu en prose ; cette moitié-ci est pour les entités — les catalogues, listes de clients et enregistrements de fournisseurs que l'IA cite quand elle répond à des questions domaine-spécifiques. Les deux moitiés sont indexées dans le même store et joignables via la même recherche de connaissances ; un agent qui s'ancre dans les deux les mêle de façon fluide.

Pour la moitié texte libre, [Base de connaissances](/fr/platform/workspace/knowledge-base) couvre le téléversement de documents et le crawling de sites. Pour les contrôles côté agent qui décident quelles entités voient les agents, [Créer un agent → Connaissances](/fr/platform/agents/create) est la page suivante.
