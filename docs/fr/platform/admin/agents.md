---
title: Agents (vue Admin)
description: La liste des agents à l’échelle de l’organisation — chaque agent dans l’organisation, qui l’a construit, quel modèle il fait tourner, quelles connaissances il touche. Les Administrateurs et Propriétaires lisent ceci quand ils gouvernent les agents à l’échelle de l’org plutôt que d’en construire un.
---

La vue Admin des agents est l’annuaire à l’échelle de l’organisation de chaque agent qui existe dans Tale, peu importe qui l’a construit. Les Éditeurs et Développeurs ne voient que les agents auxquels ils ont accès dans leur propre périmètre ; les Administrateurs et Propriétaires les voient tous, plus les leviers de gouvernance par agent et la piste d’audit par agent. Cette page couvre la surface Admin — ce que la table montre, ce qu’un Admin peut changer, et ce qui reste sous le contrôle du propriétaire de l’agent.

Cette page ne t’apprend pas à construire un agent. C’est la vue Éditeur sous [Agents](/fr/platform/agents/concepts). Ce qui suit est le côté supervision : comment trouver un agent, comment intervenir quand l’un d’eux a besoin d’attention, et comment les frontières de rôle tiennent quand tu le fais.

<Frame caption="La liste des agents à l’échelle de l’organisation — un dossier déplié sur ses lignes d’agents, chacune avec son modèle et sa catégorie. Un Admin voit ici chaque agent de l’org.">

![La liste des agents avec un dossier déplié montrant des lignes d’agents, chacune nommant un agent aux côtés de son modèle principal et de sa catégorie.](/images/platform/agents-list-expanded.webp)

</Frame>

## Ce que la table montre

Ouvre **Paramètres > Agents** pour atterrir sur la liste à l’échelle de l’org. Chaque ligne nomme un agent et montre son modèle primaire, sa catégorie, l’équipe à laquelle il appartient (s’il y en a une), et la date de la dernière édition. La liste est cherchable par nom et filtrable par catégorie, équipe et statut (actif ou désactivé). Le tri par défaut est « le plus récemment édité d’abord » — utile quand tu veux voir ce qui a changé depuis la dernière fois.

Cliquer une ligne ouvre le même éditeur d’agent qu’un Éditeur ou Développeur verrait, mais avec la lentille Admin : chaque onglet est visible, chaque liaison est éditable, et l’onglet de journal d’audit montre l’historique complet d’édition avec l’acteur et le diff par enregistrement.

## Ce qu’un Admin peut faire qu’un Éditeur ne peut pas

Les Administrateurs héritent de chaque permission qu’Éditeur et Développeur portent sur la surface agent. Au-dessus, la vue Admin ajoute trois mouvements de gouvernance :

- **Désactiver un agent.** Un agent désactivé n’apparaît plus dans les pickers et ne répond plus aux nouvelles requêtes, mais ses conversations, exécutions et piste d’audit sont préservées. Réactiver restaure le comportement précédent. Va vers désactiver quand un agent se comporte mal et que tu dois l’arrêter sans perdre le contexte.
- **Réassigner la propriété.** Le propriétaire d’un agent est l’équipe ou le membre qui en est responsable. Réassigner transfère l’agent à une autre équipe ou un autre membre ; le propriétaire précédent perd l’accès en écriture sauf s’il partage la nouvelle équipe. Va vers réassigner quand une équipe est réorganisée ou qu’un propriétaire part.
- **Appliquer une politique de gouvernance.** Les Administrateurs peuvent attacher une politique de gouvernance à un agent — approbations requises sur les écritures, familles de tools autorisées, intégrations autorisées. La politique écrase la configuration propre de l’agent en cas de conflit ; le propriétaire voit la politique comme un badge en lecture seule dans l’éditeur.

## Ce qui reste avec le propriétaire de l’agent

La plupart de l’édition quotidienne reste avec la personne qui a construit l’agent. Renommer, modifier les instructions, ajuster les liaisons de connaissance, basculer les tools, changer de modèle, publier de nouvelles versions — tout ça arrive dans l’éditeur d’agent sous les permissions du propriétaire. La vue Admin sert à intervenir, pas à prendre le contrôle. Si tu te retrouves à éditer les agents des autres en routine, la bonne réponse est généralement une politique de gouvernance qui scope le comportement, pas une édition manuelle.

## Audit et historique

Chaque enregistrement sur un agent atterrit dans le journal d’audit avec l’acteur, l’horodatage et le champ qui a changé. La vue Admin expose la tranche par agent de ce journal sous l’onglet **Historique** dans l’éditeur d’agent. Les mêmes données sont également joignables depuis le journal d’audit à l’échelle de l’org sous **Paramètres > Gouvernance**.

## Où cela s’inscrit

La vue Admin des agents est le pendant supervision à la vue construction de l’Éditeur — mêmes agents, lentille différente. Va la chercher la plupart du temps seulement quand quelque chose a besoin d’attention ; le travail quotidien arrive dans l’éditeur d’agent sous [Concepts agents](/fr/platform/agents/concepts). Quand la bonne réponse est de scoper le comportement pour une classe d’agents plutôt qu’un seul, la lecture suivante est la surface des politiques de gouvernance — voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour comment les politiques s’attachent aux rôles.
