---
title: Agents (vue Admin)
description: La liste des agents à l’échelle de l’organisation — chaque agent, à qui il appartient, qui peut l’atteindre et ce qu’il a le droit de toucher.
---

La vue Admin des agents est l’annuaire, à l’échelle de l’organisation, de tous les agents qui existent dans Tale, quel qu’en soit le constructeur. Les éditeurs et les développeurs voient les agents auxquels ils ont accès dans leur propre espace ; les administrateurs et les propriétaires les voient tous, avec en plus les leviers de gouvernance et la piste d’audit par agent. Cette page couvre cette surface de supervision : ce que montre le tableau, ce qu’un administrateur peut changer, et ce qui reste sous le contrôle du propriétaire de l’agent.

Cette page n’apprend pas à construire un agent : c’est la vue éditeur, sous [Concepts d’agent](/fr/platform/agents/concepts). Ce qui suit est l’autre versant — comment retrouver un agent, comment intervenir quand l’un d’eux demande de l’attention, et comment les frontières de rôle tiennent quand tu le fais.

## Ce que montre le tableau

Ouvre **Paramètres > Agents** pour arriver sur la liste de l’organisation. Chaque ligne nomme un agent et indique à qui il appartient, s’il est partagé avec l’organisation ou gardé privé, et la date de sa dernière modification. La liste se cherche par nom, et le tri par défaut place les modifications les plus récentes en tête — pratique pour voir ce qui a bougé depuis ton dernier passage.

Cliquer sur une ligne ouvre le même éditeur d’agent qu’un éditeur ou un développeur verrait, mais avec la lentille Admin : tous les onglets sont visibles, toutes les liaisons modifiables, et l’historique montre la trace complète des modifications, avec l’auteur et le diff de chaque enregistrement.

## Ce qu’un administrateur peut faire et pas un éditeur

Les administrateurs héritent de toutes les permissions que portent les éditeurs et les développeurs sur la surface des agents. Au-delà, la vue Admin ajoute trois gestes de gouvernance.

- **Restreindre la portée d’un agent.** Remettre en privé un agent partagé le retire du sélecteur de tous les membres sans rien supprimer : ses conversations et son historique restent intacts, et le repartager rétablit le comportement précédent. Sers-t’en quand un agent dérape et que tu veux en arrêter l’usage le temps de comprendre pourquoi.
- **Transférer la propriété.** Le propriétaire d’un agent est le membre qui en répond, et un agent privé doit toujours en avoir un. Le transfert confie l’agent à quelqu’un d’autre ; l’ancien propriétaire ne garde que ce que son rôle lui donne. Sers-t’en quand un propriétaire change d’équipe ou s’en va.
- **Appliquer une politique de gouvernance.** Un administrateur peut rattacher une politique à un agent : validations requises sur les écritures, familles d’outils permises, connectors joignables. La politique l’emporte sur la configuration de l’agent partout où les deux divergent, et le propriétaire la voit dans l’éditeur comme un badge en lecture seule.

## Ce qui reste au propriétaire de l’agent

L’essentiel du travail quotidien reste à qui a construit l’agent : le renommer, réécrire ses instructions, ajuster sa portée de connaissances, accorder ou retirer des outils, lier et délier des skills, enregistrer de nouvelles versions. La vue Admin sert à intervenir, pas à reprendre la main. Si tu te surprends à modifier régulièrement les agents des autres, la bonne réponse est en général une politique de gouvernance qui cadre le comportement pour une classe d’agents, plutôt qu’une retouche manuelle sur l’un d’eux.

Une chose échappe aux deux rôles : personne n’épingle un modèle à un agent. Le modèle est choisi tour par tour par celui qui envoie le message ; gouverner quels modèles sont utilisables est donc une question de [Fournisseurs](/fr/platform/admin/providers) et de [Politiques et limites](/fr/platform/admin/governance/policies-and-limits), jamais une question agent par agent.

## Audit et historique

Chaque enregistrement sur un agent atterrit dans le journal d’audit avec l’auteur, l’horodatage et le champ modifié. La vue Admin en expose la tranche par agent via l’historique de l’éditeur ; les mêmes données sont accessibles pour toute l’organisation sous **Paramètres > Gouvernance**. Les liaisons se lisent en gardant cela en tête : la configuration d’un agent peut rester inchangée pendant qu’un bundle de skill qu’il lie est remplacé en dessous, et c’est la piste d’audit de ce bundle qui le montre.

## Où cela se place

La vue Admin des agents est le pendant de supervision de la vue de construction de l’éditeur — les mêmes agents, une autre lentille. La plupart du temps, tu ne devrais y venir que lorsque quelque chose demande de l’attention ; le travail quotidien se passe dans l’éditeur d’agent, sous [Concepts d’agent](/fr/platform/agents/concepts). Quand la bonne réponse consiste à cadrer le comportement d’une classe d’agents plutôt que d’un seul, la suite est [Membres et rôles](/fr/platform/admin/members-and-roles), qui explique comment les politiques se rattachent aux rôles.
