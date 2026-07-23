---
title: Approbations dans les workflows
description: Là où les humains décident autour des workflows — approuver les modifications de l’éditeur IA sur une définition, approuver la demande d’un agent d’exécuter un workflow, et répondre aux questions qui mettent une exécution en pause.
---

Les workflows s’exécutent sans toi, mais ils ne changent et ne démarrent qu’avec toi. Trois portes humaines entourent chaque workflow : les modifications de l’éditeur IA sur une définition ne s’appliquent qu’après ton approbation, un agent qui veut exécuter un workflow a d’abord besoin de ton accord, et une exécution qui rencontre une question se met en pause jusqu’à ce que quelqu’un réponde. Cette page couvre les trois portes ; l’histoire à l’échelle de l’org de ce qu’est une carte d’approbation vit sur [Concepts d’approbation](/fr/platform/approvals/concepts).

<Frame caption="Le canvas d’une automatisation avec son panneau latéral — une modification proposée arrive comme carte d’approbation et ne touche jamais le document en silence.">

![Le canvas de workflow d’une automatisation montrant un graphe de nœuds, avec un panneau ouvert à côté.](/images/platform/automation-editor-canvas.webp)

</Frame>

## Approuver les modifications d’une définition

Demande à l’assistant de construire ou de retravailler une automatisation et sa proposition arrive comme une carte plutôt que comme un changement. La carte nomme ce qu’elle ferait — créer une nouvelle automatisation, corriger un seul nœud, ou remplacer le document entier — et tient jusqu’à ta décision. Approuve-la et le résultat est enregistré comme une nouvelle version, exactement comme un enregistrement manuel : le document que tu regardais reste intact, et la version en service le reste jusqu’à ce que quelqu’un en mette une autre en service. Annuler écarte la proposition, et rien n’atteint le document tant que la carte est en attente.

## Approuver une exécution

Un agent en chat qui détient les outils d’automatisation peut demander à en lancer une. La demande arrive comme une carte nommant l’automatisation, et tu peux la déplier pour inspecter l’entrée exacte avec laquelle elle s’exécuterait avant de décider. Après approbation, la même carte suit l’exécution en direct — sur quel nœud elle se trouve, depuis combien de temps elle tourne et comment elle s’est terminée — et te laisse l’arrêter en vol ou ouvrir l’exécution elle-même pour le détail complet par nœud.

<Note>

Le chat se met en pause tant qu’une demande est en attente, et il te le dit. Décide la carte avant d’envoyer le message suivant.

</Note>

## Répondre à une exécution en pause

Une exécution qui a besoin d’une réponse humaine prend le statut **En attente** dans la [liste des exécutions](/fr/platform/automations/execution-logs) et s’y arrête. La question arrive comme une carte-formulaire — remplis-la et envoie-la, ou réplique en texte libre quand le formulaire ne demande pas la bonne chose. Répondre ne relance rien : l’exécution repart au nœud où elle s’était arrêtée, emporte ta réponse comme entrée de ce nœud, et termine le reste du graphe. Chaque nœud déjà terminé le reste, donc rien de ce qu’elle avait fait avant la pause n’arrive deux fois.

## Ce que chaque décision laisse derrière elle

Chaque porte traverse la même poignée d’états sur la carte elle-même — en attente, puis en cours d’application, puis terminée ou rejetée —, et la décision atterrit dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec l’acteur et l’horodatage. Une carte résolue ne peut pas être rouverte ; pour retenter une exécution rejetée, redemande et décide la carte neuve. Une approbation qui a lancé une exécution laisse cette exécution derrière elle comme enregistrement propre : ce que la décision a réellement provoqué reste donc lisible dans la [liste des exécutions](/fr/platform/automations/execution-logs) longtemps après la disparition de la carte.

## Où cela s’inscrit

Ces portes sont la face côté workflow d’un motif qui traverse tout le produit : un agent propose, un humain dispose. [Concepts d’approbation](/fr/platform/approvals/concepts) nomme chaque type de carte au-delà des workflows — écritures de documents, écritures de connaissances, appels d’intégration — et [Configurer les approbations](/fr/platform/approvals/configure) montre où les exigences sont déclarées.
