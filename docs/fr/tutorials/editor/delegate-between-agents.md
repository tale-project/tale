---
title: Confier du travail à un worker
description: Demande une recherche ouverte à l'assistant, regarde-le lancer un worker ciblé et suis la carte de job — progression en direct, résultat et transcription complète.
---

Quand une demande mérite son propre contexte ciblé — recherche citée, extraction en masse, longue rédaction — l'assistant lance un **worker** : un agent éphémère composé pour exactement cette tâche, avec exactement les capacités que l'assistant lui accorde depuis son propre ensemble. Il n'y a rien à configurer ; ce parcours fait tourner un job de recherche de bout en bout et te montre comment lire la carte de job.

Le versant conceptuel (sous-ensembles de capacités, budgets, méthodologies) vit dans [Workers d'agent](/fr/platform/agents/delegation).

## Avant de commencer

Il te faut un agent de chat (l'Assistant intégré fonctionne tel quel) sur un modèle avec tool-calling. Pour des sources web en direct, connecte une connector de recherche comme Tavily sous **Paramètres > Connectors** — sans elle, le worker retombe sur la simple récupération web et le dit dans son résultat.

## Étape 1 — Demande quelque chose qui mérite un worker

Ouvre un chat avec `Assistant` et demande un travail ouvert et citable, par exemple : `Fais une recherche sur l'état des batteries à électrolyte solide — marché, acteurs clés, sources citées.` Une question factuelle rapide ne lance pas de worker (et ne le devrait pas) ; les workers sont pour les tâches qui profitent de l'isolation.

## Étape 2 — Observe la carte de job

L'assistant appelle `spawn_agent` et une **carte de job** apparaît sous son tour : le nom du worker, un statut en direct et la checklist de progression du worker qui se remplit pendant qu'il planifie et traite les sous-questions. La carte ne bloque jamais le champ de saisie — tu peux continuer à écrire pendant que le worker tourne.

Si la carte affiche une note « ignoré », l'assistant a demandé quelque chose hors de ses propres accès (par exemple une connector non connectée) ; l'exécution continue avec le reste, et la note te dit quoi connecter pour la prochaine fois.

## Étape 3 — Lis le résultat et la transcription

Quand le job se termine, l'assistant replie le livrable du worker dans sa réponse — pour une recherche : une conclusion, des points clés avec citations en ligne et les sources. Sur la carte, déplie **l'activité du worker** pour voir la transcription complète : chaque recherche, chaque appel d'outil et le raisonnement du worker. Cette transcription est la piste d'audit à montrer quand on te demande ce que l'agent a réellement fait.

## Étape 4 — Quand quelque chose tourne mal

Un worker à court de temps ou frappé par une erreur se termine avec un statut visible sur la carte — `temps écoulé` ou `échoué` — avec sa progression partielle intacte. L'assistant rapporte ce qu'il a obtenu et continue lui-même là où il peut. Rien n'échoue en silence : si le worker avait besoin d'une information que toi seul peux donner, l'assistant te la demande directement.

## Où cela s'inscrit

Une demande, un worker, une carte : c'est la plus petite forme utile. La même mécanique passe à l'échelle avec plusieurs workers dans un tour — chacun a sa carte, sa progression et sa transcription. Pour des étapes fixes avec validations ou planification entre elles, prends plutôt une [automatisation](/fr/platform/automations/concepts).
