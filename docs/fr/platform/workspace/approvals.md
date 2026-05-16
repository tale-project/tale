---
title: Approbations
description: Examine, approuve ou refuse les actions que les automatisations et les agents mettent en file d'attente pour validation humaine, directement dans la conversation.
---

Les approbations sont des cartes en ligne qui apparaissent dans une conversation de chat lorsqu'une automatisation ou un agent IA atteint une étape verrouillée pour validation humaine. La carte porte tout le contexte — quel workflow ou outil l'a déclenchée, quelle action elle veut exécuter, quelles données elle utiliserait — et propose des boutons **Approuver** et **Refuser** qui exécutent ou annulent l'action sur place. Le public, c'est toute personne dans la conversation au moment où une approbation arrive ; les cartes apparaissent dans l'alignement des messages auxquels elles appartiennent, donc le relecteur ne change pas de surface pour décider.

Cette page couvre les sept formes d'approbation que tu peux rencontrer, le flux de relecture sur chaque carte, et en quoi les deux variantes interactives (demandes utilisateur et demandes de localisation) se distinguent de la paire approuver-ou-refuser standard.

## Types d'approbation

Les sept cartes qui peuvent apparaître dans une conversation, chacune verrouillée pour une raison différente :

| Type                    | Ce qu'elle demande                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Opération d'intégration | Permission d'exécuter un appel d'API REST ou une requête SQL via une intégration connectée.  |
| Création de workflow    | Permission de créer un nouveau workflow d'automatisation.                                    |
| Exécution de workflow   | Permission de lancer un workflow existant avec des paramètres précis.                        |
| Mise à jour de workflow | Permission de modifier les étapes ou la configuration d'un workflow existant.                |
| Écriture de document    | Permission de créer ou d'enregistrer un ou plusieurs fichiers dans la base de connaissances. |
| Demande utilisateur     | Un workflow en pause demande au relecteur de remplir une information avant de continuer.     |
| Demande de localisation | Permission d'accéder à la position du navigateur pour une tâche géolocalisée.                |

## Examiner une approbation

Chaque carte a la même forme. Un en-tête identifie le type d'approbation et l'acteur (le workflow ou l'agent qui l'a soulevée). Une section de détails dépliable montre les paramètres, la liste des fichiers ou les étapes du workflow — tout ce que l'action toucherait. Les deux boutons en bas exécutent ou annulent l'action.

Pour laisser l'action se poursuivre, clique sur **Approuver**. La carte bascule vers une vue d'exécution avec la progression en direct, puis le résultat final. Pour l'annuler, clique sur **Refuser** (certaines cartes utilisent un libellé contextuel comme **Annuler la création du workflow** ou **Refuser cette opération**). L'agent reçoit une notification de refus et ajuste son approche au tour suivant.

## Demandes utilisateur et demandes de localisation

Deux des sept types sont interactives plutôt que de simples décisions approuver-ou-refuser. Les demandes utilisateur affichent un formulaire avec les champs dont le workflow en pause a besoin — saisies texte, menus déroulants, bascules oui/non — et soumettre la réponse reprend le workflow avec les valeurs jointes. Les demandes de localisation sollicitent la géolocalisation du navigateur : clique sur **Partager la position** pour accorder l'accès (le navigateur affiche son invite native de permission) ou **Refuser** pour décliner.

Dans les deux formes, la conversation est en pause jusqu'à ce que le relecteur réponde. La carte affiche _En attente de réponse_ dans le transcript de l'agent pour que l'historique du chat reste lisible.

## Où ça s'inscrit

Les approbations sont la surface de contrôle « humain dans la boucle ». Elles existent parce que certaines actions — opérations de facturation, envois massifs de courriel, écritures sur les données de production — ne devraient pas tourner en autonomie même quand l'agent en a la capacité technique. Le motif de carte est le même que la demande vienne d'un [agent](/fr/platform/agents/concepts) appelant l'opération d'écriture d'une intégration, d'une automatisation atteignant une étape verrouillée pour relecture, ou d'un outil de serveur MCP marqué `requiresApproval: true`.

Pour verrouiller une opération d'intégration précise derrière une approbation, l'option par opération vit sur la page de configuration de l'intégration dans [Paramètres > Intégrations](/fr/platform/integrations/overview). Pour exiger une approbation avant qu'une étape de workflow tourne, l'éditeur de workflow expose la même option par étape.
