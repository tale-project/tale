---
title: Utiliser des agents dans le chat
description: Choisis un agent spécialisé depuis le composeur pour cadrer les connaissances, restreindre les outils et router les conversations vers la bonne voix.
---

Un agent est une version de l'IA taillée pour une mission précise — un agent support qui répond aux questions des clients depuis le dossier du Centre d'aide, un agent de recherche commerciale autorisé à appeler le web, un agent de recherche interne en lecture seule sur les documents d'ingénierie. Chaque agent porte ses propres instructions, son périmètre de connaissances et ses permissions d'outils, et le composeur du chat te laisse choisir quel agent répond à une conversation donnée. Le public : tout le monde dans le produit — les Membres prennent les agents que l'équipe a livrés, les Éditeurs et les Développeurs en construisent de nouveaux.

Cette page couvre le comportement à l'exécution des agents dans le chat — bascule de l'agent actif, lecture des amorces de conversation, observation des transferts vers un spécialiste. Le modèle mental de ce qu'_est_ un agent vit dans [Concepts des agents](/fr/platform/agents/concepts) ; en construire un, c'est dans [Créer un agent](/fr/platform/agents/create).

## Basculer l'agent actif

Pour router une conversation vers un agent précis, ouvre le sélecteur d'agent (l'icône bot en bas à gauche du composeur), descends jusqu'à l'agent et clique. Le message suivant part vers les instructions, le périmètre de connaissances et les outils du nouvel agent ; la barre de titre de la conversation affiche l'agent actif. Basculer en cours de conversation est permis — le nouvel agent lit le transcript existant avant sa première réponse, donc le contexte n'est pas perdu.

Chaque conversation retient l'agent choisi. Démarrer un nouveau chat remet le sélecteur sur l'Assistant par défaut livré avec Tale.

## Amorces de conversation

Quand l'agent actif a des **amorces** configurées, une rangée de suggestions cliquables apparaît sur une conversation neuve. Clique sur une amorce pour l'envoyer comme premier message — c'est plus rapide que de taper le prompt, et c'est un bon moyen de découvrir ce que l'agent sait gérer. Les amorces se configurent par agent dans l'onglet **Agents > [agent] > Amorces** ; un agent sans amorces affiche un composeur vide.

## Pourquoi basculer d'agent

Trois raisons de prendre un agent autre que le défaut. Un périmètre de connaissances plus étroit donne des réponses plus tranchantes — un agent support qui ne fouille que le dossier du Centre d'aide ne se laisse pas distraire par les documents internes d'ingénierie. Une liste d'outils plus mince garde les questions exploratoires sûres — un agent de recherche en lecture seule, avec toutes les opérations d'écriture coupées, ne peut pas mettre à jour un ticket par accident. Une voix différente change la forme de la sortie — les agents se configurent avec des tons, des formats de sortie (Markdown, JSON, prose nue) et des niveaux de rigueur distincts.

Le plus gros levier de qualité, ce sont les instructions de l'agent. La plupart des « l'IA n'arrête pas de faire X » se ramènent à une phrase manquante ou fausse dans le system prompt, pas à un mauvais modèle.

## Transferts de délégation

Certains agents sont configurés pour **déléguer** à des spécialistes quand le sujet dérive. Si un agent support général reçoit une question de facturation et a un agent spécialiste de la facturation inscrit comme cible de délégation, il transfère la conversation tout seul. Le transfert apparaît dans le transcript sous forme d'une note courte qui nomme le nouvel agent, et les réponses qui suivent viennent des instructions du délégué.

La délégation est opt-in par agent. Pour l'activer, ouvre l'onglet **Délégation** de l'agent et choisis vers quels agents il peut transférer, avec le sujet ou la condition qui déclenche le transfert. La surface de configuration est documentée dans [Créer un agent](/fr/platform/agents/create).

## Où ça s'inscrit

Le sélecteur d'agent, c'est comment le bon spécialiste répond à chaque question — au lieu de forcer un Assistant générique à couvrir tous les sujets, tu prends l'agent bâti pour le sujet. Le rôle Membre peut utiliser ce que l'équipe a livré ; Éditeur ou plus est requis pour construire un nouvel agent.

Pour bâtir un spécialiste, démarre par [Concepts des agents](/fr/platform/agents/concepts) pour le modèle mental à quatre boutons, puis parcours [Créer un agent](/fr/platform/agents/create) de bout en bout.
