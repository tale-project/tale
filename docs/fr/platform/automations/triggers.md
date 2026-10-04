---
title: Démarrer les automatisations automatiquement
description: Configure horaires, webhooks et événements, adapte les données d’entrée et identifie les démarrages manqués.
---

La section **Déclencheur** de l’onglet **Général** d’une automatisation définit quand elle démarre seule. Chaque déclencheur utilise la version en service en mode réel. Avant de l’activer, teste le workflow avec les données qu’il recevra et vérifie que ses actions externes sont prêtes.

<Frame caption="L’onglet Général d’un paquet fourni : son déclencheur de planification est activé, mais il ne lance rien tant qu’aucune version n’est en service.">

![L’onglet Général de Triage the Gmail inbox avec un déclencheur Schedule activé, l’expression cron 0 */6 * * * décrite comme toutes les six heures et sans démarrage tant qu’aucune version n’est déployée, le fuseau horaire UTC et, en dessous, un sélecteur de projets vide.](/images/platform/automation-general-trigger.webp)

</Frame>

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

Ouvre l’automatisation, puis son onglet **Général**. Sans liaison, la section **Déclencheur** indique que l’automatisation ne s’exécute que lancée à la main ou via l’API ; choisis **Ajouter un déclencheur**, puis **Planification** sous **Type de déclencheur**. Un nouveau déclencheur n’est pas **Actif** au départ — laisse-le désactivé tant que le workflow ne doit pas démarrer seul.

</Step>

<Step title="Saisir l’horaire">

Renseigne **Cron** et le **Fuseau horaire**. Les cinq champs représentent minute, heure, jour du mois, mois et jour de la semaine. Choisis un fuseau IANA comme `Europe/Zurich` pour suivre les heures locales. Sans indication, UTC s’applique.

</Step>

<Step title="Vérifier et enregistrer">

Examine la prochaine occurrence affichée pour l’expression valide : c’est la minute à laquelle la planification démarrera vraiment, changement d’heure compris. Clique ensuite sur **Enregistrer** à côté des onglets. Vérifie que la version en service accepte les données de planification du tableau. Active le déclencheur prêt à fonctionner avec **Actif** et enregistre à nouveau. Retrouve le prochain démarrage sous **Exécutions**.

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

Choisis **Webhook**, puis enregistre pour générer les identifiants. Copie l’URL complète dès son apparition : le jeton n’est montré qu’une fois et seul son hash est conservé. La section fournit une URL d’organisation et un modèle d’URL de projet. Utilise cette dernière pour un projet actif auquel l’automatisation est liée. Une automatisation liée à des projets ne peut pas utiliser l’URL réservée aux exécutions sans projet.

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

Un workflow qui exige des champs de premier niveau comme `owner` et `repo` n’accepte pas automatiquement les métadonnées d’un horaire ou le corps enveloppé d’un webhook. Adapte son schéma et ses références, ou utilise un démarrage API qui fournit ces champs. Les réglages du déclencheur ne permettent pas de définir des données d’entrée arbitraires enregistrées.

## Démarrer un agent de projet selon une planification

Une planification peut mettre au travail l’un des agents existants d’un projet : pour une tâche permanente dont l’agent rend compte à chaque occurrence, ou pour un travail récurrent que tu lancerais sinon à la main. Installe l’automatisation dans le projet de la tâche, ajoute une étape `task.start_agent` qui désigne la tâche, puis donne une planification à l’automatisation. Chaque occurrence démarre l’agent assigné à la tâche, ou assigne d’abord la tâche à l’agent que désigne `agentId`, qui doit appartenir au même projet. `feedback` est le message que l’exécution traite en premier, par exemple une mention de l’occurrence pour laquelle elle s’exécute :

```yaml
nodes:
  - id: start
    type: task.start_agent
    input:
      taskId: <ID de la tâche>
      moveToInProgress: false
      feedback: 'Scheduled occurrence {{ input.firedAt }}.'
```

L’étape renvoie l’exécution qu’elle a démarrée, et la chronologie de la tâche affiche cette exécution comme **automatisation**, avec un lien vers l’exécution de l’automatisation. Quand elle ne démarre rien, l’étape réussit tout de même et en donne la raison, si bien que l’occurrence est consignée au lieu d’être mise en file d’attente :

| Réponse | Signification |
| --- | --- |
| `started: true` | L’exécution de l’agent a démarré ; `runId` l’identifie. |
| `already_running` | L’exécution précédente de la tâche travaille encore et prend le travail en charge. Rien de nouveau ne démarre, et l’occurrence n’attend pas derrière elle. |
| `in_review` | Avec `moveToInProgress: false`, la carte attend son relecteur enregistré, une personne ou un agent. Rien n’est assigné ni démarré, et la revue conserve ce destinataire. |
| `closed` | Avec `moveToInProgress: false`, la carte est **Terminé** ou **Annulé** (`taskStatus`). Rien n’est assigné ni démarré. |
| `agent_busy` | L’agent travaille sur une autre tâche (`busyTaskId`). Un agent ne traite qu’une tâche à la fois dans son espace de travail. |
| `blocked` | Une tâche dont celle-ci dépend est encore ouverte (`blockedBy`). |
| `paused` | La tâche a déjà reçu trois démarrages par des automatisations et des agents au cours de la dernière heure, les relances automatiques ordinaires comprises. Une attente du courtier immédiatement après un échec HTTP 429 du même agent n’ajoute aucun démarrage ; les attentes consécutives restent comptées. `retryAfter` indique quand le compteur horaire autorise un autre démarrage ; les autres vérifications restent applicables. |

Une exécution lancée par une planification n’agit pour le compte de personne. Elle travaille avec les instructions, les secrets et les outils configurés de l’agent, et ses dépenses comptent comme des dépenses d’automatisation dans les limites de l’organisation. Les actions de connecteur qu’elle demande à la plateforme d’exécuter ne se font au nom de personne et sont donc refusées. Elle ne garde cette autorité que tant que la planification peut agir dans le projet : désactiver la planification, la retirer ou désinstaller l’automatisation du projet empêche le démarrage suivant, fait échouer une exécution qui n’a pas encore commencé et retire à une exécution en cours les outils de son espace de travail. Si une personne lance elle-même l’automatisation, l’exécution agit plutôt pour le compte de cette personne, tant qu’elle peut modifier le projet. Une exécution lancée par un webhook ou un événement de la plateforme ne peut pas démarrer d’agents, et une automatisation qui n’est pas installée dans le projet de la tâche n’a pas accès à ses agents.

`moveToInProgress` décide de ce qui arrive à la carte. Par défaut, la carte passe à **En cours** et le résultat attend à **En revue** son [relecteur configuré](/fr/platform/projects/tasks#review-default), comme après **Démarrer l'agent** ; une revue encore en attente sur le travail précédent est retirée, jamais validée. Avec `false`, la carte reste où elle est et l’exécution ne demande aucune revue, ce qui convient à une tâche permanente dans **À faire**. L’exécution garde ce choix jusqu’au bout : quand elle se termine, son rapport et ses fichiers arrivent comme d’habitude, et la carte n’est ni déplacée ni envoyée en revue, même si quelqu’un l’a entre-temps passée à **En cours**. Ce démarrage ne s’exécute que sous un travail ouvert (**Backlog**, **À faire** ou **En cours**) : une carte qui attend à **En revue** répond `in_review`, une carte close `closed`, si bien que la carte ne présente jamais un travail antérieur au jugement, ou comme terminé, pendant qu’un nouveau travail s’exécute dessous.

Une nouvelle tentative automatique est possible si le type d’échec le permet, tant que la tâche garde son statut et son responsable d’origine et qu’aucune nouvelle décision de statut, d’affectation, d’archivage ou de revue n’est intervenue. Modifier une valeur puis la rétablir met aussi fin à cette tentative ; les commentaires ne l’arrêtent pas. Les limites de tentatives, les autorisations de la planification et les vérifications de l’espace de travail restent applicables. Une occurrence ultérieure peut lancer un nouveau travail lorsque les conditions sont réunies.

### Importer chaque issue selon une planification

Un import d’issues lit au plus un lot par exécution, jusqu’à 500 issues, et indique où commence le lot suivant. Une personne le poursuit avec **Poursuivre l'import** ; une planification conserve plutôt la position entre ses occurrences, si bien que chaque occurrence importe un lot à partir de l’endroit où la précédente s’est arrêtée, jusqu’à ce que toutes les issues ouvertes aient été lues, et l’occurrence suivante commence la passe d’après. Lis la position avec `task.get_import_cursor`, transmets-la à l’import et enregistre son `nextCursor` avec `task.save_import_cursor` :

```yaml
nodes:
  - id: position
    type: task.get_import_cursor
    onError: continue
    input: { projectId: <the project's ID>, externalSystem: github, source: owner/repo }
  - id: issues
    type: subautomation
    automation: github-import-issues
    onError: continue
    input:
      projectId: <the project's ID>
      owner: owner
      repo: repo
      limit: 500
      cursor: '{{ nodes.position.output.cursor }}'
  - id: progress
    type: task.save_import_cursor
    onError: continue
    input:
      projectId: <the project's ID>
      externalSystem: github
      source: owner/repo
      revision: '{{ nodes.position.output.revision }}'
      next: '{{ nodes.issues.output.nextCursor ?? "" }}'
```

`source` est le nom que tu donnes à la liste ; les automatisations qui nomment la même source partagent une même passe. La lecture indique aussi `revision`, le jeton de comparaison de la position, et l’enregistrement le renvoie : la position n’avance que tant qu’elle en est encore à cette révision. Chaque lot enregistré, chaque fin de passe et chaque redémarrage fait passer à une nouvelle révision, et aucune révision ne se répète, même quand le texte du curseur se répète. Un import qui échoue n’enregistre rien, si bien que l’occurrence suivante reprend le même lot. Un enregistrement fait avec une révision antérieure est refusé (`conflict`) et n’écrit rien, qu’il vienne d’une exécution qui se chevauche, d’une exécution retardée au-delà de la fin de sa passe ou d’une exécution qui détient encore une position antérieure à un redémarrage. Après trois lectures d’une même position sans enregistrement, la lecture suivante recommence la passe (`restarted`) au lieu de réessayer une position que la source refuse sans cesse, par exemple après le renommage du dépôt. L’enregistrement indique `batch` et `drained`, qu’un reçu peut rapporter. Chaque exécution rafraîchit aussi jusqu’à 500 issues importées auparavant, en commençant par celles vérifiées le moins récemment, si bien qu’une grande collection est rafraîchie sur plusieurs occurrences.

## Comprendre l’absence de démarrage

Vérifie d’abord **Actif**, la version en service et le dernier déclenchement. Lis ensuite le motif éventuellement enregistré :

| Motif ou symptôme | Vérification |
| --- | --- |
| `not_deployed` | Mets une version testée en service. Un brouillon enregistré ne suffit pas. |
| `start_refused` | Compare le schéma de la version active à l’enveloppe du déclencheur et corrige l’erreur de validation ou de démarrage indiquée. |
| `unusable_cron` | Corrige l’expression ou le fuseau, puis enregistre. Les autres horaires continuent pendant que celui-ci est ignoré. |
| `paused_after_failures` | La planification s’est désactivée d’elle-même après des échecs répétés. Voir [Quand une planification se met en pause](#quand-une-planification-se-met-en-pause). |
| Identifiant du webhook refusé | Vérifie l’URL actuelle et l’activation. Les jetons inconnus et désactivés reçoivent volontairement le même refus. |
| Exécution présente, mais inachevée | Ouvre les [journaux d’exécution](/fr/platform/automations/execution-logs). Le démarrage a réussi ; le problème se trouve dans le workflow. |

La date du dernier déclenchement avance lorsqu’une exécution démarre réellement. Un déclencheur arrivé à échéance mais incapable de démarrer enregistre plutôt un départ ignoré. Tu peux ainsi le distinguer d’un workflow démarré puis tombé en échec.

## Quand une planification se met en pause

Une planification dont les exécutions échouent de la même façon à chaque occurrence continuerait sinon d’échouer indéfiniment. Tale compte donc les exécutions lancées par un déclencheur qui échouent sur une erreur qu’une nouvelle tentative ne corrigera pas : le code de l’automatisation elle-même (`node_error`), un connecteur (`connector_error`), une réponse du modèle qui ne respecte pas son schéma (`llm_output_invalid`) ou le fournisseur de modèles de l’organisation (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). Une exécution réussie remet le compteur à zéro. Les autres échecs, comme une limite de débit ou un fournisseur injoignable, ne comptent pas et ne remettent pas non plus le compteur à zéro. Une planification qui s’est déjà mise en pause d’elle-même fait exception : elle garde le compteur qui a provoqué la pause, même si une exécution encore en cours à ce moment-là réussit ensuite, et seul l’enregistrement du déclencheur le remet à zéro.

Après cinq échecs de ce type d’affilée, la planification désactive **Actif** et enregistre `paused_after_failures`. La section **Déclencheur** affiche alors la pause, le code et l’heure du dernier échec, ainsi que **Voir l’exécution**, qui ouvre cette exécution. Tant que des exécutions échouent alors que la planification est encore active, la section indique combien ont échoué d’affilée. Les Propriétaires et Admins reçoivent une notification par la cloche, et aussi par e-mail si l’organisation dispose d’une boîte mail connectée ; le journal d’audit enregistre la pause. Ils peuvent désactiver ces avis avec **Alertes d'automatisation** dans **Paramètres > Notifications**.

Ouvre l’exécution en échec pour lire l’erreur, puis corrige l’automatisation ou sa connexion. Active ensuite **Actif** et enregistre. Chaque enregistrement du déclencheur repart d’un compteur à zéro, qu’il réactive la planification ou la laisse désactivée, et marque les avis comme lus.

Les déclencheurs webhook et événement de la plateforme comptent les échecs de la même façon, mais ne sont jamais mis en pause. Leurs exécutions portent une livraison ou un événement, qu’un déclencheur en pause perdrait.

## Suspendre ou remplacer le déclencheur

Désactive **Actif** et enregistre pour suspendre les départs en conservant configuration et historique. Réactive-le pour reprendre. **Retirer le déclencheur** supprime la liaison et rend l’URL d’un webhook inutilisable.

Le déclencheur appartient au nom de l’automatisation, pas à une version. Un déploiement ou un retour à une version précédente conserve l’horaire ou l’URL et change la version utilisée par les prochains départs. Modifier le déclencheur ne crée pas de version du workflow. Vérifie donc aussi ses paramètres lorsqu’un déploiement change les données attendues.
