---
title: "Ce qu’un agent IA doit savoir pour reprendre le travail"
description: "Prépare une transmission utile à la prochaine session IA : les fichiers à garder, les hypothèses qui ont changé et la prochaine action à mener."
slug: persistent-ai-agent-workspaces-handoffs
topicId: T04
reviewed: '2026-10-03'
draft: false
coverAlt: "Un dossier traverse un pont bleu entre deux plateaux de travail distincts."
---

Pour qu’un agent reprenne une session précédente, conserve plus que la conversation. Laisse l’objectif actuel, les fichiers à utiliser, le travail terminé, les questions ouvertes et la prochaine action utile. Demande à la session suivante de vérifier cette transmission avant de poursuivre.

Conserver les fichiers évite de perdre le travail. Cela ne dit pas au prochain agent si la conclusion d’hier répond encore à la question d’aujourd’hui. Une courte note de transmission rend cette différence visible.

## Vérifie ce que la prochaine session peut ouvrir

Avant de t’arrêter, place le travail là où la prochaine session ou le prochain agent pourra y accéder. Précise les versions des fichiers. Garde la consigne actuelle à côté, surtout si les instructions ont changé en cours de travail.

Les fichiers, les commentaires de tâche, l’historique de conversation et le contenu actuellement accessible au modèle sont des choses distinctes. Un rapport enregistré peut subsister même si une conversation repart de zéro. Une conversation conservée peut encore contenir une consigne périmée. « Il s’en souvient » ne suffit pas comme plan de transmission.

Dans Tale, les agents de projet réutilisent un espace de travail persistant, mais la reprise de conversation dépend de l’environnement d’exécution. Gemini CLI démarre une nouvelle conversation à partir de l’espace de travail conservé. Vérifie le fonctionnement de ta configuration dans le [guide des environnements d’exécution](https://docs.tale.dev/fr/platform/agents/harnesses).

![Les références du projet, le suivi des tâches, les fichiers, l’historique de conversation et le contexte actif du modèle assurent chacun une partie de la continuité. Une transmission explicite indique au prochain agent ce qu’il doit vérifier et utiliser.](/blog/diagrams/fr/T04-diagram.svg)

Si tu confies la suite à un autre agent, vérifie ses accès au lieu de supposer qu’il partage l’espace de travail du premier. Joins les documents nécessaires au projet partagé ou fournis des liens accessibles. Un chemin dans le répertoire privé de quelqu’un d’autre n’est pas une transmission exploitable.

## Laisse une note qui oriente la prochaine action

Prenons l’exemple d’une comparaison de fournisseurs. La consigne B2 demandait des outils pour cinq personnes. La première session a produit un registre des sources, des notes sur les fonctionnalités et une recommandation. Le responsable du projet a ensuite donné la consigne B3 : l’équipe comptera 50 personnes et l’authentification unique est obligatoire.

« Le fournisseur A semble le meilleur ; termine le rapport » enverrait le prochain agent dans la mauvaise direction. Une transmission utile précise ce qui reste valable :

| Élément à transmettre | Exemple rempli |
| --- | --- |
| Objectif actuel | Comparer les candidats existants pour 50 personnes avec authentification unique obligatoire, selon la consigne B3 |
| Fichiers à ouvrir | Consigne B3, registre des sources r4, notes sur les fonctionnalités de A et B, recommandation r2 ; joindre les fichiers ou des liens accessibles |
| Travail à conserver | Registre des sources et notes sur les fonctionnalités comme point de départ, avec leurs références |
| Travail qui ne répond plus à la demande | La recommandation r2 et l’estimation pour cinq personnes ont été préparées selon B2 |
| Preuves manquantes | Quelles offres comprennent l’authentification unique requise et combien elles coûtent pour 50 personnes |
| Prochaine action | Vérifier les sources sur les offres et fonctionnalités des candidats existants, puis recalculer le coût et revoir la recommandation |
| S’arrêter et demander | Une source nécessaire est inaccessible ou ne permet pas de savoir si un candidat répond aux exigences |

Cette note évite au prochain agent de refaire toute la recherche. Elle l’empêche aussi de peaufiner une recommandation qui n’est plus étayée. D’autres fournisseurs deviennent pertinents si les candidats existants ne satisfont pas aux exigences de B3 ; inutile d’allonger la liste avant de les avoir vérifiés.

Tu peux adapter la [fiche de transmission](/blog/worksheets/fr/T04-handoff.md) à ton projet. Pour une petite tâche, l’exemple rempli ci-dessus peut suffire.

## Vérifie la transmission avant de reprendre

Donne la note à la prochaine session avec cette consigne :

> Lis la consigne actuelle et ouvre les fichiers indiqués. Dis-moi ce qui reste utilisable, ce qui doit être revérifié et quelle sera ta première action. Si la transmission contredit la consigne actuelle, signale la différence avant de continuer.

Dans l’exemple, une première réponse utile reconnaît B3 comme la consigne actuelle, met de côté l’ancienne recommandation et vérifie l’authentification unique ainsi que les conditions des offres. Elle ne doit ni effacer les recherches antérieures ni considérer chaque affirmation enregistrée comme encore actuelle.

Vérifie à nouveau les conclusions touchées par le changement. Un calcul de prix pour cinq personnes doit être remplacé ; une note datée sur un ancien entretien client peut rester utile comme témoignage historique. Si le rapport précédent ne cite pas ses sources, une vérification plus large peut être nécessaire, car le prochain agent ne peut pas relier les affirmations aux hypothèses qui les soutiennent.

Précise aussi ce que signifie « terminé ». Un fichier nommé `final.md` peut encore être un brouillon non relu. Indique si le travail est proposé, vérifié ou accepté, pour que la prochaine session ne transforme pas un document de travail en conclusion approuvée.

## Note les actions incertaines avant de les retenter

Une question s’ajoute si la session précédente pouvait modifier un système externe : l’action tentée a-t-elle abouti ?

Si l’agent a essayé de créer un ticket mais a perdu la réponse, note « création du ticket non confirmée », avec l’identifiant de la requête et le système destinataire. Vérifie ce système avant de réessayer. L’absence de confirmation ne prouve pas que rien ne s’est passé.

Pour une recherche en lecture seule, indique simplement qu’aucune écriture externe n’a été tentée. Garde la transmission assez courte pour qu’elle soit utilisée. Elle remplit son rôle quand le prochain agent peut ouvrir les bons documents, écarter une hypothèse périmée et avancer sans te demander de reconstituer la session précédente.
