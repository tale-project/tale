---
title: Agents dans le chat
description: Comment fonctionne le sélecteur d'agents dans le Chat — quels agents apparaissent, ce que contrôle Visible in chat, agents ponctuels versus persistants, changement en cours de thread, et appels de sous-agents.
---

Choisir un agent dans le Chat est la différence entre demander à un Assistant générique et demander à quelque chose que l'organisation a façonné pour un domaine. Le sélecteur d'agents est le contrôle le plus utilisé du composer ; les règles qui définissent quel agent apparaît, quand un agent persiste, et ce qui se passe quand tu changes en milieu de chat, font l'objet de cette page.

Le sélecteur est conceptuellement simple — tape un nom, appuie sur entrée — mais les règles autour de la visibilité et de la persistance provoquent en pratique la plupart des tickets « pourquoi je ne vois pas cet agent ». Connaître les règles évite l'aller-retour.

## Le sélecteur d'agents

Clique **Select agent** sur le composer (ou la puce affichant l'agent actuellement choisi) et le sélecteur s'ouvre avec **Search agents** en haut. La liste montre chaque agent auquel l'utilisateur a accès et qui est marqué **Visible in chat** ; les agents sans ce toggle existent dans l'organisation mais ne montent jamais dans le sélecteur, ce qui garde la liste courte. **Add agent** en bas est un raccourci pour les Éditeurs et au-dessus pour en créer un nouveau — voir [Créer un agent](/fr/platform/agents/create).

## « Visible in chat »

Chaque agent a un toggle **Visible in chat** sur sa page d'instructions. Le désactiver ne désactive pas l'agent — les workflows peuvent toujours l'appeler ; les appels de sous-agents depuis d'autres agents fonctionnent encore — ça cache seulement l'agent du sélecteur du chat. La raison : les organisations finissent avec des dizaines d'agents que l'utilisateur moyen ne choisit jamais (agents utilitaires appelés par d'autres agents, agents liés à un workflow précis), et les afficher tous noierait les choix quotidiens.

## Ponctuel versus persistant

Choisir un agent **avant** le premier message d'un chat le rend persistant — chaque message suivant dans le même chat va au même agent. En choisir un **en milieu de chat** l'applique au message suivant et tout ce qui suit, jusqu'à un nouveau changement. Il n'y a pas de geste « utilise cet agent une fois et reviens » ; pour revenir à l'Assistant générique, choisis **Assistant** explicitement dans le sélecteur. Le transcript garde l'agent par message, donc un chat avec un changement en cours de route se lit comme deux agents qui collaborent.

## Changer en cours de thread

Les connaissances et les outils de l'agent changent avec le sélecteur, mais l'historique de la conversation, non. Le nouvel agent lit tout ce qui précède — tes messages et les réponses de l'agent précédent — et continue à partir de là. C'est utile pour les passations : un agent de tri répond au premier message, tu passes à un spécialiste pour la suite, le spécialiste a tout le contexte sans que personne ne copie-colle.

## Appels de sous-agents

Les instructions d'un agent peuvent inclure un outil sous-agent ; quand c'est le cas, l'agent primaire peut déléguer une partie du travail sans que l'utilisateur choisisse quoi que ce soit. Les appels de sous-agents s'affichent dans la réponse comme des appels d'outils pliés — l'utilisateur voit ce qui a été délégué et ce qui est revenu, pas une seconde conversation complète. Les règles de délégation et le modèle de prévention de boucles vivent sur [Délégation d'agents](/fr/platform/agents/delegation).

## Quand opter pour chaque forme

| Utilise … quand                                         | Chat | Projects | Conversations |
| ------------------------------------------------------- | ---- | -------- | ------------- |
| Tâche personnelle, question ponctuelle                  | ✓    |          |               |
| Espace de travail partagé en équipe, threads récurrents |      | ✓        |               |
| Entrée depuis un canal client (e-mail, webhook)         |      |          | ✓             |

## Où ça s'inscrit

Agents dans le chat est la moitié côté utilisateur de l'histoire des agents — ce que le sélecteur fait, ce qui s'affiche, comment la persistance fonctionne. La moitié côté construction est [Concepts d'agent](/fr/platform/agents/concepts) : les quatre boutons qui déterminent ce qu'un agent fait une fois choisi. Si tu es venu ici pour construire l'agent que tu aimerais avoir dans le sélecteur, c'est la lecture suivante.
