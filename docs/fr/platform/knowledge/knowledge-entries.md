---
title: Entrées de connaissances
description: Les entrées de connaissances sont de petits faits indexés par sujet dans la base de connaissances — capturés depuis le chat avec approbation humaine ou ajoutés à la main — avec une seule version active par sujet et un historique complet des versions.
---

Les entrées de connaissances sont la surface « faits » de la base de connaissances. Là où un document transporte un fichier entier, une entrée porte un seul fait, petit et durable — « le magasin ouvre à 9 h », « le délai de retour est de 3 jours » — indexé par un nom de sujet. Les entrées empruntent le même pipeline d’indexation que les documents, si bien que chaque agent dont le périmètre les couvre les récupère et les cite comme n’importe quelle source ; ce qui les rend particulières, c’est la façon dont elles entrent et dont les corrections remplacent ce qu’elles corrigent.

<Frame caption="L’onglet Entrées de connaissances — sujet, contenu, source et statut d’indexation par fait.">

![L’onglet Entrées de connaissances listant trois faits ajoutés à la main, chacun avec l’étiquette de source Manuel et le badge de statut Indexé.](/images/platform/knowledge-entries-list.webp)

</Frame>

## D’où viennent les entrées

**Depuis le chat, avec ton approbation.** Les agents dont l’outil d’écriture dans les connaissances est activé peuvent proposer d’enregistrer un fait que tu as énoncé ou corrigé pendant un chat. La proposition apparaît comme une carte dans le chat — **Enregistrer dans la base de connaissances**, avec le sujet et le contenu complet ; quand le sujet existe déjà, la carte devient **Mettre à jour la base de connaissances** et prévient que l’approbation remplacera l’entrée existante. Rien n’atterrit tant que tu n’as pas cliqué sur **Approuver** ; **Rejeter** écarte la proposition.

<Note>

L’outil est désactivé par défaut — active-le agent par agent dans les réglages d’outils de l’agent. Un agent ne peut jamais écrire dans les connaissances partagées de l’organisation sans qu’un humain valide le texte exact.

</Note>

**À la main.** Clique sur **Ajouter une entrée** dans **Connaissances > Entrées de connaissances**. Donne-lui un **Sujet** (120 caractères au maximum — court et stable, comme un titre) et le **Contenu** en markdown (8 000 caractères au maximum), rédigé pour rester compréhensible sans la conversation autour. La colonne **Source** distingue les deux origines : **Chat** ou **Manuel**.

## Une seule version active par sujet

Le sujet est la clé de déduplication : une proposition de chat approuvée pour un sujet existant, ou une modification, remplace la version active au lieu d’en ajouter une seconde — la base de connaissances ne sert jamais deux versions du même fait. Ajouter une nouvelle entrée sous un sujet existant est refusé avec une erreur de sujet en double ; modifie l’entrée existante à la place.

Les versions remplacées ne sont pas perdues. Ouvre une entrée pour voir ses détails — le statut d’indexation, la dernière mise à jour et l’**Historique des versions**, avec chaque version remplacée et la date de son remplacement. Seule la version active est indexée pour la récupération ; l’historique existe pour l’audit et la référence.

## Modifier, indexer, supprimer

Modifier crée une nouvelle version active et réindexe en arrière-plan — le badge de statut repasse par l’indexation et revient à **Indexé** quand la recherche reprend le nouveau texte. Supprimer retire l’entrée entière : la confirmation prévient qu’elle disparaît aussi de la base de connaissances, que les agents ne pourront plus la trouver, et que l’action est irréversible. Si le fait était juste, ajoute-le de nouveau.

## Où cela s’inscrit

Les entrées de connaissances bouclent la boucle entre les conversations et la base de connaissances : une correction faite une fois dans le chat devient un fait que chaque agent récupère, avec un humain qui approuve la formulation exacte, et une seule version active par sujet qui garantit que l’ancien fait disparaît quand le nouveau atterrit. Pour la moitié au format fichier, lis [Documents](/fr/platform/knowledge/documents) ; pour la façon dont les agents s’y relient et récupèrent, lis [Connaissances de l’agent](/fr/platform/agents/knowledge).
