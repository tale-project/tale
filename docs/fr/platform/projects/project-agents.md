---
title: Agents de projet
description: L'onglet Agents dote un projet d'agents nommés — chacun avec un harness, un modèle servi par le fournisseur que tu choisis, un équipement et des instructions permanentes — qui traitent les tâches du projet dans une sandbox isolée.
---

L'onglet **Agents** d'un projet, c'est son équipe : des agents nommés que tu configures une fois puis à qui tu confies du travail — chacun combine un [harness](/fr/platform/agents/harnesses) de code, un modèle, des skills et des connectors, et des instructions permanentes. Le chat continue de tourner sur l'assistant intégré — ces agents existent pour le tableau : assigne une tâche à l'un d'eux, il travaille dans une sandbox isolée puis revient rendre compte pour revue. Toute personne qui peut modifier le projet les gère ; un projet en accueille jusqu'à 50.

<Frame caption="L'onglet Agents — les agents du projet ; chaque ligne nomme le harness, le fournisseur et le modèle.">

![L'onglet Agents d'un projet listant des agents nommés, chacun avec son harness, le fournisseur qui le sert, l'identifiant du modèle et le nombre d'équipements.](/images/platform/project-agents-models.webp)

</Frame>

## Créer un agent

<Steps>

<Step title="Ouvre l'onglet et lance-toi">

Ouvre l'onglet **Agents** du projet et clique sur **Nouvel agent**. Donne-lui un **Nom** que ton équipe reconnaîtra sur les cartes de tâches, et choisis le **Harness** — la CLI de code sur laquelle l'agent tourne.

</Step>

<Step title="Choisis le modèle — et avec lui le fournisseur">

La liste **Modèle** se filtre à la saisie ; un modèle servi par plusieurs fournisseurs apparaît une fois par fournisseur, le nom du fournisseur sous chaque entrée. Le choix est exact : les runs de l'agent appellent ce modèle via ce fournisseur — et la dépense atterrit sur son accès. Si le fournisseur choisi ne peut plus servir le modèle, le run échoue en le disant, au lieu de basculer en silence sur la facture d'un autre.

Les entrées servies par abonnement — un abonnement Claude, par exemple — n'apparaissent que lorsque le **Harness** est celui que cet abonnement pilote ; le run s'authentifie alors avec l'abonnement du fournisseur plutôt qu'avec une clé API de l'organisation.

</Step>

<Step title="Équipe-le et fixe ses instructions">

**Skills, connectors & outils** décident de ce que l'agent atteint au-delà de son espace de travail ; la liste suit l'accès des équipes du projet, pas ta visibilité personnelle. Les skills fournissent des bundles de référence dans la sandbox, les connectors relaient un service connecté, et les **outils de la plateforme** laissent l'agent lire et écrire les données de ton organisation — trouver et lire des tâches, contacts, produits, documents et connaissances, et, quand tu accordes un outil d'écriture, créer des tâches, les commenter, les déplacer entre colonnes, synchroniser un élément externe vers une tâche ou enregistrer un document. Un outil d'écriture est marqué _Écrit des données_ : l'accorder vaut autorisation, un agent équipé de `Créer des tâches` crée donc de vraies tâches sans autre validation. Lecture et écriture restent limitées au projet — un agent ne voit jamais le tableau d'un autre projet.

Les **secrets** remettent à l'agent une clé API sous forme de variable d'environnement — l'échappatoire pour un service sans connector. Ajoutes-en un (un nom comme `GLITCHTIP_TOKEN` et le jeton), et l'agent le reçoit dans son shell et appelle l'API de ce service directement, avec la doc du fournisseur. La valeur est stockée chiffrée et n'est plus jamais affichée ; ne stocke que des jetons peu privilégiés et renouvelables, car l'agent en cours d'exécution peut les lire. Les secrets appartiennent à l'organisation, le même est donc réutilisé entre agents et renouvelé à un seul endroit.

Les **Instructions** accompagnent chaque run comme consigne permanente — ce que cet agent prend en charge, comment il doit travailler et les limites à respecter.

</Step>

</Steps>

Clique sur **Créer l'agent**. La ligne affiche le harness, le fournisseur, le modèle et le nombre d'équipements — le même résumé que voient tes coéquipiers au moment d'assigner.

## Mets-le au travail

Assigne une tâche du tableau à l'agent et clique sur **Démarrer l'agent** depuis la tâche. Le run travaille dans une sandbox isolée avec un espace de travail permanent qui persiste d'une tâche à l'autre, poste son rapport en commentaire de la tâche, joint ce qu'il produit sous **Fichiers produits** et gare la tâche **En revue** — un agent ne clôt jamais un travail ; c'est une personne qui le fait. Commente la tâche en mentionnant l'agent avec @ pour orienter un run en cours, ou pour lancer le suivant — il lit d'abord ton commentaire et reprend là où le run précédent s'était arrêté. [Automatisation des tâches](/fr/platform/projects/task-automation) décrit la boucle du tableau de bout en bout.

## Modifier ou supprimer

Les modifications s'appliquent au run suivant — un run en cours garde sa configuration de départ ; c'est le run suivant qui reprend tes changements. Supprimer un agent conserve l'historique de chaque tâche ; seule l'assignation se vide.

## Assistant de chat ou agent de projet ?

| Prends…            | quand le travail est…                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| le chat            | une conversation — questions, brouillons, recherche ; l'assistant intégré s'en charge.       |
| un agent de projet | une tâche — du travail sur dépôt ou fichiers via un harness, fait par une équipe permanente. |

## Où ça se range

L'agent regroupe côté projet des choix que d'autres pages détaillent : le catalogue des harnesses et leurs capacités vivent dans [Harnesses](/fr/platform/agents/harnesses) ; savoir quels fournisseurs et quels accès servent les modèles — clés stockées sur la passerelle mesurée, ou abonnements sur le compte du fournisseur — relève de [Fournisseurs IA](/fr/platform/admin/providers).
