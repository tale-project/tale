---
title: Démarrage rapide
description: De rien à ta première réponse d’agent — obtiens une instance, connecte-toi et envoie ton premier message. Cinq minutes sur une instance prête, quinze si tu en montes une sur ta propre machine.
---

C’est le chemin le plus court vers un chat qui répond : obtenir une instance, se connecter, envoyer un message, regarder la réponse arriver en streaming. Compte environ cinq minutes sur une instance prête et quinze sur ta propre machine ; à la fin tu vois l’écran ci-dessous — une vraie réponse d’un agent sur ton espace de travail.

<Frame caption="Là où ce démarrage rapide se termine : une réponse d’agent en streaming dans l’onglet Chat.">

![Un fil de chat montrant une question d’utilisateur sur des retours d’onboarding et une réponse de l’assistant contenant un tableau markdown de trois thèmes.](/images/platform/chat-thread-reply.webp)

</Frame>

Tu préfères la vidéo ? L'épisode 1 parcourt le même chemin en trois minutes — sous-titres compris.

<Video src="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.mp4" poster="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.webp" captions="/videos/fr/tutorials/ep1-welcome/ep1-welcome.fr.vtt" lang="fr" title="Épisode 1 — Bienvenue dans Tale" caption="Épisode 1 — Bienvenue dans Tale (2:46)">

</Video>

## Obtenir une instance

Les deux éditions font tourner le même produit — choisis selon qui doit exploiter la stack.

<Tabs>

<Tab title="Auto-hébergé">

Avec [Docker](https://www.docker.com/products/docker-desktop) en marche, trois commandes montent toute la stack sur ta machine :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

Le premier lancement récupère les images — compte cinq à dix minutes. Quand le navigateur s’ouvre, inscris-toi : le premier compte revendique le rôle **Propriétaire** et crée ton organisation. Le [démarrage rapide auto-hébergé](/fr/self-hosted/install/quickstart) couvre chaque étape en profondeur, Windows et dépannage compris.

</Tab>

<Tab title="Cloud">

Les instances Cloud sont montées pour toi : remplis le [formulaire de demande de démo](https://tale.dev/fr/request-demo) et l’équipe Tale provisionne ta propre instance. Une fois qu’elle est prête, ouvre-la et inscris-toi — le formulaire demande ton nom, ton e-mail et un mot de passe ; vérifie le lien reçu par e-mail, nomme ton organisation et tu atterris dans le dashboard. L’assistant de configuration propose de connecter un fournisseur d’IA tout de suite — colle une clé [OpenRouter](https://openrouter.ai) à cet endroit et le chat fonctionne immédiatement. Le [parcours admin](/fr/get-started/admins) déroule le même assistant, captures d’écran à l’appui, quand tu veux plus que le chemin le plus direct.

</Tab>

</Tabs>

## Envoyer ton premier message

<Steps>

<Step title="Ouvre un nouveau chat">

Clique sur **Nouveau chat** dans la barre latérale. La zone de saisie en bas de l’écran est le point de départ de tout : le champ de message, et un seul sélecteur qui nomme le modèle d’où viendra la réponse. Un modèle déjà affiché sur le sélecteur signifie que tu es prêt à envoyer — l’assistant est intégré, il n’y a donc rien d’autre à choisir.

</Step>

<Step title="Pose une vraie question">

Choisis n’importe quel modèle de chat dans le sélecteur — chaque réponse vient du modèle que tu as nommé, rien n’est choisi pour toi en coulisses. Tape une question et envoie-la. La réponse arrive en streaming, token par token ; quand l’agent raisonne avant de répondre, une ligne de réflexion repliable apparaît au-dessus de la réponse.

<Check>

Une réponse en streaming qui répond à ta question prouve que toute la chaîne fonctionne — identifiant de fournisseur, modèle et assistant. Tu as un espace de travail opérationnel.

</Check>

</Step>

</Steps>

## Où tu en es

Tu as une instance qui tourne et un agent qui répond. Les quinze prochaines minutes dépendent de ton rôle : le [parcours membre](/fr/get-started/members) couvre les documents et les projets, le [parcours éditeur](/fr/get-started/editors) publie ton premier agent spécialiste, le [parcours admin](/fr/get-started/admins) monte l’équipe et les fournisseurs, et le [parcours développeur](/fr/get-started/developers) te donne une clé API et ta première requête.
