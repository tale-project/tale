---
title: Chat
description: Le chat sert à demander et à retrouver — envoie un message, laisse Auto choisir le modèle ou épingle le tien, lis une réponse dont les étapes et les sources restent visibles. Cet aperçu cartographie l’écran et trace la frontière entre chat, tâche et automatisation.
---

Le chat est le point d’entrée quotidien à Tale. Tu poses ta question, l’assistant cherche dans les connaissances de l’organisation ou va chercher une page quand la question le demande, et la réponse arrive en streaming, chaque étape et chaque source à l’affiche. Le chat ne fait délibérément qu’un seul travail — les questions et la récupération. Le travail qui demande un responsable et un résultat à relire — une présentation, un document traduit, un export de données — vit sur une tâche ; un processus fixe vit dans une automatisation. L’assistant connaît cette frontière et te renvoie vers une tâche dès qu’une demande la franchit, si bien que rien de lourd ne reste à moitié bâti dans un chat.

<Frame caption="Un chat avec une réponse en streaming — la question, les étapes de l’assistant et la réponse.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

## Les parties de l’écran

La barre latérale liste chaque chat que tu peux reprendre, rangé sous tes dossiers de projet, favoris épinglés en tête, avec la recherche et les chats archivés en dessous. La colonne de conversation porte l’échange : au-dessus de chaque réponse, une ligne de réflexion repliable consigne ce que l’assistant a fait — le raisonnement, puis chaque recherche de connaissances ou récupération de page, dans l’ordre — et sous la réponse, **Sources** liste ce qu’il a réellement lu. La zone de saisie, en bas, est le champ de message plus un sélecteur unique pour le modèle — **Auto** par défaut, chaque modèle listé à épingler, et l’effort de raisonnement pour un modèle épinglé qui en a un ; le menu `+` porte la lecture à voix haute et le Mode Arène, et le micro dicte. Pendant qu’une réponse arrive en streaming, le bouton d’envoi devient un bouton d’arrêt.

Un chat tout neuf s’ouvre sur quatre suggestions de départ. Clique sur l’une d’elles : elle devient ton premier message — le moyen le plus rapide de voir toute la boucle tourner une fois.

<Frame caption="Un nouveau chat : le message d’accueil, les quatre suggestions de départ et la zone de saisie.">

![L’écran d’un nouveau chat encore vide, avec le message d’accueil, quatre boutons de suggestions de conversation et la zone de saisie en dessous.](/images/platform/chat-starters-empty.webp)

</Frame>

## Chat, tâche ou automatisation ?

Fais correspondre le travail à la surface — chaque type de travail a exactement une place.

| Type de travail                                                         | Où il vit      | Pourquoi                                                                                                 |
| ----------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| Interroger les connaissances, les documents ou une page web publique    | Chat           | Une conversation aux étapes et aux sources visibles ; rien à faire valider                               |
| Produire un livrable — une présentation, une traduction, un rapport     | Tâche          | Il faut un responsable et une relecture ; un agent fait le travail, une personne marque la tâche Terminé |
| Un processus fixe, avec des portes de validation et des étapes humaines | Automatisation | Le processus est le produit ; personnes et agents agissent à l’intérieur                                 |

L’assistant fait respecter la première ligne lui-même : demande-lui une dissertation de 2 000 mots et il t’en donne une esquisse courte, puis te dit de créer une tâche et de l’assigner à un agent. C’est voulu — un livrable produit directement dans le chat n’aurait ni étape de relecture ni responsable.

## Les pages de cette section

<CardGroup cols="2">

<Card title="Bases du chat" icon="message-circle" href="/fr/platform/chat/basics">

Ce qui se passe entre l’envoi et l’arrivée de la réponse — la zone de saisie, les trois outils de récupération, le déroulé de réflexion et les sources.

</Card>

<Card title="Mode Arène" icon="swords" href="/fr/platform/chat/arena-mode">

La comparaison de modèles côte à côte, et comment les verdicts remontent dans l’analyse des retours.

</Card>

<Card title="Mode vocal" icon="mic" href="/fr/platform/chat/voice-mode">

Parler au lieu de taper — les passations STT et TTS et la frontière de confidentialité.

</Card>

<Card title="Chats partagés" icon="share-2" href="/fr/platform/chat/shared-threads">

Partager un instantané en lecture seule d’un chat avec le reste de l’organisation, et arrêter le partage plus tard.

</Card>

</CardGroup>

## Où cela s’inscrit

Le chat est la surface qui pose les questions ; le reste de la plateforme est ce qu’il interroge. La base de connaissances alimente ses recherches, et les [projets](/fr/platform/projects/overview) classent son historique et portent les tâches qui reprennent tout ce que le chat refuse délibérément de bâtir sur place. La page à mettre en favori en premier est [Bases du chat](/fr/platform/chat/basics) — une fois compris le chemin de l’envoi à la réponse, chaque autre page du chat se lit comme une variation autour.
