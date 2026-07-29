---
title: Recherche approfondie
description: L’agent Chercheur — recherche web ouverte avec un plan de tâches en direct, des sources citées via Tavily, et un rapport PDF propre à la fin.
---

La recherche approfondie est un mode du chat qui confie une question à un agent **Chercheur** spécialisé. L’agent planifie le travail comme une liste de sous-questions, cherche sur le web ouvert avec Tavily, lit les pages les plus prometteuses, suit sa progression dans une carte de tâches que tu regardes en direct, et finit avec un rapport PDF qui cite chaque source utilisée. Va vers ce mode quand la question est ouverte, que la réponse a besoin de preuves, et que tu y passerais sinon une heure avec vingt onglets de navigateur.

Cette page couvre la surface de la recherche approfondie de bout en bout — quand la choisir, à quoi ressemble le flux, le budget qui l’empêche de tourner à l’infini, et d’où viennent les sources citées. La mécanique de l’agent a la même forme que tout autre agent Tale (voir [Concepts d’agent](/fr/platform/agents/concepts)) ; ce qui est inhabituel ici, c’est le plan de tâches en direct et l’connector Tavily qui alimente les recherches.

## Quand y recourir

La recherche approfondie bat un chat ordinaire pour les questions où la valeur n’est pas le savoir existant du modèle mais l’assemblage d’informations récentes et sourcées. Trois signaux que c’est le bon mode :

- La question est ouverte (« quel est le consensus actuel sur… », « compare les trois meilleurs… »).
- Tu veux des citations — une affirmation sans URL est une devinette.
- Tu acceptes d’attendre deux à dix minutes pour un rapport écrit plutôt qu’une réponse de chat.

Pour des questions factuelles étroites (« quelle est la capitale du Sénégal »), un chat classique est plus rapide et tout aussi précis. Pour des questions sur tes propres données (« qu’a dit le contact lors de l’appel de mardi dernier »), un agent avec des liaisons de [Connaissances](/fr/platform/agents/knowledge) est la bonne forme — la recherche approfondie ne lit que le web ouvert, pas ta base de connaissances.

## Ouvrir la recherche approfondie

Ouvre le menu plus de la zone de saisie — les modes vivent sous son en-tête **Modes**, et **Deep research** y apparaît dès que l’agent Chercheur est disponible. Choisis-le et le chat bascule vers l’agent Chercheur. Tape la question et envoie. Le panneau de réponse passe du streaming texte habituel à une carte **Plan de recherche** avec trois à sept tâches que l’agent a choisies comme sous-questions.

Le mode est disponible quand un Éditeur ou un rôle supérieur a lié l’connector **Tavily** sous [Paramètres > Connectors](/fr/platform/connectors/overview) ; sans Tavily, l’entrée de menu nomme l’connector manquante et un clic dessus ouvre les réglages d’connectors.

## Le plan de recherche

Le plan est une liste de tâches `pending` que l’agent a générées à partir de ta question. Pour les questions complexes, l’agent fait une pause après le premier plan et te demande de confirmer — une carte **Proceed with this plan?** apparaît avec un champ oui/non. Clique oui pour démarrer ; clique non et l’agent ne va pas plus loin. Les questions triviales sautent la confirmation.

Une fois lancé, l’agent traite les tâches une par une :

1. Passe la tâche courante à `in_progress`.
2. Cherche jusqu’à trois fois sur Tavily pour cette tâche.
3. Lit jusqu’à deux des URL les plus prometteuses en entier via l’opération extract de Tavily.
4. Passe la tâche à `done` avec une conclusion en une phrase.

La carte se met à jour en direct à mesure que chaque étape arrive. Tu peux regarder le raisonnement du modèle prendre forme ; si une nouvelle sous-question émerge en cours de route, l’agent l’ajoute à la liste.

## Recherches et extractions

Tavily est le fournisseur de recherche web ouverte derrière la recherche approfondie — son API est optimisée pour les agents LLM et renvoie des résultats avec des snippets nettoyés et des scores par résultat. Deux opérations comptent :

- **search** — requête en langue naturelle avec profondeur (`basic` ou `advanced`), thème (`general` ou `news`, avec une fenêtre `days` pour la fraîcheur), et une allowlist ou blocklist de domaines optionnelle.
- **extract** — récupère le texte principal nettoyé pour une à cinq URL. L’agent l’appelle sur les deux meilleurs résultats par tâche quand un snippet ne suffit pas.

Le palier gratuit de Tavily est de 1000 appels par mois ; les plans payants débloquent la profondeur `advanced` sur search et l’opération extract. Les étapes de configuration vivent sur la carte de setup de l’connector sous **Paramètres > Connectors**.

## Budget par exécution

La recherche approfondie plafonne une exécution à :

- **3 recherches + 2 extractions par tâche.** L’enveloppe d’connector refuse les appels au-delà.
- **40 étapes de raisonnement au total** sur toute l’exécution.
- **25 minutes d’horloge.** Au-delà, l’agent s’arrête et synthétise avec ce qu’il a.
- **60 appels d’connector au total par exécution** comme plafond dur.

Toucher l’une de ces limites arrête la phase de recherche et pousse l’agent en synthèse. S’il t’en faut plus, relance la question avec un périmètre plus serré ou découpe-la en deux questions.

## Le rapport PDF

Quand chaque tâche est `done` (ou annulée, ou que le budget a heurté un mur), l’agent appelle l’outil **pdf** une fois pour produire un seul rapport structuré :

- **Conclusion** — une à trois phrases répondant directement à la question.
- **Key points** — trois à sept puces, chacune portant au moins une citation en ligne vers une source Tavily.
- **Details** — l’analyse plus longue, groupée par sous-question.
- **Sources** — une liste dédupliquée de chaque URL citée.

Le PDF arrive comme une carte de pièce jointe dans le chat. L’agent ne colle pas le rapport dans le corps du message — la carte est le livrable. Une courte ligne de confirmation dans ta langue (« Recherche terminée — consulte le PDF ci-joint pour le rapport complet. ») pointe vers la carte.

Pour les rapports en chinois, japonais et coréen, le jeu de polices du moteur de rendu PDF est incomplet ; dans ce cas, l’agent émet le même rapport structuré directement dans le chat et précise qu’un PDF traduit en anglais est disponible sur demande.

## Cas d’échec

- **Tavily non connecté.** L’agent émet une ligne demandant à un Éditeur de connecter Tavily sous **Paramètres > Connectors** et s’arrête.
- **Quota Tavily épuisé.** L’connector renvoie `CONNECTOR_BUDGET_EXHAUSTED` et l’agent passe à la synthèse avec ce qu’il a. Le palier gratuit touche cette limite vers le millième appel du mois.
- **Une URL précise échoue à l’extraction.** La tâche concernée est marquée `failed` avec une raison ; les autres tâches continuent.
- **Ton budget se vide.** L’exécution s’arrête et l’agent synthétise. La carte montre quelles tâches ont été sautées.

## Où ça s’inscrit

La recherche approfondie est l’extrémité la plus lourde du chat — elle fait en dix minutes ce qu’un analyste ferait en un après-midi. Couple cette page avec [Concepts d’agent](/fr/platform/agents/concepts) (le modèle à quatre boutons sur lequel l’agent Chercheur est construit) et l’[Aperçu des connectors](/fr/platform/connectors/overview) (où Tavily se tient à côté des autres connectors que la ceinture d’outils de l’agent peut atteindre). Si tu veux construire ton propre agent de recherche plutôt qu’utiliser celui livré, [Créer un agent](/fr/platform/agents/create) parcourt la construction d’un agent de bout en bout.
