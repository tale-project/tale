---
title: Comparaison de documents
description: Compare deux documents côte à côte pour voir ajouts, suppressions et modifications.
---

La comparaison de documents te laisse téléverser ou sélectionner deux documents et voir un diff détaillé de leur contenu. Utile pour examiner des révisions de contrat, suivre des changements de politique ou vérifier des mises à jour.

## Démarrer une comparaison

1. Va dans **Connaissances > Documents**.
2. Ouvre le dialogue de comparaison depuis le menu d'actions.
3. Sélectionne deux documents :

| Côté   | Libellé                 | Options                                            |
| ------ | ----------------------- | -------------------------------------------------- |
| Gauche | Document de base        | téléverser un fichier ou sélectionner un existant. |
| Droite | Document de comparaison | téléverser un fichier ou sélectionner un existant. |

Chaque côté a deux onglets :

- **Upload** — glisse-dépose ou parcours pour téléverser depuis ton appareil.
- **Existing** — cherche et sélectionne dans les documents déjà dans ta base.

4. Clique **Compare**. La plateforme envoie les deux documents au service RAG pour analyse.

### Types de fichiers pris en charge

PDF, DOCX, XLSX, CSV, TXT, PPTX et formats image courants.

## Lire les résultats

Les résultats affichent une barre de résumé et une liste de blocs de changement.

### Statistiques de résumé

| Statistique   | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| **Ajoutés**   | paragraphes présents dans le document de comparaison mais pas dans la base. |
| **Supprimés** | paragraphes présents dans le document de base mais pas dans la comparaison. |
| **Modifiés**  | paragraphes qui ont changé entre les documents.                             |
| **Inchangés** | paragraphes sans différence.                                                |

Un avertissement de **divergence élevée** apparaît si les documents diffèrent fortement. Un **avertissement de troncature** apparaît si le nombre de changements dépasse la limite d'affichage.

### Types de changement

Chaque bloc est coloré :

| Type     | Couleur | Préfixe  | Description                                                              |
| -------- | ------- | -------- | ------------------------------------------------------------------------ |
| Ajouté   | Vert    | `+`      | nouveau contenu dans le document de comparaison.                         |
| Supprimé | Rouge   | `−`      | contenu retiré du document de base (affiché barré).                      |
| Modifié  | Jaune   | `~`      | contenu changé, avec diffs en ligne mettant en évidence des mots précis. |
| Contexte | Gris    | (espace) | texte environnant inchangé, pour référence.                              |

Les blocs modifiés affichent des diffs en ligne quand c'est possible : les parties supprimées apparaissent comme `[-texte-]` et les ajouts comme `{+texte+}`. Si pas de diff en ligne, les anciennes et nouvelles versions apparaissent sur des lignes séparées.
