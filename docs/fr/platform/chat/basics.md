---
title: Chat — les bases
description: Utilise l'IA pour explorer tes données, attacher des fichiers et choisir des agents.
---

Le chat IA est l'interface principale pour travailler avec l'IA de Tale. C'est un espace de conversation où tu poses des questions, demandes des actions et explores tes données en langage naturel.

## Utiliser le chat

- Accès : dans la barre latérale gauche, clique Chat.
- Clique l'icône plus dans la barre d'outils ou appuie sur `Alt + Ctrl + N` (`Option + Cmd + N` sur Mac) pour démarrer une nouvelle conversation.
- Chaque conversation est enregistrée dans ton historique et peut être cherchée ou renommée plus tard.

## Envoyer des messages

Écris dans la zone de saisie en bas. Entrée envoie ton message. Utilise Maj+Entrée pour un retour à la ligne. La zone s'agrandit automatiquement quand tu tapes.

## Pièces jointes

Tu peux joindre des fichiers à chaque message en cliquant sur l'icône trombone ou en les déposant dans la fenêtre. Types pris en charge :

- Images : PNG, JPEG, GIF, WebP. L'agent analyse le contenu visuel.
- Documents : PDF, DOCX, XLSX, PPTX, TXT, Markdown. L'agent lit le contenu.
- Fichiers code : JS, TS, Python et la plupart des formats source courants.

Les fichiers sont téléversés avant l'envoi du message. Un spinner indique chaque fichier pendant son téléversement.

## Choisir un agent

Le sélecteur d'agent est dans le coin inférieur gauche de la zone de saisie, sous forme d'icône bot. Il te permet de choisir quel agent IA traite ta conversation. La valeur par défaut est l'agent de chat système. Les agents personnalisés construits par ton équipe y apparaissent aussi.

## Historique

Clique sur l'icône horloge de la barre d'outils pour ouvrir la barre latérale d'historique. Tu peux :

- parcourir toutes les conversations passées, groupées par date ;
- cliquer une conversation pour l'ouvrir ;
- double-cliquer un titre pour le renommer en place ;
- utiliser le menu trois-points pour renommer ou supprimer une conversation ;
- chercher dans toutes les conversations avec `Ctrl+K` (Windows/Linux) ou `Cmd+K` (Mac).

## Ce que sait faire l'agent de chat

L'agent par défaut gère :

| Catégorie d'outil                | Ce que tu peux demander                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| Recherche dans les connaissances | poser des questions étayées par tes documents envoyés et sites crawlés. |
| Recherche web                    | chercher des informations d'actualité sur internet.                     |
| Traitement de documents          | analyser PDF, Word, PowerPoint, Excel et fichiers texte.                |
| Analyse d'image                  | décrire, analyser ou extraire des infos d'images.                       |

## Mode Arène

Le Mode Arène te laisse comparer deux modèles IA sur le même prompt. Clique l'icône **Épées** dans la barre d'outils, sélectionne deux modèles et envoie un message. Les deux modèles répondent en parallèle dans une vue côte à côte. Enregistre un verdict pour indiquer quelle réponse était la meilleure.

Voir [Mode Arène](/fr/platform/chat/arena-mode) pour tous les détails.

## Canevas

Quand l'IA génère un bloc de code, un snippet HTML, un diagramme Mermaid ou du Markdown, clique **Ouvrir dans le canevas** pour l'ouvrir dans un panneau latéral dédié. Le canevas offre coloration syntaxique, aperçu en direct, édition et export. Tu peux modifier puis réappliquer dans la conversation.

Voir [Canevas](/fr/platform/workspace/canvas) pour tous les détails.

## Bibliothèque de prompts

Enregistre et réutilise des modèles de prompt dans toute ton organisation. Ouvre la Bibliothèque de prompts depuis la barre d'outils pour parcourir, chercher et insérer des prompts enregistrés. Tu peux aussi enregistrer un message de chat comme modèle directement depuis la conversation.

Voir [Bibliothèque de prompts](/fr/platform/workspace/prompt-library) pour tous les détails.

## Raccourcis clavier

| Action                | Windows / Linux  | macOS              |
| --------------------- | ---------------- | ------------------ |
| Nouveau chat          | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Rechercher des chats  | `Ctrl + K`       | `Cmd + K`          |
| Afficher l'historique | `Ctrl + H`       | `Cmd + H`          |
