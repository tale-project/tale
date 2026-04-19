---
title: Données structurées
description: Gère Produits, Clients et Fournisseurs comme enregistrements structurés interrogeables par l'IA.
---

Les sections de données structurées de la base de connaissances stockent des enregistrements métier que l'agent IA peut interroger à côté des documents et sites. Contrairement aux documents libres, les entrées structurées ont des champs fixes et peuvent être importées en masse.

## Produits

La section Produits stocke ton catalogue produit. Chaque enregistrement contient nom, description, URL d'image, stock, prix, devise, catégorie et statut.

Les produits peuvent être ajoutés un par un ou importés en masse via CSV. Le format CSV n'a pas d'en-tête ; les colonnes suivent cet ordre :

```text
name, description, imageUrl, stock, price, currency, category, status
```

Valeurs de statut valides : `active`, `inactive`, `draft`, `archived`. Valeurs invalides retombent sur `draft`.

## Clients

La section Clients stocke ta liste de clients. Chaque client a une adresse e-mail, une locale, un statut et des métadonnées personnalisées optionnelles. Les clients importés ont par défaut le statut `churned`.

Import CSV :

```text
email, locale
```

Valeurs de locale valides : `en`, `de`, `es`, `fr`, `it`, `nl`, `pt`, `zh`. Valeurs invalides retombent sur `en`.

## Fournisseurs

La section Fournisseurs stocke les enregistrements de fournisseurs et partenaires. Les données Fournisseur sont interrogeables par l'IA et utilisables dans les workflows automatisés. Le même import CSV que Clients fonctionne aussi ici.

## Utiliser des données structurées dans les agents

Les enregistrements structurés sont indexés dans le même store que les documents. Les agents avec accès aux connaissances peuvent chercher sur tous les types. Pour limiter un agent à un sous-ensemble — par exemple un agent commercial qui ne voit que Produits et Clients — configure son onglet Connaissances. Voir [Créer un agent](/fr/platform/agents/create).
