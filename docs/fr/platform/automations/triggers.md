---
title: Démarrer les automatisations automatiquement
description: Configure horaires, webhooks et événements, adapte les données d’entrée et identifie les démarrages manqués.
---

Le panneau **Déclencheur** d’une automatisation définit quand elle démarre seule. Chaque déclencheur utilise la version en service en mode réel. Avant de l’activer, teste le workflow avec les données qu’il recevra et vérifie que ses actions externes sont prêtes.

## Choisir le mode de démarrage

| Type de déclencheur | Usage | Données transmises à l’exécution |
| --- | --- | --- |
| **Planification** | Travail périodique à une heure locale ou à intervalles réguliers. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | Réception d’une livraison d’un autre système. | `{ trigger: "webhook", payload: … }` |
| **Événement de la plateforme** | Un événement nommé dans l’organisation. | `{ trigger: "event", event: "…", payload: … }` |

Une automatisation possède un seul déclencheur configuré à la fois. Changer son type remplace la liaison précédente. Remplacer un webhook révoque immédiatement son URL ; en recréer un plus tard ne restitue pas ces identifiants.

Un client API ou MCP peut aussi démarrer sans déclencheur configuré. Sa clé API et ses droits sur le projet autorisent l’appel, et il fournit directement les données du workflow. Consulte la [référence API](/fr/develop/api-reference).

## Définir un horaire

<Steps>

<Step title="Ouvrir les paramètres du déclencheur">

Ouvre l’automatisation et son panneau **Déclencheur**. Sous **Type de déclencheur**, choisis **Planification**. Laisse **Actif** désactivé tant que le workflow ne doit pas démarrer seul.

</Step>

<Step title="Saisir l’horaire">

Renseigne **Cron** et le **Fuseau horaire**. Les cinq champs représentent minute, heure, jour du mois, mois et jour de la semaine. Choisis un fuseau IANA comme `Europe/Zurich` pour suivre les heures locales. Sans indication, UTC s’applique.

</Step>

<Step title="Vérifier et enregistrer">

Examine la prochaine occurrence affichée pour l’expression valide, puis enregistre les paramètres. Vérifie que la version en service accepte les données de planification du tableau. Active le déclencheur prêt à fonctionner et enregistre à nouveau. Retrouve le prochain démarrage sous **Exécutions**.

</Step>

</Steps>

```text
*/15 * * * *     toutes les quinze minutes
0 9 * * 1-5      à 09:00 du lundi au vendredi
0 6 1 * *        à 06:00 le premier du mois
30 8 1 * 1       à 08:30 le premier du mois et chaque lundi
```

Les champs acceptent `*`, nombres, plages, pas et listes séparées par des virgules. 0 et 7 désignent le dimanche. Si le jour du mois et celui de la semaine sont tous deux limités, l’un ou l’autre suffit. Le dernier exemple tourne donc chaque lundi ainsi que le premier de chaque mois.

L’heure locale suit les changements saisonniers du fuseau. Un horaire zurichois à 09:00 reste à 09:00 sur place. La résolution est d’une minute. Les occurrences manquées pendant une panne ne sont pas rejouées ; le travail reprend à la suivante. Une date de calendrier impossible est refusée à l’enregistrement.

## Recevoir un webhook

Choisis **Webhook**, puis enregistre pour générer les identifiants. Copie l’URL complète dès son apparition : le jeton n’est montré qu’une fois et seul son hash est conservé. Le panneau fournit une URL d’organisation et un modèle d’URL de projet. Utilise cette dernière pour un projet actif auquel l’automatisation est liée. Une automatisation liée à des projets ne peut pas utiliser l’URL réservée aux exécutions sans projet.

Envoie une petite charge utile à l’URL. Le JSON devient `payload` à l’intérieur de l’entrée, et non directement ses champs de premier niveau. Les autres contenus passent comme texte. La limite est de 256 KiB ; téléverse les grands documents séparément. Une requête acceptée renvoie l’identifiant de l’exécution sans attendre sa fin.

Ainsi, le corps `{ "invoiceId": "inv-1" }` parvient au workflow sous cette forme :

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Fournis un identifiant de livraison, par exemple `Idempotency-Key` ou un en-tête pris en charge de l’expéditeur. Le même identifiant renvoie l’exécution initiale pendant 24 heures. Sans identifiant, un corps identique envoyé à la même URL dans les deux minutes est considéré comme un doublon. Utilise des identifiants distincts si des contenus identiques correspondent à des travaux séparés. [Webhooks](/fr/develop/webhooks) détaille en-têtes, chemins de projet, erreurs et réponses.

<Warning>

L’URL autorise le démarrage. Protège-la comme un identifiant et ne la transmets qu’au système expéditeur. **Renouveler le token** produit un remplacement et invalide l’ancienne URL. Retirer ou remplacer le déclencheur la révoque également. Mets l’expéditeur à jour après un renouvellement.

</Warning>

## Réagir à un événement de la plateforme

Choisis **Événement de la plateforme**, puis le **Nom de l’événement**. Enregistre et active le déclencheur quand il est prêt. Le schéma du workflow doit accepter l’enveloppe `trigger`, `event` et `payload` du tableau. Les événements produits par une exécution d’automatisation ne déclenchent pas d’autres départs : le workflow ne peut ainsi se relancer sans fin par ses propres changements.

Un workflow qui exige des champs de premier niveau comme `owner` et `repo` n’accepte pas automatiquement les métadonnées d’un horaire ou le corps enveloppé d’un webhook. Adapte son schéma et ses références, ou utilise un démarrage API qui fournit ces champs. Le panneau ne permet pas de définir des données d’entrée arbitraires enregistrées.

## Comprendre l’absence de démarrage

Vérifie d’abord **Actif**, la version en service et le dernier déclenchement. Lis ensuite le motif éventuellement enregistré :

| Motif ou symptôme | Vérification |
| --- | --- |
| `not_deployed` | Mets une version testée en service. Un brouillon enregistré ne suffit pas. |
| `start_refused` | Compare le schéma de la version active à l’enveloppe du déclencheur et corrige l’erreur de validation ou de démarrage indiquée. |
| `unusable_cron` | Corrige l’expression ou le fuseau, puis enregistre. Les autres horaires continuent pendant que celui-ci est ignoré. |
| Identifiant du webhook refusé | Vérifie l’URL actuelle et l’activation. Les jetons inconnus et désactivés reçoivent volontairement le même refus. |
| Exécution présente, mais inachevée | Ouvre les [journaux d’exécution](/fr/platform/automations/execution-logs). Le démarrage a réussi ; le problème se trouve dans le workflow. |

La date du dernier déclenchement avance lorsqu’une exécution démarre réellement. Un déclencheur arrivé à échéance mais incapable de démarrer enregistre plutôt un départ ignoré. Tu peux ainsi le distinguer d’un workflow démarré puis tombé en échec.

## Suspendre ou remplacer le déclencheur

Désactive **Actif** et enregistre pour suspendre les départs en conservant configuration et historique. Réactive-le pour reprendre. **Retirer le déclencheur** supprime la liaison et rend l’URL d’un webhook inutilisable.

Le déclencheur appartient au nom de l’automatisation, pas à une version. Un déploiement ou un retour à une version précédente conserve l’horaire ou l’URL et change la version utilisée par les prochains départs. Modifier le déclencheur ne crée pas de version du workflow. Vérifie donc aussi ses paramètres lorsqu’un déploiement change les données attendues.
