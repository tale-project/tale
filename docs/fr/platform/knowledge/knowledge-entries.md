---
title: Entrées de connaissances
description: Les entrées de connaissances sont de petits faits indexés par sujet dans la base de connaissances — ajoutés à la main ou par l’API — avec une seule version active par sujet et un historique complet des versions.
---

Les entrées de connaissances sont la surface « faits » de la base de connaissances. Là où un document transporte un fichier entier, une entrée porte un seul fait, petit et durable — « le magasin ouvre à 9 h », « le délai de retour est de 3 jours » — indexé par un nom de sujet. Les entrées empruntent le même pipeline d’indexation que les documents, si bien que chaque agent dont le périmètre les couvre les récupère et les cite comme n’importe quelle source ; ce qui les rend particulières, c’est la façon dont elles entrent et dont les corrections remplacent ce qu’elles corrigent.

<Frame caption="L’onglet Entrées de connaissances — sujet, contenu, source et statut d’indexation par fait.">

![L’onglet Entrées de connaissances listant trois faits ajoutés à la main, chacun avec l’étiquette de source Manuel, le badge de statut Non indexé et sa commande de relance de l’indexation.](/images/platform/knowledge-entries-list.webp)

</Frame>

## D’où viennent les entrées

**Pas depuis le chat.** L’ancienne version laissait un agent proposer un fait tiré d’une conversation comme carte **Enregistrer dans la base de connaissances**, que tu approuvais. Cette carte n’existe pas dans cette version : l’assistant de chat n’a aucun outil d’écriture et ne propose rien à enregistrer, aucun agent n’écrit donc dans les connaissances partagées de l’organisation. Une entrée dont la **Source** indique **Chat** a été capturée par l’ancienne version ; les nouvelles entrées arrivent à la main ou par l’endpoint knowledge-entries de l’API REST.

<Note>

Il n’y a aucun interrupteur d’écriture dans les connaissances à activer agent par agent. Un fait entre dans la base de connaissances parce qu’une personne l’a saisi ou qu’un programme l’a posté par l’API — jamais parce qu’un modèle a décidé de s’en souvenir.

</Note>

**À la main.** Clique sur **Ajouter une entrée** dans **Connaissances > Entrées de connaissances**. Donne-lui un **Sujet** (120 caractères au maximum — court et stable, comme un titre) et le **Contenu** en markdown (8 000 caractères au maximum), rédigé pour rester compréhensible sans la conversation autour. La colonne **Source** distingue les deux origines : **Chat** ou **Manuel**.

## Une seule version active par sujet

Le sujet est la clé de déduplication : une modification remplace la version active au lieu d’en ajouter une seconde — la base de connaissances ne sert jamais deux versions du même fait. Ajouter une nouvelle entrée sous un sujet existant est refusé avec une erreur de sujet en double ; modifie l’entrée existante à la place.

Les versions remplacées ne sont pas perdues. Ouvre une entrée pour voir ses détails — le statut d’indexation, la dernière mise à jour et l’**Historique des versions**, avec chaque version remplacée et la date de son remplacement. Seule la version active est indexée pour la récupération ; l’historique existe pour l’audit et la référence.

## Modifier, indexer, supprimer

Modifier crée une nouvelle version active et réindexe en arrière-plan — le badge de statut repasse par l’indexation et revient à **Indexé** quand la recherche reprend le nouveau texte. Supprimer retire l’entrée entière : la confirmation prévient qu’elle disparaît aussi de la base de connaissances, que les agents ne pourront plus la trouver, et que l’action est irréversible. Si le fait était juste, ajoute-le de nouveau.

## Où cela s’inscrit

Les entrées de connaissances sont la plus petite unité de la base de connaissances : un fait noté une fois devient quelque chose que chaque voie récupère, et une seule version active par sujet garantit que l’ancien fait disparaît quand le nouveau atterrit. Pour la moitié au format fichier, lis [Documents](/fr/platform/knowledge/documents) ; pour la façon dont l’assistant de chat et les agents de projet récupèrent, lis l’[aperçu des connaissances](/fr/platform/knowledge/overview).
