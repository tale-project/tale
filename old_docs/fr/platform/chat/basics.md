---
title: Discuter avec l'IA
description: L'espace de travail conversationnel où tu poses des questions, attaches des fichiers, choisis un agent, et suis un plan multi-étapes en langage clair.
---

Discuter avec l'IA est la surface conversationnelle principale de Tale — l'endroit où chaque rôle du produit rencontre d'abord l'IA. Tu écris une question dans le composeur en bas de l'écran, attaches éventuellement des fichiers ou choisis un agent spécialisé, et l'IA chemine vers la réponse en langage clair : elle fouille la base de connaissances, appelle des intégrations, construit des artéfacts dans le panneau Canevas, déroule un plan multi-étapes quand la question est large. Cette page couvre le composeur lui-même, les panneaux autour, et la portée clavier.

Les fonctionnalités plus profondes ont chacune leur page. Le traitement des pièces jointes, le sélecteur d'agent, le Mode Arène pour la comparaison de modèles, Canevas pour les artéfacts éditables, la Bibliothèque de prompts et le panneau Plan de recherche sont tous à un clic dans la barre latérale.

## Ouvrir une conversation

Discuter avec l'IA est le premier élément de la barre latérale gauche. Pour démarrer une nouvelle conversation, clique sur l'icône plus dans la barre d'outils en haut ou appuie sur `Alt + Ctrl + N` (`Option + Cmd + N` sur macOS). Chaque conversation s'enregistre automatiquement dès le premier message envoyé, donc fermer le navigateur en pleine réflexion ne fait jamais perdre le travail.

## Envoyer des messages

Le composeur est en bas de l'écran. Appuie sur `Entrée` pour envoyer le message ; `Maj + Entrée` insère un saut de ligne dans le même message. Le composeur grandit à mesure que tu tapes — il n'y a pas de limite dure de longueur au-delà de la fenêtre de contexte du modèle. Clique sur **Arrêter la génération** pour interrompre l'IA au milieu d'une réponse ; la sortie partielle reste dans le fil, donc tu gardes ce qui est déjà utile.

## Attacher des fichiers

Pour envoyer un fichier avec un message, clique sur l'icône trombone ou glisse le fichier sur le composeur. Tale traite le téléversement avant que le message atteigne le modèle — un indicateur de progression s'affiche par fichier, avec un statut de transcription séparé pour l'audio et la vidéo. L'ensemble complet des formats acceptés :

- **Images :** PNG, JPEG, GIF, WebP. L'agent analyse le contenu visuel.
- **Documents :** PDF, DOCX, XLSX, PPTX, TXT, Markdown. L'agent lit le texte extrait.
- **Fichiers code :** JavaScript, TypeScript, Python et les formats sources courants.
- **Audio :** MP3, M4A, WAV, OGG, WebM. La piste audio est transcrite côté serveur et la transcription est transmise à l'agent.
- **Vidéo :** MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. La piste audio est extraite, transcrite et transmise à l'agent — le contenu visuel n'est pas envoyé.

La pipeline complète (limites de taille, facturation de la transcription, traitement des données personnelles) vit dans [Pièces jointes du chat](/fr/platform/chat/attachments).

## Choisir un agent

Le sélecteur d'agent, c'est l'icône bot en bas à gauche du composeur. Pour router une conversation vers un agent précis, ouvre le sélecteur et choisis-le — la valeur par défaut est l'assistant système livré avec Tale ; les agents personnalisés que ton équipe a construits apparaissent dessous. Basculer l'agent en cours de conversation est permis, et le nouvel agent lit le transcript existant avant sa première réponse.

Les instructions de l'agent, son périmètre de connaissances et les outils activés décident de ce que le chat peut faire. Le comportement à l'exécution lors d'un changement d'agent et la lecture des amorces se trouvent dans [Utiliser des agents dans le chat](/fr/platform/chat/agents-in-chat) ; le modèle mental derrière les quatre boutons vit dans [Concepts des agents](/fr/platform/agents/concepts).

## Parcourir l'historique

L'icône horloge dans la barre d'outils en haut ouvre la barre latérale d'historique. Les conversations passées sont groupées par date — clique sur l'une pour l'ouvrir, double-clique sur un titre pour le renommer sur place, ou utilise le menu trois-points pour archiver ou supprimer. Pour chercher dans toutes les conversations, appuie sur `Ctrl + K` (`Cmd + K` sur macOS) et tape — le sujet et le corps des messages sont indexés.

## Ce que sait faire l'assistant par défaut

L'agent livré avec Tale est câblé avec l'ensemble d'outils le plus large pour qu'une organisation fraîche ait tout de suite quelque chose d'utile. Les cinq catégories d'outils de l'Assistant par défaut :

| Catégorie d'outil                       | Ce que tu peux demander                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Recherche dans la base de connaissances | Questions répondues par tes documents téléversés et tes sites crawlés.       |
| Recherche web                           | Informations d'actualité depuis l'internet public.                           |
| Traitement de documents                 | Parser et analyser PDF, Word, PowerPoint, Excel et fichiers texte en ligne.  |
| Analyse d'image                         | Décrire, analyser ou extraire des informations des images attachées.         |
| Transcription audio                     | Transcrire les fichiers audio ou vidéo attachés pour que l'agent les résume. |

Les agents personnalisés que tu construis partent des mêmes valeurs par défaut ; tu les resserres. Le flux de construction parcourt les étapes dans [Créer un agent](/fr/platform/agents/create).

## Mode Arène

Le Mode Arène fait passer le même prompt par deux modèles en parallèle et affiche les réponses côte à côte. Pour comparer des modèles sur un vrai prompt, clique sur l'icône **Épées** dans la barre d'outils, choisis deux modèles et envoie un message — les deux réponses se diffusent dans une vue divisée. Enregistre un verdict pour signaler quelle réponse était meilleure ; les verdicts s'accumulent comme historique de comparaison par modèle dans l'analyse d'usage.

La doctrine complète vit dans [Mode Arène](/fr/platform/chat/arena-mode).

## Canevas

Quand l'IA produit du HTML exécutable, un SVG, un diagramme Mermaid, un document Markdown ou un extrait de code, elle crée un **artéfact** — une carte dans la barre des Artéfacts au-dessus du chat qui s'ouvre automatiquement dans le panneau Canevas. L'artéfact a une identité stable sur toute la conversation, donc les petites corrections n'imposent pas de régénérer tout le document — l'IA le patche en place d'un tour à l'autre.

La doctrine complète vit dans [Canevas](/fr/platform/workspace/canvas).

## Bibliothèque de prompts

Pour réutiliser un modèle de prompt dans l'équipe, ouvre la Bibliothèque de prompts depuis la barre d'outils du composeur — chaque prompt enregistré est cherchable et insérable en un clic. Pour enregistrer le prompt que tu viens d'écrire, ouvre le menu trois-points du message et choisis **Enregistrer comme prompt** ; cadre-le sur toi, ton équipe ou toute l'organisation.

La doctrine complète vit dans [Bibliothèque de prompts](/fr/platform/workspace/prompt-library).

## Plan de recherche

Les questions larges qui demandent de la planification — recherche multi-sources, comparaisons, synthèses sur plusieurs documents et le web — sont décomposées en un **Plan de recherche**. Le plan s'ouvre automatiquement en panneau latéral la première fois que l'agent émet un todo pour la conversation ; épingle-le depuis la barre au bord droit du chat, ou ferme-le quand tu veux récupérer le flux complet des messages.

Chaque todo affiche un statut (en attente, en cours, fait, échoué), un résumé d'une ligne et les sources que l'agent a capturées pour cette étape — résultats issus de la base de connaissances, pages web récupérées, résultats d'intégrations. Le plan se met à jour en direct à mesure que l'agent termine chaque étape, donc tu suis le raisonnement au fil de l'eau au lieu d'attendre une longue réponse à la fin.

Tu peux intervenir sans casser l'exécution. Replie une étape pour masquer ses sources quand la liste devient longue. Réordonne en envoyant un message de suivi — l'agent révise les todos restants à partir de tes retours. Arrête avec le bouton stop du composeur — les résultats partiels restent dans le fil, et le compteur de todos en échec s'affiche en haut du plan. Le plan lui-même est en lecture seule ; pilote l'exécution avec des messages de chat normaux.

## Raccourcis clavier

| Action                         | Windows / Linux  | macOS              |
| ------------------------------ | ---------------- | ------------------ |
| Nouveau chat                   | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Chercher dans les chats        | `Ctrl + K`       | `Cmd + K`          |
| Basculer la barre d'historique | `Ctrl + H`       | `Cmd + H`          |

## Où ça s'inscrit

Le chat est la porte d'entrée pour tout ce que sait faire l'IA. Les agents, les connaissances, les outils — chaque autre surface de Tale soit alimente le chat (curer la base de connaissances, construire des agents, configurer des fournisseurs), soit le remplace pour les cas où la forme du chat est mauvaise (automatisations pour le travail sans supervision, l'API pour les scripts). La plupart des lecteurs vivent dans cette page ; le reste de la plateforme se lit comme _comment rendre le chat meilleur_ ou _quoi faire quand le chat n'est pas la bonne surface_.

Pour rendre le chat plus tranchant pour ton équipe, l'étape naturelle est un agent dédié — démarre par [Concepts des agents](/fr/platform/agents/concepts) pour le modèle mental, puis parcours [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end).
