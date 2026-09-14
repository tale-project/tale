---
title: Envoyer ton premier message
description: Te connecter à Tale, lancer un chat, choisir un modèle et vérifier sa réponse.
---

Commence ici si tu as accès à un espace Tale et souhaites obtenir une première réponse. Tu vas envoyer un court prompt, lire la réponse, puis retrouver la conversation.

## Avant de commencer

Il te faut l’adresse de ton instance, un compte et un espace avec un fournisseur IA connecté. Demande l’accès à la personne qui gère cet espace. Pour installer Tale, suis le [démarrage en auto-hébergement](/fr/self-hosted/install/quickstart). Pour une instance gérée, consulte [la mise en route Cloud](/fr/cloud/onboarding).

Ton compte te permet de te connecter. L’organisation est l’espace qui regroupe les membres, les projets et la configuration de ton équipe. Ton rôle détermine les actions que tu peux y effectuer.

## Lancer une conversation

<Steps>

<Step title="Te connecter et ouvrir Chat">

Ouvre ton instance et utilise la méthode de connexion indiquée par ton admin. Si tu appartiens à plusieurs organisations, choisis celle où tu veux travailler. Ouvre **Chat**, puis **Nouveau chat** dans la barre latérale des chats. Si l’historique est masqué, utilise **Afficher les chats** pour le retrouver.

</Step>

<Step title="Vérifier le modèle et écrire un prompt">

La commande de modèle sous le champ de message affiche les choix disponibles. Elle peut indiquer **Auto** ; sélectionne un modèle précis si tu veux choisir lequel répond. Les options dépendent des fournisseurs connectés et des règles d’accès de ton espace.

<Frame caption="Le champ de message et le choix du modèle se trouvent dans la même zone de saisie.">

![La zone de saisie du chat contient le champ de message, le sélecteur de modèle, les commandes de pièces jointes et le bouton d’envoi.](/images/platform/chat-composer.webp)

</Frame>

Pour ce premier test, utilise une demande autonome : « Rédige une liste de trois points pour préparer une réunion d’équipe. Limite chaque point à une phrase. » Elle ne dépend ni de documents chargés ni d’outils connectés.

</Step>

<Step title="Envoyer et lire la réponse">

Sélectionne **Envoyer le message** ou appuie sur Entrée. Ton message apparaît dans la conversation, suivi de la réponse de l’assistant. Un indicateur de réflexion peut précéder la réponse. Attends qu’elle soit terminée avant de l’évaluer.

Vérifie le respect de la longueur et du format demandés. Pose une question complémentaire, par exemple : « Ajoute qui devrait préparer chaque point. » La même conversation conserve le contexte des messages précédents.

</Step>

</Steps>

## Retrouver le chat

Rouvre la conversation dans la barre latérale des chats. Un nouveau chat démarre une conversation séparée, utile lorsque tu changes de sujet. Les [bases du chat](/fr/platform/chat/basics) expliquent les noms, l’historique et les commandes des réponses.

<Tip>

Précise l’objectif, les informations à utiliser et le format attendu. « Résume ces notes en décisions et questions ouvertes » définit mieux la tâche que « Aide-moi avec ceci ».

</Tip>

## Si tu n’obtiens pas de réponse

| Ce que tu observes | Action à prendre |
| --- | --- |
| La connexion échoue | Vérifie l’adresse de l’instance et la méthode de connexion avec ton admin. |
| Aucun modèle n’est disponible | Demande à un admin de vérifier les [fournisseurs IA](/fr/platform/admin/providers) et ton accès aux modèles. |
| Une erreur de fournisseur ou de modèle apparaît | Essaie un autre modèle disponible et transmets l’erreur affichée à l’admin. |
| Une limite d’utilisation est atteinte | Demande à l’admin de vérifier la [politique](/fr/platform/admin/governance/policies-and-limits) concernée. |
| La réponse n’utilise pas tes documents | Le premier prompt ne contenait pas de source. Ajoutes-en avec les [pièces jointes du chat](/fr/platform/chat/attachments) ou les [connaissances](/fr/platform/knowledge/overview). |

Poursuis avec [Tale en équipe](/fr/get-started/members) ou [les prompts efficaces](/fr/tutorials/member/chat-effectively).

<Video src="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.mp4" poster="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.webp" captions="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.vtt" lang="fr" title="Épisode 1 — Bienvenue dans Tale" caption="Épisode 1 — Bienvenue dans Tale (2:46)">

</Video>
