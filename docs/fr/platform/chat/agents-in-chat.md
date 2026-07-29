---
title: Agents dans le chat
description: Comment fonctionne le sélecteur d’agents dans le Chat — quels agents apparaissent, ce qu’un agent apporte à une réponse, combien de temps un choix dure, le changement en cours de chat et les appels de sous-agents.
---

Choisir un agent dans le Chat fait la différence entre interroger une assistance générale et interroger quelque chose que l’organisation a façonné pour un domaine. Le sélecteur est le contrôle le plus utilisé de la zone de saisie, et ses règles valent dix minutes de lecture : quels agents apparaissent, ce qui change quand tu en choisis un, combien de temps ce choix tient, et ce qu’il advient de la conversation quand tu changes à mi-parcours. Cette page couvre le côté usage ; construire un agent, c’est [Concepts d’agent](/fr/platform/agents/concepts).

## Le sélecteur d’agents

Ouvre la pastille d’agent dans la zone de saisie : le sélecteur liste les agents auxquels tu as accès, avec un champ de recherche qui filtre par nom pendant que tu tapes. La liste est plate — les agents ne sont pas rangés par types, et aucune entrée ne répond d’elle-même ni ne transmet le message à quelqu’un d’autre. L’agent que nomme la pastille est celui qui répondra à ton prochain message.

C’est la visibilité d’un agent qui décide de sa présence ici. La baisser ne désactive pas l’agent : les automatisations peuvent toujours l’exécuter et d’autres agents peuvent toujours lui déléguer du travail. Elle garde seulement le sélecteur court, ce qui compte dans une organisation qui a accumulé des dizaines d’agents utilitaires que personne ne choisit à la main.

## Ce qu’apporte un agent

Un agent est un petit objet lisible. Il porte un nom et une description, les instructions qui façonnent ses réponses, une visibilité, les tools et skills qu’il peut appeler, et la portée de connaissance qu’il peut atteindre. Cette liste, c’est tout l’agent.

<Note>

Un agent ne porte pas de modèle. Le modèle vient du sélecteur voisin et se choisit tour par tour — le même agent peut répondre via un modèle rapide le matin et via un plus solide quand la question durcit. [Bases du chat](/fr/platform/chat/basics) couvre le sélecteur de modèles et ses deux groupes.

</Note>

## Quand un choix persiste

Choisir un agent avant le premier message en fait l’agent du chat : chaque message suivant lui revient jusqu’à ce que tu changes. En choisir un en cours de route s’applique à partir du message suivant. Il n’existe pas de geste « une fois puis retour » : pour rendre la main, choisis l’autre agent explicitement.

La transcription note quel agent a répondu à quel message. Un chat avec un changement au milieu se lit donc comme deux agents sur le même problème, et non comme un agent qui change d’avis.

## Changer en cours de chat

Les instructions, les tools et la connaissance de l’agent changent avec le sélecteur. L’historique de la conversation, non. L’agent entrant lit tout ce qui précède — tes messages, les réponses de l’agent précédent et les appels de tools entre les deux — et poursuit à partir de là.

Les passations deviennent bon marché. Un généraliste prend la première question, tu passes au spécialiste pour la relance, et il dispose du contexte complet sans que personne ne colle un résumé. En retour, l’agent entrant hérite aussi des erreurs présentes dans la transcription : quand un fil a dérapé, ouvrir un chat neuf vaut mieux que changer d’agent dans celui qui est cassé.

## Appels de sous-agents

Un agent à qui l’on a donné un tool de sous-agent peut déléguer une partie du travail sans que tu choisisses quoi que ce soit. La délégation se rend dans la réponse sous forme d’appel de tool replié — tu vois ce qui a été confié et ce qui est revenu, plutôt qu’une seconde conversation à lire. Les instructions obligatoires de l’organisation s’appliquent une fois, en tête du tour, et non de nouveau dans chaque appel imbriqué : un agent qui délègue ne peut pas doubler la voix de l’organisation en empilant les niveaux.

## Où chaque surface s’inscrit

Le Chat est l’un des trois endroits où un agent répond, et la différence tient à qui possède le fil, pas à ce que l’agent sait faire.

| Prends … quand                                       | Chat | Projets | Conversations |
| ---------------------------------------------------- | ---- | ------- | ------------- |
| Tâche personnelle, question ponctuelle               | ✓    |         |               |
| Espace partagé dans une équipe, fils récurrents      |      | ✓       |               |
| Entrant depuis un canal de contact (e-mail, webhook) |      |         | ✓             |

## Où cela s’inscrit

Agents dans le chat est la moitié utilisateur de l’histoire des agents — ce que liste le sélecteur, ce qu’un agent apporte, combien de temps un choix tient, et ce qui survit à un changement. La moitié constructeur est [Concepts d’agent](/fr/platform/agents/concepts) : quoi mettre dans les instructions, quels tools donner, comment cadrer la connaissance. Si l’agent qui te manque n’est pas dans le sélecteur, c’est la page suivante ; si c’est la réponse elle-même que tu veux comprendre, reviens à [Bases du chat](/fr/platform/chat/basics).
