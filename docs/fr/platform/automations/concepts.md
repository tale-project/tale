---
title: Concepts d’automatisation
description: Le modèle derrière chaque automatisation — un document de workflow, un historique de versions qui ne change jamais, une seule version en service, les déclencheurs qui la lancent et les exécutions qu’elle enregistre.
---

Une automatisation, c’est un document de workflow enregistré sous un nom, plus tout ce que la plateforme conserve autour : l’historique des versions de ce document, la seule version en service, les déclencheurs autorisés à la lancer, et la trace de chaque exécution. Ouvre **Automatisations** dans la barre latérale et chaque ligne est l’un de ces noms, avec à côté la version en service. Trois idées de cette page commandent tout le reste — les versions ne changent jamais, la mise en service est un geste distinct, et un déclencheur se rattache au nom plutôt qu’à une version —, alors lis-les avant de construire quoi que ce soit.

Tu préfères regarder d’abord ? L’épisode 5 ouvre l’automatisation de triage de bout en bout et décide une vraie carte de validation à l’écran, sous-titres compris.

<Video src="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.mp4" poster="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.webp" captions="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.vtt" lang="fr" title="Épisode 5 — Automatisations & validations" caption="Épisode 5 — Automatisations & validations (2:34)">

</Video>

## Le document de workflow

Tout ce que fait une automatisation est déclaré dans un seul document. Son `name` est aussi son identité — des segments de slug en minuscules, séparés par des tirets, où `/` regroupe en dossiers les automatisations voisines, comme `billing/dunning-reminder`. Autour du nom viennent une `description`, un schéma JSON `inputs` qui décrit l’entrée d’exécution, les `nodes` qui font le travail, un `output` qui est la valeur de retour, et les `tests` qui décident si une version peut être mise en service.

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

Les positions sur le canvas voyagent dans un bloc `ui` que le moteur ignore : déplacer une boîte ne change donc jamais le comportement.

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

Trois types sont intégrés, et chaque action d’connector comme chaque capacité native de la plateforme — recherche dans les connaissances, opérations sur documents — rejoint la même table à côté d’eux.

**`transform`** exécute du JavaScript pur pour remettre des données en forme. Sans réseau ni imports : le corps lit l’`input` résolue du nœud et doit retourner une valeur.

**`llm`** appelle un modèle de langage avec un prompt en template. `model` est obligatoire et toujours explicite — la plateforme n’en choisit jamais un à ta place. La sortie est `{text}`, ou l’objet à la forme du schéma quand le nœud déclare un `outputSchema`.

**`subworkflow`** exécute une autre automatisation enregistrée comme un seul nœud, référencée en `"name"` ou `"name@version"`. Sans version, c’est celle en service, et l’imbrication s’arrête à trois niveaux.

### Sortie structurée et non structurée

La sortie de chaque type de nœud est de l’une des deux sortes, et c’est là que les auteurs trébuchent le plus. Une sortie **structurée** est une forme typée dans laquelle tu peux descendre avec `nodes.<id>.output.<field>`. Une sortie **non structurée** est du texte libre : seul `nodes.<id>.output.text` existe, et uniquement en contexte texte. Un outil qui ne déclare aucun schéma de sortie est non structuré par définition, et le seul pont prévu du texte vers des données structurées est un nœud `llm` avec un `outputSchema`.

La validation refuse l’erreur au lieu de la laisser surgir à l’exécution, et chaque message porte un code lisible par une machine ainsi qu’une indication de ce qui est réellement disponible. Lire cette indication, c’est la façon de retrouver la forme que tu voulais référencer.

## Les versions ne changent jamais

Enregistrer ajoute une version ; cela n’en modifie jamais une existante. Les versions sont numérotées à partir de 1 et restent contiguës par automatisation, et chacune porte la note que son auteur a écrite sur ce qui a changé. La version 3 d’une automatisation est donc le même document pour toujours.

Deux conséquences. Modifier une automatisation ne peut pas perturber ce qui tourne déjà, puisque la version qui tourne est une autre ligne. Et une exécution tombée en échec le mois dernier se relit contre exactement le document qui l’a produite, puisque ce document existe encore, intact.

## La mise en service est un geste distinct

Une seule version par automatisation est en service, et c’est celle que lancent les déclencheurs. Mettre une version en service, ou revenir à une plus ancienne, est un geste unique qui ne réécrit aucun historique : la liste des versions reste exactement telle quelle, seul le pointeur bouge. Une automatisation peut aussi n’avoir aucune version en service et vivre uniquement à l’état de brouillon.

Une version ne devient éligible qu’une fois ses propres tests réussis. Les tests sont rangés dans le document : chacun porte un nom, une entrée, et des attentes sur la sortie comme sur les effets que l’exécution doit produire. Le résultat des tests d’une version est consigné au moment de l’enregistrement, si bien que la mise en service lit ce fait consigné au lieu de rejouer la suite.

<Note>

Une automatisation sans version en service ne peut pas être lancée du tout — ni par un déclencheur, ni à la main. Enregistre une version, puis mets-la en service.

</Note>

## Ce qui lance une exécution

Un déclencheur dit ce qui a le droit de lancer une automatisation, et il en existe exactement trois sortes : un **schedule** (une expression cron lue dans un fuseau IANA nommé), un **webhook** (une URL entrante protégée par un token) et un **event** (le nom d’un événement de la plateforme).

Un déclencheur se rattache au **nom** de l’automatisation, jamais à une version. Mettre une nouvelle version en service n’invalide donc jamais une URL de webhook dont dépend un système externe, et ne fait jamais disparaître une planification sur laquelle quelqu’un compte. Chaque déclencheur s’éteint et se rallume sans être perdu, et chacun retient la dernière fois que le planificateur a agi dessus. [Déclencheurs de workflow](/fr/platform/automations/triggers) détaille ce que chaque sorte emporte dans l’exécution.

## Ce qu’une exécution enregistre

Une exécution est un objet durable, pas une ligne de log. Elle retient son statut — `queued`, `running`, `waiting`, `success`, `failed` ou `cancelled` —, son mode, ce qui l’a lancée, l’entrée reçue, la sortie produite, et un **point de reprise pour chaque nœud terminé**.

Ces points de reprise sont l’essentiel. Une exécution réelle avance nœud par nœud, et quand elle atteint la fenêtre de temps de la plateforme, elle se rend la main et reprend au dernier nœud terminé au lieu de refaire des effets déjà produits. Une exécution conserve aussi la trace complète du moteur et la liste ordonnée des effets qu’elle a produits — c’est ce qui permet au canvas de la rejouer et ce qui garde vérifiable après coup chaque changement hors de la plateforme.

Les exécutions ont deux modes. **Essai** ne touche jamais l’extérieur et c’est la boucle de retour rapide pendant que tu construis. **Réel** peut y toucher, et c’est pourquoi en lancer une demande un droit de développeur. [Journaux d’exécution](/fr/platform/automations/execution-logs) lit une exécution de bout en bout.

## Là où un humain décide

Une exécution qui a besoin d’une validation ne tombe pas en échec et ne repart pas de zéro. Elle se met en pause au statut `waiting`, et dès que la validation est répondue, elle repart exactement au nœud où elle s’était arrêtée en emportant la réponse. Une exécution qui attend une saisie humaine se comporte pareil. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) couvre ces portes et ce que chaque décision laisse derrière elle.

## Choisir la bonne unité

| Choisis …                                                                   | Automatisation | Agent | Webhook d’agent |
| --------------------------------------------------------------------------- | -------------- | ----- | --------------- |
| Un travail à plusieurs étapes, avec branches, planifications ou validations | ✓              |       |                 |
| Quelque chose qui doit tourner à l’heure ou répondre à un webhook           | ✓              |       |                 |
| Une question qui revient dans le chat, sans système externe en jeu          |                | ✓     |                 |
| Une réponse d’agent par POST entrant                                        |                |       | ✓               |

Vérifie le catalogue avant de construire — l’automatisation dont tu as besoin est peut-être déjà livrée. Un [déclencheur webhook](/fr/platform/automations/triggers) est la couture entrante ; recours-y quand une charge utile externe doit lancer une exécution.

## Mettre le modèle en pratique

Une automatisation est un document, tenu comme une chaîne ininterrompue de versions dont une seule est en service, avec des déclencheurs rattachés à son nom plutôt qu’à une version — et c’est précisément ce qui rend la modification sûre, le retour arrière bon marché et une exécution en échec reproductible. [L’éditeur de workflow](/fr/platform/automations/editor) est le manuel pratique pour enregistrer, tester, mettre en service et revenir en arrière ; [Parcourir et installer des automatisations](/fr/platform/automations/catalog) mène à celles qui sont déjà livrées.
