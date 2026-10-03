---
title: "Ton projet pilote d’IA fait-il gagner du temps ?"
description: "Compare un pilote d’IA au processus actuel selon les résultats utilisables et le temps de préparation, de vérification et de correction. Exemple à l’appui."
slug: evaluate-ai-agents-business-tasks
topicId: T08
reviewed: '2026-10-03'
draft: false
coverAlt: "Trois rapports témoins sont comparés au même cadre de mesure."
---

Un pilote d’IA fait gagner du temps si ton équipe en passe moins pour obtenir un résultat qu’elle peut utiliser. Un brouillon produit en deux minutes peut encore demander une heure de vérification. Cette heure compte dans le bilan, tout comme la préparation, les corrections, les tentatives ratées et le travail que quelqu’un doit terminer à la main.

Choisis une tâche récurrente et compare le processus complet à la façon dont ton équipe la traite aujourd’hui. Garde la même exigence de qualité. Tu cherches à savoir si le travail devient moins lourd, pas seulement si l’agent produit quelque chose rapidement.

## Définis avec l’équipe ce qui rend un résultat utilisable

Choisis un livrable que l’équipe sait déjà évaluer : un brief de campagne, une synthèse de support ou un rapport hebdomadaire. Avant le pilote, note les quelques conditions qui le rendent utilisable.

Pour un brief de campagne, tu pourrais exiger des affirmations produit étayées, un problème précis du public visé, deux options de message distinctes et des lacunes clairement signalées. Un brief qui présente une fonctionnalité en pilote privé comme « disponible pour tous » échoue, même s’il est très bien écrit. Celui qui indique correctement que sa disponibilité reste inconnue peut satisfaire les critères.

Demande à une personne d’appliquer ces critères à quelques exemples. Si deux personnes ne sont pas d’accord sur ce qui compte, tranchez avant de comparer les scores. Un modèle peut signaler des problèmes, mais confronte ses jugements à ceux d’une personne qui connaît la tâche. [Le guide d’Anthropic sur l’évaluation des agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) recommande de calibrer l’évaluation par modèle sur le jugement d’experts humains.

## Compare un travail équivalent

Utilise des tâches représentatives de ce que tu souhaites déléguer, y compris des cas difficiles et des informations manquantes. Donne au processus actuel et au processus assisté par IA des entrées et des délais équivalents. Conserve les versions des sources pour pouvoir expliquer les écarts ensuite.

Évite qu’une personne réalise une tâche manuellement, puis la refasse avec l’IA alors qu’elle a encore tous les détails en tête. Fais travailler des personnes différentes avec chaque méthode, ou utilise des missions comparables. Note les différences de difficulté. Un petit pilote ne pourra pas isoler chaque cause de variation, mais il ne devrait pas avantager manifestement une méthode.

Décide du volume de corrections autorisé. Si le processus prévu comprend une vérification et des réparations par une personne, teste ce processus et compte le travail effectué. Garde le premier résultat à part pour que les améliorations humaines ne passent pas pour de la précision de l’agent.

## Compte le travail qui suit le brouillon

Relève le temps de travail actif à quatre étapes : préparer les entrées, superviser l’exécution, vérifier le résultat et le rendre utilisable. Inclus les tentatives ratées. Une collègue qui réécrit le brief travaille elle aussi sur le pilote.

Compte l’attente séparément. Dix minutes de vérification représentent du travail ; un résultat qui attend cette vérification pendant deux jours subit un retard de livraison. Les deux peuvent compter, mais les additionner rend le bilan plus difficile à interpréter.

![Compare les résultats utilisables, le travail de vérification, les coûts couverts et le délai de livraison, avec des entrées équivalentes et les mêmes critères d’acceptation.](/blog/diagrams/fr/T08-diagram.svg)

Voici une comparaison fictive portant sur dix briefs de campagne. Les deux méthodes livrent les dix briefs au même niveau de qualité convenu. Avec l’IA, deux briefs doivent être terminés manuellement ; ce travail est inclus dans le temps de correction.

| Travail humain pour dix briefs utilisables | Processus actuel | Processus assisté par IA |
| --- | --- | --- |
| Préparer les entrées | 40 minutes | 60 minutes |
| Rechercher et rédiger, ou superviser activement l’agent | 260 minutes | 30 minutes |
| Vérifier les résultats | 60 minutes | 100 minutes |
| Corriger ou terminer le travail | 40 minutes | 70 minutes |
| Temps de travail actif total | 400 minutes | 260 minutes |
| Temps actif par brief utilisable | 40 minutes | 26 minutes |

Avec ces hypothèses, l’équipe économise 140 minutes sur dix briefs, soit 14 minutes par brief. La vérification prend plus de temps avec l’IA, mais l’ensemble du processus demande moins de travail humain. Si la vérification et les corrections absorbaient tout le temps de rédaction économisé, la rapidité de génération ne suffirait pas à faire du pilote une réussite.

Ce tableau ne démontre ni un gain financier ni une livraison plus rapide. Ajoute les frais de modèles et d’outils, les abonnements et les éventuels coûts d’infrastructure supplémentaires avant d’annoncer une économie. Dans Tale, les [statistiques d’utilisation](https://docs.tale.dev/fr/platform/admin/governance/usage-analytics) montrent l’usage enregistré par l’application ; elles ne constituent pas une facture complète du fournisseur.

## Garde visibles les tâches inachevées et les erreurs graves

L’exemple aboutit à dix briefs utilisables de chaque côté. Ce ne sera pas forcément le cas de ton pilote. Si l’agent produit sept briefs utilisables et en abandonne trois, indique les dix tentatives, tout le temps consacré et les trois tâches restantes. Diviser par dix ferait comme si chacune avait produit de la valeur. Diviser par sept sans montrer le travail inachevé masquerait le fait qu’une partie des tâches reste à faire.

Examine les échecs avant de te fier à une moyenne. Un agent qui demande une précision pose un autre problème qu’un agent qui invente une source ou envoie un message sans autorisation. Si une erreur grave rend le workflow inacceptable, un gain de temps ailleurs ne la compense pas.

Répète aussi certaines tâches. Un bon résultat isolé ne dit pas si le même processus sera fiable la semaine prochaine. Tu n’as pas besoin d’un banc d’essai complexe pour commencer, mais tu dois savoir si le premier succès était inhabituel.

## Décide précisément de la suite

Utilise le pilote pour repérer où le processus aide et où il crée encore du travail. Tu pourrais poursuivre avec les briefs dont les sources sont complètes et garder les recherches ambiguës dans l’équipe. Tu pourrais corriger une erreur récurrente dans les affirmations avant d’augmenter le volume. Arrêter est une décision raisonnable si la vérification coûte plus que le travail remplacé.

La [grille d’évaluation](/blog/worksheets/fr/T08-evaluation-scorecard.md) propose une comparaison plus détaillée de deux configurations d’agent, ainsi que des fiches vierges pour les entrées, le temps de vérification, les échecs et les coûts. Utilise ces détails quand tu en as besoin. Pour la première décision, garde une question claire : **à travail comparable et à qualité égale, les personnes passent-elles moins de temps pour obtenir un résultat utilisable ?**
