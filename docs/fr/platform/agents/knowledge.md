---
title: Connaissances d’agent
description: L’onglet Base de connaissances de l’agent — le mode de récupération, les portées des documents d’équipe et d’organisation, les téléversements propres à l’agent, et la frontière avec les outils et les pièces jointes.
---

Les connaissances sont ce qu’un agent peut récupérer et citer au moment de répondre. Sans elles l’agent est générique ; avec elles il répond depuis tes documents et cite d’où vient la réponse. L’onglet **Base de connaissances** de l’agent contrôle deux choses : _comment_ l’agent récupère (le mode de récupération) et _ce qui_ est dans la portée (quels documents).

<Frame caption="L’onglet Base de connaissances — le mode de récupération au-dessus, les portées de documents et ce que chacune tient en dessous.">

![L’onglet Base de connaissances de l’éditeur d’agent avec Outil choisi parmi les quatre modes de récupération, les interrupteurs des documents d’équipe et d’organisation tous deux actifs, un encadré de documents d’équipe indiquant qu’aucun document n’a été trouvé pour cette équipe, et la liste des documents de l’organisation où chaque fichier porte un badge Indexé.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Choisir un mode de récupération

Quatre modes arbitrent entre coût et couverture. **Outil** laisse l’agent chercher à la demande — la récupération ne tourne que quand le modèle décide d’en avoir besoin. **Contexte** injecte les connaissances pertinentes dans chaque réponse, que le modèle l’aurait demandé ou non. **Les deux** les combine, et **Désactivé** coupe entièrement la base de connaissances pour cet agent. Commence avec **Outil** ; passe à **Contexte** quand tout le travail de l’agent est de répondre depuis les documents et que tu veux la récupération à chaque réponse.

## Cadrer les documents

La base de connaissances interroge les documents téléversés dans ton organisation — la même bibliothèque que tu gères sous [Documents](/fr/platform/knowledge/documents). Deux interrupteurs fixent la portée : **Inclure les documents de l'équipe** couvre l’équipe assignée à l’agent, et **Inclure les documents de l'organisation** couvre les documents assignés à aucune équipe. L’onglet liste ce que chaque portée contient à l’instant, avec l’état d’indexation par document — seuls les documents marqués **Indexé** sont récupérables.

## Donner à l’agent ses propres documents

Les **Documents de l'agent** sont des téléversements que seul cet agent peut atteindre — clique sur **Téléverser des documents** et les fichiers rejoignent la portée de récupération de cet agent sans entrer dans la bibliothèque partagée. Va vers eux quand la source appartient au travail de l’agent plutôt qu’à l’organisation : un playbook de tri, une FAQ propre à un produit.

## Comment la récupération atterrit dans la réponse

Quand l’agent récupère, les citations s’attachent aux phrases qu’elles soutiennent — survoler montre la source, cliquer l’ouvre. Tout ce qui est récupérable concourt à la pertinence à chaque question, donc garde la portée serrée : une portée large rend la récupération plus bruyante, pas plus intelligente.

## Quand y recourir

Les enregistrements structurés et les sources vivantes sont des outils, pas des connaissances — et les fichiers pour une seule conversation sont des pièces jointes. Les frontières :

| Utilise…                                                 | Quand l’agent a besoin…                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| les connaissances (cet onglet)                           | De chercher et citer des documents téléversés à chaque chat         |
| [Outils](/fr/platform/agents/tools)                      | Des contacts, produits, fournisseurs, sites web ou systèmes vivants |
| [Pièces jointes](/fr/platform/chat/attachments)          | D’un fichier qui ne compte que pour un seul chat                    |
| [Agents de projet](/fr/platform/projects/project-agents) | De connaissances cantonnées à un seul Projet                        |

## Où ça se situe

Les connaissances d’agent répondent à « cet agent doit répondre depuis ces documents ». La section [Connaissances](/fr/platform/knowledge/overview) au sens large est l’endroit où les sources vivent et s’indexent ; cet onglet câble un agent sur une portée d’entre elles. Pour la construction de bout en bout — téléverser, cadrer, demander, vérifier les citations — parcours [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge).
