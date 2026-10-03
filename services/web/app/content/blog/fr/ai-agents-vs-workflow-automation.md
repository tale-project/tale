---
title: "Agents IA ou automatisation : comment choisir"
description: "Choisis entre workflow défini, agent IA et approche hybride avec un exemple détaillé, une matrice de décision et des critères d’acceptation clairs."
slug: ai-agents-vs-workflow-automation
topicId: T03
reviewed: '2026-10-03'
draft: false
coverAlt: "Un parcours fixe et un parcours à embranchements convergent vers un livrable commun."
---

Un rapport mensuel peut suivre les bonnes étapes, calculer tous les totaux correctement et raconter malgré tout une histoire fausse. Huit retours mentionnent des problèmes de mise en route. Un agent transforme ce nombre en « 40 % des clients ont du mal à démarrer ». Le calcul peut être exact pour les retours fournis ; l’affirmation sur les clients n’est pas établie.

Choisir entre des agents IA et l’automatisation d’un workflow revient à décider où le système peut exercer son jugement. L’automatisation convient aux étapes dont les règles peuvent être définies à l’avance. Un agent devient utile lorsque les observations déterminent la prochaine action autorisée. De nombreux processus métier ont besoin des deux, mais chacun doit avoir une fonction précise.

**Garde les règles de calcul et les contrôles obligatoires explicites. Accorde à un agent une marge de décision pour une investigation délimitée dont les conclusions peuvent être vérifiées.** Avant d’accepter cette complexité supplémentaire, vérifie si une seule étape de modèle ou une personne traitant les exceptions suffirait.

## Séparer le déroulement du processus du contenu produit

Un workflow définit une séquence ou un ensemble d’embranchements. Il peut contenir du code classique, un appel à un modèle de langage, une intervention humaine ou un agent. Un agent peut choisir des actions, examiner leurs résultats et adapter l’étape suivante pour atteindre un objectif.

Le guide d’architecture d’Anthropic distingue les workflows prédéfinis des agents qui dirigent leur propre processus et leurs outils. Cette distinction concerne le contrôle du travail ; elle ne transforme pas chaque appel à un modèle en agent. [Lis Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

Deux propriétés se confondent facilement. Un contrôleur peut toujours exécuter la classification avant la synthèse. La classification elle-même peut néanmoins varier ou être erronée. L’exemple ADK de Google illustre cette distinction avec un contrôleur séquentiel exécutant des sous-agents IA ; sa documentation signale aussi les changements des structures de workflow dans les versions plus récentes d’ADK. [Consulte l’explication du contrôleur séquentiel](https://adk.dev/agents/workflow-agents/sequential-agents/).

De même, un agent n’a pas besoin de contrôler tout le processus. Il peut examiner une anomalie et rapporter des preuves tandis que les étapes définies conservent la responsabilité de la validation, des totaux, des modifications d’enregistrements et de la diffusion. L’architecture doit montrer où l’incertitude apparaît, où une marge de décision est utile et où une réponse incorrecte est détectée.

![Un workflow suit des étapes fixes. Un agent observe, choisit et utilise des outils en boucle. Une approche hybride valide les entrées, exécute une tâche d’agent délimitée et examine le résultat.](/blog/diagrams/fr/T03-diagram.svg)

## Exemple illustratif : commencer par des retours aux totaux vérifiés

Supposons qu’une équipe reçoive un export mensuel et veuille savoir si la mise en route mérite une investigation. Tous les enregistrements et nombres de cet exemple sont fictifs.

L’export contient 22 lignes. Deux reprennent un identifiant de retour déjà présent. Selon la règle convenue par l’équipe, une seule ligne par identifiant est conservée, soit 20 retours distincts. Chaque retour conservé possède une catégorie principale existante. Le mois précédent compte lui aussi 20 retours distincts selon les mêmes règles.

| Catégorie principale | Mois précédent | Mois actuel |
| --- | ---: | ---: |
| Mise en route | 4 | 8 |
| Facturation | 6 | 5 |
| Fiabilité | 5 | 4 |
| Autres | 5 | 3 |
| Total | 20 | 20 |

Le calcul est simple. La part de la mise en route dans les retours enregistrés passe de `4 / 20 = 20%` à `8 / 20 = 40%`, soit une hausse de 20 points de pourcentage. Le nombre de retours sur la mise en route a doublé. Aucune de ces affirmations n’établit que deux fois plus de clients ont rencontré un problème : un client peut soumettre plusieurs retours distincts et la collecte peut avoir changé.

Un workflow défini peut valider les identifiants, appliquer la règle convenue sur les doublons, vérifier les catégories, calculer les totaux et conserver la trace des lignes exclues. Un agent ne doit pas décider discrètement que deux identifiants différents « ressemblent à des doublons », modifier les catégories ou remplacer le dénominateur par le nombre de clients. Ces changements modifient la mesure.

Les règles elles-mêmes peuvent être inadéquates. Si deux lignes ont le même identifiant mais des textes contradictoires, le workflow a besoin d’un traitement explicite de cette exception. Une exécution déterministe appliquant fidèlement une mauvaise règle produit tout de même un mauvais résultat. Le responsable doit décider comment traiter ces versions contradictoires avant d’accepter les totaux.

## Décider si une investigation est réellement nécessaire

Le responsable du rapport peut maintenant formuler trois demandes. Chacune appelle une conception différente.

| Demande réelle | Organisation minimale plausible | Qu’est-ce qui justifierait plus de marge de décision ? |
| --- | --- | --- |
| Rapporter les totaux des catégories convenues | Validation, calcul et modèle de rapport définis | Rien dans cette demande n’exige une investigation ouverte |
| Résumer les huit retours fournis sur la mise en route | Une étape de modèle avec références aux sources et revue | Le dossier ne répond pas à la question et d’autres preuves sont disponibles |
| Examiner les raisons possibles du changement | Investigation délimitée par un agent ou une personne | Chaque découverte détermine la prochaine source autorisée à examiner |

Pour la troisième demande, supposons qu’une première lecture relève trois retours sur les invitations, deux sur l’authentification unique, deux sur l’import et un retour peu clair. Ce sont des annotations proposées pour les huit enregistrements, pas de nouvelles catégories officielles du rapport.

Les retours sur les invitations conduisent à la référence fournie sur les permissions. Ceux sur l’authentification renvoient à une note de version approuvée. Les plaintes sur l’import concernent des formats de fichiers différents. Une seule grande catégorie peut contenir plusieurs raisons sans rapport entre elles. Un agent pourrait être utile ici, car les premières preuves déterminent ce qu’il faut vérifier ensuite. Si tous les éléments nécessaires se trouvaient déjà dans un court dossier, un seul appel d’analyse suivi d’une revue pourrait accomplir le même travail.

N’autorise pas de modifications externes simplement parce que l’investigation nécessite plusieurs outils. Lire le corpus de référence autorisé et proposer des explications est une mission complète et utile. Modifier des fiches clients ou publier une annonce sur la cause racine relève d’une décision distincte.

## Exiger une explication qui résiste à la contradiction

Une explication proposée doit inclure des preuves susceptibles de la réfuter. Voici une partie remplie d’un résultat d’investigation :

| Constat proposé | Preuves à l’appui | Limite ou preuve contraire | Décision |
| --- | --- | --- | --- |
| Les instructions d’invitation méritent un examen | Trois retours fournis mentionnent qui peut inviter un collègue | Aucun changement de permission ou de documentation vérifié pour le moment | Ouvrir un audit délimité des instructions |
| Une version concernant l’authentification a causé la hausse | Deux retours mentionnent l’authentification ; une note de version date du même mois | La proximité temporelle n’établit pas la causalité ; environnements des retours non vérifiés | Ne pas présenter la cause comme établie |
| Tous les retours sur la mise en route décrivent un seul problème | Catégorie principale commune | Les sujets d’import, d’invitation et d’authentification diffèrent | Rejeter la synthèse à cause unique |

Un rapport défendable peut maintenant dire : « La mise en route représente huit des 20 retours enregistrés ce mois-ci, contre quatre sur 20 auparavant. Les commentaires indiquent plusieurs sujets. Les instructions d’invitation méritent une vérification ciblée ; les preuves fournies n’établissent pas de cause commune. »

Cette formulation donne au responsable une prochaine action sans prétendre que l’export répond à une autre question. L’investigation a amélioré la décision en réduisant l’incertitude, même sans produire un diagnostic spectaculaire.

Conserve les lignes originales et le tableau de totaux accepté. Place les annotations dans un document séparé avec les identifiants sources. Si le responsable approuve ensuite de nouvelles catégories, recalcule la comparaison concernée selon la nouvelle règle et présente-la comme une analyse révisée. Ne mélange pas anciennes et nouvelles définitions dans une même tendance.

## Fixer la limite dans le contrat du processus

Dans cet exemple, le choix est hybride : des étapes définies produisent le tableau de totaux ; une investigation délimitée examine les retours sur la mise en route ; une personne revoit l’interprétation proposée. Ce choix découle des exigences exposées, pas d’une supériorité mesurée.

La limite peut tenir dans un contrat court :

> Examine les huit retours fournis sur la mise en route à l’aide des corpus autorisés de références produit et de notes de version. Retourne les explications proposées avec les identifiants des retours, les passages à l’appui, les preuves contraires et les faits manquants. Préserve le tableau de totaux accepté. Interroge le responsable si la réponse nécessite des données de compte indisponibles. Ne modifie pas les enregistrements et ne diffuse pas les conclusions.

Le workflow vérifie que chaque retour cité appartient aux entrées autorisées et que les champs requis du résultat existent. Le réviseur vérifie si les preuves étayent réellement l’interprétation. Une réponse structurée valide prouve que le résultat peut être analysé par le programme ; elle ne prouve pas que l’explication est vraie.

Délimite l’investigation par les outils disponibles, les questions, le temps ou le nombre de tentatives, et un résultat incomplet utile. Si la note de version pertinente est inaccessible, « impossible de vérifier l’hypothèse liée à la version » est acceptable lorsque la source manquante et sa conséquence sont explicites. Une référence inventée est un échec.

La [fiche de décision du processus](/blog/worksheets/fr/T03-process-decision.md) consigne ces invariants et sépare les règles connues, les interprétations proposées et les effets autorisés. Elle demande aussi ce qui ferait changer le choix d’architecture. Ici, une analyse récurrente stable n’exigeant plus de recherche adaptative pourrait devenir un workflow plus simple. Une tâche dont l’explication n’est pas vérifiable en pratique peut demander une investigation humaine plutôt qu’un agent plus élaboré.

## Tester l’acceptation répétée, pas seulement finir par réussir

Une démonstration sans accroc ne dit pas si le système se comporte de façon constante. La recherche originale τ-bench évalue des agents utilisant des outils dans des interactions de service client simulées et distingue réussir au moins une fois de réussir sur plusieurs tentatives répétées. Les utilisateurs simulés et les domaines simplifiés limitent la transposition à un vrai processus de rapport, mais la distinction est utile. [Lis la méthode et les limites du benchmark](https://arxiv.org/html/2406.12045v1).

L’article note aussi qu’un état final correct de la base de données peut masquer une violation de politique, comme agir sans confirmation. Les contrôles obligatoires ont donc besoin de leurs propres vérifications.

Pour le processus de retours, garde des cas ordinaires et des cas volontairement difficiles : identifiants dupliqués aux contenus contradictoires, catégorie manquante, référence indisponible et texte suggérant plusieurs explications. Définis l’acceptation avant le test. Les totaux doivent se recouper ; le périmètre doit rester fixe ; l’incertitude doit apparaître dans le rapport ; les modifications interdites ne doivent pas avoir lieu.

Répète certains cas depuis le même état initial réinitialisé, avec les mêmes règles d’acceptation. Consigne chaque tentative valide, y compris les échecs et dépassements de délai. Sépare l’acceptation au premier passage de l’acceptation après correction. « Une tentative sur cinq a produit un rapport utilisable » et « les cinq ont produit des rapports utilisables » sont des observations différentes. Ne transforme aucun de ces petits échantillons en garantie de fiabilité en production.

Compare un workflow, une seule étape de modèle et un agent uniquement lorsque chacun peut satisfaire la demande réelle. Une référence qui ne fait que compter ne peut pas répondre à une question d’investigation ; une investigation ne doit pas être valorisée simplement parce qu’elle produit plus de texte. Évalue le résultat utile à la décision et consigne le travail supplémentaire nécessaire à son acceptation.

## Choisir selon le travail total, puis appliquer la conception dans Tale

Compte la préparation humaine, la revue, les corrections et la maintenance aux côtés du temps machine et des coûts mesurés. Si l’agent demande de lourdes reprises manuelles chaque mois, cette charge appartient à la comparaison. S’il apporte régulièrement une investigation utile que le rapport fixe ne peut pas fournir, l’effort supplémentaire peut se justifier. Les coûts manquants restent non mesurés, pas nuls.

Les concepts d’automatisation de Tale distinguent les nœuds `llm` en un appel des nœuds `agent` pour les travaux impliquant des outils, des fichiers ou plusieurs tours. Les tâches de projet accueillent les livrables attribués et leur revue. Ces éléments permettent de donner des limites différentes aux étapes du rapport et à l’investigation. [Lis les concepts d’automatisation](https://docs.tale.dev/fr/platform/automations/concepts).

Pour une [démo Tale](/fr/request-demo), apporte le petit export, les règles de comptage acceptées et l’explication causale non étayée. Demande à voir comment la conception choisie préserve le tableau, remet l’explication en question et retourne un résultat que quelqu’un peut accepter. Ces observations t’en diront davantage que le nom de l’architecture.
