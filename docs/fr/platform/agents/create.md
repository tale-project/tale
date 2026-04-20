---
title: Créer un agent
description: Construis des assistants IA spécialisés avec des instructions, connaissances et outils dédiés.
---

Les agents sont des assistants IA spécialisés que tu configures pour des tâches précises. Contrairement à l'agent de chat par défaut, généraliste, un agent a ses propres instructions, un ensemble de connaissances défini, un modèle IA précis et des restrictions d'outils optionnelles.

## Créer un agent

1. Dans la barre latérale, va dans **Agents**.
2. Clique **Créer un agent**.
3. Entre un **Nom d'affichage** (affiché dans le sélecteur) et un **Nom** (slug URL-safe pour les appels API, ex. `support-agent`).
4. Optionnellement ajoute une description, puis **Créer**.
5. Tu arrives sur la page de configuration où tu règles **Instructions et modèle**, **Base de connaissances**, **Outils** et **Webhook**.

### Création par fichier, avec assistance IA

Tu peux aussi créer des agents en ajoutant des fichiers JSON directement dans le répertoire `agents/` de ton projet. Si tu ouvres le projet dans un éditeur IA (Claude Code, Cursor, GitHub Copilot ou Windsurf), l'éditeur connaît les schémas d'agents et capacités plateforme. Décris l'agent voulu, il générera une configuration valide. Voir [AI-assisted development](/fr/develop/ai-assisted-development).

## Onglet Instructions et modèle

C'est l'onglet le plus important. Il définit ce que sait l'agent, comment il se comporte et ce qu'il peut faire.

- **Instructions système** : prompt envoyé au modèle avant chaque conversation. Définit rôle, ton, sujets abordés ou non, et format de réponse.
- **Préréglage de modèle** : choisis entre **Rapide**, **Standard** et **Avancé**. Chaque niveau pointe vers un modèle IA configuré dans les fichiers providers (`providers/*.json`).
- **Réponses structurées** : si activé, l'agent formate ses réponses avec une structure constante (sections et listes) plutôt qu'en texte libre.

Les modifications de cet onglet sont enregistrées automatiquement. Un indicateur en haut à droite montre l'état.

## Onglet Base de connaissances

Contrôle les parties de la base de connaissances auxquelles cet agent peut accéder. Par défaut, les agents peuvent tout chercher. Tu peux restreindre à des dossiers de documents, catégories de produits ou données cadrées par équipe.

## Onglet Outils

Contrôle les capacités plateforme utilisables par l'agent. Active/désactive chaque outil. Par exemple, un agent support peut avoir le web browsing désactivé mais le lookup client activé.

## Onglet Amorces

Définis des prompts suggérés qui apparaissent quand on commence une nouvelle conversation avec cet agent. Ils aident les utilisateurs à découvrir ce que l'agent sait faire et abaissent la barrière du premier message.

Chaque démarreur a un titre et un prompt. Le titre apparaît comme suggestion cliquable ; le prompt est envoyé comme premier message au clic.

## Onglet Délégation

Configure les règles de transfert entre agents. La délégation permet à cet agent de router les conversations vers d'autres agents quand le sujet sort de son périmètre. Par exemple, un agent support général peut déléguer les questions de facturation à un agent billing spécialisé.

## Onglet Webhook

Chaque agent a un endpoint webhook unique. Tu peux POSTer un message et le contexte de conversation à cette URL pour obtenir une réponse de l'agent sans passer par l'UI. Utile pour intégrer l'agent dans des produits externes ou des widgets de chat.

Tu peux ajouter un secret webhook pour vérifier l'authenticité des requêtes entrantes.

## Versions

Les agents supportent les versions. Quand tu édites les instructions d'un agent, une version **Brouillon** est créée. La version **Actif** continue à servir les requêtes jusqu'à publication du brouillon. Le dialogue d'historique des versions liste toutes les versions passées et permet comparaison et rollback.
