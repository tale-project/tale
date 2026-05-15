---
title: Construire ton premier agent end-to-end
description: Créer un agent dédié, brancher du savoir, le tester et publier une version.
---

Un chat générique répond avec ce sur quoi le modèle a été entraîné. Un agent dédié répond avec le savoir de ton organisation, dans ton ton, cadré sur un seul job — « Support produit », « Politiques RH », « Sales enablement ». Ce tutoriel t’emmène d’une page d’agent vide à un agent actif et versionné que ton équipe peut choisir dans le chat.

Il te faut un accès Éditeur ou supérieur. La référence vit dans [Concepts d’agents](/fr/platform/agents/concepts) et [Créer un agent](/fr/platform/agents/create) ; ce tutoriel enchaîne ces étapes vers un résultat concret.

## Étape 1 — Définir à quoi sert l’agent

Avant de cliquer quoi que ce soit, écris une phrase : « Cet agent répond à X en s’appuyant sur Y, et ne fait pas Z. » Exemple : « Cet agent répond aux questions de support produit en s’appuyant sur le dossier Centre d'aide, et ne donne pas de conseil juridique ni de facturation. » Cette phrase devient la colonne vertébrale de tes instructions système — sans elle, l’agent dérive.

## Étape 2 — Créer l’agent

Va dans **Agents** dans la barre latérale et clique **Créer un agent**. Donne-lui un Nom d’affichage (« Support produit ») et un Nom — un slug URL-safe utilisé pour les appels API et l’URL de chat (`support-produit`). Ajoute une courte description, puis clique **Créer**.

Tu arrives sur la page de configuration. Laisse tous les onglets en défaut pour l’instant.

## Étape 3 — Rédiger les instructions

Ouvre l’onglet **Instructions et modèle**. Colle un prompt système construit à partir de la phrase de l’étape 1. Une trame réutilisable :

```text
Tu es <rôle> pour <organisation>.

Ton job : <tâche> en t'appuyant sur <périmètre de savoir>.

Règles :
- Réponds toujours dans la langue de l'utilisateur.
- Cite le document source quand tu réponds depuis la base de connaissances.
- Si une question sort du périmètre, dis-le et suggère où la poser.

Ton : <ton>.
Format : <format>.
```

Choisis un **Préréglage de modèle** (Rapide / Standard / Avancé) adapté à la tâche — Rapide suffit aux lookups courts, Avancé pour du raisonnement multi-étapes. Voir [Concepts d’agents — Modèle](/fr/platform/agents/concepts#modèle) pour la correspondance.

Les modifications sont enregistrées automatiquement ; un indicateur en haut à droite montre l’état.

## Étape 4 — Cadrer le savoir

Ouvre l’onglet **Base de connaissances**. Décoche tout ce que l’agent ne doit pas lire et ne garde que les dossiers qui collent à son job. Un périmètre étroit est presque toujours meilleur qu’un large — moins de résultats hors-sujet, contexte plus court, réponses plus nettes. Voir [Concepts d’agents — Connaissances](/fr/platform/agents/concepts#connaissances).

Si les dossiers n’existent pas encore, crée-les d’abord dans la [base de connaissances](/fr/platform/workspace/knowledge-base), puis reviens.

## Étape 5 — Éteindre les outils inutiles

Ouvre l’onglet **Outils** et désactive tout ce que l’agent n’a pas besoin d’utiliser. Un agent support n’a sans doute pas besoin de web search. Un agent recherche n’a sans doute pas besoin de l’intégration facturation. Moins d’outils, moins de surprises en prod.

## Étape 6 — Ajouter des amorces

Ouvre l’onglet **Amorces** et ajoute deux ou trois prompts exemples. Ils s’affichent sur l’écran vide quand un utilisateur ouvre une nouvelle conversation avec l’agent et servent aussi de smoke tests intégrés pour l’étape 7.

## Étape 7 — Tester depuis le chat

Ouvre **Chat**, sélectionne le nouvel agent dans le sélecteur et essaie chaque amorce, plus une ou deux questions spontanées. Surveille :

- L’agent cite-t-il les bons documents ?
- Refuse-t-il proprement les questions hors-périmètre ?
- Le ton colle-t-il à ce que tu as écrit dans les instructions ?

Itère sur l’onglet Instructions et modèle, puis re-teste. Cette boucle fait l’essentiel de la construction d’agent.

## Étape 8 — Publier une version

Chaque édition crée un **brouillon** ; la version active continue de servir le chat jusqu’à publication. Quand tu es satisfait, clique **Publier** dans l’en-tête de version. Les éditions suivantes démarrent un nouveau brouillon — les utilisateurs continuent de frapper la version publiée jusqu’à une nouvelle publication. Voir [Versions d’agents](/fr/platform/agents/versions) pour le rollback.

## Où cela sert

Ce que tu as construit, c'est un agent versionné et cloisonné par les connaissances, que ton équipe peut sélectionner depuis le sélecteur de chat — et le même agent est également disponible via les automatisations, l'API publique et l'onglet Webhook sans configuration supplémentaire. C'est tout l'intérêt des quatre décisions que tu viens de prendre (instructions, connaissances, outils, modèle) : elles tiennent sur chaque surface où l'agent tourne.

Deux suites courantes : laisser tes scripts appeler l'agent directement avec [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script), ou brancher le même agent dans un workflow multi-étapes avec [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
