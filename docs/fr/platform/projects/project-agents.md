---
title: Créer et gérer des agents de projet
description: Configure un agent réutilisable, accorde son équipement et démarre une tâche dont tu peux vérifier le résultat.
---

Crée un agent de projet pour disposer d’un agent réutilisable sur les tâches du projet. Il associe un environnement de code, un modèle, des instructions et un équipement autorisé. Tu dois pouvoir modifier le projet actif. Seuls un Propriétaire ou un Admin peuvent changer les secrets accordés.

## Préparer la première tâche

Choisis un résultat limité, comme vérifier les approbations manquantes dans un brief de lancement. L’agent nécessite des [identifiants de fournisseur](/fr/platform/admin/providers) compatibles et une [sandbox](/fr/platform/admin/sandboxes) disponible. Enregistrer sa configuration ne prouve pas encore qu’une exécution réussira.

Sépare les instructions réutilisables de la tâche. « Repère les preuves manquantes et indique les contrôles effectués » appartient à l’agent. Le document, la date de revue et les critères d’acceptation appartiennent à la tâche.

<Frame caption="L'onglet Agents — les agents du projet ; chaque ligne nomme le harness, le fournisseur et le modèle.">

![L’onglet Agents du projet Website relaunch listant deux agents nommés — Content editor sur Claude Code et Redirect auditor sur Codex — chaque ligne nommant le fournisseur et l’identifiant du modèle, à côté du bouton Nouvel agent.](/images/platform/project-agents-models.webp)

</Frame>

## Configurer l’agent

<Steps>

<Step title="Choisir un nom et un environnement">

Ouvre l’onglet **Agents** du projet et choisis **Nouvel agent**. Donne-lui un **Nom** reconnaissable, puis choisis le **Harness**, son [environnement de code](/fr/platform/agents/harnesses). Les noms sont uniques dans le projet, qui accepte jusqu’à 50 agents.

</Step>

<Step title="Choisir le modèle et le fournisseur">

Recherche un **Modèle** par nom ou identifiant API. Le même modèle peut apparaître une fois par fournisseur : lis le fournisseur de l’entrée avant de la choisir. Cela fixe la combinaison pour les prochaines exécutions. Les offres par abonnement n’apparaissent qu’avec un environnement compatible.

Une ancienne configuration peut nommer un modèle sans fournisseur fixé. Le dialogue indique alors quel fournisseur le servirait actuellement ou pourquoi aucun ne peut le faire. Choisis une entrée pour fixer ce choix.

</Step>

<Step title="Accorder l’équipement et écrire les instructions">

Sous **Skills, connectors & outils**, ajoute les bundles, services et opérations nécessaires. La liste de skills suit les accès des équipes du projet, pas seulement ta visibilité personnelle. Un skill absent peut donc demander une modification de son partage.

Lis **Écrit des données** avant d’accorder un outil d’écriture : il autorise des opérations réelles selon ses règles d’accès. Le broker de connectors ne propose que des lectures aux agents. Les outils GitHub directs et les secrets explicitement accordés suivent d’autres voies.

Rédige des **Instructions** qui définissent responsabilité, preuves et limites. Pour la revue du lancement : « Lis le brief fourni. Signale les approbations manquantes et les dates contradictoires avec le passage correspondant. Ne termine pas la tâche. »

</Step>

<Step title="Vérifier et enregistrer">

Si le travail demande des **Secrets**, un Propriétaire ou Admin accorde des identifiants nommés de l’organisation. L’agent en cours peut lire leurs valeurs : utilise des jetons limités et remplaçables. Modifier une valeur partagée affecte aussi les autres agents et nœuds de workflow qui utilisent ce nom.

Choisis **Créer l'agent**. Vérifie l’environnement, le fournisseur et le modèle de la nouvelle ligne. Rouvre l’agent pour examiner l’équipement et les instructions enregistrés.

</Step>

</Steps>

## Affecter et démarrer le travail

Ouvre une tâche du même projet, affecte-la à l’agent et choisis **Démarrer l'agent**. L’affectation et l’exécution sont deux actions distinctes. Fournis les fichiers et les critères d’acceptation avant le démarrage.

Le compte rendu apparaît dans les commentaires et les fichiers collectés sont joints comme résultats. Après un travail réussi, la tâche passe **En revue** pour qu’une personne l’évalue. Mentionne l’agent dans un commentaire pour guider ou poursuivre le travail. Le harness détermine si le message rejoint le processus actif ou lance une continuation.

L’[automatisation des tâches](/fr/platform/projects/task-automation) explique le suivi, l’arrêt et la revue. L’assistant de chat ordinaire reste distinct, même avec un contexte de projet.

## Modifier ou retirer un agent

Utilise le menu de sa ligne pour le modifier ou le supprimer. Les changements concernent les prochaines exécutions ; une exécution active conserve sa configuration initiale. La suppression retire les affectations à l’agent mais conserve l’historique des tâches. Examine le travail en cours avant de retirer l’agent concerné.

En cas d’échec, lis la cause affichée. Un nom déjà utilisé, un accès au projet manquant, un modèle indisponible, un skill invisible et une capacité de sandbox absente sont des problèmes distincts. Modifier les instructions ne résout pas ces prérequis.
