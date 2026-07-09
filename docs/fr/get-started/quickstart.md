---
title: Démarrage rapide
description: De rien à ta première réponse d’agent — obtiens une instance, connecte-toi et envoie ton premier message. Cinq minutes sur Cloud, quinze sur ta propre machine.
---

C’est le chemin le plus court vers un chat qui répond : obtenir une instance, se connecter, envoyer un message, regarder la réponse arriver en streaming. Compte environ cinq minutes sur Cloud et quinze sur ta propre machine ; à la fin tu vois l’écran ci-dessous — une vraie réponse d’un agent sur ton espace de travail.

<Frame caption="Là où ce démarrage rapide se termine : une réponse d’agent en streaming dans l’onglet Chat.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

## Obtenir une instance

Les deux éditions font tourner le même produit — choisis selon qui doit exploiter la stack.

<Tabs>

<Tab title="Cloud">

Va sur [tale.dev](https://tale.dev) et clique sur **Démarrer**. Le formulaire d’inscription demande ton nom, ton e-mail et un mot de passe ; vérifie le lien reçu par e-mail, nomme ton organisation et tu atterris dans le dashboard. L’assistant de configuration propose de connecter un fournisseur d’IA tout de suite — colle une clé [OpenRouter](https://openrouter.ai) à cet endroit et le chat fonctionne immédiatement. Le [parcours admin](/fr/get-started/admins) déroule le même assistant, captures d’écran à l’appui, quand tu veux plus que le chemin le plus direct.

</Tab>

<Tab title="Auto-hébergé">

Avec [Docker](https://www.docker.com/products/docker-desktop) en marche, trois commandes montent toute la stack sur ta machine :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

Le premier lancement récupère les images — compte cinq à dix minutes. Quand le navigateur s’ouvre, inscris-toi : le premier compte revendique le rôle **Propriétaire** et crée ton organisation. Le [démarrage rapide auto-hébergé](/fr/self-hosted/install/quickstart) couvre chaque étape en profondeur, Windows et dépannage compris.

</Tab>

</Tabs>

## Envoyer ton premier message

<Steps>

<Step title="Ouvre un nouveau chat">

Clique sur **Nouveau chat** dans la barre latérale. Le composeur en bas de l’écran est le point de départ de tout : le sélecteur d’agent à gauche, le sélecteur de modèle à côté, et le champ de message avec l’envoi à droite. Le composeur qui attend avec **Assistant** et **Auto** présélectionnés signifie que tu es prêt à envoyer.

<Frame caption="Le composeur — sélecteur d’agent, sélecteur de modèle, champ de message.">

![La barre du composeur de chat avec le sélecteur d’agent, le sélecteur de modèle et le bouton d’envoi.](/images/platform/chat-composer.webp)

</Frame>

</Step>

<Step title="Pose une vraie question">

Laisse l’agent sur **Assistant** et le modèle sur **Auto** — Tale résout le meilleur modèle disponible au moment de la requête. Tape une question et envoie-la. La réponse arrive en streaming, token par token ; quand l’agent raisonne avant de répondre, une ligne de réflexion repliable apparaît au-dessus de la réponse.

<Check>

Une réponse en streaming qui répond à ta question prouve que toute la chaîne fonctionne — fournisseur, routage de modèle et agent. Tu as un espace de travail opérationnel.

</Check>

</Step>

</Steps>

## Où tu en es

Tu as une instance qui tourne et un agent qui répond. Les quinze prochaines minutes dépendent de ton rôle : le [parcours membre](/fr/get-started/members) couvre les documents et les projets, le [parcours éditeur](/fr/get-started/editors) publie ton premier agent spécialiste, le [parcours admin](/fr/get-started/admins) monte l’équipe et les fournisseurs, et le [parcours développeur](/fr/get-started/developers) te donne une clé API et ta première requête.
