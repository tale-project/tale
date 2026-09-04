---
title: Ton premier jour de création d’agents
description: Le parcours éditeur — crée un agent de projet, donne-lui des instructions et regarde-le faire un vrai travail sur une tâche.
---

Ce parcours s’adresse à la personne qui transforme « l’équipe pose toujours les mêmes questions » en un agent qui y répond. En quinze minutes, tu crées un agent sur un projet, tu façonnes son comportement et tu le regardes faire un vrai travail sur une tâche — la boucle que chaque agent suivant raffine.

Il te faut un accès en écriture à un projet et au moins un fournisseur sous **Paramètres > Fournisseurs IA** avec un modèle dessus ; si le chat répond déjà, le fournisseur est là — c’est le [démarrage rapide](/fr/get-started/quickstart). Dans cette version, les agents vivent sur les projets : il n’y a pas d’entrée Agents dans la barre latérale ni d’agent à choisir dans le chat.

<Steps>

<Step title="Crée l’agent">

Pour lancer un agent que tes collègues peuvent mettre au travail, ouvre l’onglet **Agents** d’un projet et clique sur **Nouvel agent**. Nomme-le d’après le travail, pas la technologie — « Tri support » bat « GPT Helper » — parce que c’est ce nom que tes collègues voient sur les cartes de tâches quand ils lui assignent du travail.

</Step>

<Step title="Choisis le harness et le modèle">

Le dialogue demande un **Harness** — la CLI de code sur laquelle l’agent tourne — et un **Modèle** ; un modèle servi par plusieurs fournisseurs apparaît une fois par fournisseur, et le choix est exact. Laisse **Skills, connectors & outils** et **Secrets** vides le premier jour : chaque outil accordé élargit ce que l’agent peut atteindre, et le premier travail n’en a besoin d’aucun.

</Step>

<Step title="Écris les instructions">

**Instructions** est le levier qui compte le plus. Écris un paragraphe comme si tu briefais un nouveau collègue : la voix dans laquelle répondre, le domaine qu’il possède et les cas qu’il doit refuser. Concret bat complet — tu affineras après avoir vu de vrais résultats. Clique sur **Créer l'agent** ; on peut lui assigner du travail dès cet instant, sans étape de publication séparée.

</Step>

<Step title="Regarde-le travailler">

Les agents font leur travail sur des tâches — le chat, lui, ne fait tourner que l’assistant intégré. Crée sur le tableau du projet une tâche qui énonce le travail en une phrase, assigne-la à l’agent et clique sur **Démarrer l'agent**. La carte passe en _En cours_ pendant que l’agent travaille dans sa sandbox ; son rapport arrive en commentaire de tâche et la carte se gare en **En revue** — seule une personne la passe en _Terminé_.

<Check>

Un résultat qui suit la voix et le périmètre que tu as écrits prouve que les instructions tiennent — l’agent est réel.

</Check>

</Step>

</Steps>

## Où tu en es

Tu as livré le plus petit agent réel : un agent nommé dans l’onglet **Agents** d’un projet, avec un paragraphe d’instructions. Le modèle complet derrière ce que tu viens de toucher est [Concepts d’agent](/fr/platform/agents/concepts) — instructions, outils, skills et portée des connaissances —, et [Agents de projet](/fr/platform/projects/project-agents) est la référence champ par champ. La construction suivante naturelle est [ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end), qui rejoue les mêmes quatre gestes sur un vrai domaine et relit le résultat ; ensuite, l’[aperçu des connaissances](/fr/platform/knowledge/overview) dit où vivent les connaissances, et [Automatisation des tâches](/fr/platform/projects/task-automation) comment le travail d’un agent parvient au suivant par le tableau.
