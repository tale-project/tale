---
title: Examiner les exécutions et corriger les échecs
description: Repère le nœud concerné, vérifie les écritures enregistrées et décide s’il faut arrêter, corriger ou relancer.
---

Ouvre une automatisation et choisis une ligne sous **Exécutions** pour comprendre ce qui s’est passé. Commence par le statut, la version et le mode, puis examine le nœud concerné. Un essai réussi prouve le déroulement simulé, pas l’acceptation de la même action par un compte externe réel.

## Lire l’état de l’exécution

La liste présente les exécutions récentes en premier. Chaque ligne précise version, date, mode et déclencheur, ou donne la cause d’un échec ou d’une attente. Le détail affiche le workflow, les résultats des nœuds et les horaires. Une exécution inachevée n’a pas de date de fin.

| Statut | Signification | Suite à donner |
| --- | --- | --- |
| **En file d’attente** | Acceptée, en attente d’exécution. | Attendre, puis examiner la capacité si rien ne progresse. |
| **En cours** | Le moteur traite le workflow. | Suivre les nœuds. |
| **En attente** | Une décision, une réponse, un agent ou une condition reste attendu. | Lire ce qui manque. |
| **Réussie** | Les nœuds atteints ont terminé et la sortie est produite. | Examiner sortie et effets. |
| **En échec** | L’exécution s’est terminée sur un échec non traité. | Ouvrir le nœud concerné et lire l’erreur. |
| **Arrêtée** | L’exécution a été annulée. | Vérifier le travail déjà fait avant de relancer. |

Une approbation ou une question attend une personne ; un agent au travail ou une interrogation répétée peut poursuivre seul. Une décision ou une réponse peut aussi être refusée ou expirer. Utilise la cause affichée, pas le seul statut **En attente**, pour décider d’intervenir. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique les commandes de décision.

## Examiner le nœud concerné

Sélectionne un nœud sur le canvas de l’exécution. **Entrée résolue** montre les valeurs après évaluation des expressions, et **Sortie** le résultat de l’étape. Ces champs distinguent une mauvaise référence d’une défaillance du service.

Les états comprennent **Exécuté**, **Ignoré**, **En échec**, **Jamais atteint** et **Pas encore atteint**. Une condition fausse, une dépendance, une branche alternative ou une règle de poursuite après erreur peut expliquer un nœud ignoré. Ce n’est pas toujours un problème.

Par exemple, un rappel peut recevoir le nom du client mais un identifiant de facture vide. Examine la sortie précédente. Si le champ a été renommé, corrige la référence plutôt que les identifiants de messagerie. Vérifie ensuite l’entrée résolue dans un nouvel essai.

## Vérifier les changements déjà effectués

La liste des effets enregistre les écritures des connectors avec leur nœud, leur connector et leurs données. Les essais utilisent des réponses simulées ; les actions réelles peuvent modifier des systèmes externes. L’exécution indique explicitement l’absence d’effets enregistrés.

Lis cette liste avant de recommencer. Un échec ultérieur n’annule ni un message déjà envoyé ni une mise à jour déjà effectuée. Si la livraison compte, vérifie aussi le service destinataire. Les effets restent liés à l’exécution jusqu’à son retrait par suppression ou conservation ; ils ne constituent pas une archive permanente distincte.

## Comprendre les reprises et nouvelles tentatives

Le moteur enregistre les nœuds terminés comme points de reprise et continue après eux. Une exécution inachevée dont la continuation a été perdue peut être reprise après un délai. Une nouvelle exécution distincte possède ses propres points de reprise et peut répéter des écritures. Relancer n’est donc pas reprendre l’exécution existante.

Un échec d’agent admissible permet jusqu’à trois nouvelles tentatives automatiques après la première. Les points de reprise précédents restent acquis et l’en-tête affiche le compteur. Une tentative qui travaille au moins quinze minutes renouvelle ce budget de tentatives. Un pool d’abonnements peut choisir un autre compte pour la suivante.

L’épuisement de la fenêtre totale d’exécution, l’expiration d’une question ou un refus lié au budget ne bénéficie pas de ces reprises. Chaque tentative consomme ses propres ressources ; les coûts antérieurs ne disparaissent pas. Si recommencer ne peut pas résoudre la cause, arrête l’exécution et corrige la dépendance avant de relancer.

## Arrêter ou corriger le workflow

Choisis **Arrêter l’exécution** pour annuler une exécution inachevée. Le moteur empêche la poursuite aux limites de ses étapes ; il n’annule pas les effets déjà produits.

Pour corriger le document, reviens à l’éditeur, modifie l’entrée ou le nœud concerné et enregistre une version avec un message utile. Fais un essai avec des données représentatives et lis les valeurs et la sortie, au-delà du statut de réussite. Mets la version vérifiée en service. Les prochains démarrages planifiés ou par webhook l’utiliseront ; l’ancien échec reste le journal de l’ancienne version.

Si aucune exécution n’a démarré, examine le [déclencheur](/fr/platform/automations/triggers). Sa désactivation, une mise en service manquante ou des données refusées peuvent expliquer l’absence totale d’exécution.
