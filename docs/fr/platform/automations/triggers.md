---
title: Démarrer les automatisations automatiquement
description: Lance une automatisation selon une planification, depuis un webhook ou sur un événement de la plateforme, vérifie ce que reçoit chaque exécution et comprends pourquoi un démarrage a été ignoré.
---

La section **Déclencheur** de l’onglet **Général** d’une automatisation définit quand elle démarre seule : selon une planification, quand un autre système envoie une requête, ou quand quelque chose se passe dans Tale. Chaque déclencheur utilise la version en service en mode réel. Avant d’en activer un, vérifie ce que recevront ses exécutions et que les actions externes du workflow sont prêtes.

<Frame caption="Le déclencheur d’un paquet fourni arrive désactivé : sa planification est définie et ses prochaines exécutions sont listées, mais rien ne démarre tant que tu ne l’actives pas.">

![L’onglet Général de Triage the Gmail inbox avec l’interrupteur Enabled désactivé, Schedule comme type de déclencheur, le format Repeat avec une planification toutes les 6 heures, le fuseau horaire UTC, Start the latest one when Tale is back sous Missed runs et les prochaines exécutions listées sous Would run at.](/images/platform/automation-general-trigger.webp)

</Frame>

## Choisir le mode de démarrage

| Type de déclencheur | Usage | Données transmises à l’exécution |
| --- | --- | --- |
| **Planification** | Travail périodique à des heures locales ou à intervalles réguliers. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | Réception d’une livraison d’un autre système. | `{ trigger: "webhook", payload: … }` |
| **Événement de la plateforme** | Quelque chose qui se passe dans l’organisation, comme une nouvelle tâche. | `{ trigger: "event", event: "…", payload: … }` |

Chaque type peut aussi ajouter une [entrée fixe](#entree-fixe) : des valeurs que chaque exécution reçoit en plus de ces champs, par exemple le dépôt que lit un tri planifié.

Une automatisation possède un seul déclencheur configuré à la fois. Changer son type remplace la liaison précédente. Remplacer un webhook révoque immédiatement son URL ; en recréer un plus tard ne restitue pas ces identifiants.

Un client API ou MCP peut aussi démarrer sans déclencheur configuré. Sa clé API et ses droits sur le projet autorisent l’appel, et il fournit directement les données du workflow. Consulte la [référence API](/fr/develop/api-reference).

## Définir une planification

<Steps>

<Step title="Ouvrir les paramètres du déclencheur">

Ouvre l’automatisation, puis son onglet **Général**. Sans liaison, la section **Déclencheur** indique que l’automatisation ne s’exécute que lancée à la main ou via l’API. Choisis **Ajouter un déclencheur**. Un nouveau déclencheur est une **Planification** qui s’exécute chaque jour à 09:00 dans ton fuseau horaire, avec **Actif** désactivé. Laisse-le ainsi tant que le workflow ne doit pas encore démarrer seul.

</Step>

<Step title="Choisir une répétition">

Laisse **Format de la planification** sur **Répétition** et ouvre **Planification**. Les choix rapides sont **Toutes les 15 minutes**, **Toutes les heures**, ainsi que des exécutions quotidiennes, en semaine, hebdomadaires et mensuelles à une heure donnée. Les choix hebdomadaire et mensuel reprennent le jour de la semaine et le jour du mois d’aujourd’hui, et chaque choix avec une heure garde l’heure la plus tôt de la planification. Choisir une option ferme la fenêtre et la reporte dans le formulaire. Sous les choix rapides et les vues personnalisées, la fenêtre liste les trois prochaines exécutions de la planification que tu composes.

<Frame caption="Les choix rapides, la ligne propre à la planification enregistrée avec sa phrase, et les trois prochaines exécutions.">

![La fenêtre Schedule dans l’onglet General de Triage the Gmail inbox : les choix rapides Every 15 minutes, Every hour, Daily at 9:00 AM, Every weekday at 9:00 AM, Weekly on Saturday at 9:00 AM et Monthly on day 10 at 9:00 AM ; Custom interval, coché, avec Every 6 hours ; Custom times ; et les trois prochaines exécutions en UTC.](/images/platform/automation-trigger-schedule-presets.webp)

</Frame>

</Step>

<Step title="Ou composer la tienne">

Choisis **Horaires personnalisés** pour démarrer à des heures précises : sélectionne **Jour**, **Semaine**, **Mois** ou **Année**, l’intervalle (par exemple toutes les 2 semaines), les jours de la semaine ou le jour, puis jusqu’à 12 horaires sous **À**. **Ajouter un horaire** ajoute un horaire une heure après le dernier. Un horaire déjà présent dans la liste ne s’exécute qu’une fois, et l’enregistrement trie les horaires.

<Frame caption="Horaires personnalisés : en semaine à 9 h 00 et 17 h 30, avec les exécutions qui en découlent.">

![La vue Custom times du sélecteur de planification : Week sélectionné, every 1 week, du lundi au vendredi choisis, les heures 9:00 AM et 5:30 PM avec Add time en dessous, les trois prochaines exécutions en UTC, et Cancel et Save.](/images/platform/automation-trigger-schedule-custom-times.webp)

</Frame>

Choisis **Intervalle personnalisé** pour démarrer toutes les quelques minutes ou heures : jusqu’à toutes les 30 minutes, par pas qui divisent une heure, ou jusqu’à toutes les 12 heures, par pas qui divisent une journée, à un nombre donné de minutes après l’heure pile. Garde les jours de la semaine où elle doit s’exécuter et, avec **Seulement entre**, limite-la aux heures comprises entre deux horaires. Sous les heures, le sélecteur indique la première et la dernière exécution de la journée.

<Frame caption="Intervalle personnalisé : toutes les 15 minutes en semaine, uniquement entre 8 h 00 et 18 h 00.">

![La vue Custom interval du sélecteur de planification : toutes les 15 minutes, du lundi au vendredi choisis, Only between coché de 8:00 AM à 6:00 PM, la ligne Each day, the first run starts at 8:00 AM and the last at 5:45 PM, les trois prochaines exécutions en UTC, et Cancel et Save.](/images/platform/automation-trigger-schedule-interval.webp)

</Frame>

**Enregistrer**, Entrée ou Ctrl+Entrée (Cmd+Entrée sur Mac) applique la planification personnalisée ; **Annuler** ou Échap l’abandonne.

</Step>

<Step title="Choisir le fuseau horaire">

Les heures de la planification s’entendent dans le fuseau choisi sous **Fuseau horaire**. Par défaut, c’est le tien ; cherche un autre fuseau IANA comme `Europe/Zurich` quand le travail suit les horaires d’un autre bureau.

</Step>

<Step title="Lire les prochaines exécutions">

**Prochaines exécutions** liste les cinq prochains démarrages dans le fuseau de la planification et, si ton propre fuseau est différent, le même moment dans ton fuseau horaire. Tant que des modifications ne sont pas enregistrées, le titre devient **Prochaines exécutions (non enregistrées)**. Tant que le déclencheur est désactivé ou qu’aucune version n’est en service, il devient **S’exécuterait à**, et la ligne en dessous indique ce qui manque.

</Step>

<Step title="Enregistrer et activer">

Clique sur **Enregistrer** à côté des onglets. Sous [Cette exécution reçoit](#verifier-ce-que-recoit-une-execution), vérifie que la version en service accepte l’entrée. Quand tout est prêt, active **Actif** et enregistre à nouveau. La prochaine exécution lancée apparaît sous **Exécutions**, et la section **Déclencheur** l’affiche comme dernière exécution.

</Step>

</Steps>

**Intervalle personnalisé** compte à partir de minuit, heure locale : toutes les 2 heures, 15 minutes après l’heure pile, démarre donc à 00:15, 02:15 et ainsi de suite. **Seulement entre** inclut le début et s’arrête avant la fin : de 08:00 à 18:00, toutes les 15 minutes, la dernière exécution part à 17:45. Une fin antérieure au début s’exécute de nuit, et les heures après minuit appartiennent au jour où la plage a commencé : le vendredi de 22:00 à 06:00 se prolonge jusqu’au samedi matin, mais ne s’exécute pas le samedi soir. Une fin à 00:00 s’exécute jusqu’à minuit, et un début égal à la fin couvre toute la journée. Si aucune exécution ne tombe entre les deux horaires, par exemple toutes les 6 heures de 08:00 à 11:00, le sélecteur le signale et **Enregistrer** attend que tu élargisses la plage ou raccourcisses l’intervalle.

### Lors d’un changement d’heure

Une planification garde ses heures locales lors des passages à l’heure d’été et à l’heure d’hiver :

- Une heure sautée ce jour-là démarre une fois, décalée de la durée du saut. Dans `Europe/Zurich`, une exécution prévue à 02:30 démarre à 03:30 le 29 mars 2026.
- Une heure qui revient deux fois démarre une fois, à sa première occurrence.
- **Toutes les N minutes** et **Toutes les N heures** gardent en revanche leur intervalle réel : elles s’exécutent deux fois pendant l’heure qui se répète et pas du tout pendant l’heure sautée.

**Prochaines exécutions** marque d’un **Changement d’heure** le démarrage concerné et explique ce qui se passe.

### Quand des exécutions sont manquées

**Exécutions manquées** décide de ce que fait une planification des horaires prévus pendant que Tale était indisponible, par exemple pendant une mise à jour :

| Choix | Ce qui se passe au retour de Tale |
| --- | --- |
| **Lancer la dernière au retour de Tale** (par défaut) | Le dernier horaire manqué s’exécute une fois, quel que soit le retard. Les horaires manqués plus anciens sont comptés, pas rattrapés. |
| **Les ignorer** | Une exécution en retard de plus de 10 minutes ne démarre pas ; elle est comptée comme manquée. |

Par exemple, une planification quotidienne à 09:00 manque son démarrage pendant que Tale est arrêté de 08:30 à 10:15. Avec le réglage par défaut, une exécution démarre à 10:15 pour 09:00 ; avec **Les ignorer**, rien ne démarre, et la section **Déclencheur** indique 1 exécution manquée. Dès que des exécutions comptent comme manquées, la section indique combien et entre quels horaires, en comptant jusqu’à 1 000. Avec le réglage par défaut, ce sont les horaires antérieurs à celle qui a démarré, comme les démarrages précédents d’une planification toutes les 15 minutes pendant la même interruption. Le temps pendant lequel la planification était désactivée ou en pause, et le temps avant son enregistrement, ne comptent jamais comme manqués.

## Utiliser une expression cron

Passe **Format de la planification** sur **Cron (avancé)** si tu as déjà une expression cron ou s’il te faut un motif que **Répétition** ne propose pas. Les cinq champs représentent minute, heure, jour du mois, mois et jour de la semaine.

```text
*/15 * * * *     toutes les quinze minutes
0 9 * * 1-5      à 09:00 du lundi au vendredi
0 6 1 * *        à 06:00 le premier du mois
30 8 1 * 1       à 08:30 le premier du mois et chaque lundi
```

Les champs acceptent `*`, nombres, plages, pas et listes séparées par des virgules. 0 et 7 désignent le dimanche. Si le jour du mois et celui de la semaine sont tous deux limités, l’un ou l’autre suffit ; le dernier exemple tourne donc chaque lundi ainsi que le premier de chaque mois. Quand **Répétition** peut dire la même chose, la ligne sous le champ la reformule, par exemple « Signifie : Tous les jours ouvrés à 09:00 ». Une expression illisible, ou qui désigne une date qui n’arrive jamais comme `0 0 30 2 *`, affiche la raison sous le champ ; **Prochaines exécutions** reste vide et **Enregistrer** attend que tu la corriges.

Une expression cron suit les mêmes règles de changement d’heure : si sa minute et son heure sont des nombres, elle désigne des heures précises ; si sa minute ou son heure commence par `*`, elle garde son intervalle réel.

Passer de **Répétition** à **Cron (avancé)**, et inversement, convertit la planification quand l’une dit exactement la même chose que l’autre. Sinon, par exemple pour une planification à 09:00 et 17:30, le champ le signale, et les deux saisies restent dans le formulaire jusqu’à l’enregistrement. Une planification enregistrée auparavant comme expression cron s’ouvre en **Répétition** quand une répétition dit exactement la même chose, avec une note qui rappelle l’expression enregistrée. L’enregistrer sans modification conserve l’expression cron ; une planification modifiée est enregistrée comme répétition. Une expression cron que **Répétition** ne peut pas exprimer s’ouvre en **Cron (avancé)**.

## Recevoir un webhook

Choisis **Webhook**, puis enregistre pour créer l’URL. **URL du webhook — copie-la maintenant** ne l’affiche qu’une fois : une URL par projet dans lequel l’automatisation est installée, ou une pour l’organisation si elle n’est installée dans aucun. Copie chaque URL dont tu as besoin ; le token à la fin n’est conservé que sous forme de hash. Ensuite, la section liste les adresses avec le token masqué, sous **URL des projets** ou, pour l’organisation, sous **Point de terminaison du webhook**. **Renouveler le token** crée une nouvelle URL. Une automatisation installée dans des projets ne s’exécute que via une URL de projet.

**Envoyer une requête de test** contient une commande `curl` prête à l’emploi. Juste après la création de l’URL, la commande la contient ; ensuite, elle la lit dans `TALE_WEBHOOK_URL`, la variable où le système émetteur doit la garder. Elle envoie un petit corps JSON avec un `Idempotency-Key`. Le JSON devient `payload` à l’intérieur de l’entrée, et non directement ses champs de premier niveau ; les autres contenus passent comme texte. La limite est de 256 KiB ; téléverse les grands documents séparément. Une requête acceptée renvoie l’identifiant de l’exécution sans attendre sa fin.

Ainsi, le corps `{ "invoiceId": "inv-1" }` parvient au workflow sous cette forme :

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Fournis un identifiant de livraison, par exemple `Idempotency-Key` ou un en-tête pris en charge de l’expéditeur. Le même identifiant renvoie l’exécution initiale pendant 24 heures. Sans identifiant, un corps identique envoyé à la même URL dans les deux minutes est considéré comme un doublon. Utilise des identifiants distincts si des contenus identiques correspondent à des travaux séparés. [Webhooks](/fr/develop/webhooks) détaille en-têtes, chemins de projet, erreurs et réponses.

**Livraisons récentes** liste les dix dernières exécutions lancées par le webhook, les plus récentes d’abord, chacune avec son statut et **Voir l’exécution**. Tant que Tale se souvient d’une livraison, la ligne indique aussi comment il reconnaît une répétition : **ID issu de** l’en-tête lu, ou **Sans ID de livraison**. Une requête refusée par Tale n’a lancé aucune exécution et n’apparaît pas ; la réponse reçue par l’expéditeur en donne la raison.

<Frame caption="Un webhook installé dans deux projets : une URL par projet, une requête de test et les livraisons qui ont lancé des exécutions.">

![La section Trigger d’un webhook : la dernière exécution a réussi, Enabled est activé, Project URLs liste Website relaunch et Customer onboarding portal avec le jeton masqué, puis Rotate token, une requête de test curl qui lit l’URL dans TALE_WEBHOOK_URL, Recent deliveries avec deux exécutions réussies, chacune ID from idempotency-key, et This run receives avec le payload.](/images/platform/automation-trigger-webhook.webp)

</Frame>

<Warning>

L’URL autorise le démarrage. Protège-la comme un identifiant et ne la transmets qu’au système expéditeur. **Renouveler le token** demande une confirmation, produit ensuite un remplacement et invalide l’ancienne URL. Retirer ou remplacer le déclencheur la révoque également. Mets l’expéditeur à jour après un renouvellement.

</Warning>

## Réagir à un événement de la plateforme

Choisis **Événement de la plateforme**, puis l’événement sous **Nom de l’événement**. La liste regroupe les événements par sujet et affiche pour chacun son nom, son ID et le moment où il se produit ; tape une partie de l’un d’eux pour chercher. Enregistre, puis active **Actif** quand tout est prêt.

<Frame caption="Les événements, regroupés selon ce qu’ils concernent, chacun avec son nom, son ID et le moment où il est émis.">

![La liste Event name ouverte pour un déclencheur Platform event : un champ de recherche au-dessus des groupes Tasks, avec Task created et Task status changed, Comments, avec Comment added et Mentioned in a comment, et Conversations, chaque événement avec son ID et une phrase qui dit quand il est émis.](/images/platform/automation-trigger-event.webp)

</Frame>

| Événement | ID | Déclenché quand | `payload` contient |
| --- | --- | --- | --- |
| **Tâche créée** | `task.created` | Une tâche est créée sur un tableau, via l’API ou par un import. | `taskId`, `projectId`, `actorType`, `actorId` |
| **Statut de tâche modifié** | `task.status_changed` | Une personne déplace une tâche vers un autre statut. Les déplacements faits par un agent ne comptent pas. | `taskId`, `projectId`, `fromStatus`, `toStatus`, `actorType`, `actorId` |
| **Commentaire ajouté** | `comment.created` | Un commentaire est publié sur une tâche. | `comment` avec `body`, `taskId`, `projectId` et `mentions` |
| **Mention dans un commentaire** | `comment.mentioned` | Un commentaire de tâche mentionne quelqu’un avec @. | `comment`, `taskId`, `mentions`, `actorType`, `actorId` |
| **Conversation ouverte** | `conversation.created` | Une conversation s’ouvre dans la boîte de réception : un e-mail arrive ou une conversation externe est reflétée. | `conversationId`, `channel` |
| **Message reçu** | `conversation.message_received` | Un message arrive dans une conversation existante. | `conversationId`, `messageId`, `direction` |
| **Contact créé** | `contact.created` | Un contact est ajouté via l’API, l’application ou un import. | `contactId` |
| **Contact modifié** | `contact.updated` | Les informations d’un contact changent. | `contactId` |
| **Contact supprimé** | `contact.deleted` | Un contact est supprimé. | `contactId` |
| **Projet créé** | `project.created` | Un projet est créé. | `projectId`, `name`, `actorId` |

La charge utile contient des identifiants, pas des enregistrements complets : si le workflow a besoin de plus, il lit la tâche, le commentaire ou le contact avec une étape. Une nouvelle tâche parvient par exemple au workflow sous cette forme :

```json
{
  "trigger": "event",
  "event": "task.created",
  "payload": {
    "taskId": "5e2f9d34-8a71-4c6b-b0d2-91a7e3c4f815",
    "projectId": "0b9c6a52-5d1e-4f0a-9c3e-2f6d8a1b7e40",
    "actorType": "user",
    "actorId": "c41d7e88-2b3a-4f95-8e60-7d5a9b1c0f23"
  }
}
```

Les événements des tâches, des commentaires et des projets appartiennent à un projet ; ceux des contacts et des conversations, non. Un événement d’un projet lance les automatisations installées dans ce projet et celles qui ne sont installées dans aucun projet, et leurs exécutions appartiennent à ce projet. Une automatisation installée uniquement dans d’autres projets n’y réagit pas. Un événement sans projet lance une automatisation installée dans un seul projet, dans ce projet. Si ce projet est archivé, ou si les entrées de l’automatisation refusent l’événement, aucune exécution ne démarre et le déclencheur en indique la raison. Les autres automatisations qui écoutent cet événement démarrent quand même. Sous **Nom de l’événement**, le champ indique quels événements lancent cette automatisation.

Un événement produit par l’exécution d’une automatisation ne relance jamais cette même automatisation, et une exécution lancée par un événement ne lance pas d’autres automatisations : un workflow ne peut ainsi se relancer sans fin par ses propres changements, ni seul ni avec un autre. Cela vaut pour tout ce que fait l’exécution elle-même : ses étapes, ses appels de connecteurs et les outils de son propre agent. Le travail qu’une étape confie à un agent de projet appartient à cet agent : un événement qu’il produit peut donc relancer l’automatisation. Veille à ce que ce travail ne produise pas l’événement qu’attend l’automatisation.

## Vérifier ce que reçoit une exécution

**Cette exécution reçoit** montre l’entrée de la prochaine exécution telle que le déclencheur la construit : ses propres champs, son entrée fixe et, pour un webhook ou un événement, un exemple de `payload`. Pour une planification, `firedAt` est l’heure prévue, en millisecondes depuis 1970 (UTC). **Copier l’entrée** te permet de la reprendre dans un essai.

En dessous, la section compare l’entrée avec les entrées de la version en service. Elle indique par exemple **La version 3 accepte cette entrée**, ou avertit **La version 3 n’accepte pas cette entrée** et propose une correction : ajouter les champs manquants à l’entrée fixe, ou modifier les entrées dans l’éditeur. Le corps d’un webhook n’est connu qu’à l’arrivée d’une requête ; il ne compte donc jamais contre la version. La même vérification a lieu quand tu enregistres un déclencheur et quand tu mets une version en service ; l’enregistrement passe quand même et nomme le problème.

### Entrée fixe

Une entrée fixe ajoute les mêmes valeurs à chaque exécution lancée par le déclencheur, comme le `owner` et le `repo` dont a besoin un tri GitHub planifié. Ouvre **Ajouter une entrée fixe** et saisis un objet JSON d’au plus 16 KiB. Les champs propres au déclencheur (`trigger`, `firedAt`, `event` et `payload`) priment sur elle ; elle ne peut donc pas les contenir. Ce sont de simples données : un modèle comme `{{ input.owner }}` arrive sous forme de texte, et l’enregistrement le signale.

Quand la version en service exige des champs que le déclencheur n’envoie pas, la section est déjà ouverte, et **Ajouter les 2 champs manquants** (ou autant qu’il en manque) écrit pour chacun un espace réservé du bon type et place le curseur dans le premier. Remplace les espaces réservés et enregistre. Une exécution planifiée reçoit alors :

```json
{
  "owner": "acme",
  "repo": "website",
  "trigger": "schedule",
  "firedAt": 1791529200000
}
```

### Exécuter maintenant

**Exécuter maintenant** lance une fois la version en service, en réel, avec l’entrée qu’envoie le déclencheur enregistré, comme le ferait le déclencheur. Pour une planification, il affiche cette entrée et demande de confirmer avec **Lancer l’exécution**. Pour un webhook ou un événement, il ouvre la boîte de dialogue d’exécution avec l’exemple à modifier. Il attend qu’une version soit en service et que tes modifications du déclencheur soient enregistrées. Le résultat s’affiche sous le bouton : **Exécution lancée.** avec **Voir l’exécution**, ou la raison pour laquelle rien n’a démarré. La planification et la dernière exécution du déclencheur ne changent pas.

## Activer le déclencheur après la mise en service

Un nouveau déclencheur démarre désactivé, tout comme celui d’un paquet fourni. Quand tu mets une version en service, dans l’éditeur ou en téléversant un paquet, et que son déclencheur est désactivé, un avis indique **Son déclencheur est désactivé**. **Activer le déclencheur** active le déclencheur enregistré tel quel, et l’avis indique alors **Le déclencheur est activé.**

Quand la version en service refuserait ce qu’envoie le déclencheur, ou qu’un webhook n’a pas encore d’URL, l’avis propose plutôt **Vérifier le déclencheur**. Cela ouvre la section **Déclencheur** de l’onglet **Général**, où tu ajoutes d’abord l’entrée fixe ou crées l’URL. Les paquets GitHub fournis en sont un exemple : leurs planifications ont besoin d’un dépôt, comme l’explique [Automatisations livrées](/fr/platform/automations/builtin).

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

L’étape renvoie l’exécution qu’elle a démarrée, et la chronologie de la tâche affiche cette exécution comme **automatisation**, avec un lien vers l’exécution de l’automatisation. Un agent qui travaille sur d’autres tâches est tout de même lancé : son exécution travaille dans un [worker](/fr/platform/projects/project-agents#run-one-agent-on-several-tasks) distinct, et quand tous les workers d’agent de ton organisation sont occupés, elle en attend un et démarre d’elle-même. Quand elle ne démarre rien, l’étape réussit tout de même et en donne la raison, si bien que l’occurrence est consignée au lieu d’être mise en file d’attente :

| Réponse | Signification |
| --- | --- |
| `started: true` | L’exécution de l’agent a démarré ; `runId` l’identifie. Avec `waitingReason`, l’exécution attend de la place avant de travailler : `org_limit` quand tous les workers d’agent de ton organisation sont occupés, `host` quand l’hôte des sandboxes est plein, `destroy_pending` quand l’espace de travail qu’elle utiliserait est en cours de suppression, `exec_limit` quand sa sandbox termine encore un processus précédent. Elle démarre d’elle-même dès que la place se libère. |
| `already_running` | L’exécution précédente de la tâche travaille encore et prend le travail en charge. Rien de nouveau ne démarre, et l’occurrence n’attend pas derrière elle. |
| `in_review` | Avec `moveToInProgress: false`, la carte attend son relecteur enregistré, une personne ou un agent. Rien n’est assigné ni démarré, et la revue conserve ce destinataire. |
| `closed` | Avec `moveToInProgress: false`, la carte est **Terminé** ou **Annulé** (`taskStatus`). Rien n’est assigné ni démarré. |
| `agent_busy` | N’est plus renvoyé : un agent qui travaille sur une autre tâche est lancé dans un worker distinct, ou en attend un. D’anciennes exécutions d’une automatisation peuvent encore l’afficher. |
| `blocked` | Une tâche dont celle-ci dépend est encore ouverte (`blockedBy`). |
| `paused` | La tâche a déjà reçu trois démarrages par des automatisations et des agents au cours de la dernière heure, les relances automatiques ordinaires comprises. Une attente du courtier immédiatement après un échec HTTP 429 du même agent n’ajoute aucun démarrage ; les attentes consécutives restent comptées. `retryAfter` indique quand le compteur horaire autorise un autre démarrage ; les autres vérifications restent applicables. |

Une exécution lancée par une planification n’agit pour le compte de personne. Elle travaille avec les instructions, les secrets et les outils configurés de l’agent, et ses dépenses comptent comme des dépenses d’automatisation dans les limites de l’organisation. Les actions de connector qu’elle demande à la plateforme d’exécuter ne se font au nom de personne et sont donc refusées. Elle ne garde cette autorité que tant que la planification peut agir dans le projet : désactiver la planification, la retirer ou désinstaller l’automatisation du projet empêche le démarrage suivant, fait échouer une exécution qui n’a pas encore commencé et retire à une exécution en cours les outils de son espace de travail. Si une personne lance elle-même l’automatisation, l’exécution agit plutôt pour le compte de cette personne, tant qu’elle peut modifier le projet. Une exécution lancée par un webhook ou un événement de la plateforme ne peut pas démarrer d’agents, et une automatisation qui n’est pas installée dans le projet de la tâche n’a pas accès à ses agents.

`moveToInProgress` décide de ce qui arrive à la carte. Par défaut, la carte passe à **En cours** et le résultat attend à **En revue** son [relecteur configuré](/fr/platform/projects/tasks#review-default), comme après **Démarrer l'agent** ; une revue encore en attente sur le travail précédent est retirée, jamais validée. Avec `false`, la carte reste où elle est et l’exécution ne demande aucune revue, ce qui convient à une tâche permanente dans **À faire**. L’exécution garde ce choix jusqu’au bout : quand elle se termine, son rapport et ses fichiers arrivent comme d’habitude, et la carte n’est ni déplacée ni envoyée en revue, même si quelqu’un l’a entre-temps passée à **En cours**. Ce démarrage ne s’exécute que sous un travail ouvert (**Backlog**, **À faire** ou **En cours**) : une carte qui attend à **En revue** répond `in_review`, une carte close `closed`, si bien que la carte ne présente jamais un travail antérieur au jugement, ou comme terminé, pendant qu’un nouveau travail s’exécute dessous.

Une nouvelle tentative automatique est possible si le type d’échec le permet, tant que la tâche garde son statut et son responsable d’origine et qu’aucune nouvelle décision de statut, d’affectation, d’archivage ou de revue n’est intervenue. Modifier une valeur puis la rétablir met aussi fin à cette tentative ; les commentaires ne l’arrêtent pas. Les limites de tentatives, les autorisations de la planification et les vérifications de l’espace de travail restent applicables. Une occurrence ultérieure peut lancer un nouveau travail lorsque les conditions sont réunies.

### Réveiller la planification quand un agent libère sa place

Une planification qui exécute le rôle permanent d’un projet, comme un responsable qui distribue le travail, peut aussi se déclencher dès qu’un agent de son projet termine et que l’un de ses workers habituels se libère, au lieu d’attendre sa prochaine minute cron. Active-le avec `wakeOnSlotFreed: true` dans la configuration gérée de la planification, appliquée avec la CLI Tale ; une seule planification activée par projet peut l’avoir — une deuxième est refusée, tout comme l’installation de son automatisation dans un projet qu’une autre planification réveille déjà — et l’application n’offre aucun interrupteur pour cela. Chaque réveil est une occurrence ordinaire avec l’entrée habituelle `{ trigger: "schedule", firedAt }`, donc les réponses ci-dessus s’appliquent toujours. Plusieurs agents qui terminent pendant qu’un réveil est en attente n’en déclenchent qu’un seul. Un réveil attend tant que la propre carte du responsable a une exécution active ou une nouvelle tentative automatique prévue, que la carte refuserait le démarrage ou qu’elle n’est plus assignée à l’agent, jusqu’à `retryAfter` quand la tâche a pris trois démarrages dans l’heure, et, après une occurrence qui n’a rien servi, une minute qui double jusqu’à une heure, sans limite de tentatives. Les autres tâches du même agent ne bloquent pas le réveil ; la nouvelle exécution du responsable reçoit son propre worker ou attend la capacité nécessaire, comme d’habitude. Il ne compte comme servi qu’une fois que l’exécution de l’agent qu’il a démarrée s’est lancée et terminée. Tant que la planification est en pause après des échecs, désactivée ou sans `wakeOnSlotFreed`, le réveil attend et se déclenche une fois quand la planification est de nouveau enregistrée.

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

Le haut de la section **Déclencheur** indique où en est le déclencheur : l’heure de la dernière exécution qu’il a lancée, avec son statut et **Voir l’exécution**, ou **N’a encore lancé aucune exécution.** Quand le déclencheur est arrivé à échéance, ou qu’un événement est arrivé, sans que rien ne démarre, un avis en dessous en donne la raison, la correction et le chemin pour y arriver :

| Avis | Ce qui s’est passé | Que faire |
| --- | --- | --- |
| **Ignorée : aucune version déployée** | Le déclencheur est arrivé à échéance, mais il n’existe que des brouillons. | **Ouvrir l’éditeur** et mettre en service une version testée. |
| **Ignorée : l’entrée de l’exécution a été refusée** | La version en service a refusé ce qu’envoie le déclencheur. | Ajouter les champs manquants à l’[entrée fixe](#entree-fixe), ou modifier les entrées dans l’éditeur. |
| **Ignorée : le projet ne peut pas lancer d’exécutions** | Son projet est archivé, n’existe plus ou n’autorise plus l’automatisation. | **Modifier les projets** sous **Projets**, plus bas. |
| **Ignorée : l’exécution n’a pas pu démarrer** | Le démarrage a été refusé pour une autre raison. | Ouvrir **Détails techniques** pour lire le code et le message. |
| **Ignorée : la planification est illisible** | La planification ou son fuseau horaire était illisible. Rien ne démarre avant la correction. | **Modifier la planification** et enregistrer. |
| **3 exécutions manquées**, par exemple | Des exécutions étaient prévues pendant que Tale était indisponible. | Rien ; [Exécutions manquées](#quand-des-executions-sont-manquees) a décidé de ce qui a démarré. |
| **En pause après des échecs répétés** | La planification s’est désactivée d’elle-même. | Voir [Quand une planification se met en pause](#quand-une-planification-se-met-en-pause). |

**Détails techniques**, replié au départ, contient les faits bruts, en anglais : le code, la version qui a refusé le démarrage, son message et chaque problème avec son champ. Quand des exécutions précédentes ont aussi été manquées, l’avis indique combien. L’API expose les mêmes faits dans `lastSkipReason` et `lastSkipDetail` ; consulte la [référence API](/fr/develop/api-reference#verifier-le-declencheur-et-le-suspendre).

<Frame caption="Un démarrage refusé : l’avis dit pourquoi, propose la correction et garde les faits bruts sous Détails techniques.">

![La section Trigger d’une planification activée avec l’avis Skipped: the run’s input was refused, qui dit que le démarrage était dû le 10 octobre 2026 à 11 h 00, mais que la version 1 a refusé ce que le déclencheur envoie, avec Add the 2 missing fields et Open the editor ; Technical details est ouvert sur owner et repo, tous deux requis, le code AUTOMATION_INPUT_INVALID et le message. En dessous, la planification tourne toutes les 30 minutes, et This run receives se termine par l’avertissement que la version 1 n’accepte pas cette entrée.](/images/platform/automation-trigger-skip-reason.webp)

</Frame>

Certains démarrages manqués n’affichent aucun avis :

- Une requête de webhook refusée par Tale n’a lancé aucune exécution et n’a rien changé sur le déclencheur. Vérifie la réponse reçue par l’expéditeur ; [Webhooks](/fr/develop/webhooks) liste les réponses possibles. Une URL inconnue ou désactivée reçoit volontairement le même refus.
- Une exécution présente mais inachevée a bien démarré. Ouvre-la depuis **Exécutions** ; les [journaux d’exécution](/fr/platform/automations/execution-logs) expliquent ce qui s’y est passé.

La dernière exécution n’avance que lorsqu’une exécution démarre réellement. Un déclencheur arrivé à échéance mais incapable d’en lancer une enregistre plutôt un démarrage ignoré. Tu peux ainsi distinguer un déclencheur défaillant d’un workflow démarré puis tombé en échec.

## Quand une planification se met en pause

Une planification dont les exécutions échouent de la même façon à chaque occurrence continuerait sinon d’échouer indéfiniment. Tale compte donc les exécutions lancées par un déclencheur qui échouent sur une erreur qu’une nouvelle tentative ne corrigera pas : le code de l’automatisation elle-même (`node_error`), un connector (`connector_error`), une réponse du modèle qui ne respecte pas son schéma (`llm_output_invalid`) ou le fournisseur de modèles de l’organisation (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). Une exécution réussie remet le compteur à zéro. Les autres échecs, comme une limite de débit ou un fournisseur injoignable, ne comptent pas et ne remettent pas non plus le compteur à zéro. Une planification qui s’est déjà mise en pause d’elle-même fait exception : elle garde le compteur qui a provoqué la pause, même si une exécution encore en cours à ce moment-là réussit ensuite, et seul l’enregistrement du déclencheur le remet à zéro.

Après cinq échecs de ce type d’affilée, la planification désactive **Actif** et enregistre `paused_after_failures`. La section **Déclencheur** affiche alors la pause, le code et l’heure du dernier échec, ainsi que **Voir l’exécution**, qui ouvre cette exécution. Tant que des exécutions échouent alors que la planification est encore active, la section indique combien ont échoué d’affilée. Les Propriétaires et Admins reçoivent une notification par la cloche, et aussi par e-mail si l’organisation dispose d’une boîte mail connectée ; le journal d’audit enregistre la pause. Ils peuvent désactiver ces avis avec **Alertes d'automatisation** dans **Paramètres > Notifications**.

Ouvre l’exécution en échec pour lire l’erreur, puis corrige l’automatisation ou sa connexion. Active ensuite **Actif** et enregistre. Chaque enregistrement du déclencheur repart d’un compteur à zéro, qu’il réactive la planification ou la laisse désactivée, et marque les avis comme lus.

Les déclencheurs webhook et événement de la plateforme comptent les échecs de la même façon, mais ne sont jamais mis en pause. Leurs exécutions portent une livraison ou un événement, qu’un déclencheur en pause perdrait.

## Suspendre ou remplacer le déclencheur

Désactive **Actif** et enregistre pour suspendre les départs en conservant configuration et historique. Réactive-le pour reprendre. **Retirer le déclencheur** supprime la liaison et rend l’URL d’un webhook inutilisable.

Le déclencheur appartient au nom de l’automatisation, pas à une version. Un déploiement ou un retour à une version précédente conserve l’horaire ou l’URL et change la version utilisée par les prochains départs. Modifier le déclencheur ne crée pas de version du workflow. Vérifie donc aussi ses paramètres lorsqu’un déploiement change les données attendues.
