---
title: Concepts des automatisations
description: Comment automatisations, étapes, déclencheurs et variables s'articulent.
---

Une automatisation est un programme déterministe d'arrière-plan qui s'exécute quand quelque chose le lui demande : une horloge, un événement dans Tale, un webhook venu d'un système externe, ou une personne qui clique sur **Exécuter**. Là où le chat reste ouvert et suit la conversation, une automatisation fait exactement ce que ses étapes disent, dans l'ordre où elles le disent, à chaque déclenchement. Le public de cette page : toute personne sur le point de construire, déboguer ou lire une automatisation — rôle Développeur ou supérieur, en Cloud ou en auto-hébergé.

Le vocabulaire ci-dessous — automatisation, étape, déclencheur, variable, exécution — est le petit ensemble que le reste de cette section présuppose. Lis-le une fois et l'éditeur, l'onglet **Déclencheurs** et l'onglet **Exécutions** deviennent lisibles d'eux-mêmes.

## L'automatisation elle-même

Une automatisation est une unité nommée et exécutable. Elle possède une liste d'étapes, les déclencheurs qui la lancent, les variables que chaque étape peut lire, et un petit ensemble de réglages (délai d'expiration, nombre de tentatives, délai de backoff). Publier, restaurer une version antérieure depuis **Historique** et suivre une seule ligne sur le tableau de métriques sont autant d'actions à l'échelle d'une automatisation — le reste du modèle se construit autour de l'automatisation comme atome.

## Étapes

Une étape est une unité de travail. L'éditeur fournit six types d'étape, codés en couleur pour que la forme d'une automatisation se lise d'un coup d'œil.

| Étape         | Ce qu'elle fait                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| **Start**     | Le point d'entrée. Porte le schéma d'entrée et lie les déclencheurs qui lancent l'automatisation.      |
| **Action**    | Exécute une opération — appeler une intégration, écrire dans une base de données, envoyer un courriel. |
| **LLM**       | Envoie un prompt à un modèle et transmet la réponse à l'étape suivante.                                |
| **Condition** | Branche le chemin selon un test.                                                                       |
| **Loop**      | Exécute une sous-séquence une fois par élément d'une liste.                                            |
| **Output**    | Nomme les données que l'automatisation renvoie à la fin.                                               |

Les étapes sont reliées par des liens orientés. L'exécution suit les liens de **Start** à **Output** ; **Condition** choisit une branche ; **Loop** répète son bloc interne par élément de liste.

## Déclencheurs

Un déclencheur nomme le moment où l'automatisation démarre et l'entrée avec laquelle elle commence. Tale fournit trois variantes — **Planifications** pour les exécutions pilotées par l'horloge, **Webhooks** pour les exécutions lancées depuis l'extérieur de la plateforme, et **Événements** pour les exécutions qui réagissent à quelque chose survenu dans Tale (un nouveau client, une conversation fermée, une autre automatisation terminée). Une même automatisation peut porter plusieurs déclencheurs de toute nature, donc le même fan-out tourne sur une planification nocturne et sur chaque webhook entrant. Les détails — syntaxe cron, l'URL du webhook, les types d'événement pris en charge — sont sur [Déclencheurs](/fr/platform/automations/triggers).

## Variables

Les variables sont le sac partagé de clés-valeurs que chaque étape peut lire. C'est là que tu gardes la clé d'API que trois étapes référencent, le drapeau de fonctionnalité qui bascule le comportement entre staging et production, ou la constante que tu ne veux pas coller dans cinq configurations d'étape. Elles vivent dans l'onglet **Configuration** et se lisent depuis n'importe quelle étape avec la syntaxe `{{ variables.name }}`.

## Exécutions

Chaque fois qu'un déclencheur se déclenche, la plateforme crée une exécution dans l'onglet **Exécutions**. Une exécution porte la source du déclencheur, l'heure de début et de fin, le statut final, et un enregistrement par étape de l'entrée vue, de la sortie produite et de toute erreur levée. C'est l'artefact que tu ouvres quand une API tierce a renvoyé `400` et que tu veux le corps de requête littéral qui l'a produit — voir [Journaux d'exécution](/fr/platform/automations/execution-logs).

## Quand y recourir

Automatisations et agents sont les deux façons dont Tale fait tourner le travail d'IA ; choisis selon l'endroit où l'humain se trouve.

| Utilise une automatisation quand …                                       | Utilise un agent quand …                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Une planification, un webhook ou un événement système lance le travail   | Une personne pose une question et attend une réponse écrite                      |
| Le flux est le même à chaque exécution — mêmes étapes, même ordre        | Le flux se ramifie selon la réponse ; le mouvement suivant dépend de l'intention |
| La sortie est une écriture dans un autre système, un courriel, un ticket | La sortie est du texte que la personne lit, ou une petite charge structurée      |
| Tu veux une trace par exécution de chaque entrée, sortie et erreur       | Tu veux un transcript de conversation avec le raisonnement du modèle en ligne    |

Les deux se composent. L'étape **LLM** d'une automatisation peut adopter les instructions et la liste d'outils d'un agent ; un agent peut passer un travail long à une automatisation via l'outil d'intégration. Choisis le primaire selon qu'un humain est dans la boucle quand le travail démarre.

## En construire une

Les cinq noms de cette page — automatisation, étape, déclencheur, variable, exécution — sont tout le modèle. La page suivante est l'éditeur qui les transforme en quelque chose d'exécutable : [Automatisations](/fr/platform/automations/workflows).
