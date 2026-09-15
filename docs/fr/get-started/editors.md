---
title: Créer et tester un agent de projet
description: Donner une tâche précise à un agent, le lancer et examiner son résultat.
---

Un agent de projet est une consigne réutilisable pour les tâches du projet. Tu choisis ses instructions, son environnement d’exécution, son modèle et ses outils, puis tu le lances sur une tâche et examines ce qu’il produit.

## Avant de commencer

Il te faut des droits de modification sur un projet, un fournisseur de modèles adapté et un environnement d’exécution disponible avec l’infrastructure requise. Un chat qui répond valide l’accès au fournisseur pour le chat. Il ne prouve pas que l’environnement d’un agent ou sa sandbox est prêt. Demande à un admin de vérifier [les environnements d’exécution](/fr/platform/agents/harnesses) si aucun n’est disponible.

Crée ou ouvre d’abord un projet. Le guide [utiliser les projets](/fr/tutorials/member/use-projects) explique le partage et les sources de connaissances.

## Définir un travail précis

<Steps>

<Step title="Créer un agent dans le projet">

Ouvre l’onglet **Agents** du projet et sélectionne **Nouvel agent**. Nomme-le selon son travail, par exemple « Relecteur de lancement ». Choisis un **Harness** et un **Modèle** pris en charge par ton espace. Si le même modèle apparaît avec plusieurs fournisseurs, choisis aussi celui que tu souhaites utiliser.

<Frame caption="Un agent de projet associe un travail nommé à un environnement d’exécution et un modèle.">

![L’onglet Agents du projet présente les agents avec leur environnement d’exécution et leur modèle configurés.](/images/platform/project-agents-models.webp)

</Frame>

</Step>

<Step title="Écrire des instructions vérifiables">

Dans **Instructions**, décris le travail, les sources, le résultat attendu et les limites. Par exemple :

> Examine le brief de lancement joint à la tâche. Liste les décisions manquantes, les responsabilités floues et les contradictions. Cite le passage concerné pour chaque constat. Ne modifie aucun fichier et ne contacte aucun service externe. Si le brief manque, demande-le.

Accorde seulement les **Skills, connectors & outils** et les **Secrets** nécessaires. Sélectionne **Créer l’agent** pour enregistrer. Tu pourras revoir les instructions après avoir examiné un résultat.

</Step>

<Step title="Attribuer une tâche concrète et lancer l’agent">

Crée une tâche avec une description précise et les fichiers d’entrée requis. Attribue-la à l’agent, puis sélectionne **Démarrer l’agent**. L’attribution et le démarrage sont deux actions distinctes. Observe le statut et l’activité pendant l’exécution.

Si le démarrage échoue, lis la cause affichée avant de réessayer. Un fournisseur absent, un environnement indisponible, une restriction de politique ou une entrée manquante demandent des corrections différentes.

</Step>

</Steps>

## Examiner le travail

Lis le commentaire de l’agent et les éventuels fichiers produits. Compare le résultat aux consignes : la bonne source a-t-elle été examinée, chaque constat est-il étayé et les limites ont-elles été respectées ? Une exécution terminée ne garantit pas un résultat correct.

Consigne explicitement la revue et l’acceptation. Utilise les commandes de la tâche pour donner un retour, demander un nouveau passage si nécessaire et terminer le travail accepté. [Les tâches de projet](/fr/platform/projects/tasks) expliquent les statuts et le champ de relecture.

<Tip>

Teste aussi le cas où une entrée manque. Un agent qui demande le brief absent est plus utile qu’un agent qui en invente le contenu.

</Tip>

## Améliorer un point à la fois

Corrige l’instruction à l’origine d’un mauvais résultat, puis teste une tâche comparable. Ajoute des outils seulement lorsque le travail le nécessite. Avant d’autoriser des écritures externes, examine [les approbations](/fr/platform/approvals/concepts). Pour un exemple plus complet, suis [ton premier agent de bout en bout](/fr/tutorials/editor/first-agent-end-to-end).
