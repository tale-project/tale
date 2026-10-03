---
title: "IA et contrôle humain : revues et approbations"
description: "Place des contrôles utiles dans le travail des agents IA. Distingue questions, revue des résultats et approbation des actions, avec une fiche pratique."
slug: human-in-the-loop-ai-agent-workflows
topicId: T02
reviewed: '2026-10-03'
draft: false
coverAlt: "Trois objets distincts représentent une question, un résultat examiné et un contrôle avant action."
---

Un agent prépare une annonce pour le support et quelqu’un clique sur « approuver ». Qu’a établi l’équipe ? Peut-être que le message est exact. Peut-être seulement que la personne avait accès au bouton. Peut-être qu’un message correct peut être envoyé à la mauvaise audience.

Un workflow d’IA avec intervention humaine place des personnes à certains points de décision. La difficulté consiste à choisir ces points et à leur confier une décision qu’elles peuvent réellement améliorer. **Un contrôle mérite l’attention d’une personne lorsqu’elle apporte une autorité manquante, des connaissances pertinentes ou un jugement que le processus ne peut pas fournir correctement autrement.** Exiger un clic ne prouve aucun de ces apports.

Ce guide examine une annonce à corriger, une proposition d’envoi à refuser et une file de revue qui n’arrive pas à suivre. Chaque échec demande une réponse différente.

## Donner un seul sens à chaque contrôle

Trois décisions portent souvent la même étiquette « approbation », alors que leurs conséquences diffèrent.

| Interaction | Décision | Conséquence |
| --- | --- | --- |
| Question | Quel fait ou quelle préférence manquante s’applique ? | L’intervenant peut utiliser cette information |
| Revue du résultat | Ce livrable précis respecte-t-il ses critères ? | Accepter le travail ou demander des modifications |
| Approbation d’action | Cette opération précise peut-elle avoir lieu ? | Permettre une tentative ou l’empêcher |

La distinction a un effet concret. Répondre « utilise le processus du support régional » n’accepte pas la description que l’agent en produira. Accepter une annonce n’approuve pas tous ses destinataires possibles. La permission d’envoyer ne prouve pas la livraison.

Les frameworks mettent ces décisions en œuvre différemment. Le middleware d’intervention humaine de LangChain documente par exemple des décisions configurables autour d’appels d’outils interrompus. Les réponses disponibles sont des détails d’implémentation à vérifier, pas des significations universelles du bouton d’approbation. [Consulte la documentation du middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop).

Écris la décision en une phrase avant de concevoir l’interface : « Ce workflow peut-il envoyer la révision 3 de l’annonce au groupe de test du support régional ? » Si cette phrase ne peut pas nommer le contenu et la conséquence, le contrôle est trop vague pour être examiné de façon fiable.

![Trois contrôles distincts : les questions apportent des informations, la revue des résultats accepte le travail ou demande des modifications, et l’approbation d’action permet ou refuse une opération précise. La permission ne prouve pas la réussite de l’exécution.](/blog/diagrams/fr/T02-diagram.svg)

## Exemple illustratif : refuser le bon élément

Le scénario de mise à jour de service suivant utilise des documents et des destinations inventés. Il illustre une méthode de revue, pas un déploiement mesuré.

Un responsable de processus a approuvé la note P-17 : à partir de lundi, l’équipe de support régional doit transmettre au responsable de permanence les problèmes d’accès non résolus. Un agent rédige la révision 2 de l’annonce. L’équipe prévoit de tester la diffusion en interne avant d’envisager une audience plus large.

Voici la partie substantielle du premier dossier de revue :

| Champ du dossier | Exemple rempli |
| --- | --- |
| Décision demandée | Accepter l’annonce r2 comme mise à jour exacte du processus régional |
| Affirmation proposée | « Toutes les équipes de support doivent transmettre immédiatement les problèmes d’accès » |
| Preuve faisant référence | P-17 : équipe régionale ; problèmes d’accès non résolus ; application lundi |
| Critères | Préserver l’audience, la condition de transmission et la date d’application |
| Constat du réviseur | Périmètre élargi ; condition « non résolus » supprimée ; date omise |
| Décision | Demander la correction de ces trois éléments |

Le réviseur n’a pas besoin d’un score de confiance du modèle pour repérer le problème. Comparer la phrase proposée à la note de référence le révèle. Les changements comptent : le brouillon élargit les personnes concernées, les cas admissibles et la date de début du processus.

La révision 3 rétablit les trois conditions. Le réviseur peut maintenant accepter son exactitude. Il reste toutefois une décision de diffusion distincte. Supposons que la proposition d’envoi désigne `all-support` au lieu du groupe prévu `regional-support-test`. La bonne réponse consiste à refuser cette opération. Réexaminer le texte accepté ne corrigerait pas la destination.

Après correction, la nouvelle proposition identifie la révision 3 et le groupe de test prévu. La personne vérifie l’identité réelle du groupe ou les preuves de sa composition auxquelles elle a accès, plutôt que de se fier au mot rassurant « test ». L’approbation permet alors la tentative. Une erreur de livraison est consignée comme un échec d’exécution, pas comme la preuve que la décision précédente de la personne a été refusée.

Cette séquence donne un but à chaque intervention. La question précise le périmètre ; la revue corrige le sens ; la décision d’action limite la diffusion ; la vérification du résultat constate l’exécution.

## Une personne peut apporter une autorité sans améliorer l’exactitude

Certaines décisions nécessitent une personne parce que l’organisation lui réserve l’autorité. D’autres contrôles existent parce qu’on attend d’elle qu’elle détecte des erreurs. Ces justifications diffèrent et demandent des preuves différentes.

Une méta-analyse de 2024 couvrant 106 expériences constate qu’en moyenne, les combinaisons humain–IA font mieux que les humains seuls, mais moins bien que la meilleure des deux conditions humain seul ou IA seule. Elle inclut des études publiées jusqu’en juin 2023 et exige les trois conditions de comparaison. Elle ne permet donc pas d’établir les performances d’un workflow actuel de revue d’agents, ni de décider si une autorisation obligatoire doit être supprimée. [Lis l’article final et sa méthode](https://www.nature.com/articles/s41562-024-02024-1).

La difficulté pratique est de nommer la contribution humaine. Dans l’exemple de l’annonce, le responsable du processus sait quelle règle fait référence. Le réviseur factuel compare le brouillon à cette règle. La personne qui autorise la diffusion contrôle l’audience prévue. Attribuer les trois fonctions à la première personne disponible laisserait ces contributions sans fondement.

Quand l’exactitude est l’objectif, donne au réviseur des preuves qui lui permettent de contester. Un raisonnement généré par l’agent peut aider à parcourir le dossier, mais ne remplace pas les documents sous-jacents. Pour les affirmations à conséquences, demande au réviseur d’identifier la condition pertinente dans la source avant d’accepter la formulation proposée. C’est notre recommandation de conception, pas l’affirmation qu’une interface donnée a été validée.

Une étude de Buçinca et ses collègues constate qu’une interaction plus réfléchie peut réduire la confiance excessive tout en recevant des évaluations moins favorables des utilisateurs. Ce résultat invite à examiner la qualité des décisions et la charge de revue ; il ne justifie pas d’ajouter des obstacles partout. [Lis l’expérience de 2021](https://arxiv.org/abs/2102.09692).

## Consacrer l’attention là où elle peut changer le résultat

L’absence d’une date obligatoire peut souvent être détectée automatiquement. Déterminer si « non résolu » garde le même sens dans une règle révisée exige une interprétation. Déterminer si un message peut être envoyé à une audience donnée nécessite l’autorité appropriée et des preuves actuelles sur la destination.

Utilise des vérifications automatiques pour éliminer le travail de revue évitable avant l’arrivée du dossier. Elles peuvent refuser des champs manquants, détecter une révision modifiée ou vérifier un identifiant de destination autorisé lorsque les règles sont explicites. Elles ne peuvent pas établir que chaque phrase valide préserve le sens voulu.

Dans cet exemple, une répartition utile serait :

| Vérification | Approche de départ | Raison |
| --- | --- | --- |
| Présence des champs obligatoires du dossier | Validation définie | La structure requise est connue |
| Préservation des conditions de P-17 dans l’annonce | Revue du fond | Une reformulation fluide peut changer le sens |
| Destination conforme à l’audience autorisée | Vérification de l’identifiant exact et autorisation appropriée | Un contenu correct ne règle pas la question de la diffusion |
| Livraison effectivement réalisée | Preuve d’exécution | L’approbation seule ne peut pas établir un effet |

Ce choix doit évoluer avec la tâche. Un changement réversible de mise en forme interne peut demander un contrôle par échantillonnage et une correction facile plutôt qu’une approbation individuelle. Un message créant un nouvel engagement de service peut nécessiter un responsable qualifié, même si sa grammaire, ses références et sa destination sont correctes. Les approbations obligatoires de l’organisation restent obligatoires ; réduire le volume de revue n’autorise pas en soi leur suppression.

## Vérifier si la capacité de revue suffit

Un fonctionnement qui attribue chaque proposition à une personne déjà occupée risque simplement de déplacer le goulot d’étranglement.

Prenons un calcul de capacité illustratif. Supposons que 24 nouvelles propositions arrivent chaque jour ouvré, que chaque revue dure quatre minutes et que le réviseur dispose de 60 minutes par jour pour ce travail. Ignorons d’abord les reprises et la variabilité.

Le travail entrant demande `24 × 4 = 96 minutes`. Le temps disponible couvre `60 ÷ 4 = 15 revues`. Selon ces hypothèses, neuf propositions restent non examinées chaque jour ; après cinq jours, le retard supplémentaire atteint 45 propositions. C’est un calcul sur des entrées inventées, pas une prévision des délais d’attente réels. Des arrivées variables, des cas plus complexes et des revues répétées exigeraient des mesures supplémentaires.

L’organisation doit prévoir une réponse avant que la file ne devienne urgente. L’équipe peut réduire les propositions inutiles, corriger les défauts récurrents des dossiers, prévoir des personnes qualifiées supplémentaires ou réduire le pilote. Regrouper quelques décisions similaires peut réduire le temps de préparation répété, mais le dossier doit préserver les exceptions et le périmètre de chaque décision. Accepter automatiquement les demandes en retard changerait la politique d’autorisation ; cela ne remédie pas à un manque de capacité.

Mesure le rythme d’arrivée et le temps réel de traitement pendant le pilote. Suis les demandes de modification autant que les approbations : une proposition qui revient trois fois consomme de la capacité trois fois. L’objectif est un processus de revue que les personnes peuvent exécuter attentivement avec la charge attendue.

## Rattacher les décisions aux versions et prévoir la reprise

Un compte rendu de revue doit identifier exactement ce qui a été examiné. « Approuvé mardi » ne suffit pas si quelqu’un a changé l’audience mercredi.

Pour l’annonce, une correction ultérieure de formulation peut nécessiter une nouvelle revue du contenu tout en conservant l’audience vérifiée. Un changement de destination exige une nouvelle décision d’action, même si le contenu reste accepté. Une nouvelle note de processus peut invalider la revue factuelle. Consigne la décision concernée et la raison de son réexamen ; évite à la fois la réutilisation générale d’une approbation et la répétition inutile de contrôles sans rapport.

L’absence de preuves est un résultat valable. Le réviseur peut répondre « impossible de décider : composition du groupe indisponible », en désignant un responsable de l’entrée manquante. L’opération doit alors rester non approuvée. De même, un réviseur qui n’a pas l’expertise nécessaire doit transmettre la décision à une personne qualifiée plutôt que de confondre accès au système et compétence.

Le [modèle de dossier de revue](/blog/worksheets/fr/T02-review-packet.md) sépare la décision demandée, les preuves susceptibles de la modifier, la révision, l’autorité et l’effet observé. Ses champs de capacité aident à vérifier si le fonctionnement prévu est soutenable.

## Appliquer cette distinction dans Tale

La documentation de Tale distingue les résultats de tâches soumis à revue, les questions des workflows et les approbations d’écriture des Connectors. Pour une tâche de projet, place les critères d’acceptation à côté du livrable afin que le réviseur puisse examiner le travail. Une exécution réussie ne suffit pas à décider de l’acceptation. [Lis la documentation sur la délégation et la revue](https://docs.tale.dev/fr/platform/projects/task-automation).

Pour une écriture proposée via un Connector, la carte d’approbation documentée affiche l’entrée sans permettre de la modifier. Un refus empêche l’opération et fait échouer l’exécution ; corriger le workflow ou l’entrée demande une nouvelle exécution. [Consulte les workflows en attente](https://docs.tale.dev/fr/platform/automations/approvals-in-workflows).

La personne désignée par le métier pour approuver est également distincte des accès à la plateforme. Le guide public de Tale indique que les approbations de Connector ne sont pas acheminées vers un groupe d’approbateurs nommé. Les propriétaires, admins et développeurs peuvent ouvrir le détail d’une exécution ; toute personne pouvant ouvrir une tâche peut décider sur les cartes qui lui sont rattachées. Fais correspondre le comportement d’accès documenté à la responsabilité exigée par ton processus. [Lis les concepts d’approbation d’opérations](https://docs.tale.dev/fr/platform/approvals/concepts).

L’approbation de Connector suit un chemin de contrôle défini. Ne suppose pas qu’elle intercepte toutes les actions possibles via les outils directs de la sandbox ou les identifiants accordés. Examine ces chemins d’accès lors de la configuration du processus. [Consulte les limites des runtimes et des identifiants](https://docs.tale.dev/fr/platform/agents/harnesses).

Pour une [démo Tale](/fr/request-demo), apporte l’annonce incorrecte, sa révision corrigée et la proposition avec la mauvaise destination. Une démonstration utile doit rendre les trois décisions distinctes et conserver assez de preuves pour expliquer ce qui s’est passé après chacune.
