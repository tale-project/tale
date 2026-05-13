---
title: Triggers
description: Comment démarrent les workflows — calendriers, événements, webhooks et exécutions manuelles.
---

Chaque workflow a besoin d’au moins un trigger. Le trigger définit _quand_ le workflow démarre et _avec quelle entrée_. Un workflow peut avoir plusieurs triggers, du même type ou de types différents.

Les triggers se configurent sur l’étape **Start** du workflow.

## Triggers calendrier

Lance le workflow selon un calendrier.

- Entre une expression cron directement (`0 9 * * 1-5` = 9h UTC en semaine).
- Ou utilise l’assistant IA à côté du champ pour générer depuis l’anglais ("every weekday at 9am").
- Presets rapides : toutes les 5 min, horaire, journalier, hebdo, mensuel.

Tous les calendriers tournent en **UTC**. Si ton équipe est dans un autre fuseau, convertis avant d’entrer le cron.

## Triggers événement

Lance le workflow quand quelque chose se passe dans Tale.

| Événement                 | Exemple d’usage                             |
| ------------------------- | ------------------------------------------- |
| Nouveau client ajouté     | envoyer un email de bienvenue.              |
| Nouvelle conversation     | taguer le fil selon l’historique du client. |
| Approbation demandée      | notifier un canal Slack.                    |
| Document téléversé        | extraire métadonnées et classifier.         |
| Stock produit ≤ threshold | réapprovisionner ou alerter les achats.     |

Chaque type d’événement accepte des conditions de filtre optionnelles. Le filtre agit avant le démarrage — les événements non matchés sont silencieusement ignorés.

## Triggers webhook

Chaque workflow a une URL webhook unique à laquelle tu peux POSTer. Utilise les triggers webhook quand quelque chose hors de Tale doit démarrer le workflow — soumission de formulaire, événement amont, hook CI/CD.

- Le body de la requête est disponible comme entrée pour toutes les étapes.
- Ajoute un secret webhook pour vérifier l’authenticité. Tale vérifie un header `X-Tale-Signature` et rejette les requêtes qui ne matchent pas.
- L’URL webhook est visible sur l’étape **Start** et dans l’onglet **Configuration**.

Voir [Webhooks](/fr/develop/webhooks) pour les formats détaillés et le code de vérification de signature.

## Triggers manuels

Le bouton **Démarrer l’exécution** de chaque workflow permet un démarrage manuel avec une entrée personnalisée. Utile pour :

- tester un nouveau workflow avant de le planifier ;
- des runs ponctuels quand le workflow existe mais ne doit pas tourner automatiquement ;
- lancer un backfill.

Les runs manuels apparaissent dans Exécutions comme les autres.

## Plusieurs triggers sur un workflow

Un workflow peut être déclenché par exemple à la fois par un calendrier (chaque heure) et un webhook (à la demande). Chaque exécution enregistre quel trigger l’a lancée.
