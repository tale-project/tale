# Inventaire des flux d’un déploiement IA

Copie cette fiche pour une configuration précise de déploiement. Sépare les faits observés de la configuration prévue. « Non observé » signifie qu’un test n’a pas vu un flux ; cela n’établit pas qu’il ne peut pas se produire. Toutes les lignes commencent non vérifiées.

## Déploiement et décision

| Champ | Relevé |
| --- | --- |
| Responsable de la décision et opérateur | Non attribué |
| Déploiement/version/date/fuseau | Non consigné |
| Emplacement de la configuration figée, sans secrets | Non consigné |
| Tâches de l’équipe et classes de données prévues | Non convenu |
| Emplacements application/inférence/embeddings | Non consigné |
| Contraintes de localisation/accès/conservation | Non convenu |
| Identifiants des modèles et outils actuels | Non consigné |
| Tâche pilote avec entrées fictives | Non choisie |

## Décision de périmètre remplie — fictive

Tâche : comparer des fournisseurs publics à un brief interne d’exigences. Règle supposée : le brief et les passages dérivés restent dans un environnement contrôlé ; les contenus publics des fournisseurs peuvent être récupérés à l’extérieur. C’est une règle organisationnelle illustrative, pas une réglementation ni un réglage par défaut de Tale.

| Chemin | Classe du contenu | Décision | Raison |
| --- | --- | --- | --- |
| Brief vers extraction et stockage | Interne | Services internes | Le texte dérivé contient toujours les éléments protégés |
| Texte vers service d’embeddings | Interne | Adresse interne approuvée | La création de l’index est aussi un chemin de divulgation |
| Brief et passages publics mélangés vers génération | Interne | Inférence interne | Les ajouts publics ne reclassent pas le brief |
| Recherche de fournisseur par l’intervenant | Termes publics uniquement | Destination publique autorisée pour cette tâche | Les exigences internes ne doivent pas être copiées dans la requête |
| Rapport d’erreur | Potentiellement interne | Examiner les champs ou désactiver le rapport externe | Les traces de réussite n’exercent pas ce chemin |

Le choix change si l’organisation autorise un prestataire externe précis pour le contenu interne. Consigne le responsable de la règle et le changement approuvé avant de modifier le routage ou le secours.

## Reproduire la décision de coût — hypothèses fictives en dollars américains

Ces hypothèses sont inventées : ce ne sont ni des prix, ni des temps de travail mesurés, ni des résultats de benchmark. Périmètre : exploitation supplémentaire de l’inférence pour une même charge. Cette comparaison suppose que l’organisation a approuvé un prestataire hébergé précis pour le contenu interne : les deux options respectent donc la limite de données. Selon la règle précédente de traitement interne exclusif, l’inférence hébergée reste inadmissible quel que soit son coût estimé. Les coûts communs de l’espace de travail sont exclus ; ajoute les licences, le support, le réseau, le stockage et le personnel qui diffèrent pour une vraie décision.

Définis **N** comme le nombre de travaux distincts lancés, y compris ceux qui échouent ou dépassent le délai. **a** est la part produisant un livrable accepté après les nouvelles tentatives ou corrections autorisées. Compte un livrable une seule fois. **v** comprend le traitement variable modélisé, toutes les nouvelles tentatives et le travail de revue/correction par travail lancé. **F** comprend la capacité fixe attribuée, le travail d’exploitation et les moyens de reprise. Ne compte pas deux fois le travail entre F et v.

| Entrée ou calcul | Exploitation interne | Hébergement |
| --- | ---: | ---: |
| F par mois | 2 600 $ | 200 $ |
| Traitement/nouvelles tentatives modélisés par travail lancé | 0,10 $ | 0,80 $ |
| Revue/correction modélisée : 2 min × 60 $/heure par travail lancé | 2,00 $ | 2,00 $ |
| v total par travail lancé | 2,10 $ | 2,80 $ |
| N | 5 000 | 5 000 |
| a | 0,90 | 0,90 |
| Coût couvert = F + v × N | 13 100 $ | 14 200 $ |
| Livrables acceptés = a × N | 4 500 | 4 500 |
| Coût couvert/livrable accepté | 2,91 $ | 3,16 $ |

À acceptation égale et capacité fixe suffisante, le seuil est `(2600 − 200) / (2.80 − 2.10) ≈ 3429` travaux mensuels. Pour N = 1 000, les totaux sont 4 700 $ et 3 000 $. Pour N = 5 000 avec a = 0,65 en interne, le coût est `13100 / 3250 ≈ $4.03` par livrable accepté. La recommandation s’inverse. Le calcul garde les autres hypothèses fixes ; des reprises réelles ou du matériel supplémentaire peuvent aussi changer le coût.

Pour ta décision, remplace chaque entrée par une observation ou une estimation étiquetée et cite sa preuve. Consigne une plage d’incertitude ; les coûts inconnus ne sont pas nuls. Si a × N vaut zéro, le coût par livrable accepté est indéfini : rapporte le coût avec zéro résultat accepté. N’extrapole jamais au-delà de la capacité testée sans changer le modèle de coût.

| Ton hypothèse | Option A | Option B | Preuve/estimation et incertitude |
| --- | --- | --- | --- |
| Périmètre fixe mensuel et F | Non estimé | Non estimé | Non consigné |
| Coûts variables couverts et v | Non estimé | Non estimé | Non consigné |
| N et schéma d’arrivées/simultanéité | Non estimé | Non estimé | Non consigné |
| Règle d’acceptation, limite de tentatives et a | Non mesuré | Non mesuré | Non consigné |
| Échéance de pic tenue avec cette capacité ? | Non testé | Non testé | Non consigné |
| Changement de coût ou de qualité inversant le choix | Non calculé | Non calculé | Non consigné |

## Exercice de dépendances de reprise — fictif, non exécuté

Suppose que la base est restaurable à 10:05, la sauvegarde de fichiers à 10:00 et qu’un rapport a été téléversé à 10:03. L’enregistrement restauré peut pointer vers des octets manquants. Une application qui tourne n’est pas une preuve suffisante d’acceptation.

Réponse attendue : maintenir le trafic et les actions planifiées à l’arrêt dans l’environnement de reprise isolé, préserver l’état existant et identifier une version d’objet correspondante ou un ensemble complet de sauvegardes coordonnées. Si le dernier ensemble utilisable date de 10:00, documente explicitement le travail ultérieur à récupérer séparément ou à accepter comme perdu. Ne suppose pas qu’une base plus récente, une réindexation ou l’image actuelle de l’application répare les octets manquants.

| Dépendance de reprise | Preuve à recueillir | Statut |
| --- | --- | --- |
| État de l’application et des connaissances | Identifiants de sauvegardes et point de reprise coordonné | Non recueilli |
| Fichiers originaux et rapports générés | Versions d’objets et téléchargement d’un fichier témoin | Non recueilli |
| Configuration, clés, état de passerelle, version correspondante de l’application | Références aux copies protégées ; aucune valeur de clé | Non recueilli |
| État conservé des intervenants, si requis | Plan séparé de restauration des espaces de travail de sandbox | Non recueilli |
| Service utilisable | Connexion, ancien projet/fichier, recherche contrôlée et vérification des identifiants | Non exécuté |
| Objectif de reprise | Intervalle de perte de données et délai jusqu’au service accepté | Non mesuré |

Un exercice isolé doit éviter les notifications et écritures d’outils en production. Si une action antérieure a pu réussir avant l’échec, vérifie son état dans le système destinataire avant de la répéter.

## Inventaire des destinations

Copie une ligne lorsqu’un flux a plusieurs destinations. Consigne des références de secrets ou leurs responsables, jamais leurs valeurs.

| Flux | Hôte/service réel et opérateur | Contenu | Preuve de région/localisation | Identité d’accès | Responsable conservation/sauvegarde | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| Navigateur vers application | Non consigné | Requêtes de compte et de tâche | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Enregistrements de l’application | Non consigné | Utilisateurs, tâches, conversations, exécutions | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Fichiers originaux/générés | Non consigné | Fichiers sources et livrables | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Stockage des connaissances | Non consigné | Texte extrait, embeddings, index | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Service d’embeddings | Non consigné | Texte source sélectionné et requêtes | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Génération via passerelle | Non consigné | Prompts, contexte, résultats d’outils | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Appels directs runtime/fournisseur, abonnements compris | Non consigné | Prompts, contexte, résultats d’outils hors routage de passerelle | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Trafic Web/outils de sandbox | Non consigné | URL, requêtes, contenu sélectionné | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Connectors backend | Non consigné | Entrées/sorties propres à l’action | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Modération | Non consigné | Texte sélectionné pour contrôle | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Rapports d’erreurs/analyses | Non consigné | Champs d’événements activés | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Sauvegardes et copies | Non consigné | Données de reprise coordonnées | Non vérifié | Non consigné | Non consigné | Non vérifié |
| Mises à jour/téléchargements de modèles | Non consigné | Images, packages, fichiers de modèles | Non vérifié | Non consigné | Non consigné | Non vérifié |

## Relevé de contrôle et d’observation

| Champ | Relevé |
| --- | --- |
| Flux testé et processus exécutant | Non consigné |
| Destination autorisée et raison | Non consigné |
| Mécanisme de restriction et configuration | Non consigné |
| Destination de test censée être refusée | Non consigné |
| Début/fin d’observation | Non consigné |
| Instrument et emplacement des preuves | Non consigné |
| Résultat réel : autorisé/refusé/non concluant | Non évalué |
| Ce que l’observation ne pouvait pas voir | Non consigné |
| Réviseur et suivi | Non attribué |

Effectue les tests uniquement sur des systèmes que tu es autorisé à examiner, avec des requêtes fictives sans conséquence. Choisis une destination contrôlée pour les tests de refus. N’envoie pas de contenu sensible simplement pour démontrer qu’un point d’accès l’accepte.

## Contrôles d’acceptation

| ID | Contrôle | Statut |
| --- | --- | --- |
| D01 | Vérifier les adresses réelles d’inférence et d’embeddings utilisées par la tâche choisie | Non exécuté |
| D02 | Vérifier l’authentification et l’accessibilité depuis l’extérieur du réseau de confiance | Non exécuté |
| D03 | Examiner les ports de conteneurs publiés et le comportement effectif du pare-feu | Non exécuté |
| D04 | Tester les destinations de sandbox autorisées et refusées | Non exécuté |
| D05 | Examiner séparément la génération via passerelle, les appels directs runtime/fournisseur et les Connectors backend, sans les confondre avec les sorties de sandbox | Non exécuté |
| D06 | Provoquer une erreur contrôlée pour examiner les champs de rapport configurés et la destination | Non exécuté |
| D07 | Examiner les réglages de modération et d’analyse, y compris les états activés/désactivés | Non exécuté |
| D08 | Effectuer une restauration isolée et vérifier les anciens fichiers, la configuration et l’accès aux secrets requis | Non exécuté |
| D09 | Inventorier les dépendances des mises à jour et téléchargements de modèles | Non exécuté |
| D10 | Répéter une charge représentative avec la simultanéité attendue et consigner les limites de capacité | Non exécuté |

## Responsabilités d’exploitation

| Responsabilité | Responsable | Fréquence/déclencheur | Preuve |
| --- | --- | --- | --- |
| Mises à jour et préparation des retours arrière/reprises | Non attribué | Non convenu | Non consigné |
| Rotation et révocation des identifiants | Non attribué | Non convenu | Non consigné |
| Surveillance de la capacité et des files | Non attribué | Non convenu | Non consigné |
| Réponse aux alertes | Non attribué | Non convenu | Non consigné |
| Sauvegardes hors hôte et stockages externes | Non attribué | Non convenu | Non consigné |
| Exercices de restauration | Non attribué | Non convenu | Non consigné |
| Revue des destinations et configurations | Non attribué | Non convenu | Non consigné |

## Décision

Consigne les tâches et classes de données prises en charge, les services externes acceptés, les risques non résolus, les changements requis et le prochain déclencheur de revue. Ne qualifie pas un déploiement d’isolé du réseau, d’entièrement local ou de conforme simplement parce que cet inventaire est rempli.

Références Tale : [architecture](https://docs.tale.dev/fr/self-hosted/overview), [stockages](https://docs.tale.dev/fr/self-hosted/configuration/data-residency), [durcissement](https://docs.tale.dev/fr/self-hosted/operate/security/hardening), [observabilité](https://docs.tale.dev/fr/self-hosted/configuration/observability-config) et [reprise](https://docs.tale.dev/fr/self-hosted/operate/backups-and-restore).
