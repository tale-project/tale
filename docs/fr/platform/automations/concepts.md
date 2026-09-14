---
title: Concepts d’automatisation
description: Comprends les étapes du workflow, les versions, la mise en service, les déclencheurs et l’historique des exécutions.
---

Utilise une automatisation pour un travail qui suit un processus répétable. Le workflow décrit les étapes ; les versions enregistrées conservent les révisions, le déploiement choisit la version exécutée en réel et un déclencheur peut la lancer selon un horaire ou un événement. Chaque exécution permet d’examiner les données, les résultats et les opérations.

Tu préfères regarder d’abord ? L’épisode 5 ouvre l’automatisation de triage de bout en bout et décide une carte de validation à l’écran, sous-titres compris — enregistré sur l’ancienne version, où la carte se trouvait dans le chat ; dans cette version, elle se trouve sur la page de détail de l’exécution.

<Video src="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.mp4" poster="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.webp" captions="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.vtt" lang="fr" title="Épisode 5 — Automatisations & validations" caption="Épisode 5 — Automatisations & validations (2:34)">

</Video>

## Le document de workflow

Le `name` identifie l’automatisation. Utilise des segments en minuscules séparés par des tirets ; `/` regroupe les automatisations liées dans des dossiers, comme `billing/dunning-reminder`. Le premier segment ne doit pas être un nom de page réservé : `asks`, `builder`, `catalog`, `listing`, `metrics`, `runs`, `serving-preview` ou `upload`.

Le document contient aussi une `description`, un schéma JSON `inputs` pour les données reçues, les `nodes` qui exécutent les étapes et une expression `output` pour le résultat. Ses `tests` décrivent des exemples et les résultats attendus, vérifiés avant la mise en service.

```yaml
name: billing/dunning-reminder
description: Relancer un client sur une facture en retard.
inputs:
  type: object
  properties:
    invoiceId: { type: string }
  required: [invoiceId]
nodes:
  - id: invoice
    type: transform
    input:
      id: '{{ input.invoiceId }}'
    code: 'return { id: input.id, daysLate: 14 };'
  - id: message
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Rédige une relance polie pour la facture {{ nodes.invoice.output.id }}.'
output:
  text: '{{ nodes.message.output.text }}'
tests:
  - name: rédige une relance
    input: { invoiceId: 'inv-1' }
```

Le bloc `ui` conserve la disposition du canvas. Déplacer un nœud modifie sa position, sans changer son exécution.

### Les liaisons se déduisent, elles ne se déclarent pas

Il n’y a pas de liste de liaisons. Un nœud en lit un autre en le référençant — `{{ nodes.invoice.output.id }}` — et cette référence _est_ la liaison que trace le canvas. L’ordre d’exécution est un tri topologique sur ces liaisons déduites : supprimer une référence retire donc aussi une flèche, et deux nœuds qui se lisent l’un l’autre sont refusés comme une boucle.

Les templates utilisent une seule grammaire `{{ }}` d’expressions JavaScript sur `input`, `nodes.<id>.output` et, à l’intérieur d’un nœud qui itère, `item` et `index`.

### Le contrôle du flux vit sur le nœud

Brancher et répéter sont des champs du nœud plutôt que des types d’étape à part. Le canvas les montre donc comme des badges sur la boîte qu’ils concernent.

| Champ                        | Ce qu’il fait                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `when`                       | N’exécute le nœud que si l’expression est vraie ; ses dépendants sont ignorés avec lui        |
| `elseOf`                     | S’exécute exactement quand le nœud nommé a été ignoré par son propre `when`                   |
| `forEach`                    | S’exécute une fois par élément d’une collection, avec `item` et `index` disponibles           |
| `repeatUntil` / `maxRepeats` | Relance jusqu’à ce que l’expression soit vraie, avec un plafond (5 par défaut, 20 au maximum) |
| `onError`                    | `fail` arrête l’exécution ; `continue` note l’erreur et ignore les dépendants                 |

### Les types de nœud

Quatre types sont intégrés, et chaque action de connector comme chaque capacité native de la plateforme — recherche dans les connaissances, opérations sur documents — rejoint la même table à côté d’eux.

**`transform`** exécute du JavaScript pur pour remettre des données en forme. Sans réseau ni imports : le corps lit l’`input` résolue du nœud et doit retourner une valeur.

**`llm`** appelle un modèle de langage avec un prompt en template. `model` est obligatoire et toujours explicite — une automatisation n’en choisit jamais un à ta place (l’Auto du composer est une affaire de chat, et de chat seulement). La sortie est `{text}`, ou l’objet à la forme du schéma quand le nœud déclare un `outputSchema`.

**`agent`** exécute un tour d’un agent de code (Claude Code, Codex et les autres harnesses) dans la sandbox. Il lit les `files` mis en place, utilise des `skills`, des `connectors` relayés, des `tools` de plateforme accordés et des `secrets` injectés, et renvoie `{text, files, status}` ; `model` est obligatoire. Prends `llm` quand une complétion unique suffit, et `agent` seulement quand l’étape a besoin d’outils, de fichiers ou de plusieurs tours — un nœud agent en service s’exécute comme un tour asynchrone, il siège donc au niveau supérieur plutôt que dans une `subautomation` et n’itère pas avec `forEach`.

**`subautomation`** exécute une autre automatisation enregistrée comme un seul nœud ; son champ `automation` nomme `"name"` ou `"name@version"`. Sans version, c’est celle en service, et l’imbrication s’arrête à trois niveaux.

### Sortie structurée et non structurée

Une sortie **structurée** possède des champs nommés, accessibles avec `nodes.<id>.output.<field>`. Une sortie **non structurée** contient du texte libre. Référence-la avec `nodes.<id>.output.text` dans une expression textuelle ; ne la traite pas comme un objet possédant d’autres champs.

Un outil sans schéma de sortie produit une sortie non structurée. Pour transformer son texte en données structurées utilisables par les étapes suivantes, ajoute un nœud `llm` avec un `outputSchema`. En cas d’erreur, la validation indique la référence incorrecte et les champs ou contextes autorisés. Corrige-la avant d’enregistrer à nouveau.

## Les versions ne changent jamais

Enregistrer crée une version au lieu d’écraser la précédente. Chaque automatisation possède une numérotation commençant à 1 ; chaque version conserve la note de modification de son auteur. Le workflow d’une version existante reste inchangé.

Une exécution conserve la version avec laquelle elle a démarré. Les modifications suivantes ne changent donc pas ses étapes. Pour examiner une ancienne exécution, ouvre sa version enregistrée et compare les données avec le workflow. Cette immutabilité ne garantit pas une conservation illimitée : supprimer une automatisation ou son historique peut retirer ces enregistrements.

## La mise en service est un geste distinct

Une seule version par automatisation est en service, et c’est celle que lancent les déclencheurs. Mettre une version en service, ou revenir à une plus ancienne, est un geste unique qui ne réécrit aucun historique : la liste des versions reste exactement telle quelle, seul le pointeur bouge. Une automatisation peut aussi n’avoir aucune version en service et vivre uniquement à l’état de brouillon.

Une version ne devient éligible qu’une fois ses propres tests réussis. Les tests sont rangés dans le document : chacun porte un nom, une entrée, et des attentes sur la sortie comme sur les effets que l’exécution doit produire. Le résultat des tests d’une version est consigné au moment de l’enregistrement, si bien que la mise en service lit ce fait consigné au lieu de rejouer la suite.

<Note>

Une exécution réelle nécessite une version en service. Tu peux tester un brouillon enregistré avec **Essai** avant son déploiement.

</Note>

## Ce qui lance une exécution

Tu peux tester manuellement une version enregistrée ou exécuter en réel la version en service. Pour un démarrage automatique, configure l’un des trois déclencheurs : une planification avec expression cron et fuseau IANA, une URL de webhook protégée par un jeton, ou un événement nommé de la plateforme.

Le déclencheur appartient au nom de l’automatisation. Mettre une autre version en service conserve sa configuration et l’URL du webhook, mais les démarrages suivants utilisent la nouvelle version. Désactive le déclencheur pour suspendre les démarrages automatiques. [Déclencheurs de workflow](/fr/platform/automations/triggers) explique les horaires, l’authentification et les données fournies par chaque type.

## Ce qu’une exécution enregistre

Une exécution conserve son statut (`queued`, `running`, `waiting`, `success`, `failed` ou `cancelled`), son mode, son origine, ses données d’entrée et de sortie, ainsi qu’un point de reprise par nœud terminé. Sa trace explique les étapes tentées par le moteur.

Si le traitement doit rendre la main avant la fin, la même exécution reprend depuis ses points de reprise sans répéter les nœuds terminés. La liste des effets recense les écritures des connectors. Elle ne constitue pas un inventaire complet des changements effectués depuis une sandbox ou par des outils directs. L’historique reste soumis aux règles de conservation et de suppression.

Le mode **Essai** simule les opérations externes pendant la préparation. Le mode **Réel** peut les effectuer et exige des droits de développeur au démarrage. [Journaux d’exécution](/fr/platform/automations/execution-logs) explique comment vérifier la version enregistrée, les données résolues, les erreurs et les effets consignés.

## Là où un humain décide

Une approbation suspend l’exécution au statut `waiting` avant une écriture protégée. Approuver autorise le moteur à tenter l’opération, sans garantir sa réussite. Rejeter empêche l’opération et fait échouer l’exécution. Une question suspend aussi le traitement, mais demande une information plutôt qu’une permission.

Le statut `waiting` peut également indiquer qu’un agent travaille encore ou qu’un nœud vérifie périodiquement une condition. Consulte `waitingFor` : `approval` et `ask` nécessitent une personne ; `agent` et `repeat` reprennent normalement seuls. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique comment examiner et traiter les demandes humaines.

## Choisir un chat, une tâche ou une automatisation

| Besoin | Utilise |
| --- | --- |
| Poser une question et discuter de la réponse | Chat |
| Produire un résultat relu avec un responsable | Une tâche de projet, éventuellement assignée à un agent |
| Enchaîner des étapes ou réagir à un horaire, webhook ou événement | Une automatisation |

Consulte les [automatisations fournies](/fr/platform/automations/builtin) avant de créer la tienne. Un webhook démarre une automatisation ; ce n’est pas un type distinct d’agent de projet.

## Mettre le modèle en pratique

Workflow, versions, déploiement et déclencheur sont des éléments distincts d’une même automatisation. Suis [L’éditeur de workflow](/fr/platform/automations/editor) pour tester et mettre un changement en service, puis les [Journaux d’exécution](/fr/platform/automations/execution-logs) pour examiner son résultat.
