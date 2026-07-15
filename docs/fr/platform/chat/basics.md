---
title: Bases du chat
description: Ce qui se passe entre l’envoi et l’arrivée de la réponse — chat, choix de l’agent, résolution du modèle, streaming, citations, et comment un chat est stocké.
---

Cette page est le modèle mental pour tout ce qui vit dans l’onglet Chat. Elle nomme les parties du chat, suit un message de la touche pressée à la réponse en streaming, et explique comment un chat est stocké une fois arrivé — lis-la une fois et le reste des pages de chat se lit comme des variations sur le même flux.

<Frame caption="L’onglet Chat avec une réponse en streaming au-dessus du chat.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

## Le chat

Le chat est la bande de saisie en bas de l’écran. Trois contrôles comptent : le sélecteur d’agents à gauche, le sélecteur de modèles à côté, et le champ de message avec l’envoi à droite. Les pièces jointes arrivent par collage, glisser-déposer ou le contrôle d’ajout — voir [Pièces jointes](/fr/platform/chat/attachments) pour ce qui est accepté.

<Frame caption="Les contrôles du chat — le champ de message, les sélecteurs d’agents et de modèles, et l’envoi.">

![La zone de saisie du chat, vide, dont le texte d’invite propose de poser une question sur les contacts, les produits ou les documents, au-dessus d’une barre d’outils qui porte les boutons de pièce jointe et de bibliothèque de prompts, le sélecteur d’agents, le sélecteur de modèles, et les boutons de sourdine, de micro et d’envoi.](/images/platform/chat-composer.webp)

</Frame>

## Choisir un agent

Le sélecteur d’agents filtre par nom à mesure que tu tapes ; le défaut est un **Assistant** sans agent, qui utilise le modèle de chat par défaut de l’organisation et aucune connaissance ni outil supplémentaire. Choisir un agent avant le premier message le rend persistant pour tout le chat ; en choisir un en cours de chat s’applique à partir du message suivant.

<Note>

Il n’existe pas de bascule « rétablir sans agent » — choisis **Assistant** pour revenir en arrière. Les règles complètes vivent dans [Agents dans le chat](/fr/platform/chat/agents-in-chat).

</Note>

## Choisir un modèle

Le sélecteur de modèles liste ce que l’agent (ou l’organisation, quand aucun agent n’est choisi) autorise. Chaque modèle porte un tag — **Chat**, **Vision**, **Génération d'images**, **Embedding** — qui signale ce à quoi il est bon. **Auto** choisit le modèle primaire de l’agent ; quand le primaire est limité en débit ou indisponible, Tale redescend l’ordre de repli que l’agent définit.

<Warning>

Choisir un modèle sans vision quand le message inclut une image abandonne l’image en silence — la réponse se lit comme si l’image n’avait jamais été envoyée.

</Warning>

## Lire la réponse

La réponse arrive en streaming, token par token. Quand l’agent raisonne avant de répondre, une ligne de réflexion pliable apparaît au-dessus de la réponse. Les appels d’outils s’affichent comme des boîtes pliées que tu peux déplier pour lire ce que l’agent a fait ; la sortie d’**Exécuter du code** atterrit dans le Canevas, à droite, comme **Sortie de code** dans son arborescence de fichiers. Quand l’agent récupère des connaissances, des citations s’attachent aux phrases qu’elles soutiennent — survoler une citation montre le titre de la source, cliquer ouvre la source. Les instructions de l’agent n’apparaissent jamais dans la réponse rendue ; elles restent une couche en dessous et façonnent le comportement plutôt que le texte.

## Les questions de l’agent

Un agent doté de l’outil human input peut s’interrompre en pleine tâche pour te poser une question — une carte **Question** apparaît dans le chat avec les champs dont l’agent a besoin, et la génération attend ta réponse. Remplis le formulaire et clique sur **Soumettre la réponse**, ou clique sur **Répondre différemment** pour objecter en texte libre. Si ta réponse était fausse ou incomplète, clique sur **Modifier la réponse** sur la carte répondue — le formulaire se rouvre prérempli, et **Mettre à jour la réponse** relance l’agent, la réponse corrigée remplaçant l’ancienne. La carte garde chaque réponse précédente : feuillette les versions avec les flèches à côté de la réponse, comme pour les messages modifiés.

## Conversations versus chats

À l’intérieur du Chat, l’unité est un **chat** — c’est le mot que chaque bouton et chaque toast utilise. Le modèle de données derrière s’appelle `threads`, et le slug d’URL est `threads/$threadId` ; la doc suit l’UI et dit « chat » dans la prose. La boîte de réception des canaux clients qu’ajoute une automatisation d’e-mail installée est une autre surface — une conversation là-bas est un fil client, pas un chat ; voir [Automatisations livrées](/fr/platform/automations/builtin) pour le sens de boîte de réception.

## Historique et recherche

**Afficher l'historique** au-dessus du chat ouvre la barre latérale d’historique — chaque chat que tu peux reprendre dans cette organisation, du plus récent au plus ancien ; en sélectionner un ouvre le transcript complet. La recherche y filtre par titre ; la recherche en texte intégral dans les corps de messages est une opération par chat, pas à l’échelle de l’organisation. Renommer un chat pose un titre personnalisé qui remplace celui généré par le modèle ; supprimer un chat le déplace dans la [Corbeille](/fr/platform/admin/governance/trash), où la rétention le balaie après la fenêtre de grâce.

## Où ça s’inscrit

Bases du chat est la page que tout le reste de la section affine : [Agents dans le chat](/fr/platform/chat/agents-in-chat) creuse le sélecteur, [Pièces jointes](/fr/platform/chat/attachments) ce que fait le téléversement, [Mode vocal](/fr/platform/chat/voice-mode) les passations STT et TTS autour du même chat. Si tu es venu ici pour construire un agent plutôt que pour en utiliser un, saute à [Concepts d’agent](/fr/platform/agents/concepts) — le modèle mental à quatre boutons est le socle sur lequel repose chaque chat avec un agent.
