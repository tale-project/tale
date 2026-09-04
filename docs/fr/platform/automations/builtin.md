---
title: Automatisations livrées
description: Ce que fait chacune des huit automatisations livrées — synchronisation et tri du courrier pour Gmail, Outlook et IMAP, évaluation des issues et examen des pull requests pour GitHub — et le connector dont chacune a besoin avant sa mise en service.
---

Tale livre huit automatisations, et chaque organisation démarre avec toutes en place : trois qui tirent une boîte aux lettres dans la **Boîte de réception** partagée, trois qui résument ce qui y est arrivé, et deux pour GitHub — l’une évalue les issues ouvertes, l’autre examine les pull requests ouvertes. Chacune arrive en version 1, son planning déjà lié et le badge **Pas en service** affiché ; rien ne tourne donc tant qu’un Propriétaire, un Admin ou un Développeur n’a pas connecté le connector requis et mis l’automatisation en service. Cette page nomme ce que fait chaque paquet, à quelle fréquence il tourne et ce dont il a besoin ; la mécanique de la mise en service est sur [L’éditeur de workflow](/fr/platform/automations/editor).

<Frame caption="La page Automatisations d’une organisation fraîche — chaque paquet semé est une version portant Pas en service jusqu’à ce que tu le mettes en service.">

![La page Automatisations listant les automatisations semées github-review-pull-requests, github-triage-issues, gmail-triage-inbox, imap-smtp-triage-inbox et outlook-triage-inbox, chacune avec une version et un badge Pas en service, sous les boutons Téléverser un paquet et Nouvelle automatisation.](/images/platform/automations-catalog.webp)

</Frame>

## Comment les paquets arrivent

Les paquets sont semés à la création de l’organisation, pas installés depuis un catalogue. Le semis fait attention à ce qui existe déjà : un paquet dont l’organisation tient déjà une version, quelle qu’elle soit, est laissé tel quel — seuls son nom et sa description livrés se rafraîchissent — et un paquet que tu as supprimé reste supprimé ; un déploiement ultérieur ne le ramène jamais. Ouvre un paquet comme n’importe quelle automatisation pour lire son document sur le canvas, suivre ses [journaux d’exécution](/fr/platform/automations/execution-logs), changer son [déclencheur](/fr/platform/automations/triggers) ou le modifier — une modification devient une nouvelle version que tu mets en service quand tu es prêt.

## Tirer une boîte aux lettres dans la Boîte de réception

**Synchroniser les e-mails Gmail**, **Synchroniser les e-mails Outlook** et **Synchroniser les e-mails via SMTP/IMAP** sont la même automatisation trois fois, une par type de boîte. Chacune tire les nouveaux messages dans les conversations toutes les cinq minutes et déclare la vue **Boîte de réception** : dès que l’une d’elles est en service, **Boîte de réception** apparaît dans la navigation et le formulaire de rédaction propose la boîte connectée — jusque-là, la page de la boîte te renvoie vers **Automatisations**. Chacune a d’abord besoin de son connector de courrier connecté.

| Automatisation                         | Requiert  | Planning             |
| -------------------------------------- | --------- | -------------------- |
| Synchroniser les e-mails Gmail         | Gmail     | Toutes les 5 minutes |
| Synchroniser les e-mails Outlook       | Outlook   | Toutes les 5 minutes |
| Synchroniser les e-mails via SMTP/IMAP | IMAP/SMTP | Toutes les 5 minutes |

## Résumer ce qui est arrivé

**Trier la boîte de réception Gmail**, **Trier la boîte de réception Outlook** et **Trier la boîte de réception IMAP** lisent toutes les six heures les messages les plus récents de chaque boîte connectée de leur type et écrivent un résumé : ce qui est arrivé, en bref, et les messages qui demandent manifestement une réponse aujourd’hui. Le résumé est la sortie de l’exécution — ouvre l’exécution dans les [journaux d’exécution](/fr/platform/automations/execution-logs) pour le lire. Rien n’est réécrit dans la boîte, et aucune conversation ne change de statut.

| Automatisation                      | Requiert  | Planning            |
| ----------------------------------- | --------- | ------------------- |
| Trier la boîte de réception Gmail   | Gmail     | Toutes les 6 heures |
| Trier la boîte de réception Outlook | Outlook   | Toutes les 6 heures |
| Trier la boîte de réception IMAP    | IMAP/SMTP | Toutes les 6 heures |

## Évaluer les issues et examiner les pull requests sur GitHub

**Trier les issues GitHub** liste une fois par jour, à 07:00 UTC, les issues ouvertes d’un dépôt, évalue pour chacune si elle est exploitable et à quel point elle est urgente, et renvoie une courte liste classée avec une phrase de justification par issue. En lecture seule : rien n’est écrit sur GitHub, et aucune tâche n’est créée sur aucun tableau — la liste est un rapport sur lequel une personne agit. **Examiner les pull requests GitHub** lit toutes les trente minutes le diff de chaque pull request ouverte, l’examine et publie ses conclusions en commentaire de revue sur la pull request. Jamais d’approbation ni de fusion — cela reste humain. Les deux ont besoin du connector GitHub connecté.

| Automatisation                    | Requiert | Planning                | Écrit                                                |
| --------------------------------- | -------- | ----------------------- | ---------------------------------------------------- |
| Trier les issues GitHub           | GitHub   | Chaque jour à 07:00 UTC | Rien — la liste classée est la sortie de l’exécution |
| Examiner les pull requests GitHub | GitHub   | Toutes les 30 minutes   | Un commentaire de revue par pull request ouverte     |

## Où cela se place

Huit paquets, deux familles : le courrier tiré dans la Boîte de réception et résumé, GitHub évalué et examiné — chacun une automatisation normale que tu mets en service, modifies et versionnes comme les tiennes. [Ajouter des automatisations](/fr/platform/automations/catalog) couvre l’écriture sur le canvas et le téléversement de tes propres paquets ; [L’éditeur de workflow](/fr/platform/automations/editor) la mise en service d’une version ; [Backlog du projet](/fr/platform/projects/backlog) explique le statut du tableau qu’utilise le travail proposé — et pourquoi rien de livré ne le remplit tout seul.
