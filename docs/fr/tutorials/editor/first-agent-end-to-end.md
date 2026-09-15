---
title: Créer ton premier agent
description: Configure un agent de projet pour une petite tâche de texte, lance-le depuis le tableau et relis son résultat.
---

Crée un agent qui résume le message d’un contact et recommande une prochaine action. Cet exercice prend la description de la tâche comme entrée. Tu peux ainsi vérifier tout le parcours avant d’ajouter des connecteurs ou des connaissances partagées : configurer l’agent, lancer une tâche, puis relire le résultat.

## Avant de commencer

Il te faut un projet que tu peux modifier, un harness d’agent de code disponible avec des identifiants de modèle compatibles et une allocation de sandbox fonctionnelle. Un administrateur gère les [fournisseurs d’IA](/fr/platform/admin/providers) et les [Sandboxes](/fr/platform/admin/sandboxes). Un modèle utilisable dans Chat ne suffit pas à lui seul : le harness choisi doit pouvoir utiliser ses identifiants.

Si la page Agents ou la liste des modèles manque, règle d’abord l’accès ou la configuration. Ce tutoriel ne nécessite ni skills, ni connecteurs, ni outils de plateforme, ni secrets injectés.

## Créer l’agent

Ouvre l’onglet **Agents** du projet et clique sur **Nouvel agent**.

<Frame caption="Le tableau identifie chaque agent par son harness, son fournisseur et son modèle.">

![Website relaunch liste Content editor avec Claude Code et Redirect auditor avec Codex, leurs fournisseurs et modèles, à côté de Nouvel agent.](/images/platform/project-agents-models.webp)

</Frame>

1. Dans **Nom**, saisis `Assistant de triage`.
2. Choisis un **Harness** configuré par ton administrateur.
3. Sous **Modèle**, cherche par nom de modèle ou identifiant API, puis sélectionne l’entrée du fournisseur voulu. Un même modèle peut être proposé par plusieurs fournisseurs.
4. Laisse **Skills, connectors & outils** et **Secrets** vides pour cet exercice.
5. Colle les instructions ci-dessous dans **Instructions**, puis clique sur **Créer l'agent**.

```text
Lis le message du contact dans la description de la tâche. Réponds en deux lignes :
Résumé : une phrase qui explique le besoin de la personne.
Prochaine action : répondre, escalader ou clore, avec une courte justification.
Si la demande est inexploitable, précise quelle information manque.
Ne contacte personne et ne modifie aucune fiche.
```

La nouvelle ligne est prête à recevoir une tâche. Il n’y a pas d’étape de publication. Garde les instructions de l’agent pour son travail récurrent ; le message individuel appartient à la tâche.

## Lui confier une tâche vérifiable

Ouvre **Tâches**, crée `Trier la demande de copie de facture` et colle cette description :

```text
Message du contact :
« Bonjour, j’ai reçu la confirmation de commande, mais je ne trouve pas la
facture. Pourriez-vous m’en envoyer une copie ? La commande est A-1042. »

Critères d’acceptation :
- Résumer la demande en une phrase.
- Recommander répondre, escalader ou clore, avec une justification.
- Ne pas affirmer que la facture a déjà été envoyée.
```

Assigne la tâche à `Assistant de triage`. Ouvre ses détails pour choisir un **Relecteur** si quelqu’un d’autre doit la relire ; sinon, son créateur reçoit la demande de relecture. Clique sur **Démarrer l'agent**. L’assignation seule ne lance pas le travail.

La tâche passe à **En cours**. Une exécution réussie publie son rapport en commentaire et déplace la tâche vers **En revue**. La sandbox et le fournisseur doivent fonctionner pour que l’exécution aboutisse.

## Relire et améliorer le résultat

Compare le commentaire de l’agent aux critères d’acceptation. Une réponse convenable reconnaît une demande de copie de facture et recommande de répondre. Elle ne doit pas prétendre qu’un e-mail a été envoyé. La formulation peut varier selon le modèle.

Passe la tâche à **Terminé** lorsque tu acceptes le résultat. S’il manque quelque chose, mentionne l’agent assigné dans un commentaire avec une correction précise : « Limite le résumé à une phrase et explique pourquoi une réponse est nécessaire. » La reprise poursuit la conversation de la tâche et fournit un nouveau résultat à relire.

<Tip>

Utilise un commentaire de tâche pour une correction ponctuelle. Modifie les instructions de l’agent si la règle doit aussi s’appliquer aux tâches suivantes. Ajoute des outils lorsqu’un exercice ultérieur nécessite de lire ou modifier quelque chose hors des données fournies.

</Tip>

## Si l’exécution ne démarre pas ou ne se termine pas

Un modèle manquant appelle une vérification du fournisseur et du harness. Une erreur de sandbox nécessite qu’un administrateur vérifie la capacité et l’infrastructure. Une exécution échouée reste consultable : corrige la cause avant de la relancer. Ne redémarre pas plusieurs fois une tâche dont l’exécution est déjà active.

[L’automatisation des tâches](/fr/platform/projects/task-automation) explique les relances, l’annulation, le passage en relecture et les reprises. [Agents de projet](/fr/platform/projects/project-agents) présente l’équipement à ajouter une fois cette première tâche validée.
