---
title: "L’auto-hébergement garde-t-il tes données IA en interne ?"
description: "Une application IA auto-hébergée peut envoyer des données ailleurs. Suis une tâche à travers ses modèles, outils, stockages et journaux pour le vérifier."
slug: self-hosted-ai-agent-platform-data-flow
topicId: T06
reviewed: '2026-10-03'
draft: false
coverAlt: "Une enceinte de travail ouverte se connecte à des services externes distincts."
---

L’auto-hébergement te permet de choisir où tourne l’application. Les services qu’elle appelle déterminent si ses données restent dans l’entreprise. Un agent installé sur ton serveur peut encore envoyer un document confidentiel à un modèle hébergé ailleurs, en reprendre le contenu dans une recherche web ou l’écrire dans un journal d’erreurs externe.

La question utile est donc : **quelles parties de cette tâche peuvent sortir de notre environnement, et par quelles connexions ?** Tu peux y répondre avant d’acheter du matériel ou de choisir un hébergement. Suis une tâche représentative, de ses données d’entrée à son résultat, en examinant les services qu’elle utilise au passage.

## Suis un document tout au long de la tâche

Imagine que ton équipe achats demande à un agent de comparer trois fournisseurs à partir d’un cahier des charges interne. Celui-ci contient un budget et une date de lancement encore confidentielle. Les sites des fournisseurs sont publics ; le cahier des charges doit rester dans l’environnement contrôlé de l’entreprise.

L’agent a besoin de ces deux types d’informations, mais rien ne l’oblige à les envoyer ensemble. Il pourrait récupérer les pages produit publiques à partir des noms des fournisseurs, puis les comparer au cahier des charges avec un modèle interne. Envoyer l’ensemble à un modèle externe enfreindrait la règle de cet exemple. Inclure la date de lancement dans une recherche publique aussi.

Note ce que chaque étape transmet réellement. « Utilise notre cloud privé » ne dit pas assez où vont une requête au modèle ou les termes d’une recherche.

| Étape | Ce qu’il faut examiner | Ce que l’exemple autorise |
| --- | --- | --- |
| Importer le cahier des charges et en extraire le texte | Fichier original, texte extrait, copies temporaires | Tout conserver dans l’environnement contrôlé |
| Rendre le document consultable par recherche | Texte envoyé au service d’embeddings | Utiliser un service interne pour ce texte |
| Rechercher les fournisseurs | Requêtes de recherche, pages demandées, formulaires envoyés | Transmettre les noms des fournisseurs et des termes publics |
| Rédiger le comparatif | Requête complète envoyée au modèle de génération | Traiter en interne le contexte qui mêle informations privées et publiques |
| Enregistrer le résultat | Rapport, historique de conversation, journaux et sauvegardes | Appliquer la même règle aux copies contenant des informations internes |

Cette vérification révèle aussi un oubli fréquent : héberger soi-même le modèle de génération ne règle pas le cas du service d’embeddings. Ce service transforme le texte en vecteurs pour la recherche. S’il est externe, il reçoit le texte avant même qu’une personne pose une question sur le document.

![L’application et l’espace de travail se trouvent dans l’infrastructure choisie. Chaque connexion aux modèles, aux outils et aux services d’exploitation nécessite une vérification distincte des données transmises.](/blog/diagrams/fr/T06-diagram.svg)

## Examine les connexions derrière le mode d’hébergement

Demande à la personne qui exploite le système d’identifier la destination réelle de chaque ligne du tableau. Pour un appel au modèle, note le point d’accès, le fournisseur qui le sert et l’éventuelle solution de repli. Pour un outil, examine la requête ou les champs envoyés. Pour le stockage, compte le texte extrait et les sauvegardes autant que les fichiers importés.

Dans Tale, les données de l’application, les connaissances consultables par recherche et les fichiers originaux ont des réglages de stockage distincts. Déplacer un stockage ne déplace ni les autres ni leur contenu existant. Le [guide des stockages](https://docs.tale.dev/fr/self-hosted/configuration/data-residency) explique ces limites.

Les restrictions réseau ont elles aussi un périmètre. Les sorties réseau du bac à sable de Tale et le chemin passant par sa passerelle de modèles sont distincts. Limiter les sites que l’agent peut consulter ne détermine donc pas où les requêtes au modèle sont traitées. Le [guide de sécurisation](https://docs.tale.dev/fr/self-hosted/operate/security/hardening) permet de préciser les connexions couvertes par une restriction. Examine aussi les accès directs aux fournisseurs dans le [guide des moteurs d’exécution](https://docs.tale.dev/fr/platform/agents/harnesses).

Inclus le signalement des erreurs dans cette vérification. Une tâche réussie peut ne jamais le déclencher, alors qu’une requête échouée peut produire un message contenant des données de la tâche. Les destinations de surveillance optionnelles de Tale dépendent de la configuration ; masquer certains en-têtes ne retire pas le texte sensible de tous les messages d’erreur. Voir la [configuration de la surveillance](https://docs.tale.dev/fr/self-hosted/configuration/observability-config).

## Vérifie avec des données sans risque

Un fichier de configuration décrit ce qui devrait se passer. Un essai contrôlé aide à vérifier ce qui se passe réellement. Utilise un cahier des charges fictif contenant une phrase distinctive et sans caractère sensible. Demande ensuite à la personne responsable d’examiner les requêtes au modèle, les appels d’outils et les événements signalés. Ne reprends pas cette phrase dans une recherche publique, sauf si c’est précisément la connexion que tu veux tester.

Teste une exécution normale et une erreur provoquée de façon contrôlée. Si la configuration prévoit un modèle externe de secours, vérifie ce chemin séparément. Teste également une destination interdite : une tâche dont les données doivent rester internes devrait s’arrêter lorsque son modèle autorisé est indisponible, plutôt que basculer discrètement vers un modèle externe.

Observer une exécution ne prouve pas l’absence d’autres connexions. Rapproche tes observations de la liste des destinations configurées et des règles réseau effectivement appliquées. Indique les chemins que tu n’as pas pu examiner comme non vérifiés. La personne qui autorise le déploiement pourra ainsi décider sur des faits précis.

## Décris précisément l’hébergement retenu

Pour la comparaison de fournisseurs, une décision utile pourrait être :

> Le cahier des charges, le texte extrait, les requêtes au modèle et le rapport restent dans notre environnement contrôlé. Les noms publics des fournisseurs sont envoyés au service de recherche web. Le signalement externe des erreurs est désactivé. Les sauvegardes restent dans notre stockage approuvé.

C’est un exemple de décision à vérifier, pas la description de tous les systèmes auto-hébergés. Ta décision peut tout à fait autoriser un fournisseur de modèles externe désigné. L’essentiel est que cette exception soit visible et approuvée avant le début du travail confidentiel.

Utilise la [fiche d’inventaire des flux de données](/blog/worksheets/fr/T06-data-flow-inventory.md) pour noter les destinations et les connexions encore incertaines avec la personne responsable de l’exploitation. Quand tu peux expliquer où une tâche réelle envoie ses données, tu peux comparer les hébergements à l’exigence qui t’a conduit à envisager l’auto-hébergement.
