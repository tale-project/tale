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

Tale dispose le canevas à partir des références entre les nœuds : personne ne place un nœud à la main. Un bloc `ui` contient des métadonnées libres que Tale conserve telles quelles et ignore.

### Les liaisons se déduisent, elles ne se déclarent pas

Il n’y a pas de liste de liaisons. Un nœud en lit un autre en le référençant — `{{ nodes.invoice.output.id }}` — et cette référence _est_ la liaison que trace le canevas. L’ordre d’exécution est un tri topologique sur ces liaisons déduites : supprimer une référence retire donc aussi un trait, et deux nœuds qui se lisent l’un l’autre sont refusés comme une boucle.

Les templates utilisent une seule grammaire `{{ }}` d’expressions JavaScript sur `input`, `nodes.<id>.output` et, à l’intérieur d’un nœud qui itère, `item` et `index`.

### Le contrôle du flux vit sur le nœud

Brancher et répéter sont des champs du nœud plutôt que des types d’étape à part. Le canevas dessine chacun d’eux là où il agit : un `when` devient une condition au-dessus de son nœud, une alternative `elseOf` part de cette condition comme sa branche **Non**, `forEach` et `repeatUntil` placent le nœud dans un cadre, et `onError: continue` lui ajoute une puce.

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

**`llm`** appelle un modèle de langage avec un prompt en template. `model` est obligatoire et toujours explicite — une automatisation n’en choisit jamais un à ta place (l’Auto du composer est une affaire de chat, et de chat seulement). La sortie est `{text}`, ou l’objet à la forme du schéma quand le nœud déclare un `outputSchema`. Chaque appel d’une exécution réelle est un usage de l’exécution : il est vérifié par rapport aux [limites de budget](/fr/platform/admin/governance/policies-and-limits) avant d’être fait, et un appel refusé par une limite fait échouer le nœud avec `budget_exceeded`, ce qui arrête l’exécution, sauf si son `onError` vaut `continue`. Avant l’appel au fournisseur, chaque tentative réserve le coût estimé du prompt et le budget maximal de réponse dans tous les projets retenus pour cette tentative. Le modèle doit disposer de tarifs dans le catalogue. L’usage déclaré remplace la réservation à la fin de l’appel. Si un délai dépassé, une connexion interrompue ou l’absence de données d’usage laisse le coût inconnu, la réservation reste en place jusqu’à l’échéance de la requête, puis son montant estimé est comptabilisé ; il s’agit d’une estimation, pas d’une facture du fournisseur. Modifier les associations aux projets pendant l’appel ne déplace pas sa consommation.

**`agent`** exécute un tour d’un agent de code (Claude Code, Codex et les autres environnements d’agent) dans la sandbox. Il lit les `files` mis en place, utilise des `skills`, des `connectors` relayés, des `tools` de plateforme accordés et des `secrets` injectés, et renvoie `{text, files, status}` ; `model` est obligatoire. Si un admin a activé la [génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images), il peut aussi créer des images, qui reviennent parmi ses `files`. Prends `llm` quand une complétion unique suffit, et `agent` seulement quand l’étape a besoin d’outils, de fichiers ou de plusieurs tours — un nœud agent en service s’exécute comme un tour asynchrone, il siège donc au niveau supérieur plutôt que dans une `subautomation` et n’itère pas avec `forEach`.

**`subautomation`** exécute une autre automatisation enregistrée comme un seul nœud ; son champ `automation` nomme `"name"` ou `"name@version"`. Sans version, c’est celle en service, et l’imbrication s’arrête à trois niveaux.

### Sortie structurée et non structurée

Une sortie **structurée** possède des champs nommés, accessibles avec `nodes.<id>.output.<field>`. Une sortie **non structurée** contient du texte libre. Référence-la avec `nodes.<id>.output.text` dans une expression textuelle ; ne la traite pas comme un objet possédant d’autres champs.

Un outil sans schéma de sortie produit une sortie non structurée. Pour transformer son texte en données structurées utilisables par les étapes suivantes, ajoute un nœud `llm` avec un `outputSchema`. En cas d’erreur, la validation indique la référence incorrecte et les champs ou contextes autorisés. Corrige-la avant d’enregistrer à nouveau.

## Les chemins qu’une exécution peut prendre {#paths}

Chaque condition, et chaque nœud qui peut échouer pendant que l’exécution continue, ouvre deux possibilités à une exécution. Tale essaie chaque combinaison et garde les différentes façons dont une exécution réussie peut se dérouler ; chacune est un chemin. Un chemin nomme les conditions qui le décident, comme les nœuds qui s’exécutent, ceux qui sont ignorés et ceux qui échouent pendant que l’exécution continue, ainsi que les nœuds qui s’exécutent sur ce chemin. Un nœud qui s’exécute sur chaque chemin s’exécute toujours ; un nœud qui ne s’exécute sur aucun ne peut jamais s’exécuter, et Tale le signale par un avertissement.

Tale liste jusqu’à 32 chemins et compte les autres. Au-delà de 12 conditions et échecs tolérés, les combinaisons sont trop nombreuses pour être parcourues : Tale ne liste alors aucun chemin, mais indique toujours, pour chaque nœud, quand il s’exécute. Tale nomme aussi les nœuds dont l’échec termine l’exécution et ce qui peut faire échouer chacun d’eux. L’éditeur montre les chemins sur le canevas, comme le décrit [Suivre les chemins possibles](/fr/platform/automations/editor#paths) ; un client du [point d’accès MCP](/fr/develop/mcp-endpoint) lit les mêmes chemins dans `analysis.paths`.

## Ce que Tale vérifie avant une exécution {#checks}

Tale vérifie le document entier quand tu l’enregistres, quand tu déploies une version et chaque fois qu’un client appelle `validate_automation`. Une **erreur** décrit un échec certain ou du code qui dépasse les limites d’analyse : elle empêche d’enregistrer comme de déployer. Un **avertissement** signale ce qui peut échouer ou ne sert à rien. Il n’empêche jamais d’enregistrer ni de déployer, c’est donc toi qui décides d’agir. Chaque problème nomme son nœud et son champ et, dans un template, une condition ou du code, l’expression exacte.

Pour que les vérifications restent réactives, chaque expression et chaque corps `transform` sont limités à 8192 unités de code UTF-16, 512 tokens JavaScript et 64 niveaux d’imbrication dans la syntaxe ou l’arbre syntaxique. Les espaces autour d’une expression de template ne comptent pas dans sa taille ; ceux du corps `transform` comptent. Le texte ordinaire hors des templates n’est pas du code. Ces limites peuvent refuser du code auparavant valide. Raccourcis-le ou répartis le travail entre plusieurs nœuds avant d’enregistrer ou de déployer à nouveau.

### Références et noms {#checks-references}

Chaque `nodes.<id>` doit désigner un nœud existant, lire son résultat par `.output` et ne pas fermer une boucle de nœuds qui se lisent l’un l’autre. Une référence à un champ que sa source n’a pas, comme la faute de frappe `nodes.calc.output.cuont`, reçoit un avertissement qui propose le champ le plus proche. Tale signale aussi un nom qu’une expression ne voit pas, comme `item` hors de `forEach` ou un `input` mal orthographié, ainsi qu’un `input.<key>` que `inputs` ne déclare pas.

### Types {#checks-types}

Tale connaît la forme de la plupart des valeurs : l’entrée de l’exécution d’après `inputs`, la sortie d’une capacité d’après sa signature dans le catalogue, celle d’un nœud `llm` d’après son `outputSchema` et celle d’un nœud `transform` d’après l’objet que renvoie son code. Il avertit quand une valeur arrive à un endroit qui attend un autre type, comme un nombre là où une entrée de capacité attend du texte, ou un objet là où `forEach` attend une liste. Il avertit aussi quand une valeur insérée dans du texte peut manquer, car une valeur manquante y fait échouer le nœud.

### Nœuds ignorés et en échec {#checks-skips}

Un nœud est ignoré quand son `when` est faux, quand son partenaire `elseOf` s’exécute ou quand un nœud qu’il lit dans `input`, `prompt`, `system`, `files`, `code` ou `forEach` est ignoré. Un nœud avec `onError: continue` est ignoré quand il échoue. La sortie d’un nœud ignoré vaut `null`, et un nœud qui lit un nœud ignoré dans l’un de ces champs est ignoré lui aussi. Une lecture dans `when` ou `repeatUntil` n’ignore pas le nœud : la condition s’exécute et lit `null`.

Quand une condition ou la `output` de l’automatisation lit un champ d’un nœud qui peut être ignoré, la lecture échoue donc lors des exécutions où ce nœud ne s’est pas exécuté. Il en va de même quand la valeur d’un tel nœud figure dans du texte, comme dans `Summary: {{ nodes.summary.output?.text }}` : `?.` n’y donne aucune valeur, et le texte refuse une valeur manquante. Tale avertit pour chacune de ces lectures, et le précise quand la cause est un échec que `onError: continue` tolère. Protège la lecture avec `?.` et une valeur de repli : `{{ nodes.check.output?.ok ?? false }}` dans une condition, `{{ nodes.summary.output?.text ?? null }}` dans la sortie. Les branches alternatives se rejoignent dans la `output` de l’automatisation, pas dans un nœud qui lit les deux :

```yaml
output:
  message: '{{ nodes.summary.output?.text ?? nodes.summary_empty.output?.text }}'
```

### Nœuds qui ne peuvent jamais s’exécuter {#checks-unreachable}

Certains nœuds ne peuvent jamais s’exécuter : celui dont la condition est toujours fausse, l’alternative d’un nœud qui s’exécute toujours, ou un nœud qui lit deux branches qui ne s’exécutent jamais ensemble. Tale avertit pour chacun d’eux. Un nœud dont personne ne lit la sortie et qui n’a aucun effet est signalé comme inutilisé.

### Conditions et boucles {#checks-conditions}

Une condition qui donne toujours la même réponse ne décide rien. Du texte autour d’un template fait par exemple de `when` une chaîne non vide, qui compte toujours comme vraie. Un `repeatUntil` toujours faux fait tous ses `maxRepeats` passages, et un `repeatUntil` qui ne lit jamais le résultat du passage (`output`) donne la même réponse après chaque passage.

### Itération {#checks-iteration}

`forEach` doit être un seul template qui donne une liste. Du texte brut, du texte autour d’un template ou une constante qui n’est pas une liste est une erreur, car le nœud échoue à chaque exécution. `when` et `forEach` sont lus une seule fois, avant que le nœud ne parcoure ses éléments : `item` et `index` n’y existent donc pas, et les utiliser est aussi une erreur. Un nœud `agent` ne peut pas encore utiliser `forEach` ni `repeatUntil`.

### Automatisations appelées {#checks-called-automations}

Un nœud `subautomation` est vérifié par rapport à la version qu’une exécution appellerait : la version qu’il indique, sinon celle qui est déployée, sinon la plus récente. Cette version doit exister et ne contenir aucun nœud `agent`. Tale avertit quand l’entrée ne correspond pas à ses `inputs`, et quand elle effectue une écriture qu’une approbation pourrait retenir, car une automatisation appelée ne peut pas attendre. Un déclencheur planifié dont l’entrée de départ est refusée par les `inputs` de l’automatisation est signalé aussi.

### Tests {#checks-tests}

L’entrée d’un test doit correspondre à `inputs`, chaque effet attendu doit venir d’un nœud qui l’effectue, et une valeur de sortie attendue doit avoir un type que l’automatisation peut renvoyer. Un test qui enfreint l’une de ces règles ne peut jamais réussir : Tale avertit donc avant que tu ne le lances.

## Les versions ne changent jamais

Enregistrer crée une version au lieu d’écraser la précédente. Chaque automatisation possède une numérotation commençant à 1 ; chaque version conserve la note de modification de son auteur. Le workflow d’une version existante reste inchangé.

Une exécution conserve la version avec laquelle elle a démarré. Les modifications suivantes ne changent donc pas ses étapes. Pour examiner une ancienne exécution, ouvre sa version enregistrée et compare les données avec le workflow. Cette immutabilité ne garantit pas une conservation illimitée : supprimer une automatisation ou son historique peut retirer ces enregistrements.

## La mise en service est un geste distinct

Une seule version par automatisation est en service, et c’est celle que lancent les déclencheurs. Mettre une version en service, ou revenir à une plus ancienne, est un geste unique qui ne réécrit aucun historique : la liste des versions reste exactement telle quelle, seul le pointeur bouge. Une automatisation peut aussi n’avoir aucune version en service et vivre uniquement à l’état de brouillon.

Une version dont un test échoue ne peut pas être mise en service ; une version dont les tests réussissent, ou qui n’en a aucun, le peut. Les tests sont rangés dans le document : chacun porte un nom, une entrée, et des attentes sur la sortie comme sur les effets que l’exécution doit produire. Le résultat des tests d’une version est consigné au moment de l’enregistrement, si bien que la mise en service lit ce fait consigné au lieu de rejouer la suite.

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

Le statut `waiting` peut également indiquer qu’un agent travaille encore, qu’une étape d’agent attend une place de sandbox pour démarrer, ou qu’un nœud vérifie périodiquement une condition. Consulte `waitingFor` : `approval`, `ask` et `in_doubt` nécessitent une personne ; `agent`, `room` et `repeat` reprennent normalement seuls. `in_doubt` signifie qu’une étape envoyait quelque chose à un service externe quand l’exécution a été interrompue, et que Tale ne peut pas savoir si le service l’a reçu. Personne n’est averti : décide sur la page de l’exécution, comme l’explique [Examiner les exécutions et corriger les échecs](/fr/platform/automations/execution-logs). [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique comment examiner et traiter les demandes humaines.

## Choisir un chat, une tâche ou une automatisation

| Besoin | Utilise |
| --- | --- |
| Poser une question et discuter de la réponse | Chat |
| Produire un résultat relu avec un responsable | Une tâche de projet, éventuellement assignée à un agent |
| Enchaîner des étapes ou réagir à un horaire, webhook ou événement | Une automatisation |

Consulte les [automatisations fournies](/fr/platform/automations/builtin) avant de créer la tienne. Un webhook démarre une automatisation ; ce n’est pas un type distinct d’agent de projet.

## Mettre le modèle en pratique

Workflow, versions, déploiement et déclencheur sont des éléments distincts d’une même automatisation. Suis [L’éditeur de workflow](/fr/platform/automations/editor) pour tester et mettre un changement en service, puis les [Journaux d’exécution](/fr/platform/automations/execution-logs) pour examiner son résultat.
