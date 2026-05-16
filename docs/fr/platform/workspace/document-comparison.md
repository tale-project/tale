---
title: Comparaison de documents
description: Compare deux documents côte à côte et lis un diff détaillé qui met en évidence les ajouts, les suppressions et les modifications, paragraphe par paragraphe.
---

La comparaison de documents te laisse téléverser ou choisir deux documents et lire un diff au niveau du paragraphe entre les deux. Sers-t'en pour relire une révision de contrat face à la version précédente, suivre les mises à jour de politiques entre deux rafraîchissements annuels, ou vérifier qu'un modèle actualisé colle au cahier des charges. Le public visé : les Éditeurs et les Admins qui font la relecture de documents ; les Membres avec un accès en lecture à la base de connaissances peuvent aussi lancer une comparaison si leur rôle le permet.

Le diff est calculé et rendu dans le navigateur ; rien ne parvient à l'IA tant qu'un agent n'est pas explicitement chargé de résumer le résultat ensuite.

## Démarrer une comparaison

Pour ouvrir la boîte de dialogue de comparaison, va dans **Base de connaissances > Documents** et choisis l'entrée de comparaison dans le menu d'actions. La boîte demande deux documents — la base à gauche, la comparaison à droite :

| Côté   | Libellé                 | Options                                            |
| ------ | ----------------------- | -------------------------------------------------- |
| Gauche | Document de base        | Téléverser un fichier ou sélectionner un existant. |
| Droite | Document de comparaison | Téléverser un fichier ou sélectionner un existant. |

Chaque côté a deux onglets. **Téléverser** te laisse déposer un fichier depuis l'appareil ou parcourir le sélecteur de fichiers. **Existant** cherche et choisit parmi les documents déjà dans la base de connaissances. Clique sur **Comparer** une fois les deux côtés remplis ; Tale envoie les deux documents au service RAG pour analyse, et le résultat s'affiche en ligne.

Les formats acceptés : PDF, DOCX, XLSX, CSV, TXT, PPTX et les formats d'image courants. Tout ce qui sort de cet ensemble est rejeté au téléversement.

## Lire les résultats

La vue de résultat comporte deux parties : une barre de résumé avec les statistiques sur tout le diff, puis une liste défilante de blocs de modification. Le résumé indique combien de paragraphes tombent dans chaque catégorie :

| Statistique   | Ce qu'elle compte                                                           |
| ------------- | --------------------------------------------------------------------------- |
| **Ajoutés**   | Paragraphes présents dans le document de comparaison mais pas dans la base. |
| **Supprimés** | Paragraphes présents dans le document de base mais pas dans la comparaison. |
| **Modifiés**  | Paragraphes qui ont changé entre les documents.                             |
| **Inchangés** | Paragraphes sans différence.                                                |

Un avertissement de **divergence élevée** apparaît en tête du résultat lorsque les documents diffèrent fortement — pratique pour repérer un mélange de versions avant de lire la suite. Un **avertissement de troncature** apparaît si le nombre de modifications dépasse la limite d'affichage ; les blocs manquants sortent du diff rendu, mais le résumé compte tout le document.

## Code couleur des blocs de modification

Chaque bloc de la liste défilante est coloré selon le type de modification :

| Type     | Couleur | Préfixe  | Ce qu'il montre                                                          |
| -------- | ------- | -------- | ------------------------------------------------------------------------ |
| Ajouté   | Vert    | `+`      | Nouveau contenu dans le document de comparaison.                         |
| Supprimé | Rouge   | `−`      | Contenu retiré du document de base (affiché barré).                      |
| Modifié  | Jaune   | `~`      | Contenu changé, avec diffs en ligne mettant en évidence des mots précis. |
| Contexte | Gris    | (espace) | Texte environnant inchangé, pour référence.                              |

Les blocs modifiés affichent des diffs en ligne quand la modification est assez petite pour le niveau du mot : les parties supprimées apparaissent comme `[-texte-]` et les ajouts comme `{+texte+}`. Quand les diffs en ligne ne sont pas disponibles — généralement parce que la modification a réécrit l'essentiel du paragraphe —, les anciennes et nouvelles versions se rendent sur des lignes séparées.

## Où ça s'inscrit

La comparaison de documents est la surface diff ciblée pour la base de connaissances. Elle existe parce que relire la révision d'un contrat, une mise à jour de politique ou un modèle rafraîchi ne tient pas dans le chat — l'œil a besoin des deux versions visibles en même temps, avec les modifications en relief. Pour comparer deux versions d'un même document dans le temps, téléverse chaque version comme fichier distinct dans la [base de connaissances](/fr/platform/workspace/knowledge-base) et lance une comparaison entre les deux.

Pour un résumé IA du diff, copie le lien de comparaison dans un chat et demande à l'assistant de parcourir les modifications ; l'agent de chat peut lire la même sortie RAG que celle que rend la boîte de comparaison.
