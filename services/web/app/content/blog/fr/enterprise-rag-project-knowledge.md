---
title: "Pourquoi l’IA se trompe malgré les sources citées"
description: "Remonte d’une réponse IA erronée à sa source. Vérifie les documents périmés, les textes absents et les affirmations avant de changer de modèle."
slug: enterprise-rag-project-knowledge
topicId: T05
reviewed: 2026-10-03
draft: false
coverAlt: "Un passage sélectionné relie une bibliothèque de documents à un rapport ouvert."
---

Une citation te donne un endroit où vérifier une réponse. Elle ne dit pas si le document est à jour, s’il a été approuvé ou si la réponse restitue correctement son contenu.

Quand l’IA de ton entreprise se trompe, pars d’une question précise et du passage cité. Remonte ensuite le fil : la source est-elle incorrecte, la recherche a-t-elle manqué la bonne source ou le modèle a-t-il mal compris le texte trouvé ? La correction dépend de la cause. Changer de modèle d’abord peut laisser le vrai problème intact.

## Un brouillon peut passer pour une décision

Supposons qu’un collègue demande : « Peut-on promettre une assistance le week-end pour ce lancement ? » Votre base de connaissances contient trois documents :

- La politique en vigueur prévoit une assistance du lundi au vendredi. Le week-end exige une dérogation approuvée.
- Une proposition de lancement plus récente demande cette couverture ; son approbation est encore en attente.
- Le brouillon de l’annonce indique : « Nous assurerons une assistance le week-end. »

Une réponse qui cite l’annonce peut sembler bien étayée. Mais le brouillon répète précisément la promesse que vous cherchez à vérifier. Il ne peut pas l’autoriser.

La réponse utile serait : **« La couverture habituelle va du lundi au vendredi. La proposition fournie attend encore une approbation pour le week-end. Vérifie la dérogation approuvée avant de promettre cette assistance. »** Cela laisse aussi ouverte la possibilité qu’une approbation existe ailleurs, sans figurer dans cette collection.

Avant de modifier le prompt, identifie la proposition et l’annonce comme des brouillons et rends la politique en vigueur facile à reconnaître. La date de dernière modification ne dit pas au système quel document fait autorité.

## Trouve où la réponse a dérapé

La génération augmentée par récupération, généralement appelée RAG, recherche des informations dans vos contenus et transmet des passages pertinents à un modèle. Un document peut manquer dans la réponse parce que son texte n’a jamais été indexé, que la recherche l’a manqué ou que les mauvais passages ont été retenus. Le modèle peut aussi mal interpréter un passage qu’il a bien reçu.

Examine la réponse erronée à l’aide de ce tableau :

| Ce que tu constates | La prochaine action |
| --- | --- |
| Le document cité est périmé ou encore à l’état de brouillon | Identifie la source en vigueur et signale clairement l’ancienne version ou celle qui n’est pas approuvée. |
| Le bon document est téléversé, mais son texte n’est pas consultable par la recherche | Vérifie l’extraction et l’indexation. Un PDF scanné peut nécessiter une version avec du texte lisible. |
| Le bon texte est consultable, mais absent du contexte transmis | Examine la recherche et la sélection avec la question exacte qui a posé problème. |
| Le bon passage est présent, mais la réponse en change le sens | Teste l’interprétation du modèle à partir de ce passage, conditions et exceptions comprises. |
| Aucune source fournie ne tranche la question | Demande à la personne responsable. Une formulation plus fluide ne remplace pas la décision manquante. |

Conserve ensemble la question, la version de la source, le passage cité et la réponse. Si les passages transmis au modèle sont consultables, garde-les aussi. Les citations visibles ne montrent pas tout ce que le modèle a reçu : tu ne pourras donc pas toujours distinguer immédiatement un problème de recherche d’un problème d’interprétation.

C’est pourquoi il faut vérifier les citations et l’exactitude séparément. Le [benchmark de recherche ALCE](https://arxiv.org/abs/2305.14627) évalue les deux ; la présence d’une citation n’y suffit pas à prouver qu’une réponse est juste.

Dans Tale, stockage et indexation sont deux états distincts. Vérifie le statut d’indexation du document avant de tester sa réponse. Téléverser un autre fichier du même nom crée aussi une entrée séparée, sans remplacer l’ancienne. Consulte le [guide des documents](https://docs.tale.dev/fr/platform/knowledge/documents).

![Le contrôle des accès détermine les sources utilisables. Les passages retrouvés et leurs versions doivent ensuite étayer la réponse. Les mises à jour du contenu et des droits se vérifient séparément.](/blog/diagrams/fr/T05-diagram.svg)

## Reteste la décision, pas seulement la formulation

Après avoir corrigé la source ou la recherche, repose la question initiale dans une nouvelle conversation. Puis reformule-la. Dans l’exemple de l’assistance, « Le samedi est-il inclus ? » doit suivre la même politique que « Peut-on proposer une couverture le week-end ? »

Change ensuite les éléments disponibles : ajoute une dérogation approuvée pour ce lancement. La réponse doit alors changer. Un assistant qui refuse systématiquement l’assistance le week-end n’a pas non plus résolu le problème.

Garde ces cas pour pouvoir refaire ce petit test. Ajoute des questions réellement posées par tes collègues, dont une que les documents ne permettent pas de résoudre. Note la réponse attendue et sa source avant de lancer les essais. Tu pourras ainsi comparer autre chose que l’impression d’une réponse mieux rédigée.

Si la source évolue souvent, teste aussi une mise à jour : modifie un détail sans conséquence, laisse l’import et l’indexation habituels se terminer, puis pose une question à ce sujet dans une nouvelle conversation. Vérifie que la réponse utilise la nouvelle version. Ne suppose pas qu’une copie téléversée suit automatiquement son original.

## Vérifie les accès avant d’ajouter des documents

Quand une source manque, élargir les accès peut sembler une solution rapide. Établis d’abord si la personne qui pose la question est autorisée à l’utiliser.

Dans Tale, le chat d’un projet peut rechercher dans les fichiers de ce projet et les connaissances de l’organisation qui lui sont accessibles. Le chat de l’organisation ne recherche pas dans les fichiers des projets. Un agent de projet a aussi besoin des outils correspondants. Ces limites sont décrites dans la [présentation des connaissances](https://docs.tale.dev/fr/platform/knowledge/overview) et le [guide des fichiers de projet](https://docs.tale.dev/fr/platform/projects/manage-files).

Teste avec un compte membre ordinaire, pas seulement un compte administrateur. Vérifie le titre de la source, l’aperçu, la citation et le téléchargement, en plus de la réponse. Après un retrait d’accès, recommence dans une nouvelle conversation. Examine séparément les conversations et résultats existants, qui peuvent déjà contenir des informations copiées.

La [fiche de vérification des connaissances](/blog/worksheets/fr/T05-knowledge-acceptance.md) permet de noter la question problématique, sa source, la correction et le nouveau test. Pars d’une réponse erronée rencontrée par ton équipe. Corriger ce problème précis est plus utile qu’ajouter cent documents sans savoir ce qui manquait.
