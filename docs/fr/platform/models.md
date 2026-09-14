---
title: Choisir un modèle disponible
description: Comprends la sélection et les catalogues de modèles, puis identifie pourquoi un modèle manque ou refuse un appel.
---

Le sélecteur affiche les modèles que ton organisation peut utiliser actuellement, pas toute l’offre d’un fournisseur. Des identifiants utilisables, leur liste de modèles autorisés et les règles d’accès déterminent le résultat. Un administrateur les gère dans **Paramètres > Fournisseurs IA** et [Contenu et modèles](/fr/platform/admin/governance/content-models).

## Choisir une sélection automatique ou explicite

Dans Chat, **Auto** choisit un modèle pour chaque message selon ses caractéristiques, comme la longueur, le code et les documents joints. Il utilise une heuristique légère, sans second appel à une IA. Consulte les détails d’une réponse pour voir quel modèle a répondu.

Choisis un modèle précis dans la zone de saisie pour comparer les résultats, maîtriser le choix ou traiter une tâche connue. Cette sélection reste en place jusqu’à ce que tu la changes ou reviennes à Auto. L’[Arène](/fr/platform/chat/arena-mode) compare deux modèles disponibles sur le même message.

Les agents de projet et les étapes de workflow qui appellent un modèle utilisent leur configuration. Le sélecteur d’un agent distingue les fournisseurs, même lorsqu’ils servent le même identifiant de modèle. Choisir une entrée fixe cette combinaison fournisseur/modèle. Un échec est signalé ; la réponse ne provient pas discrètement d’un autre modèle.

## Comprendre l’origine de la liste

Ouvre **Paramètres > Fournisseurs IA** pour examiner le fournisseur et ses modèles proposés. Le nombre affiché indique les définitions disponibles chez le fournisseur. Il ne prouve ni que ton organisation dispose d’identifiants, ni qu’elle est autorisée à appeler tous ces modèles.

| Source | Origine des modèles | Actualisation |
| --- | --- | --- |
| Catalogue intégré | Les définitions sont fournies avec Tale. | Lors d’une mise à jour de la plateforme ou du catalogue. |
| Catalogue OpenRouter | Tale récupère la liste d’OpenRouter. | Après une récupération ou une actualisation forcée. |
| Endpoint de modèles du fournisseur | Tale récupère la liste propre au fournisseur. | Après une récupération ou une actualisation forcée. |
| Pas de catalogue | Les identifiants de modèles viennent de la liste autorisée de l’identifiant de connexion. | Lorsqu’un administrateur modifie cette liste. |

Azure OpenAI et Nous Portal utilisent des identifiants de modèles définis dans les identifiants de connexion. Pour Azure, saisis les noms de déploiement de ta ressource, qui peuvent différer des noms publics. Sans catalogue, une liste autorisée vide ne rend aucun modèle disponible.

## Actualiser un catalogue distant

Les Propriétaires, Admins et Développeurs peuvent choisir **Actualiser les catalogues** dans l’en-tête des paramètres. Lis le résultat de chaque fournisseur : le nombre de modèles ou l’erreur qui a empêché l’actualisation. Un échec de récupération ne signifie pas que le fournisseur ne propose aucun modèle.

Les catalogues distants sont mis en cache pendant 24 heures, puis actualisés à la demande lorsque le cache est périmé. Le bouton force une nouvelle tentative. Si une récupération automatique échoue, Tale peut conserver le catalogue précédent ou les modèles fournis ; une actualisation forcée signale l’échec. Un nouveau modèle doit aussi respecter les règles d’accès et les identifiants disponibles. Une installation qui ne possède que des catalogues intégrés n’a aucune liste distante à récupérer.

## Retrouver un modèle absent

Vérifie ces limites dans l’ordre, ou transmets les détails à un administrateur si tu ne peux pas modifier les réglages :

1. Vérifie que le fournisseur possède des identifiants activés et utilisables. Une entrée de catalogue ne connecte pas un compte.
2. Examine leur **Modèles autorisés**. Avec un catalogue, elle restreint la sélection ; sans catalogue, elle la définit.
3. Vérifie les règles d’accès aux modèles pour l’organisation, l’équipe ou la personne dans [Contenu et modèles](/fr/platform/admin/governance/content-models).
4. Pour un agent de projet, vérifie la compatibilité des identifiants avec le [harness](/fr/platform/agents/harnesses) choisi. Un abonnement peut imposer un environnement précis.

Si le modèle apparaît mais que l’appel échoue, lis la cause affichée. Des identifiants expirés, un fournisseur indisponible, une limite de dépense et un manque de sandbox sont des problèmes distincts. Actualiser le catalogue ne les résout pas tous. [Fournisseurs IA](/fr/platform/admin/providers) explique les identifiants ; [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) couvre les refus liés aux dépenses.
