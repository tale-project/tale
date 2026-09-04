---
title: Construire un workflow avec approbation
description: L’éditeur IA et sa carte de proposition ne font pas partie de cette version — un workflow avec une décision humaine se construit sur le canvas, et l’exécution attend cette décision sur sa page de détail.
---

Ce tutoriel activait autrefois un **Éditeur IA** dans la barre d’outils du canvas, décrivait un workflow à trois étapes en un message, approuvait la carte de proposition qu’il renvoyait, puis répondait à l’exécution en pause. L’éditeur IA n’existe pas dans cette version de Tale — le canvas n’a pas de panneau d’assistant, et aucune carte ne te propose une définition à approuver. La décision humaine au milieu d’une exécution, elle, existe bel et bien ; elle vient de l’exécution elle-même, pas d’une carte dans un éditeur.

<Note>

L’éditeur IA n’est pas disponible dans cette version. Tu construis la définition sur le canvas et tu l’enregistres toi-même comme version, ou tu laisses un modèle la rédiger par l’[endpoint MCP](/fr/develop/mcp-endpoint) ; une personne décide toujours l’étape sortante au moment de l’exécution.

</Note>

## Mettre une personne entre le brouillon et l’envoi aujourd’hui

Construis la forme à la main sur le canvas : un nœud **agent** qui rédige le résumé, puis un nœud connector qui l’envoie. Rien de plus n’est nécessaire pour la décision — une écriture de connector qui quitte ton locataire, comme envoyer un courrier ou poster dans un canal, met l’exécution réelle en pause d’elle-même. L’exécution apparaît **En attente** dans la liste des exécutions, sa page de détail affiche **En attente de ton approbation** avec le message exact que l’étape enverrait, et **Approuver** le libère tandis que **Rejeter** arrête l’exécution. Une planification sur la page de l’automatisation la lance chaque matin de semaine, et **Essai** exerce le graphe contre des simulations sans rien envoyer. [L’éditeur de workflow](/fr/platform/automations/editor) déroule le canvas, l’enregistrement et la mise en service ; [Déclencheurs d’automatisation](/fr/platform/automations/triggers) couvre la planification.

Quand la décision doit porter sur le brouillon plutôt que sur l’envoi, laisse l’agent demander : un nœud agent d’automatisation porte un outil `ask_human`, et une exécution qui l’appelle se met en pause comme **En attente**, la question sur sa page de détail, jusqu’à ce que tu répondes, puis reprend à ce nœud avec ta réponse. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) couvre les deux portes.

## Où ça mène

La forme que ce tutoriel promettait — rédiger, décider, agir — est celle qu’une exécution prend d’elle-même dans cette version : l’écriture sortante demande, une personne lit l’appel exact, et le registre dit qui l’a autorisé. [Concepts d’automatisation](/fr/platform/automations/concepts) est le vocabulaire derrière définition, déclencheur et exécution ; [Concepts d’approbation](/fr/platform/approvals/concepts) est le modèle derrière l’attente.
