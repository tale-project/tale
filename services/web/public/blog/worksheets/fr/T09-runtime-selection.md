# Fiche de choix du runtime d’un agent IA

Remplis cette fiche pour une charge de travail et un déploiement, pas pour un « meilleur agent » abstrait. Les champs vides sont destinés à tes preuves. Utilise `documenté`, `observé`, `inconnu` ou `sans objet` pour distinguer leur état.

## Exemple rempli : choisir la combinaison sans classer le modèle

**Exemple pédagogique fictif. R1, R2, M1, M2 et tous les résultats sont inventés ; ce ne sont pas des résultats de tests de fournisseurs ou de Tale.** Suppose que toutes les combinaisons sont compatibles et ont passé les contrôles obligatoires d’accès et d’identifiants. Elles utilisent les mêmes six cas, sources figées, révision de skill, grille et limites déclarées, sans correction humaine.

| Acceptation du résultat initial | M1 | M2 |
| --- | --- | --- |
| R1 | 3/6 | 5/6 |
| R2 | 5/6 | 4/6 |

Comparer seulement R1/M1 à R2/M2 ne permet pas d’identifier un effet du modèle. Dans la matrice complète supposée, M2 aide dans R1 tandis que M1 fait mieux dans R2. Préserve l’identité de chaque configuration.

| Preuve supplémentaire supposée | R1/M2 | R2/M1 |
| --- | --- | --- |
| Préparation et revue actives sur six cas | 48 minutes | 30 minutes |
| Frais d’exécution couverts | 6 $ | 6 $ |
| Contrôle de correction en cours de tâche | Audience actualisée dans le brief final | Audience actualisée dans le brief final |
| Contrôle de transmission explicite | Sources vérifiées par l’intervenant suivant | Sources vérifiées par l’intervenant suivant |
| Échéance | Cinq résultats acceptés dans le délai | Cinq résultats acceptés dans le délai |

**Décision remplie :** tester R2/M1 en pilote pour les briefs de recherche, car le nombre observé est égal tandis que l’effort humain actif est inférieur selon ces hypothèses. Cela n’identifie pas un modèle généralement supérieur. Examine son cas échoué et répète des essais représentatifs. Inverse le choix si l’avantage apparent de temps disparaît, si un chemin obligatoire cesse de fonctionner ou si un échec substantiel rend ce travail inadapté. Les coûts de maintenance et de déploiement restent hors de cet exemple.

**Lorsque la matrice ne peut pas être complétée :** compare les configurations compatibles déployables et laisse explicitement l’attribution aux composants ouverte. Ne remplace jamais le fournisseur ou le chemin d’authentification en présentant discrètement le résultat comme la même configuration.

## Formuler la question de comparaison

| Champ | Valeur |
| --- | --- |
| Choisir des configurations déployables, diagnostiquer un composant ou les deux ? | |
| Configurations complètes comparées | |
| Composant unique varié pour le diagnostic | |
| Autres réglages maintenus constants | |
| Comparaisons empêchées par la compatibilité | |
| Contraintes opérationnelles égales : dépense, échéance, aide autorisée | |
| Budget d’ajustement par candidate | |
| Nouvelles tentatives/appels/utilisations d’outils réalisés | |
| Différence restant confondue avec une autre | |
| Conclusion que la comparaison ne peut pas soutenir | |

Des noms de modèles identiques n’impliquent pas des systèmes identiques. Des limites de tokens égales n’impliquent pas automatiquement des coûts ou des possibilités égaux. Sépare les limites réelles de fonctionnement de ce qu’un diagnostic tente de maintenir fixe.

## Travail à prendre en charge

| Champ | Valeur |
| --- | --- |
| Tâche et livrable prévu | |
| Rôle de la personne démarrant la tâche | |
| Réviseur et critères d’acceptation | |
| Types d’entrées et emplacements sources | |
| Lectures requises | |
| Écritures requises, le cas échéant | |
| Actions interdites | |
| Besoins de consignes en cours de tâche/d’interruption | |
| Besoins de persistance et de transmission | |
| Destinations de données permises | |
| Limites de coût, temps et capacité | |

## Comparer la configuration réelle

| Couche | Candidate A | Candidate B | Preuve/date |
| --- | --- | --- | --- |
| Runtime et version | | | |
| Modèle et fournisseur de service | | | |
| Chemin d’authentification ; aucune valeur secrète | | | |
| Couverture de facturation passerelle/abonnement | | | |
| Révision des instructions | | | |
| Skills équipés et révisions des fichiers | | | |
| Opérations des outils et permissions effectives | | | |
| Capacités MCP requises et disponibles | | | |
| Périmètre d’espace de travail/d’isolation | | | |
| Collecte et conservation des fichiers | | | |
| Hébergement/destinations sortantes | | | |
| Capacité et comportement des files | | | |
| Reprise/continuité | | | |

Classe chaque exigence comme obligatoire, utile ou sans pertinence. N’attribue pas de points aux fonctions sans pertinence. Consigne la preuve qu’une exigence obligatoire fonctionne dans le déploiement prévu ; une affirmation marketing ou un format de fichier compatible ne suffit pas à l’établir.

## Petit essai d’acceptation

| Test | Entrée et comportement attendu | Observation réelle | Preuve de livrable/d’exécution | Décision |
| --- | --- | --- | --- | --- |
| Terminer la tâche délimitée | | | | |
| Découvrir le skill pertinent | | | | |
| Suivre sa procédure distinctive | | | | |
| Éviter l’activation inutile d’un skill | | | | |
| Respecter une opération interdite | | | | |
| Recevoir une correction en cours de tâche | | | | |
| Continuer ou redémarrer après interruption | | | | |
| Utiliser les fichiers permis dans une tâche ultérieure | | | | |
| Transmettre explicitement à un autre intervenant | | | | |
| Expliquer un refus ou une dépendance manquante | | | | |

Préserve les livrables avant d’utiliser un environnement de test propre. Distingue persistance des fichiers, reprise de conversation et connaissances transmises à un autre agent. Ne traite pas l’annulation comme une inversion. Teste la reprise avec des données fictives réversibles.

## Examiner qualité et coûts

Utilise la [grille d’évaluation](/blog/worksheets/fr/T08-evaluation-scorecard.md) pour des essais comparables. Garde séparés l’exactitude des résultats, l’intervention humaine, le temps écoulé et les coûts mesurés couverts. Une connexion de modèle fonctionnelle ne prouve pas que tous les outils requis fonctionnent ; un skill disponible ne prouve pas qu’il a été appliqué.

Pour Tale, vérifie la [matrice des runtimes et chemins d’authentification](https://docs.tale.dev/fr/platform/agents/harnesses), la [configuration des agents de projet](https://docs.tale.dev/fr/platform/projects/project-agents) et l’[équipement en skills](https://docs.tale.dev/fr/platform/agents/skills). Les appels par abonnement pris en charge contournent les mesures et plafonds de la passerelle Tale. Ne suppose pas une compatibilité universelle des abonnements, modèles, runtimes ou MCP.

## Choix et maintenance

| Élément | Décision |
| --- | --- |
| Configuration choisie | |
| Travaux pour lesquels elle est approuvée | |
| Preuves soutenant le choix | |
| Limites connues/observations manquantes | |
| Condition inversant ce choix | |
| Effort de maintenance supplémentaire justifié par la spécialisation | |
| Responsable des identifiants et de la revue d’utilisation | |
| Responsable des changements d’instructions, skills et outils | |
| Tâches connues à répéter après les changements | |
| Déclencheurs/prochaine date de revue | |

Réexamine le choix après un changement pertinent de runtime, fournisseur, modèle, skill, outil ou permission. Conserve les essais précédents comme preuves datées ; ne les réinterprète pas discrètement comme tests d’une configuration plus récente.
