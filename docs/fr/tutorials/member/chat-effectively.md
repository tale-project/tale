---
title: Chatter efficacement
description: Combiner agents, pièces jointes et dictée dans un workflow quotidien avec Tale.
---

La plupart des Members utilisent le chat de la même façon chaque jour : choisir le bon agent, déposer du contexte, demander, affiner. Ce tutoriel déroule cette boucle end-to-end pour que tu obtiennes des réponses ancrées sur les données de ton organisation, pas la sortie générique d’un modèle. Il enchaîne trois fonctionnalités déjà visibles dans l’UI — le [sélecteur d’agent](/fr/platform/chat/agents-in-chat), les [pièces jointes](/fr/platform/chat/attachments) et la dictée — dans un workflow réutilisable pour tes vraies tâches.

Le flux tient en moins de cinq minutes une fois que tu l’as fait une fois. Il te faut un accès Member ou supérieur, rien d’autre.

## Étape 1 — Choisir le bon agent

Ouvre **Chat** dans la barre latérale et clique le sélecteur d’agent en bas à gauche du composeur. Par défaut, c’est l’agent de chat général, qui cherche dans tout le savoir de l’organisation. Si ton équipe a créé des agents spécialisés — un agent support, un agent relecture juridique, un agent recherche commerciale — bascule sur celui dont le savoir et les outils collent à ta tâche. Un agent plus étroit produit presque toujours de meilleures réponses.

Si tu hésites, commence par celui dont la description est la plus proche. Tu peux changer en cours de conversation ; le nouvel agent garde l’historique.

## Étape 2 — Donner du contexte via les pièces jointes

Glisse le fichier ou l’image à regarder sur la fenêtre de chat, ou clique l’icône trombone. Les pièces jointes sont traitées avant l’envoi, donc l’agent les voit en lisant ta question. Les types supportés sont listés dans [pièces jointes](/fr/platform/chat/attachments) — PDF, documents Office, images, et la plupart des fichiers de code.

Les pièces jointes restent attachées à la conversation, pas à la base de connaissances partagée. Si le fichier doit être disponible à tous plus tard, passe par la [base de connaissances](/fr/platform/workspace/knowledge-base) à la place.

## Étape 3 — Dicter quand c’est plus rapide que taper

En marchant, pour résumer un appel, ou simplement quand tu penses plus vite que tu ne tapes : clique l’icône micro dans le composeur et parle. La dictée tourne dans ton navigateur (Web Speech API), l’audio ne quitte pas ton appareil. La transcription apparaît dans le champ au fil de la voix ; tu peux la corriger avant d’envoyer.

La dictée n’est pas un mode, c’est un outil par message — active, parle, désactive, envoie.

## Étape 4 — Itérer sur la réponse

Une première réponse est rarement la bonne. Utilise des relances courtes pour resserrer : « résume en trois points », « maintenant en français », « cite le document utilisé », « réécris pour un lecteur non technique ». L’agent garde tout le fil en contexte, chaque relance profite du tour précédent.

Quand tu atteins un résultat réutilisable, enregistre-le dans la [Bibliothèque de prompts](/fr/platform/workspace/prompt-library) — la prochaine fois, le même point de départ est à un clic.

## Étape 5 — Voir les artéfacts dans le Canevas quand ce n’est pas que du texte

Si l’agent renvoie du HTML exécutable, un SVG, un diagramme Mermaid ou un long document Markdown, il crée un **artéfact** qui s’ouvre automatiquement dans le volet latéral du Canevas et apparaît dans la barre d’artéfacts au-dessus du chat. Le Canevas te donne aperçu en direct, édition de la source et export — bien plus lisible qu’une bulle de chat qui défile, et l’IA peut réviser l’artéfact en place quand tu demandes des corrections. Voir [Canevas](/fr/platform/workspace/canvas) pour la liste complète des actions.

## Ensuite

- Construis un agent calibré pour ton équipe : [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) (rôle Editor).
- Apprends les raccourcis clavier : [AI chat — Raccourcis clavier](/fr/platform/chat/basics#raccourcis-clavier).
