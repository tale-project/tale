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
- Audio : MP3, M4A, WAV, OGG, WebM. La piste audio est transcrite côté serveur et le texte est transmis à l'agent.
- Vidéo : MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. La piste audio est extraite, transcrite et transmise à l'agent — le contenu visuel n'est pas envoyé.

Les fichiers sont téléversés avant l'envoi du message. Un spinner indique chaque fichier pendant son téléversement ; les pièces jointes audio et vidéo affichent en plus un statut de transcription jusqu'à la fin du traitement. Voir [Pièces jointes du chat](/fr/platform/chat/attachments) pour la pipeline complète.

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

| Catégorie d'outil                | Ce que tu peux demander                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| Recherche dans les connaissances | poser des questions étayées par tes documents envoyés et sites crawlés.    |
| Recherche web                    | chercher des informations d'actualité sur internet.                        |
| Traitement de documents          | analyser PDF, Word, PowerPoint, Excel et fichiers texte.                   |
| Analyse d'image                  | décrire, analyser ou extraire des infos d'images.                          |
| Transcription audio              | transcrire les fichiers audio ou vidéo joints pour que l'agent les résume. |

## Mode Arène

Le Mode Arène te laisse comparer deux modèles IA sur le même prompt. Clique l'icône **Épées** dans la barre d'outils, sélectionne deux modèles et envoie un message. Les deux modèles répondent en parallèle dans une vue côte à côte. Enregistre un verdict pour indiquer quelle réponse était la meilleure.

Voir [Mode Arène](/fr/platform/chat/arena-mode) pour tous les détails.

## Canevas

Quand l'IA génère du HTML exécutable, un SVG, un diagramme Mermaid, un document Markdown ou un snippet de code, elle crée un **artéfact** qui apparaît comme une carte dans la barre d'artéfacts au-dessus du chat et s'ouvre automatiquement dans le panneau canevas. Le canevas offre aperçu en direct, édition de la source et export. L'IA peut réviser l'artéfact en place sur plusieurs tours — les petites corrections n'imposent pas de regénérer tout le document.

Voir [Canevas](/fr/platform/workspace/canvas) pour tous les détails.

## Bibliothèque de prompts

Enregistre et réutilise des modèles de prompt dans toute ton organisation. Ouvre la Bibliothèque de prompts depuis la barre d'outils pour parcourir, chercher et insérer des prompts enregistrés. Tu peux aussi enregistrer un message de chat comme modèle directement depuis la conversation.

Voir [Bibliothèque de prompts](/fr/platform/workspace/prompt-library) pour tous les détails.

## Plan de recherche

Pour les questions multi-étapes qui demandent de la planification — recherche large, comparaisons sur plusieurs sources, synthèses qui s'appuient sur plusieurs documents et le web — l'agent découpe le travail en un **Plan de recherche** et l'exécute étape par étape. Le plan s'ouvre automatiquement en panneau latéral dès que l'agent émet le premier todo dans la conversation ; tu peux l'épingler ou le fermer depuis la barre située au bord droit du chat.

Chaque todo affiche un statut (en attente, en cours, terminé, échoué), un résumé d'une ligne et les sources que l'agent a capturées pour l'étape — résultats issus de la base de connaissances, pages web récupérées et résultats des intégrations. Le plan se met à jour en direct à mesure que l'agent termine chaque étape, donc tu suis son raisonnement au fil de l'eau au lieu d'attendre une longue réponse à la fin.

Tu peux intervenir sans casser l'exécution :

- **Réduire une étape** pour masquer ses sources quand la liste devient longue.
- **Réordonner** en envoyant un message de suivi — l'agent revoit les todos restants en fonction de tes retours.
- **Arrêter** avec le bouton stop standard du composeur — les résultats partiels restent dans le thread, et le compteur de todos échoués s'affiche en haut du plan.

Le Plan de recherche est en lecture seule — tu n'édites pas les todos directement. Pilote l'exécution avec des messages de chat normaux.

## Raccourcis clavier

| Action                | Windows / Linux  | macOS              |
| --------------------- | ---------------- | ------------------ |
| Nouveau chat          | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Rechercher des chats  | `Ctrl + K`       | `Cmd + K`          |
| Afficher l'historique | `Ctrl + H`       | `Cmd + H`          |
