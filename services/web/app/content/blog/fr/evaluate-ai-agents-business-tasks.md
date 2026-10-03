---
title: "Évaluer des agents IA sur de vraies tâches métier"
description: "Compare les agents IA par résultats acceptés, temps de revue, coûts et délais. Construis une grille concrète avant d’élargir leur déploiement."
slug: evaluate-ai-agents-business-tasks
topicId: T08
reviewed: '2026-10-03'
draft: false
coverAlt: "Trois rapports témoins sont comparés au même cadre de mesure."
---

Un agent IA qui accomplit davantage de tâches peut rester le mauvais choix si vérifier son travail occupe toute la journée de l’équipe. Une exécution peu coûteuse peut devenir un livrable cher après les échecs et les corrections. Évalue le fonctionnement que tu comptes utiliser : le résultat initial, l’aide nécessaire et le résultat que ton équipe peut finalement accepter.

Cela demande quatre mesures distinctes : acceptation, effort humain, coûts couverts et délai de livraison. Il faut aussi une méthode fiable pour les évaluer. Un rapport soigné et un réviseur automatique enthousiaste sont deux résultats à vérifier, pas des preuves indépendantes de réussite.

Ce guide déroule une comparaison fictive de deux configurations de recherche pour une campagne. Chaque nombre d’essais, durée et prix de l’exemple est supposé à des fins pédagogiques ; aucun n’est un benchmark Tale. La [grille d’évaluation](/blog/worksheets/fr/T08-evaluation-scorecard.md) jointe contient le calcul détaillé et un relevé vierge pour ton pilote.

## Définir l’acceptation là où les erreurs deviennent coûteuses

Choisis un livrable que ton équipe sait examiner. Dans l’exemple de campagne, chaque tâche fournit une spécification produit, des extraits d’entretiens et des contenus concurrents datés. L’intervenant doit proposer deux messages de lancement étayés. La publication dépasse son autorité.

Un réviseur peut être en désaccord avec la stratégie proposée tout en acceptant une analyse solide. À l’inverse, un texte séduisant échoue si son affirmation produit centrale est inventée. Construis la grille autour de ces distinctions :

| Exigence | Ce que vérifie le réviseur | Règle d’acceptation |
| --- | --- | --- |
| Affirmations produit étayées | Chaque affirmation substantielle par rapport à la spécification fournie | Aucune affirmation substantielle non étayée |
| Preuves honnêtes sur l’audience | Contexte de l’entretien et affirmation qui en découle | Aucune observation de l’échantillon présentée comme fréquence sur le marché |
| Options utiles | Problème de l’audience, promesse, preuve et objection | Deux choix différents, avec leurs raisons |
| Incertitude visible | Sources manquantes et décisions ouvertes | Lacunes explicites |
| Activité autorisée | Relevés d’action disponibles et état externe pertinent | Aucune publication ni prise de contact client |

N’exige pas la séquence exacte de recherches que tu aurais utilisée, sauf si elle est elle-même obligatoire. Un travail valable peut suivre différents chemins. Mais si la tâche interdit l’envoi de messages, un document correct n’annule pas un envoi non autorisé. La vérification du résultat et les contraintes de processus ont des fonctions distinctes. Le [guide d’évaluation d’Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distingue de même ce que l’agent rapporte de ce que l’environnement contient réellement.

## Tester le réviseur avant de croire le score

Un modèle peut aider à repérer des affirmations non étayées ou à comparer la clarté. Il doit être calibré sur ta grille. Les travaux MT-Bench constatent un accord substantiel entre un modèle évaluateur puissant et les préférences humaines, tout en montrant une sensibilité à l’ordre des réponses et à la longueur inutile. Ces jugements conversationnels utilisaient des modèles plus anciens ; ils ne valident ni ne disqualifient ton évaluateur actuel. [Étude MT-Bench, méthode et limites](https://arxiv.org/html/2306.05685v4)

Avant de noter les configurations, prépare un petit dossier de calibration. Inclus un brief concis mais correct, un brief fluide qui change le sens d’une source, un autre qui reconnaît une entrée manquante et un dernier présentant un défaut de style sans conséquence. Demande à des personnes qualifiées d’identifier indépendamment les défauts substantiels, puis de résoudre les désaccords à partir des sources. Si elles ne s’accordent pas sur ce qui passe, clarifie la grille avant d’ajuster l’agent.

Pour la campagne fictive, supposons qu’une source indique qu’une fonction est en pilote privé. Un brouillon la présente comme disponible pour tous. C’est un échec substantiel, même si le brouillon remporte une comparaison stylistique. Un texte indiquant que la disponibilité n’est pas confirmée peut être le bon résultat. Le réviseur doit ainsi distinguer des cas plus difficiles qu’une réponse manifestement excellente et une autre manifestement défaillante.

Masque les noms de configuration pendant l’évaluation lorsque c’est possible. Si tu utilises des jugements de modèle par paires, inverse l’ordre des réponses et examine les changements de préférence. Exige une référence pour les verdicts factuels ; l’explication du juge peut aussi être erronée. Audite un échantillon des résultats acceptés comme des résultats refusés, car vérifier seulement les échecs ne révèle pas les faux succès. Ce sont des contrôles de fonctionnement proposés, pas une garantie d’exactitude de l’évaluateur.

La revue automatique est surtout utile lorsqu’elle réduit les vérifications répétitives sans devenir l’unique source de vérité. Pour un petit pilote, une revue directe par un spécialiste peut coûter moins cher que la construction et la maintenance d’un juge complexe. Pour un volume élevé de travail bien délimité, des contrôles automatiques calibrés peuvent se justifier.

## Séparer couverture et répétabilité

Utilise des cas représentatifs du travail prévu : entrées ordinaires, contradictions, informations manquantes et situations où poser une question est la bonne réponse. Réserve certains cas pour l’évaluation finale, sans les utiliser pour ajuster la configuration. Fige les sources lorsque c’est possible pour que l’évolution du Web ne modifie pas discrètement le test.

Des cas différents testent la couverture. Des tentatives répétées sur un même cas testent la constance. Six cas exécutés deux fois représentent douze essais sur six cas ; ils ne prouvent pas la couverture de douze types de travail indépendants. Préserve cette distinction dans les comptes rendus.

Les travaux originaux tau-bench formalisent une distinction utile : obtenir au moins une réussite parmi plusieurs tentatives et réussir à chaque répétition répondent à des questions différentes. Leurs environnements utilisent des utilisateurs simulés et des tâches délimitées de commerce et de transport aérien ; leurs taux ne prédisent pas les résultats de ton équipe. [Tau-bench, évaluation et limites](https://arxiv.org/html/2406.12045v1)

Prenons une illustration purement mathématique. Si chaque tentative réussit indépendamment avec une probabilité supposée de 90 %, la probabilité de dix réussites consécutives est `0.9^10`, soit environ 35 %. Les échecs réels peuvent être corrélés : n’applique donc pas ce calcul à une moyenne mesurée sans vérifier les hypothèses. Il explique simplement pourquoi « nous avons fini par obtenir une bonne réponse » ne suffit pas pour du travail récurrent sans surveillance.

Les nouvelles tentatives sont raisonnables lorsqu’un contrôle fiable peut identifier un résultat valide et que leur coût est acceptable. Elles rassurent moins si chacune répète une action importante ou si le même juge incertain choisit le gagnant apparent. Décide quel processus tu évalues avant de l’exécuter.

## Garder ensemble l’essai et son historique de correction

Consigne le runtime, le modèle, le fournisseur, les instructions, les skills, les outils, l’état figé des entrées et les limites. Démarre les essais indépendants dans des conditions équivalentes, dans des espaces de test jetables. Préserve les livrables avant de les réinitialiser. Un agent qui peut lire la réponse précédente part d’un état différent.

Une correction appartient à son essai initial. Consigne le verdict initial avant de fournir un retour, puis indique si le processus de correction autorisé a produit un résultat accepté. Garde les dépassements de délai valides et les exécutions sans sortie comme échecs. Consigne séparément une configuration qui ne démarre jamais comme problème de disponibilité ; cela compte pour le déploiement même sans résultat à noter.

![Évalue séparément l’achèvement, la charge de revue, les coûts couverts et le délai jusqu’à l’acceptation. Utilise les mêmes entrées figées et la même grille pour les essais répétés, échecs compris.](/blog/diagrams/fr/T08-diagram.svg)

*Conserve le verdict initial après une correction. Sinon, une personne serviable peut donner l’apparence d’une fiabilité autonome à un agent faible.*

Mesure le travail humain actif séparément du temps calendaire. Préparation, supervision, vérification des sources et correction consomment du travail. L’attente en file et la disponibilité du réviseur affectent la livraison. Les durées d’agents simultanés ne peuvent pas être additionnées et présentées comme du temps gagné : elles peuvent se chevaucher. Compte les intervalles actifs de chaque personne sans compter deux fois la même minute.

## Calculer le coût d’un livrable accepté

Supposons que les deux configurations reçoivent les mêmes six cas, chacun exécuté deux fois dans des conditions propres. Toutes deux autorisent un tour de correction. Aucun essai ne produit d’effet interdit. Tout le travail humain ci-dessous comprend préparation, supervision, revue et correction sur les réussites et les échecs. Les chiffres sont inventés, y compris le taux horaire supposé de 60 $.

| Mesure de la cohorte fictive | Configuration A | Configuration B |
| --- | --- | --- |
| Essais valides démarrés | 12 | 12 |
| Acceptés au premier résultat | 8/12 | 10/12 |
| Acceptés dans la limite de correction, premiers résultats compris | 10/12 | 11/12 |
| Non acceptés à la fin | 2 | 1 |
| Frais de modèle et d’outils couverts | 6 $ | 18 $ |
| Temps humain actif | 180 minutes | 120 minutes |
| Coût humain estimé à 60 $/heure | 180 $ | 120 $ |
| Sous-total estimé des coûts couverts | 186 $ | 138 $ |
| Sous-total par livrable accepté | 18,60 $ | 12,55 $ |

A semble moins chère si la décision ne considère que les frais de modèle et d’outils. Après ajout du travail humain, B a le sous-total couvert par résultat accepté le plus faible : `(18 + 120) / 11 = 12.55`, arrondi. Le calcul reste partiel. L’infrastructure, les abonnements et les frais de déploiement ne sont pas mesurés ici : il ne permet donc pas d’établir une économie totale.

La conclusion dépend aussi de l’hypothèse de coût du travail. Soit `r` le taux horaire. Le ratio de A est `(6 + 3r) / 10` ; celui de B est `(18 + 2r) / 11`. Ils sont égaux à environ 8,77 $/heure. En dessous, A a le ratio couvert le plus bas ; au-dessus, c’est B. Des différences de coûts manquants peuvent encore changer la comparaison. Consigne cette sensibilité au lieu de présenter le taux choisi comme un fait valable pour toutes les entreprises.

Selon ces hypothèses, B mérite le prochain pilote supervisé, à condition que son échec restant soit acceptable et qu’elle respecte l’échéance de livraison. Douze essais ne justifient pas un classement précis sur l’ensemble des tâches possibles. Si l’unique échec de B exposait du contenu confidentiel tandis que les échecs de A demandaient seulement des précisions, un coût moyen inférieur ne sauverait pas B. La gravité et le sens de l’échec passent avant le ratio.

## Choisir le dénominateur avant d’ouvrir le tableur

Pour la cohorte déclarée, utilise `F/N` pour l’acceptation au premier passage et `A/N` pour l’acceptation dans le processus de correction permis. `N` contient tous les essais valides démarrés, y compris les dépassements de délai et les sorties absentes ; `A` comprend les acceptations initiales. Résous les résultats non notés avant de comparer les taux et signale les tests invalides et les échecs de démarrage au lieu de les supprimer discrètement.

Pour le coût, additionne les frais observés sans doublons, les répartitions explicites et le travail humain estimé sur toute la cohorte, échecs compris, puis divise par les livrables acceptés. Répartir un abonnement relève d’une hypothèse comptable, pas d’un coût mesuré de cette exécution. Évite de compter la même dépense fournisseur une fois depuis la passerelle et une autre depuis la facture.

Si `N = 0`, les taux d’acceptation sont indéfinis. Si `A = 0`, le coût et l’effort par résultat accepté sont indéfinis ; rapporte la dépense, l’effort et zéro acceptation. Avec des catégories manquantes, appelle le résultat **sous-total estimé des coûts couverts par livrable accepté**. Réserve « sous-total mesuré » aux seuls frais observés. Un coût inconnu n’est pas un coût nul.

Garde le délai de livraison à côté de ces chiffres. Rapporte séparément les délais d’acceptation des essais acceptés et les durées terminales des échecs. Une configuration qui échoue vite n’a pas livré vite. Pour un processus avec échéance, compte les résultats acceptés arrivés à temps, en plus de ceux qui finissent par passer.

## Limiter la décision du pilote à ce que les chiffres permettent

La grille doit conduire à une action délimitée : poursuivre avec un travail supervisé, corriger un échec précis, comparer une autre configuration ou arrêter. Identifie ce qui ferait changer le choix. Un modèle moins cher peut suffire lorsque les sorties ont des contrôles déterministes peu coûteux ; la revue peut dominer lorsque chaque affirmation exige la lecture d’une source.

Dans Tale, place le brief et la grille dans une [tâche de projet](https://docs.tale.dev/fr/platform/projects/tasks), configure l’intervenant via les [agents de projet](https://docs.tale.dev/fr/platform/projects/project-agents) et conserve les livrables avec leurs décisions de revue. Confirme les modalités de revue de ton déploiement dans le [guide de revue des tâches](https://docs.tale.dev/fr/platform/projects/task-automation). La fiche reste un document d’évaluation distinct.

Les [analyses d’utilisation](https://docs.tale.dev/fr/platform/admin/governance/usage-analytics) fournissent l’utilisation enregistrée par l’application, pas une facture fournisseur complète ni un total garanti par tâche. Les runtimes à abonnement pris en charge appellent directement les fournisseurs et contournent la mesure et les plafonds de dépense de la passerelle Tale. Établis cette couverture avant d’utiliser ces relevés dans une comparaison de coûts. [Chemins d’authentification des runtimes](https://docs.tale.dev/fr/platform/agents/harnesses)

Apporte une entrée représentative, la grille d’acceptation et la fiche remplie à une [démo Tale](/fr/request-demo). La question utile est de savoir si cette organisation précise produit des résultats acceptables pour ton équipe, avec un coût de vérification supportable.
