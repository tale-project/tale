---
title: Agents externes
description: L'agent intégré Claude Code, qui s'exécute dans un bac à sable isolé ; tu discutes directement avec lui pendant qu'il modifie des fichiers, lance des commandes et poursuit le travail sur plusieurs tours.
---

Tale fournit un **agent externe** intégré — **Claude Code** — dont le tour entier s'exécute dans un bac à sable isolé. Au lieu de la boucle de chat habituelle, ton message est confié à cet agent de code, qui vit dans un conteneur neuf, modifie des fichiers, lance des commandes et rend compte. Tu lui parles directement dans le chat, et il conserve le même répertoire de travail et la même conversation d'un tour à l'autre, de sorte qu'une instruction de suivi comme « ajoute maintenant un test pour ça » reprend là où il s'était arrêté.

C'est la même idée que de lancer un tel outil sur une machine distante, sauf que la machine est un bac à sable géré que l'espace de travail contrôle. Cette page explique comment l'utiliser, ce que le bac à sable peut atteindre ou non, et comment il est facturé.

## Parler à un agent de code

Choisis **Claude Code** dans le sélecteur de chat et décris une tâche en langage clair — « écris un petit outil CLI en Python et teste-le », « clone ce dépôt et corrige le bug de l'issue #42 ». L'agent travaille dans son bac à sable : il planifie, écrit des fichiers, lance des commandes shell et installe des paquets au besoin, puis répond avec ce qu'il a fait. Pendant qu'il travaille, tu vois un indicateur de réflexion ; la réponse arrive quand le tour se termine.

Inutile d'attendre la fin d'un tour. Le champ de saisie reste ouvert pendant que l'agent travaille : tout ce que tu envoies est mis en file d'attente, apparaît immédiatement dans le fil avec un badge **En attente**, puis est transmis à l'agent en cours à sa prochaine occasion — pour Claude Code, c'est en plein tour, à la prochaine frontière d'outil, si bien qu'une correction comme « utilise pnpm, pas npm » arrive pendant que le travail se poursuit. Un message en attente peut être retiré (le × à côté du badge) tant que l'agent ne l'a pas pris en compte. Appuyer sur **Stop** termine le tour en cours ; les messages encore en attente sont envoyés automatiquement quelques secondes plus tard comme tour suivant, avec le contexte de l'agent intact.

Chaque fil de discussion est adossé à une session de bac à sable persistante. Les messages de suivi réutilisent la même session et les mêmes fichiers, et l'agent reprend son raisonnement antérieur au lieu de repartir de zéro. La session appartient au fil — supprimer ou archiver le fil démonte le bac à sable et libère ses ressources.

## Ce que le bac à sable peut atteindre

Le bac à sable démarre avec un répertoire de travail vide et est verrouillé par défaut. Le trafic réseau sortant est refusé sauf pour une petite liste d'autorisation (registres de paquets et GitHub), de sorte que l'agent peut installer des dépendances et cloner des dépôts publics mais ne peut pas atteindre des hôtes arbitraires. Le modèle lui-même est atteint via la passerelle de l'espace de travail, jamais via une clé de fournisseur brute — le bac à sable ne détient qu'une clé éphémère et limitée par un budget pour ce tour.

Au-delà de ce verrouillage, l'agent peut atteindre n'importe quelle intégration que ton organisation a connectée — chercher sur le web via Tavily, appeler une API, interroger une base de données — tant que cette intégration est liée à l'agent. Tu les lies comme pour n'importe quel autre agent : ouvre l'onglet **Outils** de l'agent et sélectionne-les sous **Intégrations liées**. L'identifiant n'entre jamais dans le bac à sable ; quand l'agent appelle une intégration, la requête repart vers Tale, qui exécute l'appel avec l'identifiant stocké et ne renvoie que le résultat — un conteneur compromis ne peut donc pas lire tes clés. Une opération d'écriture ne s'exécute pas en silence : elle apparaît comme une carte d'approbation dans le chat et se déroule une fois que tu l'approuves.

GitHub est l'exception qui place aussi un jeton dans le bac à sable, parce que `git` et la CLI `gh` en ont besoin localement : connecte GitHub sous [Intégrations](/platform/integrations/overview) et lie-le à l'agent, et la session reçoit un jeton à portée limitée pour que l'agent puisse cloner, pousser et ouvrir des pull requests en ton nom. Tous les identifiants — le jeton GitHub dans le bac à sable comme ceux qui sont relayés — sont limités à la session, journalisés à chaque appel et révoqués à la fin de la session.

## Moteurs et modèles

**Claude Code** a sa propre entrée dans le sélecteur de chat. Le modèle est indépendant : il provient de la liste des modèles pris en charge de l'agent, comme pour n'importe quel autre agent — choisis-le dans le sélecteur de modèle. Note que les prompts d'un agent de code fonctionnent mieux avec la famille de modèles pour laquelle il a été conçu ; l'associer à un modèle sans rapport fonctionne tout de même, mais la qualité varie.

## Coût et budget

Les tours de l'agent externe peuvent être longs et appeler le modèle de nombreuses fois ; ils coûtent donc plus qu'une simple réponse de chat. Chaque tour s'exécute sur un budget par tour, et les [Politiques et limites](/platform/admin/governance/policies-and-limits) de l'organisation plafonnent les dépenses par utilisateur, par équipe ou par agent. L'utilisation est mesurée dans l'[Analyse d'utilisation](/platform/admin/governance/usage-analytics) au même titre que tout autre agent, attribuée à l'agent externe pour que tu voies ce que coûtent ces exécutions.

## Où cela s'inscrit

Un agent externe transforme un fil de discussion en une session en direct avec un outil de code dans un bac à sable — tu le pilotes en langage clair, il travaille dans un espace de travail isolé, et la session persiste pour les suivis jusqu'à ce que tu fermes le fil. Les candidats à la dérive ici sont les noms d'agent et de modèle ; associe cette page à la liste des [Fournisseurs](/platform/admin/providers) en cours plutôt que de mémoriser des chaînes de modèle spécifiques, et à [Intégrations](/platform/integrations/overview) pour les intégrations connectées que l'agent peut atteindre — de GitHub pour un véritable flux de pull request à une intégration de recherche ou de données qui amène des faits externes dans le travail.
