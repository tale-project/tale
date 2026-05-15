---
title: Construire ton premier agent end-to-end
description: Créer un agent dédié, brancher du savoir, le tester et publier une version.
---

Le chat générique répond aux questions avec ce sur quoi le modèle a été entraîné ; un agent dédié répond avec le savoir de ton organisation, dans ton ton, limité à une tâche — « Support produit », « Politiques RH », « Aide à la vente ». Ce tutoriel te mène d'une page d'agent vide à un agent versionné que ton équipe peut sélectionner dans le sélecteur d'agent du chat. La référence fonctionnelle vit dans [Concepts d'agent](/fr/platform/agents/concepts) et [Créer un agent](/fr/platform/agents/create) ; cette page assemble les étapes en un résultat concret.

Le résultat à la fin est un agent publié, avec une tâche, le bon périmètre de connaissances, et un test de fumée que tu as toi-même passé.

## Avant de commencer

Il te faut un accès Éditeur ou supérieur dans ton instance Tale — Propriétaire, Admin, Développeur et Éditeur sont valides ; Membre et Désactivé ne le sont pas. Vérifie le rôle sur ta page de profil en cas de doute. Il te faut aussi au moins un dossier dans la [base de connaissances](/fr/platform/workspace/knowledge-base) qui correspond à la tâche de l'agent ; si le savoir de ton organisation n'est pas encore structuré en dossiers, crées-en un avec trois ou quatre documents représentatifs avant de continuer — un agent sans savoir pertinent est impossible à tester honnêtement.

Pas de compte externe, pas de clé API, pas de feature flag.

## Étape 1 — Décider à quoi sert l'agent

Le plus dur dans un agent, c'est de nommer ce qu'il **ne fait pas**. Avant de cliquer où que ce soit, écris une phrase sur papier ou dans un brouillon : « Cet agent répond à X avec Y, et ne fait pas Z. » Par exemple : « Cet agent répond aux questions de support produit avec le dossier Centre d'aide, et ne donne pas de conseil juridique ni de facturation. » Cette phrase devient l'épine dorsale de tes instructions système — sans elle, l'agent dérive vers ce que l'utilisateur demande, même quand la réponse est hors périmètre.

L'étape a fonctionné quand la phrase rend explicite à la fois la tâche de l'agent et ses cas de refus.

## Étape 2 — Créer l'agent

Ouvre **Agents** dans la barre latérale et clique sur **Créer un agent**. Donne un **Nom d'affichage** (« Support produit »), un **Nom interne** — un slug compatible URL utilisé dans les appels API et l'URL de chat (`product-support`), et une courte description. Enregistre.

Le nom interne est permanent en pratique : les agents sont adressés par slug depuis les automatisations, l'API et l'URL de chat, donc renommer plus tard casse chaque lien qui pointait sur l'ancien. Choisis quelque chose avec quoi vivre.

L'étape a fonctionné quand la page de configuration de l'agent s'ouvre avec ses onglets (Instructions, Base de connaissances, Outils, Lanceurs de conversation, Webhook, Versions) alignés en haut.

## Étape 3 — Écrire les instructions

Ouvre l'onglet **Instructions** et colle un prompt système construit autour de la phrase de l'étape 1. Le squelette ci-dessous couvre les quatre choses dont chaque prompt d'agent a besoin — identité, périmètre, règles, forme de sortie :

```text
Tu es <rôle> pour <organisation>.

Ta tâche est de <tâche>, en utilisant <périmètre de savoir>.

Règles :
- Réponds toujours dans la langue de l'utilisateur.
- Cite le document source quand tu réponds depuis la base de connaissances.
- Si une question est hors périmètre, dis-le et propose où demander.

Ton : <ton>.
Format : <format>.
```

Choisis un **Préréglage de modèle** (Fast / Standard / Advanced) qui correspond à la tâche : Fast pour des consultations courtes, Advanced pour du raisonnement multi-étapes. La correspondance entre préréglage et modèle réel vit dans [Concepts d'agent — Modèle](/fr/platform/agents/concepts#model).

Les changements s'enregistrent automatiquement ; un indicateur en haut à droite montre l'état.

L'étape a fonctionné quand l'indicateur d'enregistrement affiche « enregistré » et que l'aperçu du prompt rend le texte collé sans troncature.

## Étape 4 — Limiter le savoir

Ouvre l'onglet **Base de connaissances**. Le réglage par défaut est la base de connaissances entière de l'organisation, ce qui est presque toujours trop large — les résultats de recherche non pertinents évincent les pertinents, et les réponses de l'agent deviennent floues. Décoche tout ce qui n'est pas la tâche de l'agent et garde uniquement les dossiers qui correspondent.

Un périmètre étroit produit des réponses plus nettes. Un agent de support lisant `Centre d'aide` uniquement battra à chaque fois un agent de support lisant chaque dossier de l'organisation.

L'étape a fonctionné quand l'onglet Base de connaissances liste un ou deux dossiers et que le reste est décoché.

## Étape 5 — Désactiver les outils dont tu n'as pas besoin

Ouvre l'onglet **Outils** et désactive tout ce que l'agent ne doit pas utiliser. Un agent de support n'a probablement pas besoin de recherche web ; un agent de recherche n'a probablement pas besoin de l'intégration de facturation. Moins d'outils, c'est moins de surprises en production — et moins d'outils sur lesquels le modèle doit raisonner, ce qui accélère la réponse.

L'étape a fonctionné quand seuls les outils que l'agent utilise vraiment sont activés.

## Étape 6 — Ajouter des lanceurs de conversation

Ouvre l'onglet **Lanceurs de conversation** et ajoute deux ou trois prompts d'exemple. Ils apparaissent sur l'écran vide quand un utilisateur ouvre une nouvelle conversation avec l'agent, et ils servent de liste de test de fumée pour l'étape 7 : si un lanceur répond bien, l'agent pointe au moins dans la bonne direction.

L'étape a fonctionné quand les lanceurs apparaissent sous le composer quand tu ouvres un nouveau chat avec l'agent.

## Étape 7 — Tester depuis le chat

Ouvre **Chat** dans la barre latérale, choisis le nouvel agent dans le sélecteur, et essaie chaque lanceur de conversation plus une ou deux questions ad-hoc que tu attendrais d'un collègue. Surveille trois choses : l'agent cite-t-il les bons documents, refuse-t-il proprement les questions hors périmètre, et le ton correspond-il à ce que tu as écrit dans les instructions.

Itère en repassant dans l'onglet Instructions, en resserrant le prompt, et en retestant. Cette boucle est l'essentiel de la construction d'un agent — la plupart des agents ont besoin de trois ou quatre tours d'itération avant d'être bons.

L'étape a fonctionné quand l'agent répond à une question représentative dans le périmètre avec une citation, et refuse une question hors périmètre par une redirection d'une phrase.

## Étape 8 — Publier une version

Chaque modification jusqu'ici a mis à jour un **brouillon** ; la version en ligne (s'il y en a une précédente) continue de servir le chat jusqu'à ce que tu publies. Clique sur **Publier** dans l'en-tête de version. Les modifications futures démarrent un nouveau brouillon — les utilisateurs continuent d'atteindre la version publiée jusqu'à ce que tu publies à nouveau.

L'étape a fonctionné quand l'en-tête de version montre un numéro de version frais avec un badge « Publié », et que l'onglet brouillon de l'agent est vide.

## Dépannage

- **L'agent cite le mauvais document sur chaque question** — le périmètre de l'onglet Base de connaissances est encore trop large, ou un dossier domine en nombre de documents. Resserre encore, ou découpe en deux agents (`support-public` et `support-internal`) avec des périmètres différents.
- **L'agent refuse des questions dans le périmètre** — la section « Règles » du prompt système est trop restrictive, ou la description de la tâche ne correspond pas à la façon dont les utilisateurs formulent vraiment leurs questions. Relâche les règles et reformule la tâche dans la voix de l'utilisateur.
- **Les lanceurs de conversation n'apparaissent pas** — l'agent a au moins une version publiée mais tu regardes une prévisualisation de brouillon, ou les lanceurs ont été enregistrés sur un autre brouillon. Bascule vers l'aperçu de la version publiée.
- **La publication a échoué avec une erreur de validation** — des champs obligatoires (nom d'affichage, slug, instructions système) sont vides, ou le slug entre en collision avec un agent existant. Le toast d'erreur nomme le champ.

## Où ça s'inscrit

Ce que tu as construit est un agent versionné, à périmètre de savoir, que ton équipe peut sélectionner depuis le sélecteur de chat — et le même agent est aussi joignable depuis les automatisations, l'API publique et l'onglet Webhook sans câblage supplémentaire. Les quatre décisions que tu viens de prendre (instructions, base de connaissances, outils, modèle) tiennent sur chaque surface où tourne l'agent, ce qui est tout l'intérêt de l'abstraction d'agent.

Deux suites naturelles d'ici : laisse des scripts appeler l'agent directement avec [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script), ou branche le même agent dans un workflow multi-étapes avec [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
