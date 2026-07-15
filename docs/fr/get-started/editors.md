---
title: Ton premier jour de création d’agents
description: Le parcours éditeur — crée un agent, donne-lui des instructions et un modèle, rends-le visible dans le chat et regarde-le répondre.
---

Ce parcours s’adresse à la personne qui transforme « l’équipe pose toujours les mêmes questions » en un agent qui y répond. En quinze minutes, tu crées un agent, tu façonnes son comportement et tu le regardes répondre dans le chat — la boucle que chaque agent suivant raffine.

Il te faut le rôle **Éditeur** ou plus (la section Agents est masquée pour les membres) sur un espace de travail où le chat répond déjà — c’est le [démarrage rapide](/fr/get-started/quickstart).

<Steps>

<Step title="Crée l’agent">

Pour lancer un agent que tes collègues peuvent choisir dans le chat, ouvre **Agents** dans la barre latérale et clique sur **Créer un agent**. Nomme-le d’après le travail, pas la technologie — « Tri support » bat « GPT Helper » — parce que ce nom est ce que tes collègues choisiront plus tard dans le chat.

</Step>

<Step title="Façonne son identité">

L’éditeur s’ouvre sur l’onglet **Général** : le nom affiché que voient tes collègues, une description d’une ligne et le type d’agent. L’interrupteur qui compte au premier jour est **Visible dans le chat** — sans lui, l’agent existe mais personne ne peut le choisir depuis le chat.

<Frame caption="L’onglet Général — identité, type d’agent et visibilité dans le chat.">

![L’onglet Général de l’éditeur d’agent pour l’agent Assistant, montrant les options de type d’agent, l’interrupteur Visible dans le chat et le champ du nom affiché.](/images/get-started/agent-editor-general.webp)

</Frame>

</Step>

<Step title="Écris les instructions">

Ouvre **Instructions et modèles** — le levier qui compte le plus. Écris un paragraphe comme si tu briefais un nouveau collègue : la voix dans laquelle répondre, le domaine qu’il possède et les cas qu’il doit refuser. Concret bat complet — tu affineras après avoir vu de vraies réponses.

<Frame caption="Instructions et modèles — le prompt système au-dessus de la liste ordonnée de modèles.">

![L’onglet Instructions et modèles de l’éditeur d’agent montrant le champ du prompt système et la liste ordonnée de modèles pour l’agent Assistant.](/images/platform/agent-editor-instructions.webp)

</Frame>

</Step>

<Step title="Lie le modèle">

Le même onglet lie le modèle : choisis-en un parmi les fournisseurs configurés de l’espace de travail, ou laisse le routage en automatique pour que Tale résolve le meilleur modèle disponible à chaque requête. Clique sur **Enregistrer** — un toast **Agent enregistré** confirme l’écriture.

</Step>

<Step title="Regarde-le répondre">

Ouvre **Nouveau chat**, choisis ton agent dans le sélecteur d’agent et pose une question en plein dans les instructions que tu as écrites. Puis pose une question que les instructions disent de refuser.

<Frame caption="Le sélecteur d’agent — ton nouvel agent listé à côté des agents du catalogue.">

![Le sélecteur d’agent du chat ouvert, listant les agents disponibles dans l’espace de travail.](/images/platform/chat-agent-picker.webp)

</Frame>

<Check>

Une réponse dans la bonne voix au premier message et un refus au second prouvent que les instructions tiennent — l’agent est réel.

</Check>

</Step>

</Steps>

## Où tu en es

Tu as livré le plus petit agent réel : des instructions, un modèle, une place dans le sélecteur. Le modèle complet derrière ce que tu viens de toucher est [Concepts d’agent](/fr/platform/agents/concepts) — instructions, connaissances, outils et modèle comme quatre leviers. La construction suivante naturelle est [ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end), qui ajoute des liaisons de connaissances et un vrai domaine ; ensuite, [agents avec connaissances](/fr/tutorials/editor/agent-with-knowledge) et [délégation entre agents](/fr/tutorials/editor/delegate-between-agents) poussent la même boucle plus loin.
