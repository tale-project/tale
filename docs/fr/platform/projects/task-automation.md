---
title: Déléguer une tâche à un agent
description: Lance un agent, examine son résultat, demande des modifications et reprends ou annule une exécution.
---

Un agent de projet travaille sur une tâche et remet son résultat à une personne pour vérification. Assigne le travail, démarre l’exécution et garde les retours sur la tâche pour que l’agent et le relecteur partagent le même contexte. Il te faut le droit de modifier la tâche : un Éditeur ou un rôle supérieur l’a sur toutes les tâches du projet, un Membre sur celles qu’il a créées ou qui lui sont attribuées. Il faut aussi un fournisseur fonctionnel, un harness compatible et de la capacité de sandbox.

<Frame caption="Le travail des agents utilise le même tableau que le travail humain : il démarre à En cours et attend sa validation à En revue.">

![Le tableau du projet répartit les tâches entre Backlog, À faire, En cours, En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## Préparer et démarrer la tâche

1. Crée une [tâche](/fr/platform/projects/tasks) avec le résultat attendu, les critères de fin et les fichiers d’entrée.
2. Choisis un [agent de projet](/fr/platform/projects/project-agents) sous **Assigné à**.
3. Désigne dans **Relecteur** la personne qui vérifiera le résultat. À défaut, la demande revient à la personne qui a créé la tâche ou le projet. Un relecteur doit pouvoir modifier le projet : un Membre qui a créé la tâche ne reçoit donc pas la demande de revue, mais il suit la tâche, est prévenu quand elle passe à **En revue** et peut accepter le résultat lui-même, sauf si ton organisation exige une relecture indépendante et qu’il a démarré l’exécution.
4. Clique sur **Démarrer l'agent** ou passe la tâche à **En cours**.

L’assignation seule ne démarre pas l’exécution. Une tâche déjà assignée peut rester dans **Backlog** tant que l’équipe n’a pas décidé de la lancer. Une fois démarré, l’agent utilise la description, les commentaires et les fichiers d’entrée dans sa sandbox. La fiche d’exécution indique s’il attend ou travaille. Une exécution qu’un Membre démarre s’en tient à sa tâche et se passe des secrets de l’agent ; [Exécutions démarrées par un Membre](/fr/platform/projects/tasks#executions-demarrees-par-un-membre) détaille ce qui change.

Les agents reçoivent la consigne de rédiger les mises à jour, les comptes rendus, les tâches associées et les questions dans la langue du titre et de la description de la tâche. Si ces éléments ne permettent pas de déterminer une langue, ils utilisent la langue par défaut de l’organisation pour les agents. Un identifiant, un trimestre ou un titre issu d’un modèle ne détermine pas cette langue. Changer la langue de ton interface ne change pas celle de la tâche ; tu peux demander explicitement à l’agent d’en changer.

Les commentaires de progression d’un workflow peuvent contenir des traductions pour chaque langue d’interface prise en charge. Le même commentaire enregistré s’affiche alors dans la langue choisie par chaque lecteur. Les commentaires sans traduction conservent leur texte d’origine.

## Lire et accepter le résultat

L’agent publie son compte rendu dans un commentaire et joint les fichiers produits comme livrables. Il passe ensuite la tâche à **En revue**. Le relecteur reçoit une notification et, si l’envoi d’e-mails est configuré, un e-mail.

Tale liste les fichiers livrés ou ignorés dans un commentaire système distinct, affiché dans la langue de ton interface. Ce commentaire signale aussi un compte rendu absent ou raccourci. Le compte rendu conserve ainsi la langue de la tâche.

Lis le compte rendu, ouvre les livrables et compare-les aux critères de fin. Passe la tâche à **Terminé** seulement lorsque tu acceptes le travail. Tale enregistre la décision humaine ; un agent ne peut pas marquer sa propre tâche comme terminée.

**Relecteur** détermine la notification et la file de revue. Ce rôle n’empêche pas les autres personnes qui peuvent modifier la tâche, un Éditeur ou un rôle supérieur, ou le Membre à qui la tâche appartient, d’accepter le résultat. Changer de relecteur ne retire pas l’assignation de l’agent. Si ton organisation exige une relecture indépendante, la personne qui a démarré l’exécution ne peut pas en accepter le résultat : une exécution qu’un Membre a démarrée sur sa propre tâche est alors acceptée par un Éditeur ou un rôle supérieur. [Désigner un responsable et un relecteur](/fr/platform/projects/tasks#designer-un-responsable-et-un-relecteur) donne les détails.

Si tu modifies le champ **Relecteur** alors que la tâche est **En revue**, la demande en cours passe au nouveau relecteur : elle quitte la file de revue de l’ancien, et le nouveau reçoit la notification et, si l’envoi d’e-mails est configuré, un e-mail. **Retirer le relecteur** renvoie la demande à la personne qui a créé la tâche ou le projet.

## Demander des modifications

Explique les changements attendus dans un commentaire et **mentionne l’agent assigné avec @**. Cette mention est une instruction : un agent actif peut la recevoir pendant son exécution, tandis qu’un agent inactif démarre une reprise de la conversation précédente. Le résultat revient à **En revue**.

Si tu as démarré une exécution, tes mentions continuent de la guider même après que la tâche est passée à l’agent, par exemple parce que ta mention lui a confié une tâche qui t’était attribuée. Quand l’environnement de l’agent redémarre pour prendre en compte un commentaire, comme le font tous les environnements sauf Claude Code, la suite de l’exécution revient à l’auteur du commentaire : elle compte dans ses limites, et ses appels de connecteurs se font en son nom.

Un commentaire sans mention conserve une note sans déclencher cette action. Le sélecteur de mentions indique si l’agent ne peut pas répondre, par exemple lorsque l’automatisation des tâches est désactivée ou suspendue, ou lorsque tu peux commenter la tâche sans pouvoir la modifier.

Pour une tâche pilotée par une automatisation, mentionne celle qui en est responsable pour demander une nouvelle exécution. Mentionner une autre automatisation ne lui transfère pas la tâche et ne la démarre pas. [Automatisations](/fr/platform/automations/concepts) présente les workflows qui coordonnent plusieurs étapes.

Une tâche ne peut avoir qu’une seule exécution en file d’attente, en cours ou en attente à la fois, quelle que soit l’automatisation qui l’a démarrée. Répéter une demande de démarrage tant qu’elle est active renvoie à l’exécution existante, même si elle nomme une autre automatisation. Une fois celle-ci terminée, un nouveau démarrage peut créer une autre exécution et répéter le travail. Vérifie donc l’exécution actuelle et ses effets avant une nouvelle tentative.

## Traiter une attente ou un échec

| État ou symptôme | Action |
| --- | --- |
| Attente d’une place de sandbox | La capacité de l’organisation ou de l’infrastructure partagée peut être épuisée. Attends une place ou demande à un admin d’examiner [Sandboxes](/fr/platform/admin/sandboxes). |
| Nouvelle tentative automatique affichée | Tale reprend après un échec récupérable. Surveille le compteur sans lancer une autre exécution. |
| L’exécution reste en échec | Lis l’erreur, corrige sa cause, puis utilise **Relancer** pour continuer la conversation. Un agent supprimé ou une limite de temps atteinte demande une intervention. |
| Réassignation refusée | Annule l’exécution active avant de choisir un autre responsable. |
| Des agents ou des automatisations relancent sans cesse une même tâche | Une tâche accepte au plus trois démarrages de son agent par des automatisations et d’autres agents en une heure, leurs relances automatiques comprises ; le démarrage suivant est refusé, une relance au-delà de la limite ne démarre pas, et la chronologie indique **Exécution refusée: les exécutions d'agents sont en pause sur cette tâche**. Les démarrages par des personnes, et leurs relances, ne sont jamais comptés. Les exécutions d’automatisations n’ont pas ce plafond : entre deux automatisations qui se mentionnent sans fin, c’est la règle d’un seul moteur qui arrête la boucle. Annule l’exécution active, puis lis la chronologie avant de laisser l’une ou l’autre redémarrer. |
| Clôture impossible | Termine d’abord les sous-tâches ouvertes. |

Un échec récupérable donne lieu à jusqu’à trois nouvelles tentatives après la tentative initiale. Une exécution qui progresse pendant au moins quinze minutes reçoit une nouvelle réserve de tentatives. Cela aide le travail long à reprendre après une interruption, sans prouver que le résultat est correct.

Une nouvelle tentative automatique poursuit le travail de la personne qui a démarré l’exécution : elle ne démarre donc que là où cette personne pourrait la lancer maintenant. Le projet doit encore être actif, et cette personne doit toujours avoir le droit de modifier la tâche. Si un administrateur archive le projet, ou si cette personne quitte l’organisation ou perd le droit de modifier la tâche, aucune nouvelle tentative ne démarre et l’exécution reste en échec. Il en va de même pour une mention qui n’atteint l’agent qu’après la fin de son exécution. Une fois le projet restauré, toute personne qui peut modifier la tâche peut utiliser **Relancer**.

Un agent servi par un courtier d’abonnement peut perdre son jeton en cours de travail, lorsque le courtier actualise le compte. La nouvelle tentative poursuit alors la conversation avec un nouveau jeton, sans faire avancer le compteur de tentatives : elle affiche le même compteur que l’exécution qu’elle remplace, ou **Reprise après l'actualisation du jeton** si celle-ci n’en affichait aucun ou avait travaillé au moins quinze minutes, ce qui lui a valu une nouvelle réserve de tentatives. Après deux interruptions de ce type d’affilée, une nouvelle interruption compte comme n’importe quel autre échec.

Une exécution peut aussi ne pas démarrer du tout, parce que tous les comptes de son courtier d’abonnement sont en pause après avoir atteint une limite de requêtes. Sa nouvelle tentative est alors mise en file d’attente aussitôt, mais ne démarre que lorsque le premier compte redevient disponible, au plus tard une minute après. Cette attente ne consomme aucune tentative si l’exécution refusée relançait elle-même un échec dû à une limite de requêtes ; sinon, le démarrage refusé est décompté comme une tentative.

## Travail lancé par une automatisation ou un autre agent

Un agent de projet peut aussi être mis au travail sans que personne ait à cliquer sur **Démarrer l'agent** : par une [automatisation planifiée](/fr/platform/automations/triggers#demarrer-un-agent-de-projet-selon-une-planification), ou par un autre agent du projet qui dispose de l’outil **Lancer d'autres agents sur des tâches**, comme un agent coordinateur qui distribue le travail prêt et répond aux questions. La chronologie affiche une telle exécution comme **automatisation**, avec un lien vers l’exécution de l’automatisation, ou comme **délégué**, lancée par l’agent qui l’a demandée. L’agent apprend qui l’a démarré, et il lit un message transmis par cette automatisation ou cet agent comme venant d’eux, jamais comme la revue d’une personne : là où ce message contredit la description ou le commentaire d’une personne, ce sont ces derniers qui l’emportent.

L’exécution agit pour le compte de la même personne que l’exécution qui l’a demandée : la personne qui a démarré cette exécution, ou personne si la chaîne a commencé par une planification, auquel cas ses dépenses comptent comme des dépenses d’automatisation. Cette personne, ou la planification, doit pouvoir agir dans le projet au moment où l’exécution démarre : si la personne perd le rôle Éditeur, si la planification est suspendue ou si l’automatisation est retirée du projet, le démarrage suivant n’a pas lieu. Un agent lancé par un autre agent ne peut pas lancer d’autres agents, et une exécution démarrée par un Membre ne peut en lancer aucun. Un tel démarrage vérifie aussi ce qu’une personne pourrait oublier : une tâche bloquée par une tâche ouverte ne démarre pas, et un agent qui travaille déjà sur une autre tâche n’est pas lancé une seconde fois.

La validation reste entre les mains d’une personne. Une exécution déléguée dépose son résultat à **En revue** comme n’importe quelle autre, et reprendre une tâche qui y attend retire sa demande de revue en cours, sans valider le résultat pour autant. Un démarrage qui laisse la carte en place (`moveToInProgress: false`) est refusé sous une carte qui attend sa revue, ou sous une carte **Terminé** ou **Annulé**, afin qu’un travail antérieur ne soit jamais présenté au jugement pendant qu’un nouveau travail s’exécute dessous. Si ton organisation exige une relecture indépendante, la personne pour le compte de laquelle l’exécution agit ne peut pas en accepter le résultat.

## Annuler ou suspendre le travail

Utilise **Annuler l'exécution** pour arrêter l’agent actif. Toute personne qui peut modifier la tâche peut annuler son exécution, tout comme la personne qui a démarré celle-ci, même si la tâche est passée depuis à l’agent. Déplacer une tâche d’agent hors de **En cours** peut aussi annuler son exécution : lis la confirmation avant de continuer. Une tâche ne peut pas avoir deux exécutions d’agent actives en même temps.

Pour une tâche pilotée par une automatisation, le déplacement arrête l’exécution et place la tâche là où tu l’as déplacée, en une seule étape. Si ce déplacement est refusé, par exemple parce que tu passes à **Terminé** une tâche parente dont des sous-tâches restent ouvertes, l’exécution continue et la tâche reste dans **En cours**. **Annuler l'exécution**, dans le panneau de l’automatisation sur la tâche, passe la tâche à **Annulé** : les mêmes sous-tâches ouvertes l’en empêchent donc. Pour arrêter l’exécution tout en gardant la tâche ouverte, déplace-la plutôt vers **À faire**.

Un admin peut désactiver l’automatisation des tâches pour l’organisation. Cela bloque les nouveaux démarrages pendant que le travail déjà lancé se termine. Les limites et budgets de l’organisation s’appliquent toujours ; consulte [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Choisir le bon responsable

Assigne une personne lorsque le travail demande un jugement humain ou un accès hors des droits de l’agent. Choisis un agent de projet pour une tâche délimitée utilisant ses fichiers et outils configurés. Une automatisation convient à un processus défini avec des étapes, des déclencheurs ou des approbations pour les opérations des connecteurs. Un Membre ne peut choisir qu’une automatisation conçue pour les tâches, c’est-à-dire l’une de celles listées sous **Automatisations** dans **Assigné à**.

Pour commencer, suis [Créer ton premier agent](/fr/tutorials/editor/first-agent-end-to-end). Choisis une tâche assez petite pour en vérifier toi-même le résultat.
