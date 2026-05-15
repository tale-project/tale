---
title: Chatter efficacement
description: Combiner agents, pièces jointes, dictée et Canevas dans un workflow quotidien avec Tale.
---

La plupart des Membres utilisent le chat Tale de la même façon chaque jour : choisir le bon agent, déposer le contexte, demander, itérer. Ce tutoriel parcourt cette boucle pour que tes réponses soient ancrées dans le savoir de ton organisation, pas dans une sortie de modèle générique. La référence fonctionnelle de chaque étape vit sous [Chat](/fr/platform/chat/basics) ; cette page assemble les pièces en un workflow répétable.

La boucle entière dure moins de cinq minutes une fois que tu l'as faite une fois. Le résultat à la fin est une conversation qui produit des réponses que tu transmettrais.

## Avant de commencer

Il te faut un accès Membre ou supérieur dans l'instance Tale où tu es connecté — chaque compte connecté sauf `Désactivé` peut utiliser le chat. Au moins un agent doit exister dans l'organisation ; l'agent de chat général est livré par défaut, donc ce prérequis est rempli sur chaque instance. Pas de setup externe, pas de clé API, pas de permission admin nécessaire.

## Étape 1 — Choisir le bon agent

Un agent dédié cherche dans une portion plus étroite de la base de connaissances et suit un prompt système plus serré, ce qui produit presque toujours une réponse plus nette que l'agent de chat général. Ouvre **Chat** dans la barre latérale et clique sur le sélecteur d'agent en bas à gauche du composer ; la liste déroulante montre chaque agent que ton rôle peut voir.

Choisis celui dont la description colle le plus près à ta tâche — un agent `product-support` pour une question client, un agent `legal-review` pour une clause de contrat, l'agent de chat par défaut pour le reste. Si tu ne sais pas, démarre avec le plus proche et change en cours de conversation : le nouvel agent garde l'historique des messages.

L'étape a fonctionné quand le nom d'affichage de l'agent apparaît au-dessus du composer et que le placeholder reflète ses lanceurs de conversation.

## Étape 2 — Donner du contexte via des pièces jointes

Les pièces jointes laissent l'agent lire le fichier exact dont tu parles, au lieu de deviner depuis sa mémoire. Glisse un fichier ou une image sur la fenêtre de chat, ou clique sur l'icône trombone du composer. Les types pris en charge — PDF, documents Office, images, audio, vidéo, et la plupart des fichiers de code — sont listés dans [Pièces jointes](/fr/platform/chat/attachments) ; les fichiers hors de la liste sont rejetés avant l'envoi.

Les pièces jointes restent limitées à la conversation, pas à la base de connaissances partagée. Si le fichier doit être interrogeable par tout le monde plus tard, téléverse-le via la [base de connaissances](/fr/platform/workspace/knowledge-base) — il y est indexé une fois et réutilisé par chaque agent.

L'étape a fonctionné quand le fichier apparaît comme une puce sous le composer, avec son nom et sa taille, et que la première réponse de l'agent fait référence à son contenu.

## Étape 3 — Dicter quand parler va plus vite que taper

L'icône micro du composer active la dictée du navigateur ; l'audio est traité localement par la Web Speech API et la transcription se déverse dans le champ pendant que tu parles. Les octets audio n'atteignent pas les serveurs Tale — seul le texte reconnu quitte ton appareil.

Active le micro, dis la question, désactive-le, et corrige la transcription avant d'envoyer. La dictée est un outil par requête, pas un mode : il n'y a pas de préférence à régler, et aucune trace ne reste une fois le message envoyé.

L'étape a fonctionné quand la transcription apparaît dans le champ pendant que tu parles.

## Étape 4 — Itérer sur la réponse

La première réponse est rarement la dernière. Les courtes relances sont le chemin le plus rapide pour préciser : `résume en trois points`, `maintenant en anglais`, `cite le document utilisé`, `réécris pour un lecteur non technique`. L'agent garde tout le fil en contexte, donc chaque relance bénéficie du tour précédent — pas besoin de répéter ce que tu as déjà dit.

Quand tu atterris sur un résultat qui mérite d'être réutilisé, enregistre le prompt dans la [bibliothèque de prompts](/fr/platform/workspace/prompt-library). La prochaine fois, le même point de départ est à un clic du composer.

L'étape a fonctionné quand la réponse suivante de l'agent répond visiblement à la contrainte ajoutée dans la relance.

## Étape 5 — Voir les artefacts dans Canevas quand c'est plus que du texte

Un long document Markdown, une page HTML exécutable, un SVG ou un diagramme Mermaid est difficile à lire dans une bulle de chat. Quand l'agent en produit un, Tale l'ouvre automatiquement comme artefact dans le panneau latéral [Canevas](/fr/platform/workspace/canvas) et le liste dans la barre Artefacts au-dessus du chat — aperçu en direct, vue source, et export vivent tous dans le panneau Canevas.

Demande à l'agent de réviser l'artefact sur place (`rends le diagramme horizontal`, `ajoute une deuxième colonne`) et Canevas le met à jour sans produire de nouvelle bulle.

L'étape a fonctionné quand le panneau Canevas s'ouvre à droite avec l'artefact rendu, et que la bulle de chat affiche un court résumé au lieu du contenu complet.

## Dépannage

- **L'agent répond depuis le mauvais savoir** — l'agent a accès à un ensemble de dossiers trop large. Bascule vers un agent plus étroit ou demande au propriétaire de l'agent de restreindre son onglet **Base de connaissances**. La cartographie complète vit dans [Concepts d'agent — Base de connaissances](/fr/platform/agents/concepts#knowledge).
- **La pièce jointe a été téléversée mais l'agent l'ignore** — le fichier dépasse le budget de contexte du modèle ou son type n'est pas dans l'ensemble pris en charge. Essaie un fichier plus petit ou convertis en PDF ; [Pièces jointes](/fr/platform/chat/attachments) liste les types et limites pris en charge.
- **L'icône micro n'apparaît pas** — le navigateur ne prend pas en charge la Web Speech API (anciens builds Firefox, certaines WebView embarquées) ou le site n'a pas la permission micro. Bascule sur Chrome, Edge ou Safari, et accorde la permission quand on te la demande.
- **Le panneau Canevas ne s'ouvre pas** — la sortie de l'agent n'est pas assez longue ou ne correspond à aucun format d'artefact. Demande explicitement un artefact HTML, Mermaid ou Markdown dans le prompt.

## Où ça s'inscrit

La même boucle en cinq étapes couvre presque tout le travail quotidien de chat d'un Membre : agent, contexte, demander, itérer, sortir les artefacts de la bulle quand ils méritent une autre place. Les raccourcis qui donnent la vitesse — glisser-déposer pour les pièces jointes, dictée, sélecteur d'agent, bibliothèque de prompts — vivent tous dans le composer ; la mémoire musculaire rend la boucle proche d'une barre de recherche au-dessus du savoir de ton organisation.

Quand tu cherches un agent plus ajusté que ceux disponibles, [Construire ton premier agent end-to-end](/fr/tutorials/editor/first-agent-end-to-end) déroule la création — ça demande le rôle Éditeur. Pour les raccourcis clavier qui compressent encore la boucle, [Chat — Bases — Raccourcis clavier](/fr/platform/chat/basics#keyboard-shortcuts) porte la liste complète.
