---
title: Créer un agent
description: Le flux de construction de bout en bout pour un agent personnalisé — nom, modèle, instructions, connaissances, outils, amorces de conversation, délégation et l'URL de worker.
---

Créer un agent, c'est choisir les valeurs des quatre boutons que la page Concepts a introduits — instructions, connaissances, outils, modèle — puis donner à l'agent un nom, une URL de worker pour les appelants externes, et les amorces de conversation qui apparaissent sur un chat neuf. Le public, c'est le rôle Éditeur ou plus ; les Membres peuvent utiliser les agents livrés mais pas en construire.

Cette page parcourt le flux de construction onglet par onglet. Le modèle conceptuel derrière les quatre boutons vit dans [Concepts des agents](/fr/platform/agents/concepts). La boucle d'itération après la première publication — instantanés de l'historique, comparaison, restauration — vit dans [Versions des agents](/fr/platform/agents/versions). Cette page s'inscrit entre les deux.

## Créer l'agent

Pour démarrer un nouvel agent, ouvre **Agents** dans la barre latérale et clique sur **Créer un agent**. La boîte de création demande trois choses :

| Champ           | Ce qu'il faut mettre                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom d'affichage | Le nom montré dans le sélecteur d'agent et les conversations. `Agent support`, `Recherche commerciale`.                                                                   |
| Nom             | Slug compatible URL utilisé dans les appels d'API et les références aux fichiers JSON. Dérivé automatiquement du nom d'affichage ; surcharge-le si un slug précis compte. |
| Description     | Une-ligne optionnelle qui décrit ce que fait l'agent. Apparaît dans l'infobulle du sélecteur d'agent.                                                                     |

Clique sur **Continuer**. L'écran suivant est la page de configuration de l'agent, qui porte sept onglets : Général, Instructions et modèle, Outils, Connaissances, Amorces, Délégation et Workers.

### Création par fichier avec assistance IA

Pour créer des agents en ajoutant directement des fichiers JSON, ouvre le répertoire `agents/` du projet et ajoute un nouveau fichier. Un éditeur assisté par IA (Claude Code, Cursor, GitHub Copilot, Windsurf) ouvert sur le projet voit le schéma d'agent et les capacités de la plateforme via le code de référence extrait — décris l'agent et l'éditeur génère un fichier de configuration valide. Voir [Développement assisté par IA](/fr/develop/ai-assisted-development) pour la mise en place.

## Instructions et modèle

C'est l'onglet le plus porteur. Le champ **Instructions système** est le system prompt que le modèle voit avant chaque conversation ; il définit le rôle, le périmètre, le ton et la forme de sortie de l'agent. Garde-le court, spécifique et listé en règles — déclare qui est l'agent, ce qu'il peut répondre, ce qu'il doit refuser et comment formater ses réponses.

Deux autres champs vivent dans cet onglet. Le sélecteur **Modèle** choisit le modèle IA qui sous-tend cet agent — prends parmi les modèles que ton organisation a configurés dans [Fournisseurs IA](/fr/platform/admin/providers) ; le sélecteur te laisse aussi ajouter des modèles de repli qui démarrent quand le principal n'est pas disponible. La bascule **Réponses structurées** laisse l'agent formater les réponses conséquentes avec des marqueurs `[[CONCLUSION]]`, `[[KEY_POINTS]]` et `[[DETAILS]]` qui se rendent comme des sections d'UI riches dans le chat ; coupe-la pour forcer des réponses en texte simple.

Les modifications s'enregistrent automatiquement ; un indicateur d'enregistrement en haut à droite montre l'état courant.

## Outils

Pour donner à l'agent l'accès à une capacité, ouvre l'onglet Outils et active l'entrée correspondante. Les outils intégrés incluent la recherche dans les connaissances, la recherche web, le traitement de documents et l'analyse d'image — chacun avec un sélecteur de mode de récupération à quatre voies (**Désactivé**, **Outil**, **Contexte**, **Les deux**) qui décide si l'agent fouille à la demande, reçoit les résultats auto-injectés dans chaque réponse, ou les deux. Chaque intégration configurée et chaque [serveur MCP](/fr/platform/integrations/mcp-servers) actif apparaît comme groupe bascule sous les outils intégrés.

La liste des outils sépare l'agent qui sait seulement parler de l'agent qui sait agir. Un agent de recherche en lecture seule a la recherche web activée et toutes les opérations d'écriture coupées ; un agent qui met à jour des tickets a l'intégration support activée et tout le reste coupé.

## Connaissances

Pour cadrer ce que l'agent peut chercher, ouvre l'onglet Connaissances et resserre la valeur par défaut (toutes les connaissances de l'organisation) par dossier, par équipe ou par type d'entité (Documents, Produits, Clients, Fournisseurs). Des périmètres plus étroits donnent des résultats plus pertinents — un agent support qui fouille seulement le dossier du Centre d'aide ne se laisse pas distraire par les documents d'ingénierie — et coûtent moins, parce que moins de documents atteignent le modèle.

L'onglet Connaissances te laisse aussi téléverser des **documents d'agent** — des fichiers auxquels seul cet agent peut accéder, utiles pour des guides de style privés ou des modèles de réponse que tu ne veux pas exposer au reste de l'organisation. Pour couper les connaissances entièrement (l'agent répond depuis les instructions et les outils uniquement), mets le **Mode de récupération** sur **Désactivé** dans cet onglet.

## Amorces

Pour suggérer des premiers messages sur un chat neuf, ouvre l'onglet Amorces et ajoute des entrées d'amorce. Chaque amorce a un **titre** (la suggestion cliquable) et un **prompt** (le message envoyé au clic). Les amorces réduisent la friction pour écrire le premier message et sont un bon moyen de montrer ce que l'agent sait gérer.

Un agent sans amorces affiche un composeur vide sur un chat neuf — la fonctionnalité est opt-in.

## Délégation

Pour laisser l'agent transférer des conversations à des spécialistes quand le sujet dérive, ouvre l'onglet Délégation et choisis les agents cibles. Pour chaque cible, nomme le sujet ou la condition qui déclenche le transfert ; l'agent route alors les conversations correspondantes vers le délégué choisi. Le transfert apparaît dans le transcript sous forme d'une note courte qui nomme le nouvel agent, et les réponses suivantes viennent des instructions du délégué.

La délégation est opt-in. Un agent sans cibles de délégation répond lui-même à chaque sujet.

## Workers

Chaque agent reçoit une **URL de worker** unique. Pour appeler l'agent depuis l'extérieur de Tale — un widget de chat sur un site marketing, un bot Slack, un workflow externe — POSTe un message et le contexte de la conversation à l'URL du worker et l'agent répond avec la même forme qu'il aurait utilisée dans le chat. L'onglet Workers prend en charge plusieurs URLs de worker par agent, donc tu peux faire tourner les identifiants ou cadrer des intégrations différentes sur des clés différentes.

L'agent doit être publié avant que son onglet Workers ne s'active — jusque-là, l'onglet affiche _Publie cet agent pour activer l'accès worker_. Le schéma de signature et un exemple concret en cURL, Node et Python vivent dans [Webhooks](/fr/develop/webhooks).

## Historique

Pour parcourir l'historique des instantanés enregistrés de l'agent, ouvre le menu **Historique**. La boîte liste chaque instantané publié avec l'horodatage et l'acteur ; de là, tu peux comparer deux instantanés côte à côte ou restaurer un précédent comme nouvel état de travail. Voir [Versions des agents](/fr/platform/agents/versions) pour le cycle de vie complet.

## Où ça s'inscrit

Cette page est le flux de construction — nom, instructions, modèle, connaissances, outils, amorces, délégation, workers. La majeure partie de l'itération sur un agent se passe _après_ cette création initiale : réécrire les instructions à mesure que tu repères ce que l'agent comprend de travers, resserrer les connaissances en voyant sur quoi il s'ancre, activer ou désactiver les outils quand le cas d'usage se précise. Les quatre boutons que la page Concepts a introduits sont les quatre que tu continueras d'ajuster.

Pour la boucle d'itération — brouillons, publication, rollback d'agents en production —, [Versions des agents](/fr/platform/agents/versions) est la référence dédiée. Pour appeler cet agent depuis l'extérieur de l'UI, [Webhooks](/fr/develop/webhooks) et la [référence de l'API](/fr/develop/api-reference) couvrent les deux surfaces hors UI.
