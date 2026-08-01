---
title: Exploration de sites web
description: Comment Tale transforme un site web en connaissances — enregistrement du domaine, découverte des URL par sitemap, ré-analyses planifiées et vue des pages indexées.
---

Un site web est la forme que prend, dans la base de connaissances, « un site public que l’agent doit connaître ». Tu confies à Tale un domaine et un intervalle d’analyse ; le crawler découvre les URL, va chercher les pages, extrait le contenu principal, découpe le texte et calcule ses embeddings, puis sert les fragments au moment de répondre, exactement comme pour les Documents. Quand tu veux des pages précises plutôt qu’un site entier, confie-lui une liste d’URL — le même pipeline tourne alors exactement sur les pages que tu nommes. Cette page parcourt ce que tu vois entre l’ajout d’un domaine et les citations de ses pages par les agents.

<Frame caption="Ajouter un site web — en mode « Site web entier », un domaine plus un intervalle d’analyse, et le formulaire est complet.">

![La boîte de dialogue Ajouter un site web de l’onglet Sites web, demandant un domaine et un intervalle d’analyse réglé par défaut sur toutes les 6 heures.](/images/platform/websites-add-dialog.webp)

</Frame>

## Ajouter un site web

Ouvre **Connaissances > Sites web** et clique sur **Ajouter un site web**. Le **Type de source** décide de ce que couvre la source : **Site web entier** — le réglage par défaut — explore tout ce qui se découvre sur le domaine, **Liste d'URL** indexe exactement les pages que tu colles (la section suivante y revient). En mode Site web entier, la boîte de dialogue a deux champs : **Domaine** (par exemple `example.com`) et **Intervalle d'analyse** — toutes les heures, toutes les 6 heures (le réglage par défaut), toutes les 12 heures, tous les jours, tous les 5, 7 ou 30 jours. Tale normalise le domaine — `https://`, `www.` et les barres obliques finales sont tolérés — et rejette tout ce qui ne se lit pas comme un nom d’hôte. Clique sur **Enregistrer** ; le planificateur ramasse les nouveaux sites à son prochain passage, la première analyse démarre donc en quelques secondes.

<Note>

Il n’y a ni champ d’authentification ni liste de chemins à inclure ou exclure — le crawler voit exactement ce qu’un visiteur anonyme voit. Tout ce qui vit derrière une connexion relève de [Documents](/fr/platform/knowledge/documents) ou d’une [connector](/fr/platform/connectors/overview).

</Note>

## Ajouter une liste d’URL

Passe le **Type de source** sur **Liste d'URL** quand tu veux des pages précises, pas un site entier — un rapport ici, une page de tarifs là, quelques PDF. Colle une URL par ligne dans le champ **URL** ; seules ces pages sont chargées et indexées, le crawler ne suit aucun lien au-delà. Les lignes peuvent mélanger plusieurs sites web : la boîte de dialogue les regroupe en une source par site web, un collage qui couvre trois domaines crée donc trois lignes. Recoller une liste pour un site qui en a déjà une ajoute les nouvelles URL à la source existante — rien ne se perd, et l’intervalle d’analyse passe à ton nouveau choix. Les listes se ré-analysent à la même cadence que les sites entiers ; leurs lignes portent le badge **Liste d'URL** dans la table.

## Comment les URL sont découvertes

Le crawler tente d’abord la voie coopérative. Il résout la page d’accueil et parcourt chaque sitemap que le site publie — `sitemap.xml`, index de sitemaps, sitemaps compressés ou déclarés dans le robots.txt — pour collecter la liste d’URL que le site entretient lui-même. Les sites au sitemap sain obtiennent une couverture complète, sans rien deviner.

Quand le sitemap manque, est cassé ou vide, le crawler se rabat sur un parcours de liens en largeur depuis la page d’accueil : liens du domaine uniquement, liens externes et sociaux écartés, navigation et pied de page retirés avant l’extraction. Ce repli couvre les sites sans sitemap, mais il ne peut pas égaler la complétude d’un sitemap bien tenu.

Les pages ne sont pas le seul contenu qui compte. Les documents liés — PDF et fichiers Office (`docx`, `xlsx`, `pptx`, `odt`) — sont chargés et indexés comme des pages, que le crawler les trouve sur un site ou que tu les listes directement dans une liste d’URL. Les images et les documents numérisés sans texte intégré sont ignorés : l’analyse note qu’elle a regardé et n’enregistre rien.

## Le planning d’analyse

L’intervalle décide de la fréquence à laquelle les URL sont redécouvertes et les pages rechargées. Chaque analyse est incrémentale : les pages inchangées sont sautées, les pages modifiées sont réextraites et réindexées, les nouvelles pages sont ajoutées, les pages disparues sont retirées de l’index. Une liste d’URL suit la même cadence avec un ensemble fixe — les pages listées sont rechargées selon le planning, rien de nouveau n’est découvert. Les agents pointés sur le site voient le nouveau contenu dès la récupération suivante — il n’y a pas d’étape de publication séparée.

## Lire la table

Chaque ligne montre le domaine (les sources de type liste d’URL portent à côté le badge **Liste d'URL**), son **Statut** — **Inactif** entre deux analyses, **En cours d'analyse** en vol, **Actif** après une analyse réussie, **Erreur** quand la dernière analyse a échoué, **Suppression en cours** pendant le retrait — le pourcentage **Indexé** (survole-le pour le compte de pages explorées sur le total), l’heure de dernière analyse dans **Analysé** et l’**Intervalle**. Ouvre une ligne pour le titre et la description découverts du site ; clique sur **Voir les pages** pour la liste des pages — chaque URL indexée avec son nombre de mots, son nombre de fragments et sa dernière exploration, plus un champ de recherche qui interroge les fragments indexés : le moyen le plus rapide de vérifier ce qu’un agent récupérerait réellement.

## Où cela s’inscrit

L’exploration est le moyen économique d’amener un site public dans le contexte des agents : un domaine — ou une liste d’URL choisie à la main — une cadence, et le reste est l’affaire du crawler. La contrepartie est la frontière du visiteur anonyme — le contenu privé passe par [Documents](/fr/platform/knowledge/documents) ou une connector. Pour la place des lignes Sites web à côté des Contacts, Produits et Fournisseurs, lis [Données structurées](/fr/platform/knowledge/structured-data).
