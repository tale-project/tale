---
title: Approbations dans les workflows
description: Là où les humains décident autour des workflows — approuver les modifications de l’éditeur IA sur une définition, approuver la demande d’un agent d’exécuter un workflow, et répondre aux questions qui mettent une exécution en pause.
---

Les workflows s’exécutent sans toi, mais ils ne changent et ne démarrent qu’avec toi. Trois portes humaines entourent chaque workflow : les modifications de l’éditeur IA sur une définition ne s’appliquent qu’après ton approbation, un agent qui veut exécuter un workflow a d’abord besoin de ton accord, et une exécution qui rencontre une question se met en pause jusqu’à ce que quelqu’un réponde. Cette page couvre les trois portes ; l’histoire à l’échelle de l’org de ce qu’est une carte d’approbation vit sur [Concepts d’approbation](/fr/platform/approvals/concepts).

<Frame caption="L’éditeur IA à côté du canevas — ses modifications arrivent comme cartes d’approbation, jamais comme changements silencieux de la définition.">

![L’éditeur de workflow avec un graphe d’étapes sur le canevas et le panneau de l’éditeur IA ouvert à droite, où les modifications de workflow proposées apparaissent pour approbation.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approuver les modifications d’une définition

Demande à l’**Éditeur IA** de construire ou de retravailler un workflow et sa proposition arrive comme une carte dans le panneau — une carte **Créer le workflow** avec le nombre d’étapes pour une nouvelle définition, ou une carte de mise à jour badgée selon la portée : **Mettre à jour l'étape** pour un correctif d’une seule étape, **Mettre à jour {count} étapes** pour plusieurs, **Mettre à jour le workflow** pour un enregistrement complet. Approuve et le changement est appliqué et versionné comme n’importe quel enregistrement manuel ; **Annuler** l’écarte. Rien ne touche la définition tant que la carte est en attente.

## Approuver une exécution

Un agent en chat doté des outils de workflow peut demander à démarrer un workflow. La demande arrive comme une carte nommant le workflow — déplie **Afficher les paramètres** pour inspecter l’entrée exacte avec laquelle il s’exécutera — et tient jusqu’à ce que tu cliques sur **Exécuter le workflow** ou **Annuler**. Après approbation, la même carte suit l’exécution en direct : l’étape en cours, le temps écoulé et l’issue, avec **Arrêter** pour annuler en vol et **Voir les détails de l'exécution** pour sauter au journal de l’exécution.

<Note>

Le chat est bloqué tant qu’une demande est en attente — **Réponds à la demande en attente ci-dessus pour continuer**. Décide la carte avant d’envoyer le message suivant.

</Note>

## Répondre à une exécution en pause

Une exécution qui a besoin d’une réponse humaine se met en pause avec le statut **En attente de saisie** dans la [liste des exécutions](/fr/platform/automations/execution-logs). La question arrive comme une carte-formulaire — remplis-la et clique sur **Soumettre la réponse**, ou clique sur **Répondre différemment** pour répliquer en texte libre. L’exécution reprend avec ta réponse comme entrée de l’étape, et le journal enregistre qui a répondu et quoi.

## Ce que chaque décision laisse derrière elle

Chaque porte se résout vers les mêmes états — **En attente**, **Exécution**, **Terminé** ou **Rejeté** — visibles sur la carte elle-même, et la décision atterrit dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec l’acteur et l’horodatage. Une carte résolue ne peut pas être rouverte ; pour retenter une exécution rejetée, redemande et décide la carte neuve.

## Où cela s’inscrit

Ces portes sont la face côté workflow d’un motif qui traverse tout le produit : un agent propose, un humain dispose. [Concepts d’approbation](/fr/platform/approvals/concepts) nomme chaque type de carte au-delà des workflows — écritures de documents, écritures de connaissances, appels d’intégration — et [Configurer les approbations](/fr/platform/approvals/configure) montre où les exigences sont déclarées.
