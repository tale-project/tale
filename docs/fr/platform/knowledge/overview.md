---
title: Base de connaissances
description: La base de connaissances est la bibliothèque partagée de l’organisation — documents, petits faits, sites web explorés et fiches typées — sur laquelle les agents ancrent leurs réponses. Cet aperçu nomme les onglets et pointe vers les pages par domaine.
---

La base de connaissances est l’espace où vivent les données de l’organisation pour que les agents puissent les lire et les citer. Les éditeurs la constituent une fois ; les agents y puisent au moment de répondre — c’est ce qui permet à un agent Tale de répondre avec ta réalité plutôt qu’avec les données d’entraînement du modèle. L’espace s’ouvre sur cinq onglets : **Documents**, **Entrées de connaissances**, **Sites web**, **Produits** et **Contacts**.

Tu préfères regarder d’abord ? L’épisode 3 parcourt toute la bibliothèque en trois minutes — indexation, entrées, fiches, crawler et périmètres, sous-titres compris.

<Video src="/videos/fr/tutorials/ep3-knowledge/ep3-knowledge.fr.mp4" poster="/videos/fr/tutorials/ep3-knowledge/ep3-knowledge.fr.webp" captions="/videos/fr/tutorials/ep3-knowledge/ep3-knowledge.fr.vtt" lang="fr" title="Épisode 3 — Connaissances" caption="Épisode 3 — Connaissances (2:45)">

</Video>

<Frame caption="L’onglet Documents — le coin le plus utilisé de la base de connaissances.">

![L’onglet Documents de la base de connaissances listant trois fichiers texte téléversés avec les colonnes taille, source, statut RAG et équipes.](/images/get-started/documents-list.webp)

</Frame>

## Les deux formes

Tout ce que contient l’espace prend l’une de deux formes. Le **contenu indexé** — les fichiers de Documents, les faits des Entrées de connaissances, les pages qu’une exploration de site web ramène — passe par le pipeline d’indexation (extraction, découpage, embeddings, stockage) pour que les agents récupèrent les passages pertinents et les citent. Les **fiches typées** — Produits et Contacts (l’annuaire de correspondants qui couvre à la fois clients et fournisseurs) — sont des lignes à champs nommés que les agents lisent comme des données, pas comme de la prose : des valeurs exactes, sans approximation de récupération.

La forme que tu choisis décide de la façon dont un agent peut exploiter le contenu — c’est pourquoi [Données structurées](/fr/platform/knowledge/structured-data) est une page de décision, pas seulement une référence.

## Où réside l'index

Le contenu indexé est intégré dans la base de données vectorielle intégrée de Tale — un stockage **PostgreSQL** (ParadeDB) qui combine les embeddings `pgvector` avec la recherche par mots-clés (BM25) et fusionne les deux, de sorte que la recherche capte à la fois les correspondances sémantiques et les termes exacts. Il est livré avec la plateforme : rien de plus à licencier ni à exploiter, et la recherche, les citations, les permissions par équipe et l'effacement RGPD agissent tous sur un seul stockage. Les embeddings proviennent du **modèle d'embedding** configuré par l'organisation — un admin d'org choisit le fournisseur, le modèle et la largeur des vecteurs dans **Paramètres > Résidence des données**, et la recherche de connaissances refuse avec une erreur actionnable tant qu'aucun n'est configuré, plutôt que de deviner un modèle.

**Apporte ta propre base de données vectorielle — c'est du Postgres.** Comme le stockage vectoriel est PostgreSQL, tu peux pointer la base de connaissances de Tale vers n'importe quel PostgreSQL géré que tu exploites (avec les extensions `pgvector` et `pg_search`/ParadeDB) au lieu de celui fourni — tes données, ton infrastructure, ta région. Un admin d'org renseigne la connexion dans **Paramètres > Résidence des données** — saisis l'hôte, la base et les identifiants de ton Postgres, de la même façon pour un déploiement auto-hébergé et une instance cloud dédiée. Tale vérifie la connexion et la présence des extensions requises avant que tu bascules. Voir [Résidence des données](/fr/self-hosted/configuration/data-residency) pour les détails de connexion et les prérequis d'extensions.

## Comment les agents y puisent

Un agent ne voit pas toute la bibliothèque par défaut. L’onglet **Base de connaissances** de l’agent contrôle son périmètre de récupération — les parties de la bibliothèque qu’il interroge au moment de répondre — et les éléments limités à une équipe restent invisibles pour les agents et les membres hors de cette équipe. La récupération passe par les outils RAG de l’agent, et chaque passage récupéré porte sa source : les citations renvoient au fichier, à l’entrée ou à la page d’origine. La mécanique côté agent vit dans [Connaissances de l’agent](/fr/platform/agents/knowledge).

## Pages dans cette section

<CardGroup cols="2">

<Card title="Documents" icon="file-text" href="/fr/platform/knowledge/documents">

Téléverser des fichiers, le pipeline d’indexation, les formats pris en charge et le cycle de vie de chaque document.

</Card>

<Card title="Entrées de connaissances" icon="book-open" href="/fr/platform/knowledge/knowledge-entries">

De petits faits indexés par sujet — capturés depuis le chat avec approbation ou ajoutés à la main.

</Card>

<Card title="Exploration de sites web" icon="globe" href="/fr/platform/knowledge/crawling">

Transformer un site public en connaissances — domaine, intervalle d’analyse et vue des pages indexées.

</Card>

<Card title="Données structurées" icon="table" href="/fr/platform/knowledge/structured-data">

Contacts, Produits, Sites web — quand une fiche typée bat un document.

</Card>

</CardGroup>

## Où cela s’inscrit

La base de connaissances est la couche de données sur laquelle repose chaque réponse ancrée ; sans elle, les agents ne savent que ce que le modèle sait déjà. Fais entrer le contenu par l’onglet qui correspond à sa forme, puis branche les agents dessus — la suite naturelle est [Documents](/fr/platform/knowledge/documents) pour les fichiers, [Données structurées](/fr/platform/knowledge/structured-data) pour les fiches et [Connaissances de l’agent](/fr/platform/agents/knowledge) pour le volet récupération.
