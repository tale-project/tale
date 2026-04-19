---
title: Base de connaissances
description: Téléverse, organise et cherche dans tes documents et sites crawlés.
---

La base de connaissances est l'endroit où Tale stocke les informations utilisables par l'IA. Tout ce que tu y ajoutes devient cherchable par l'agent via la recherche sémantique. Cette page couvre les deux sections utilisateurs — **Documents** et **Sites web**. Pour les sections de données structurées (Products, Customers, Vendors), voir [Données structurées](/fr/build/knowledge/structured-data).

> **Note :** Modifier la base de connaissances demande le rôle Editor ou plus. Les Members voient tous les éléments mais ne peuvent pas créer, mettre à jour ou supprimer.

## Documents

Les documents sont le cœur de la base. Tu peux téléverser des fichiers ou synchroniser depuis Microsoft OneDrive. Une fois indexé, le contenu est cherchable par l'agent IA.

### Téléverser des documents

1. Va dans Connaissances > Documents.
2. Clique Upload dans le menu d'actions en haut à droite.
3. Dépose les fichiers ou clique pour parcourir. Tu peux en sélectionner plusieurs à la fois.
4. Optionnellement, assigne les documents à une ou plusieurs équipes. Cela contrôle dans quelles vues filtrées ils apparaissent.
5. Clique Upload. Chaque fichier est mis en file d'attente pour traitement. Un indicateur montre la fin de l'indexation.

Types pris en charge : PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML, et la plupart des fichiers code.

Taille maximale : 100 Mo par fichier.

### Organisation en dossiers

Les documents peuvent être rangés en dossiers. Utilise le fil d'Ariane en haut du tableau pour naviguer. Tu crées des dossiers lors du téléversement ou depuis le menu d'actions.

### Synchro Microsoft OneDrive

Si une intégration Microsoft Account est configurée, l'option Sync from OneDrive apparaît dans le menu. Elle importe les documents directement depuis OneDrive sans les télécharger sur ton serveur.

### Comparaison de documents

Tu peux comparer deux documents pour voir les changements. Téléverse une nouvelle version ou sélectionne un document existant, et la plateforme génère un diff détaillé.

Voir [Comparaison de documents](/fr/use/workspace/document-comparison) pour tous les détails.

## Sites web

Le suivi de site web indique au crawler de Tale de visiter et indexer les pages d'un domaine selon un calendrier. Une fois indexé, l'agent IA peut répondre aux questions sur ce site.

### Ajouter un site

1. Va dans Connaissances > Sites web et clique Add website.
2. Entre l'URL complète, par exemple `https://docs.example.com`.
3. Choisis un intervalle de scan, qui contrôle la fréquence à laquelle le crawler revérifie les mises à jour.
4. Clique Add. Le crawler récupère la page d'accueil tout de suite et commence à découvrir les liens.

| Intervalle de scan           | Idéal pour                                    |
| ---------------------------- | --------------------------------------------- |
| Toutes les heures            | sites dont le contenu change souvent.         |
| Toutes les 6 heures (défaut) | sites de documentation et wikis d'entreprise. |
| Toutes les 12 heures         | sites semi-actifs.                            |
| Tous les jours               | sites marketing et blogs.                     |
| Tous les 5 jours             | contenu relativement statique.                |
| Tous les 7 jours             | sites de référence peu mis à jour.            |
| Tous les 30 jours            | contenu de référence rarement modifié.        |

Pour plus de contrôle sur le crawling, voir [Crawling de sites](/fr/build/knowledge/crawling).
