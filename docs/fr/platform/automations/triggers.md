---
title: Déclencheurs de workflow
description: Les quatre façons dont une automatisation démarre — une planification, un webhook, un événement de la plateforme ou un appel par clé d’API — ce que chacune transporte dans l’exécution, et pourquoi aucune ne casse à la mise en service.
---

Un déclencheur, c’est ce qui lance une automatisation quand personne ne clique nulle part. Il en existe exactement quatre sortes, l’ensemble est fermé, et une automatisation peut en porter plusieurs à la fois. Le plus utile à savoir sur un déclencheur : il se rattache au **nom** de l’automatisation et non à une version. C’est pour cela que mettre une nouvelle version en service n’invalide jamais une URL de webhook dont dépend un système externe, et ne fait jamais disparaître une planification.

Chaque déclencheur lance la version en service et s’exécute en mode réel : une automatisation sans version en service ne peut donc pas être lancée par l’un d’eux. Chaque déclencheur porte un interrupteur et retient la dernière fois que le planificateur a agi dessus.

## Les quatre sortes

| Sorte      | Lance l’automatisation quand…                                   |
| ---------- | --------------------------------------------------------------- |
| `schedule` | une expression cron arrive à échéance dans un fuseau IANA nommé |
| `webhook`  | un système externe poste sur une URL protégée par un token      |
| `event`    | un événement nommé de la plateforme se produit                  |
| `api-key`  | un client d’API authentifié le demande explicitement            |

## Planifications

Une planification porte une expression cron à cinq champs et le fuseau IANA dans lequel elle est lue. Les champs sont la minute, l’heure, le jour du mois, le mois et le jour de la semaine, et chacun accepte un `*`, un nombre, une plage, un pas, ou une liste de ceux-ci séparée par des virgules.

```text
*/15 * * * *     toutes les quinze minutes
0 9 * * 1-5      09:00 en semaine
0 6 1 * *        06:00 le premier du mois
30 8 1 * 1       08:30 le 1er et chaque lundi
```

Le jour de la semaine va de 0 à 7, où 0 comme 7 désignent le dimanche. Quand tu restreins à la fois le jour du mois **et** le jour de la semaine, un jour correspondant à l’un ou à l’autre déclenche — la règle même de crontab, et celle qui fait que le dernier exemple se lit comme il se comporte.

Le fuseau est résolu en heure locale : une planification écrite pour 09:00 dans `Europe/Zurich` reste à 09:00 au passage à l’heure d’été, au lieu de dériver d’une heure deux fois par an. Une planification qui ne nomme aucun fuseau est lue en UTC.

La résolution est d’une minute, et une planification est un battement de cœur, pas une file d’attente : après une panne, l’automatisation repart à sa prochaine échéance au lieu de rejouer celles qu’elle a manquées. Une planification dont l’expression cron ne se lit pas est ignorée plutôt que d’arrêter les autres planifications de la plateforme — sa date de dernier déclenchement cesse simplement d’avancer, et c’est le signal d’aller la relire.

## Webhooks

Un webhook est une URL entrante protégée par un token. Sa création engendre le token et l’affiche une seule fois ; seul son empreinte est stockée, de sorte que la plateforme peut vérifier un appelant sans jamais pouvoir reconstituer l’URL. Tout système qui y poste lance une exécution, et le corps de la requête devient la charge utile de l’exécution.

```bash
curl -X POST https://<ton-hote-tale>/api/automations/webhook/<token> \
  -H 'Content-Type: application/json' \
  -d '{"invoiceId": "inv-1"}'
```

Un appel réussi est accepté immédiatement et répond avec l’id de l’exécution lancée : l’appelant n’attend donc jamais que l’automatisation se termine. Un corps qui n’est pas du JSON est transmis tel quel en texte plutôt que refusé, car certains fournisseurs postent des charges utiles en formulaire ou en texte brut. Les corps sont plafonnés à 256 Ko : un webhook reçoit une charge utile, pas un téléversement.

Deux refus valent la peine d’être reconnus. Un token inconnu et le token d’un déclencheur éteint répondent volontairement de la même manière, pour que personne ne puisse sonder la plateforme afin de savoir quels tokens existent. Une automatisation sans version en service répond plutôt par un conflit, ce qui te dit que l’URL va bien et que c’est la mise en service qui manque.

<Warning>

Le token dans l’URL est l’identifiant. Quiconque détient l’URL peut lancer l’automatisation. Conserve-la comme un mot de passe, transmets-la par un canal sûr, et supprime le déclencheur pour la révoquer — le token ne se récupère pas ensuite.

</Warning>

## Événements

Un déclencheur d’événement nomme un événement de la plateforme et se déclenche dès que cet événement se produit dans l’organisation. La charge utile de l’événement devient l’entrée de l’exécution, ce qui en fait la sorte vers laquelle se tourner quand le travail de l’automatisation est de réagir à quelque chose que la plateforme vient de faire elle-même.

<Note>

Un événement émis par l’exécution d’une automatisation ne déclenche jamais de déclencheur. Une automatisation qui écrit un enregistrement, lequel émet un événement, lequel lance la même automatisation, serait une boucle sans fin qu’aucune limite par exécution ne peut arrêter — la plateforme refuse donc dès la distribution.

</Note>

## Appels par clé d’API

Un déclencheur par clé d’API rend une automatisation appelable par programme. La clé elle-même est authentifiée avant que la requête n’atteigne l’automatisation ; ce que ce déclencheur ajoute, c’est la décision explicite de l’organisation que cette automatisation-là peut être lancée ainsi. Une automatisation sans déclencheur par clé d’API activé n’est pas appelable, si valide que soit la clé : l’exposer reste donc toujours un geste délibéré, jamais un effet de bord de l’émission d’une clé.

Le JSON de l’appelant devient l’entrée de l’exécution sans modification, et l’exécution retient quel appelant authentifié l’a lancée.

## Ce que chaque sorte transporte dans l’exécution

L’entrée que reçoit une automatisation dit quelle sorte l’a lancée : un même document peut donc servir plusieurs déclencheurs et se brancher sur la différence.

| Sorte      | L’entrée de l’exécution                                                |
| ---------- | ---------------------------------------------------------------------- |
| `schedule` | La sorte de déclencheur et l’échéance pour laquelle il s’est déclenché |
| `webhook`  | La sorte de déclencheur et le corps posté en charge utile              |
| `event`    | La sorte de déclencheur, le nom de l’événement et sa charge utile      |
| `api-key`  | Exactement le JSON envoyé par l’appelant                               |

Déclare la forme attendue dans le schéma `inputs` du document, et la référence qui la lit est vérifiée avant même que l’automatisation ne s’exécute.

## La mise en service ne les dérange pas

Parce qu’un déclencheur nomme l’automatisation plutôt qu’une version, l’ensemble survit à chaque mise en service et à chaque retour arrière. Publie une URL de webhook auprès d’un partenaire, mets onze versions de plus en service, reviens deux fois en arrière : cette URL continue de fonctionner et atteint chaque fois ce qui est en service à ce moment-là.

L’inverse est vrai aussi : ajouter, modifier ou retirer un déclencheur ne change rien au document ni à ses versions. Déclencheurs et versions sont deux choses indépendantes à propos de la même automatisation.

## En éteindre un sans le perdre

Chaque déclencheur a un interrupteur, et l’éteindre est la façon d’empêcher une automatisation de se lancer sans rien abandonner. Une planification éteinte n’arrive plus à échéance, une URL de webhook éteinte n’est plus honorée, et un déclencheur d’événement éteint ne correspond plus — tandis que la ligne, sa configuration et tout l’historique des exécutions de l’automatisation restent exactement où ils étaient. Rallume-le et il repart.

Supprimer un déclencheur est la version définitive du même geste, et pour un webhook c’est aussi la façon de révoquer l’URL. Prends l’interrupteur quand tu veux une pause, et la suppression quand tu veux que l’identifiant disparaisse.

## Où cela s’inscrit

Quatre sortes, un seul comportement : chacune lance la version en service en mode réel, chacune retient son dernier déclenchement, et chacune se met en pause sans être perdue — et aucune ne se soucie du nombre de mises en service depuis. [Concepts d’automatisation](/fr/platform/automations/concepts) explique pourquoi le rattachement au nom rend cela vrai ; [Journaux d’exécution](/fr/platform/automations/execution-logs) montre les exécutions que tes déclencheurs ont produites et laquelle a lancé chacune.
