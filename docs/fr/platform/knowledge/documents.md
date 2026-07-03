---
title: Documents
description: La zone Documents est l'endroit où les Éditeurs téléversent des fichiers dans la base de connaissances, les regardent s'indexer et les lient aux agents. Cette page couvre le téléversement, la pipeline d'indexation, les formats supportés et le cycle de vie par document.
---

La zone Documents est la surface fichiers de la base de connaissances. Les Éditeurs téléversent des fichiers — PDF, documents Word, Markdown, texte brut, code, tableurs, présentations — et Tale fait passer chacun par une pipeline d'indexation qui extrait le texte, le découpe en chunks, embed les chunks et les range pour que les agents puissent récupérer les morceaux pertinents à la réponse. Une fois indexé, un document peut être lié à un ou plusieurs agents ; les agents liés voient les chunks du document pendant la récupération RAG et les citent dans les réponses.

Cette page couvre le côté opérateur de Documents : téléverser, ce qui arrive pendant l'indexation, les formats supportés, comment marche le cycle de vie par document, et en quoi les documents diffèrent des types de données structurées (clients, produits, fournisseurs, sites web) qui partagent la base de connaissances.

## Un téléversement mis en pratique

Pour téléverser un document, ouvre **Connaissance > Documents** et lâche le fichier sur la zone de téléversement, ou clique sur **Téléverser** et choisis le fichier depuis le disque. Le document apparaît dans la liste immédiatement avec le statut `Indexation` ; Tale fait tourner la pipeline en arrière-plan. Quand le statut bascule sur `Indexé`, le document est prêt à être lié à des agents. Les échecs de pipeline apparaissent avec le statut `Erreur` et une raison en une ligne ; la ligne porte un bouton **Réessayer** qui refait tourner la pipeline de zéro.

Lier le document à un agent est une étape séparée. Ouvre l'agent et ajoute le document sous son onglet **Connaissance** ; la requête suivante que sert l'agent récupère sur les chunks du nouveau document. Un document sans liaison reste indexé mais est invisible à chaque agent — utile quand tu veux le document dans la bibliothèque mais pas encore en production.

## Ce que fait la pipeline d'indexation

L'indexation arrive en quatre étapes, dans l'ordre :

- **Extraire** — tirer du texte du fichier. Les PDF passent par une extraction consciente du layout ; les documents Office et Markdown passent par une extraction consciente de la structure ; les images dans un document passent par OCR.
- **Découper** — couper le texte extrait en morceaux de taille récupération, en respectant les titres et frontières de paragraphes où la structure du fichier les rend visibles.
- **Embed** — appeler le modèle d'embedding du fournisseur configuré de l'org pour produire un vecteur par chunk.
- **Ranger** — écrire les chunks et leurs vecteurs dans l'index de recherche, avec les métadonnées du fichier source attachées.

La pipeline est idempotente sur le hash du fichier source. Téléverser le même fichier deux fois produit une copie indexée, pas deux. Modifier le fichier et le retéléverser remplace les anciens chunks par les nouveaux ; les agents voient la mise à jour à la récupération suivante.

## Formats supportés

La pipeline gère les types de fichiers qui couvrent le gros de la connaissance d'org :

- **Texte et code.** Markdown (`.md`), texte brut (`.txt`), code source (chaque langage que Tale colorise — voir la liste du highlighter).
- **Documents.** PDF (`.pdf`), Word (`.docx`), OpenDocument Text (`.odt`).
- **Tableurs.** Excel (`.xlsx`), CSV (`.csv`), TSV (`.tsv`).
- **Présentations.** PowerPoint (`.pptx`).
- **Pages web.** HTML (`.html`) et la sortie rendue d'un crawl de page.
- **Images.** PNG, JPG, GIF, BMP, TIFF, WEBP, avec OCR appliqué pour extraire tout texte.

Deux choses différentes arrivent à un fichier que la pipeline n'indexe pas. Un ancien fichier Office (`.doc`, `.xls`, `.ppt`) se téléverse quand même et reste disponible comme fichier stocké, mais Tale saute l'indexation — la ligne affiche **Non indexé** au lieu d'une erreur d'indexation, et les agents ne peuvent pas récupérer son contenu. Un type que le contrôle d'upload n'accepte pas du tout — une archive, un binaire quelconque — est refusé au téléversement avec une erreur « type de fichier non supporté » et n'arrive jamais. La liste des formats acceptés et indexés grandit en même temps que la pipeline.

## Le cycle de vie par document

Chaque document porte un petit ensemble de champs au-delà de son contenu : un **titre** (auto-extrait des métadonnées du fichier, éditable), une **source** (le fichier ou l'intégration qui l'a amené), un **propriétaire** (le membre ou équipe qui l'a téléversé), des **tags** (étiquettes libres pour filtrer) et une **visibilité** (à l'échelle de l'org, cadrée équipe ou par agent). Le levier visibilité est le jumeau au niveau document du cadrage équipe fait ailleurs — un document cadré équipe est invisible aux membres hors de l'équipe même si leur rôle l'autoriserait sinon.

Les documents synchronisés depuis une intégration portent le champ source de l'intégration. Un document amené par la sync OneDrive montre le chemin OneDrive ; un document tiré de Confluence montre l'URL de la page. Le champ source rend les citations cliquables vers le système amont.

## Supprimer et réindexer

Clique la ligne du document, puis **Supprimer** pour le retirer de la bibliothèque. La suppression retire les chunks de l'index de recherche à la prochaine passe ; les récupérations en vol se terminent, la suivante ne voit pas le document. Pas d'annulation — retéléverser le même fichier le restaure, mais l'historique d'audit du document repart frais.

Réindexer sans supprimer est le bon mouvement quand la pipeline s'est améliorée entre téléversements. Clique sur **Réindexer** sur la ligne ; Tale refait tourner la pipeline sur le fichier source rangé et remplace les chunks atomiquement. Le document ne sort pas de la portée des agents pendant la réindexation.

## Documents versus données structurées

La base de connaissances a deux moitiés. Les **Documents** sont non structurés — texte, prose, présentations, tout ce que la pipeline peut découper et embed. Les **Données structurées** (clients, produits, fournisseurs, sites web) sont des lignes dans des tables typées — champs avec noms, validation et relations explicites. Va vers les documents quand le contenu est prose ; va vers les données structurées quand le contenu est une liste de choses avec la même forme. Voir [Données structurées](/fr/platform/knowledge/structured-data) pour la surface table-typée.

## Où cela s'inscrit

Les documents sont le coin le plus utilisé de la base de connaissances — chaque agent qui cite une source cite vraisemblablement un document. La lecture suivante naturelle est [Vue d'ensemble Connaissance](/fr/platform/knowledge/overview) pour la carte inter-surfaces, et [Connaissance d'agent](/fr/platform/agents/knowledge) pour comment un agent se lie aux documents et récupère sur eux à la réponse.
