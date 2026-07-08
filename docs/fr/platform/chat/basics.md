---
title: Bases du chat
description: Ce qui se passe entre la frappe sur Envoyer et l'arrivée de la réponse — composer, choix de l'agent, résolution du modèle, streaming, citations, et comment un chat est stocké.
---

Cette page est le modèle mental pour tout dans l'onglet Chat. Elle nomme les parties du composer, suit un message unique de la touche pressée à la réponse en streaming, et explique comment un chat est stocké une fois arrivé. Une fois lue, le reste des pages chat se lit comme des variations sur le même flux.

Le flux est surtout invisible — Tale assemble une demi-douzaine de sous-systèmes pour qu'un chat ressemble à une seule conversation — mais les coutures comptent quand quelque chose se comporte de façon inattendue. Savoir quel sous-système possède quelle étape est la différence entre un rapport de bug utile et un rapport vague.

## Le composer

Le composer est la bande de saisie en bas de l'écran. Trois contrôles comptent : le sélecteur d'agents à gauche, le sélecteur de modèles à côté, et le textarea avec **Envoyer le message** à droite. Le sélecteur d'agents expose chaque agent que l'organisation a marqué **Visible in chat**, plus un **Assistant** par défaut quand aucun agent n'est choisi. Le sélecteur de modèles expose chaque modèle tagué chat que la politique de l'agent autorise ; **Auto** laisse Tale résoudre à la requête. Les pièces jointes arrivent par collage, glisser-déposer, ou le contrôle d'upload — voir [Pièces jointes](/fr/platform/chat/attachments) pour ce qui est accepté.

## Le sélecteur d'agents

Le sélecteur d'agents filtre par nom à mesure que tu tapes ; le défaut est un **Assistant** sans agent qui utilise le modèle de chat par défaut de l'organisation et aucune connaissance ou outil supplémentaire. Choisir un agent avant le premier message rend l'agent persistant pour tout le chat ; en choisir un en milieu de chat l'applique au message suivant et tout ce qui suit. Il n'y a pas de bascule « retour à aucun agent » — choisis **Assistant** pour revenir. La page [Agents dans le chat](/fr/platform/chat/agents-in-chat) couvre les règles en détail.

## Le sélecteur de modèles

Le sélecteur de modèles liste les modèles que l'agent (ou l'organisation, quand aucun agent n'est choisi) a le droit d'utiliser. Chaque modèle porte un tag — **Chat**, **Vision**, **Image generation**, **Embedding** — qui signale à quoi il est bon. Choisir un modèle vision quand le message n'a pas d'image va bien ; choisir un modèle non-vision quand le message inclut une image laisse tomber l'image en silence. **Auto** choisit le primaire de l'agent ; quand le primaire est rate-limité ou indisponible, Tale tombe sur l'ordre de fallback que l'agent nomme.

## Rendu de la réponse et citations

La réponse arrive en streaming token par token. Les appels d'outils s'affichent comme des boîtes pliées que l'utilisateur peut déplier pour lire ce que l'agent a fait ; les sorties de **Run code** atterrissent dans le Canvas à droite. Quand l'agent récupère du savoir, des citations s'attachent aux phrases qu'elles soutiennent — survoler une citation montre le titre de la source ; cliquer ouvre la source. Les instructions de l'agent n'apparaissent jamais dans la réponse rendue ; elles sont une couche en dessous, façonnant le comportement plutôt que le texte.

## Questions de l'agent

Un agent doté de l'outil human input peut s'interrompre en pleine tâche pour te poser une question — une carte **Question** apparaît dans le chat avec les champs dont l'agent a besoin, et la génération attend ta réponse. Remplis le formulaire et clique sur **Soumettre la réponse**, ou clique sur **Répondre différemment** pour répondre en texte libre. La carte répondue reste dans la transcription à l'endroit où la question a été posée, pour que l'échange se relise dans l'ordre. Si ta réponse était fausse ou incomplète, clique sur **Modifier la réponse** sur la carte répondue — le formulaire se rouvre prérempli, et **Mettre à jour la réponse** relance l'agent, la réponse corrigée remplaçant l'ancienne. La carte garde chaque réponse précédente : feuillette les versions avec les flèches à côté de la réponse, comme pour les messages modifiés.

## Chats et la boîte de réception

À l'intérieur du Chat, l'unité est un **chat** — c'est le mot que chaque bouton et chaque toast utilise. Le modèle de données derrière s'appelle `threads`, et l'URL est `threads/$threadId` ; la doc suit l'UI et dit « chat » dans la prose. L'onglet **Boîte de réception** d'une automatisation installée est une tout autre surface — les conversations e-mail des clients que Gmail, Outlook ou IMAP/SMTP font arriver, pas une liste de chats. Deux sens de « conversation », deux surfaces — voir [Automatisations livrées](/fr/platform/automations/builtin) pour le sens de boîte de réception.

## History et recherche

**History** est la liste de chaque chat que l'utilisateur peut reprendre dans cette organisation. Les nouveaux chats apparaissent en haut ; en sélectionner un ouvre le transcript complet. **Search chat** filtre l'History par titre ; la recherche texte intégrale sur les corps de messages est une opération par chat, pas à l'échelle de l'organisation. **Rename chat** pose un titre personnalisé qui remplace celui généré par le modèle ; **Delete chat** déplace le chat dans la [Corbeille](/fr/platform/admin/governance/trash) où la rétention le balaie après la fenêtre de grâce.

## Où ça s'inscrit

Bases du chat est la page que tout le reste de la section affine : [Agents dans le chat](/fr/platform/chat/agents-in-chat) creuse le sélecteur, [Pièces jointes](/fr/platform/chat/attachments) le téléversement, [Mode vocal](/fr/platform/chat/voice-mode) les passations STT et TTS autour du même composer. Si tu es venu ici pour construire un agent plutôt que pour en utiliser un, saute à [Concepts d'agent](/fr/platform/agents/concepts) — le modèle à quatre boutons est le socle sur lequel repose chaque chat avec un agent.
