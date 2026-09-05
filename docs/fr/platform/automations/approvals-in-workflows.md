---
title: Approbations dans les workflows
description: Là où une exécution en cours attend une personne — une écriture de connector en pause pour approbation, une question posée par un nœud agent — et comment une définition change et passe en service sans carte de proposition.
---

Les automatisations s’exécutent sans toi, mais une exécution s’arrête pour toi à deux endroits. Une écriture de connector qui quitte ton locataire se met en pause jusqu’à ce que quelqu’un l’approuve, et un nœud agent qui a besoin d’une réponse se met en pause jusqu’à ce que quelqu’un la donne ; les deux attendent sur la page de détail de l’exécution, et les deux reprennent exactement là où elles s’étaient arrêtées. Changer la définition elle-même n’a pas de carte dans cette version : tu modifies et enregistres des versions sur le canvas, et la mise en service est un geste distinct et explicite. Cette page couvre les deux portes et la voie de rédaction ; ce qu’est une approbation en général vit sur [Concepts d’approbation](/fr/platform/approvals/concepts).

<Frame caption="Le canvas d’une automatisation avec son panneau latéral — la définition change ici en enregistrant une version, et une exécution réelle se met en pause sur sa page de détail quand une étape a besoin d’une personne.">

![Le canvas de workflow d’une automatisation montrant un graphe de nœuds, avec un panneau ouvert à côté.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approuver une écriture de connector

Quand une exécution réelle atteint une écriture que ta politique retient, l’exécution prend le statut **En attente** dans les [journaux d’exécution](/fr/platform/automations/execution-logs) et sa page de détail montre la carte d’approbation : **En attente de ton approbation**, l’opération sous la forme `<connecteur>.<action>`, le nœud qui l’a demandée, et l’entrée exacte avec laquelle l’étape appellerait. **Approuver** laisse l’étape agir au prochain poll et l’exécution repart ; **Rejeter** fait échouer l’étape et l’exécution s’arrête. Les essais ne se mettent jamais en pause ici — en mode simulation, rien hors de la plateforme n’est touché. Quelles écritures demandent, et comment déplacer la ligne, se lit sur [Configurer les approbations](/fr/platform/approvals/configure).

## Répondre à une exécution en pause

Un nœud agent qui ne peut pas finir sans toi pose sa question : l’exécution se met en pause comme **En attente** et sa page de détail montre la question — sous forme de choix quand l’agent en a proposé, sous forme de champ libre sinon. Réponds, et l’exécution repart au nœud où elle s’était arrêtée, ta réponse en main, puis termine le reste du graphe ; rien de ce qu’un nœud terminé a fait n’arrive deux fois. L’agent pose sa question par son outil `ask_human`, que chaque nœud agent d’automatisation porte — la pause est donc la décision de l’agent, pas un nœud que tu places.

## Changer et mettre en service une définition

Il n’y a aucune carte de proposition entre toi et la définition dans cette version — pas d’éditeur IA sur le canvas, pas d’agent de chat qui rédige un changement à approuver. Tu changes une définition en modifiant des nœuds sur le canvas et en cliquant sur **Enregistrer**, ce qui ajoute une version avec ta note et laisse chaque version antérieure intacte ; **Essai** l’exerce contre des simulations ; et rien ne s’exécute en réel tant que tu n’as pas cliqué sur **Mettre cette version en service**, ce que les propres tests de l’automatisation conditionnent. Un modèle qui rédige une automatisation passe par l’[endpoint MCP](/fr/develop/mcp-endpoint) — `save_automation` ajoute une version de la même façon, et `deploy_automation` est le même geste explicite. [L’éditeur de workflow](/fr/platform/automations/editor) déroule les trois gestes.

## Ce que chaque décision laisse derrière elle

Les deux portes laissent une trace à deux endroits : le détail de l’exécution elle-même, où la carte se fixe sur approuvé ou rejeté et où suit le résultat de l’étape, et le [journal d’audit](/fr/platform/admin/governance/audit-logs), qui enregistre qui a décidé et quand. Une carte décidée ne se rouvre pas ; une exécution rejetée est terminée, et relancer l’automatisation est une exécution neuve avec une carte neuve. Parce qu’une décision appartient à l’opération pour laquelle elle a été demandée, une politique assouplie ensuite ne libère jamais une carte déjà en attente. Une exécution qui se termine alors que sa carte attend encore — arrêtée par quelqu’un, ou échouée sur une autre branche — retire la carte : elle passe à rejeté dans le détail de l’exécution, puisque l’écriture qu’elle demandait n’aura jamais lieu.

## Où cela s’inscrit

Une exécution attend une personne pour deux raisons — une écriture qui quitte le locataire, et une question à laquelle seule une personne peut répondre — et ces deux attentes se tiennent sur la page de détail de l’exécution plutôt que dans un chat. [Concepts d’approbation](/fr/platform/approvals/concepts) est le modèle derrière la porte d’écriture, [Configurer les approbations](/fr/platform/approvals/configure) déplace la ligne, et [Journaux d’exécution](/fr/platform/automations/execution-logs) est l’endroit où tu trouves d’abord l’exécution en attente.
