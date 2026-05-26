---
title: Crawling
description: Comment Tale transforme une entité Sites web en connaissances — enregistrement du domaine, découverte d'URL pilotée par sitemap, re-scans planifiés, et la vue des pages indexées.
---

Un site web est la forme structurée pour « une page publique que l'agent doit connaître ». Tu donnes à Tale un domaine et un intervalle d'analyse ; le crawler découvre les URL, récupère les pages, extrait le contenu principal, découpe et embed le texte, et sert les chunks à la réponse — exactement comme pour les Documents. Cette page te donne le modèle mental et déroule ce que tu vois quand un site passe de l'ajout à l'indexation.

Le crawling est une moitié de l'histoire Sites web. L'autre — ce que contient l'enregistrement structuré Site web et comment les agents le lisent — vit dans [Données structurées](/fr/platform/knowledge/structured-data). Lis celle-là d'abord si la question est « est-ce un site ou un document » ; lis celle-ci si la question est « que fait vraiment le crawler ».

## Ajouter un site web

Ouvre **Connaissance > Sites web** et clique **Ajouter un site web**. Deux champs : **Domaine** (par exemple `exemple.com`) et **Intervalle d'analyse** (toutes les heures, toutes les 6 heures, toutes les 12 heures, tous les jours, tous les 5 jours, tous les 7 jours, tous les 30 jours). Tale normalise le domaine — `https://`, `www.`, barres obliques finales sont tolérées — et rejette tout ce qui ne parse pas comme nom d'hôte. Enregistre, et le site atterrit dans le tableau avec le statut **En cours d'analyse**.

Il n'y a pas de champ d'authentification, pas de liste d'inclusion par chemin, pas de liste d'exclusion par chemin sur le formulaire. Le crawler traite le domaine comme une surface publique ; tout ce qui demande une session, un en-tête ou un contournement sort du périmètre Sites web. Pour du contenu privé, téléverse des [Documents](/fr/platform/knowledge/documents) ou branche une [intégration](/fr/platform/integrations/overview).

## Comment les URL sont découvertes

Le crawler essaie d'abord la voie coopérative et bascule sur la voie brutale.

Le premier essai est la sitemap du site. Le crawler résout la page d'accueil, demande à `ultimate-sitemap-parser` de parcourir chaque `sitemap.xml` et chaque index de sitemap qu'il trouve — y compris les sitemaps gzip et celles déclarées dans `robots.txt` — et collecte toutes les URL que le site lui-même a publiées. Les sites qui maintiennent leur sitemap obtiennent une liste d'URL propre et complète, sans deviner via le graphe de liens.

Quand la sitemap manque, est cassée ou vide, le crawler bascule sur une marche en largeur depuis la page d'accueil. Il suit uniquement les liens internes au domaine, laisse tomber les liens externes et les liens vers les réseaux sociaux, et retire la navigation et le pied de page avant d'extraire le contenu. La voie de repli couvre les sites sans sitemap ; elle n'égale pas la complétude d'une sitemap bien tenue.

## Le calendrier des scans

L'intervalle d'analyse que tu as choisi décide à quelle fréquence le crawler redécouvre les URL et récupère à nouveau les pages. Derrière le tableau, un scheduler se réveille à chaque intervalle, demande au store quels sites sont dus, et les exécute avec une concurrence bornée. Les nouveaux sites n'ont pas d'horodatage de dernière analyse, donc ils sont ramassés au prochain tick du scheduler et commencent à s'analyser dans les secondes après leur ajout.

Chaque scan est incrémental : les pages inchangées sont sautées, les pages modifiées sont ré-extraites et ré-embedded, les nouvelles pages sont ajoutées, les pages supprimées tombent de l'index. Les agents pointés vers le site voient le nouveau contenu au prochain retrieval.

## Ce que te dit le tableau

Chaque ligne montre le domaine, l'intervalle d'analyse, le statut, l'horodatage de dernière analyse et un pourcentage de pages indexées. Le statut se lit **Inactif** entre les scans, **En cours d'analyse** pendant qu'un scan tourne, **Actif** quand un scan a réussi, **Erreur** quand le dernier scan a échoué, ou **Suppression en cours** quand une ligne est retirée. Le pourcentage est `crawlé / total` issu du dernier scan — survole pour les chiffres bruts.

Ouvre une ligne pour lire le titre découvert, la description et la date de création du site. Clique **Voir les pages** pour la liste des pages — chaque URL que le crawler a indexée, avec le nombre de mots par page, le nombre de chunks, l'horodatage de dernier crawl, et une boîte de recherche qui parcourt les chunks indexés.

## Où cela s'inscrit

Le crawling est la manière peu coûteuse d'amener un site public dans le contexte d'un agent. Tu donnes un domaine et une cadence, le reste est le problème du crawler — découverte de sitemap, repli sur le graphe de liens, re-scans planifiés, indexation incrémentale. Le compromis : le crawler ne voit que ce qu'un visiteur anonyme voit. Tout ce qui est derrière un login vit dans [Documents](/fr/platform/knowledge/documents) ou dans une [intégration](/fr/platform/integrations/overview). La lecture suivante à mettre en file est [Données structurées](/fr/platform/knowledge/structured-data) — elle couvre comment l'enregistrement Site web et les pages indexées s'inscrivent aux côtés des Clients, Produits et Fournisseurs dans la base de connaissances.
