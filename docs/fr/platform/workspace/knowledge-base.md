---
title: Base de connaissances
description: Téléverse, organise et cherche dans les documents et les sites web crawlés que l'IA prend comme ancrage pour ses réponses.
---

La base de connaissances est l'endroit où Tale stocke les informations sur lesquelles l'IA s'ancre pour répondre. Tout ce que tu y ajoutes devient cherchable par chaque agent de l'organisation — fichiers téléversés, sites web indexés par le crawler, enregistrements structurés importés. Cette page couvre les deux sections principales côté utilisateur : **Documents** pour les fichiers que tu téléverses ou synchronises, et **Sites web** pour les sources crawlées. Le rôle Éditeur ou plus est requis pour ajouter, modifier ou supprimer des entrées ; les Membres peuvent lire le catalogue.

Pour les sections de données structurées (Produits, Clients, Fournisseurs), voir [Données structurées](/fr/platform/knowledge/structured-data) — la même surface de connaissances, avec une forme tabulaire au lieu de fichiers libres.

## Documents

Les documents sont le cœur de la base de connaissances. Téléverse des fichiers directement depuis l'appareil, synchronise-les depuis Microsoft 365, ou lance une comparaison contre un document existant. Une fois un fichier indexé, le contenu est cherchable par chaque agent qui a accès au dossier où il vit.

### Téléverser des documents

Pour téléverser un ou plusieurs fichiers, ouvre **Base de connaissances > Documents** et clique sur **Téléverser** dans le menu d'actions en haut à droite. La boîte accepte les fichiers déposés dans la zone de dépôt ou parcourus depuis le sélecteur — choisis-en plusieurs à la fois si tu as un lot. Assigne les documents à une ou plusieurs équipes pour cadrer dans quelles vues filtrées par équipe ils apparaissent. Clique sur **Téléverser** pour mettre les fichiers en file ; chacun affiche un indicateur de statut pendant son indexation en arrière-plan.

Les types de fichiers acceptés : PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML et la plupart des formats de fichiers code. La taille maximale est de 100 Mo par fichier par défaut ; les Admins peuvent baisser le plafond par type MIME dans la [politique de téléversement](/fr/platform/admin/governance#upload-policy).

### Organiser en dossiers

Les documents peuvent vivre dans des dossiers pour que l'équipe navigue dans un catalogue profond sans dérouler une liste plate. Utilise le fil d'Ariane en haut du tableau Documents pour passer d'un dossier à l'autre, ou choisis **Nouveau dossier** dans le menu d'actions. Tu peux créer un dossier pendant le téléversement ou à tout moment ; les documents se déplacent entre dossiers depuis le menu d'actions de la ligne.

### Synchroniser depuis Microsoft 365

Si une intégration de compte Microsoft est connectée, **Depuis Microsoft 365** apparaît dans la boîte de téléversement à côté de **Depuis ton appareil**. La choisir ouvre un navigateur pour les sites OneDrive et SharePoint que le compte peut joindre — pick un import ponctuel ou une synchronisation qui garde les fichiers en phase avec le dossier source. Les fichiers importés par cette voie portent un badge de source SharePoint ou OneDrive dans le tableau des documents, donc tu distingues les fichiers synchronisés des téléversements depuis l'appareil.

### Comparer deux documents

Pour diffuser deux documents — une nouvelle version de contrat contre la précédente, une politique rafraîchie contre la spécification —, ouvre le menu d'actions et choisis l'entrée de comparaison. La boîte parcourt le flux téléverser-ou-choisir et rend un diff au niveau du paragraphe. La doctrine complète vit dans [Comparaison de documents](/fr/platform/workspace/document-comparison).

## Sites web

Le suivi de sites web indique au crawler de Tale de visiter et d'indexer les pages d'un domaine donné selon un calendrier. Une fois un site indexé, chaque agent avec accès au web peut répondre aux questions sur son contenu — utile pour les sites de documentation, les wikis internes et tout domaine public que l'équipe cite souvent.

### Ajouter un site web

Pour ajouter un site, ouvre **Base de connaissances > Sites web** et clique sur **Ajouter un site web**. La boîte demande l'URL complète (par exemple `https://docs.example.com`) et un intervalle de scan. Clique sur **Ajouter** pour enregistrer — le crawler récupère la page d'accueil tout de suite et commence à découvrir les liens.

Les sept intervalles de scan pris en charge échangent la fraîcheur contre le coût de crawl :

| Intervalle de scan   | Idéal pour                                    |
| -------------------- | --------------------------------------------- |
| Toutes les heures    | Sites dont le contenu change souvent.         |
| Toutes les 6 heures  | Sites de documentation et wikis d'entreprise. |
| Toutes les 12 heures | Sites semi-actifs.                            |
| Tous les jours       | Sites marketing et blogs.                     |
| Tous les 5 jours     | Contenu plutôt statique.                      |
| Tous les 7 jours     | Sites de référence peu mis à jour.            |
| Tous les 30 jours    | Matériel de référence rarement changé.        |

Pour un contrôle plus fin sur le périmètre de crawl (chemins autorisés, sections ignorées, surcharges robots.txt), voir [Crawling de sites](/fr/platform/knowledge/crawling).

## Où ça s'inscrit

La base de connaissances est le substrat dans lequel chaque agent s'ancre — les documents, sites web et enregistrements structurés que l'IA cite dans ses réponses. Bien la curer, c'est ce qui transforme un assistant générique en un assistant qui connaît tes produits, tes politiques et tes clients. La plupart des gains de qualité au moment de bâtir un nouvel agent viennent du resserrement de son périmètre de connaissances plutôt que d'un changement de modèle.

Pour restreindre ce qu'un agent précis peut chercher au lieu de donner à chaque agent l'accès à tout, la page suivante est [Concepts des agents → Connaissances](/fr/platform/agents/concepts#connaissances). Pour enrichir la base avec des enregistrements structurés, [Données structurées](/fr/platform/knowledge/structured-data) parcourt les entités Produits, Clients et Fournisseurs.
