---
title: Agents dans le chat
description: Comment fonctionne le sélecteur d’agents dans le Chat — quels agents apparaissent, ce que contrôle Visible dans le chat, ponctuel versus persistant, changement en cours de thread, et appels de sous-agents.
---

Choisir un agent dans le Chat fait la différence entre interroger un Assistant générique et interroger quelque chose que l’organisation a façonné pour un domaine. Le sélecteur d’agents est le contrôle le plus utilisé du chat ; les règles qui décident quel agent apparaît, quand un agent persiste, et ce qui se passe quand tu changes en cours de chat font l’objet de cette page.

<Frame caption="Le sélecteur d’agents ouvert au-dessus du chat — Auto, les agents installés et le raccourci Catalogue.">

![Le sélecteur d’agents ouvert au-dessus du chat, montrant un champ de recherche, une entrée Auto, l’Assistant sélectionné, une entrée Assistant d’automatisation et un bouton Parcourir les automatisations.](/images/platform/chat-agent-picker.webp)

</Frame>

## Le sélecteur d’agents

Clique sur la puce d’agent du chat (son nom accessible est **Sélectionner un agent**) et le sélecteur s’ouvre avec **Rechercher des agents** en haut. La liste montre **Auto** — Tale route chaque message vers l’agent qui colle le mieux — suivi de chaque agent auquel tu as accès et qui est marqué **Visible dans le chat** ; les agents de code ont leur propre section **Agents de code** dès que l’un d’eux est visible. Les agents sans cette bascule existent dans l’organisation mais ne montent jamais ici, ce qui garde la liste courte. **Parcourir les automatisations**, en bas, mène au [catalogue des automatisations](/fr/platform/automations/catalog) — les nouveaux agents arrivent au sein d’une automatisation que tu installes.

## « Visible dans le chat »

Chaque agent porte une bascule **Visible dans le chat** sur la page **Général** de son éditeur. La désactiver ne désactive pas l’agent — les automatisations et les workflows peuvent toujours l’appeler, et les appels de sous-agents depuis d’autres agents fonctionnent encore — elle cache seulement l’agent du sélecteur du chat. La raison : les organisations finissent avec des dizaines d’agents que l’utilisateur moyen ne choisit jamais (agents utilitaires appelés par d’autres agents, agents liés à un workflow précis), et tous les afficher noierait les choix quotidiens.

## Ponctuel versus persistant

Choisir un agent **avant** le premier message d’un chat le rend persistant — chaque message suivant du même chat va au même agent. En choisir un **en cours de chat** l’applique au message suivant et à tout ce qui suit, jusqu’au prochain changement.

<Note>

Il n’existe pas de geste « utilise cet agent une fois puis reviens » — pour rendre la main, choisis explicitement **Assistant** (ou **Auto**) dans le sélecteur. Le transcript garde l’agent par message, donc un chat avec un changement en cours de route se lit comme deux agents qui collaborent.

</Note>

## Changer en cours de thread

Les connaissances et les outils de l’agent changent avec le sélecteur, mais pas l’historique de la conversation. Le nouvel agent lit tout ce qui précède — tes messages et les réponses de l’agent précédent — et continue à partir de là. C’est utile pour les passations : un agent de tri répond au premier message, tu passes à un spécialiste pour la suite, et le spécialiste a tout le contexte sans que personne ne copie-colle.

## Appels de sous-agents

Les instructions d’un agent peuvent inclure un outil sous-agent ; quand c’est le cas, l’agent primaire peut déléguer une partie du travail sans que l’utilisateur choisisse quoi que ce soit. Les appels de sous-agents s’affichent dans la réponse comme des appels d’outils pliés — tu vois ce qui a été délégué et ce qui est revenu, pas une seconde conversation complète. Les règles de délégation et le modèle de prévention des boucles vivent sur [Délégation d’agent](/fr/platform/agents/delegation).

## Quand opter pour chaque forme

| Utilise … quand                                         | Chat | Projets | Conversations |
| ------------------------------------------------------- | ---- | ------- | ------------- |
| Tâche personnelle, question ponctuelle                  | ✓    |         |               |
| Espace de travail partagé en équipe, threads récurrents |      | ✓       |               |
| Entrée depuis un canal contact (e-mail, webhook)        |      |         | ✓             |

## Où ça s’inscrit

Agents dans le chat est la moitié côté utilisateur de l’histoire des agents — ce que fait le sélecteur, ce qui s’affiche, comment la persistance fonctionne. La moitié côté construction est [Concepts d’agent](/fr/platform/agents/concepts) : les quatre boutons qui déterminent ce qu’un agent fait une fois choisi. Si tu es venu ici pour construire l’agent que tu aimerais voir dans le sélecteur, c’est la lecture suivante.
