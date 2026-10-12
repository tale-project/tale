---
title: Paramètres par MCP
description: Laisse un agent de code lire et modifier les paramètres de Tale par le point d’accès MCP, dans les limites du rôle de la personne dont il utilise la clé API.
---

Un agent de code connecté au [point d’accès MCP](/fr/develop/mcp-endpoint) lit les paramètres de ton organisation, planifie une modification et l’applique avec trois outils : `get_settings`, `plan_settings` et `apply_settings`. Il agit avec le rôle de la personne dont il utilise la clé API. Il peut modifier ce que cette personne pourrait modifier dans l’application, avec les mêmes contrôles, et les [journaux d’audit](/fr/platform/admin/governance/audit-logs) enregistrent chaque modification comme faite par cette personne, par MCP.

## Ce qu’un agent peut modifier {#kinds}

Tale lit et écrit chaque type de paramètre avec son propre code et les contrôles qu’applique l’application : les règles de rôle sont donc les mêmes que dans l’application.

| Type | Ce qu’il contient | Modifications | Qui peut le modifier |
| --- | --- | --- | --- |
| `provider` | Un fournisseur IA que ton organisation a défini : son point d’accès, son format d’API et son catalogue de modèles. Les fournisseurs livrés avec Tale ne sont pas des paramètres. | Définir, supprimer ; relire son catalogue de modèles (`refresh-catalogs`) | Propriétaires, admins et développeurs |
| `provider-credential` | Des identifiants qui lisent leur clé dans une variable d’environnement du déploiement. Les identifiants avec une clé ou un abonnement sont listés sans leur secret et peuvent être supprimés. | Définir, supprimer | Propriétaires, admins et développeurs |
| `governance` | Une politique de l’organisation, désignée par sa clé : modèles et accès aux modèles, budgets et limites, sécurité de connexion et de session, garde-fous, quotas de sandbox. | Définir | Propriétaires et admins |
| `knowledge-embedding` | Le modèle d’embedding des connaissances de l’organisation, avec son seuil de similarité et ses limites d’utilisation. | Définir | Propriétaires et admins |
| `branding` | La couleur d’accentuation et les noms de fichier du logo et des favicons. | Définir | Propriétaires et admins |
| `project-instructions` | Les instructions permanentes d’un projet. | Définir | Qui peut modifier le projet |
| `agent-instructions` | Les instructions d’un agent de projet. | Définir | Qui peut modifier le projet |
| `agent-tools` | Les outils qu’un agent de projet peut utiliser. | Définir | Qui peut modifier le projet |
| `agent-model` | L’environnement d’agent (harness), le modèle et le fournisseur avec lesquels travaille un agent de projet. Un changement s’applique aux exécutions qu’il lance ensuite. | Définir | Qui peut modifier le projet |
| `task-instructions` | La description d’une tâche. | Définir | Qui peut modifier la tâche |
| `task-review-context` | Si le travail d’une tâche passe par une relecture indépendante d’un autre agent de projet, et lequel. Une fois défini, l’agent relecteur reste le même. | Définir | Qui peut modifier le projet |
| `automation-approval` | Les écritures vers des systèmes externes qu’une automatisation peut faire sans que chaque exécution attende une personne, nommées comme le fait une étape, par exemple `slack.send_message`, avec celles que fait sa dernière version et qui les a autorisées. En lecture seule ; ses actions la modifient. | Autoriser ou retirer une écriture (`grant`, `revoke`) | Propriétaires et admins ; les développeurs la lisent |
| `deployment` | Les paramètres propres au déploiement, communs à toutes les organisations qu’il héberge, comme l’environnement d’exécution des sandboxes. | Définir | Tout propriétaire ou admin d’une organisation du déploiement peut les lire, avec sa propre clé API ; seules les adresses de la liste d’autorisation des éditeurs du déploiement peuvent les modifier. Une clé créée pour un autre membre, une équipe, un projet ou l’organisation n’en atteint aucun |

Une ressource a un identifiant au sein de son type : un fournisseur, son nom ; des identifiants, `<provider>/<name>` avec le nom encodé en URI ; une politique, sa clé, comme `password_policy` ; un projet, son identifiant ; un agent, `<projectId>/<agentId>` ; une tâche, `<projectId>/<taskId>` ; les autorisations d’une automatisation, le nom de l’automatisation, comme `ops/morning-digest`. Le modèle d’embedding, le branding et les paramètres du déploiement n’ont pas d’identifiant. `get_settings` liste les paramètres des projets et des agents page par page, sur les projets que tu peux lire, ainsi que les automatisations qui ont une autorisation ; il ne lit la description d’une tâche, son contexte de relecture et une automatisation sans autorisation que par l’identifiant.

Certaines modifications restent dans Tale :

- Chaque secret, comme la clé API d’un fournisseur, un abonnement ou la clé du fournisseur de modération, est saisi par une personne dans Tale.
- La politique de conservation et la politique des demandes des personnes concernées changent uniquement par leurs propres procédures échelonnées.
- Les images du branding sont téléversées dans Tale. Un nom de fichier qu’un agent définit doit désigner une image déjà téléversée.
- Par MCP, le modèle d’embedding lui-même ne change que tant que les connaissances de l’organisation ne contiennent aucun document et aucun site web : ainsi, les vecteurs de deux modèles ne se rencontrent jamais dans une même recherche. Son seuil de similarité et ses limites d’utilisation changent à tout moment ; si des documents sont indexés, une personne change le modèle dans Tale.
- L’agent standard d’un projet suit la politique `standard_agent`, que modifie le type `governance` ; ses propres instructions, outils et modèle ne sont pas des paramètres.
- Aucun type ne couvre les membres, les équipes, les connectors, les skills, les compétences, les conservations légales, les journaux d’audit, les métriques ni les paramètres personnels. `get_settings` sans arguments indique ce que couvre chaque type.

## Faire une modification {#make-a-change}

1. Appelle `get_settings` sans arguments. La réponse liste chaque type, indique si ce déploiement le sert et si ton rôle peut le lire et le modifier.
2. Lis ce que tu veux modifier avec `get_settings` et `kinds` (et `ids`). Chaque ressource arrive avec sa `key`, sa `config` et son `hash`. Un type qui a beaucoup de ressources répond avec une page et son curseur sous `cursors` ; lis la page suivante avec ce seul type et `cursor`.
3. Planifie la modification avec `plan_settings`. Un `set` remplace toute la ressource par sa `config` : envoie donc chaque champ qui doit rester, tel que tu l’as lu. Le plan indique pour chaque modification son action, son diff, ses effets et son risque, ou le refus qui l’arrête. Rien n’est écrit.
4. Montre le plan à la personne et attends sa décision. Commence par les effets et le risque.
5. Applique les mêmes modifications avec `apply_settings`. `expected` associe la `key` de chaque ressource modifiée au hash que tu as lu, ou `null` pour une ressource que tu crées.

Voici les arguments d’un plan qui active la rotation des mots de passe :

```json
{
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "op": "set",
      "config": {
        "minLength": 12,
        "requireUpper": true,
        "requireLower": true,
        "requireDigit": true,
        "requireSpecial": true,
        "rotationDays": 90
      }
    }
  ]
}
```

Le plan indique l’effet sur les membres, car la rotation fait expirer les mots de passe déjà définis. Le hash est raccourci ici :

```json
{
  "ok": true,
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "key": "governance/password_policy",
      "op": "set",
      "action": "update",
      "currentHash": "5c1f…",
      "diff": [{ "path": "/rotationDays", "before": 0, "after": 90 }],
      "effects": ["may-lock-out-members"],
      "risk": "critical"
    }
  ]
}
```

Pour l’appliquer, envoie les mêmes `changes` avec `"expected": { "governance/password_policy": "5c1f…" }`, en utilisant le hash complet. Avant toute écriture, chaque modification est de nouveau planifiée par rapport à ce qui est enregistré maintenant. Si l’une est refusée, ou si une ressource a changé depuis ta lecture, rien n’est appliqué. Sinon, les modifications s’exécutent dans un ordre fixe d’un type à l’autre, pour que ce à quoi une ressource fait référence existe d’abord. La première modification qui échoue arrête les suivantes, et la réponse indique ce qui a été appliqué (`applied`), ce qui a échoué (`failed`) et ce qui a été ignoré (`skipped`). Une modification déjà appliquée n’est pas annulée.

`apply_settings` demande à la personne avant chaque appel et dispose de son propre [budget](/fr/develop/rate-limits).

## Laisser une automatisation écrire sans approbation {#automation-approval}

Une écriture vers un système externe, comme un message Slack ou un nouveau ticket GitHub, attend l’approbation d’une personne à chaque exécution réelle, sauf si un propriétaire ou un admin a autorisé cette écriture pour cette seule automatisation. Ce sont les interrupteurs **S’exécute sans approbation** de l’onglet **Général** de l’automatisation (voir [Répondre à un workflow en attente](/fr/platform/automations/approvals-in-workflows)) ; le type `automation-approval` lit et modifie ces mêmes autorisations.

Pour lire les autorisations d’une automatisation, nomme-la : `get_settings` avec `kinds: ["automation-approval"]` et `ids: ["ops/morning-digest"]`. Sans `ids`, il liste page par page les automatisations qui ont une autorisation. La configuration est en lecture seule :

| Champ | Ce qu’il contient |
| --- | --- |
| `allowed` | Les écritures qui s’exécutent sans approbation, nommées comme le fait une étape : `<connector>.<action>`, par exemple `slack.send_message`. |
| `used` | Les écritures que fait la dernière version de l’automatisation. |
| `requiredByPolicy` | Parmi les écritures autorisées et utilisées, celles pour lesquelles une règle de la [politique d’approbation](/fr/self-hosted/configuration/approvals) de ton organisation exige toujours une personne. Une telle règle l’emporte sur une autorisation. |
| `grants` | Qui a autorisé chaque écriture, par son nom, et quand. Une personne qui a quitté l’organisation n’a pas de nom. |

Une autorisation change par une action, une opération ponctuelle sur une ressource existante : `grant` autorise des écritures, `revoke` retire leur autorisation. Chacune prend les écritures dans `args.types` :

```json
{
  "changes": [
    {
      "kind": "automation-approval",
      "id": "ops/morning-digest",
      "op": "act",
      "act": "grant",
      "args": { "types": ["github.create_issue"] }
    }
  ]
}
```

Seule une écriture d’un connecteur vers un système externe peut être autorisée. Une lecture, et une écriture dans Tale même comme la création d’une tâche, n’attendent jamais d’approbation. Autoriser une écriture retire une personne des exécutions réelles de cette automatisation : le plan nomme donc l’effet `removes-human-approval`, au risque critical — montre-le d’abord à la personne. Retirer une autorisation n’a pas cet effet : l’écriture demande de nouveau une approbation. Une modification laisse les autres autorisations telles quelles, et son hash ne couvre que l’automatisation et ses écritures autorisées : une nouvelle version de l’automatisation ne périme donc pas un plan, la modification de ses autorisations par une autre personne, si. Les propriétaires et les admins modifient les autorisations ; les développeurs les lisent. Le [journal d’audit](/fr/platform/admin/governance/audit-logs) enregistre chaque autorisation et chaque retrait comme faits par MCP, comme pour l’onglet **Général**.

## Lire les effets d’un plan {#effects}

Le risque d’un plan est le plus élevé entre le risque de base de son type et celui de ses effets. Voici les effets que peuvent nommer les types servis aujourd’hui :

| Effet | Risque | Quand un plan le nomme |
| --- | --- | --- |
| `may-lock-out-members` | critical | Le verrouillage de connexion est actif après la modification, la rotation des mots de passe commence ou se raccourcit, ou l’authentification à deux facteurs devient plus stricte |
| `signs-out-members` | critical | Le délai d’inactivité est activé ou raccourci |
| `removes-human-approval` | critical | Une règle d’approbation ou une exigence de relecture ne demande plus l’avis d’une personne, ou une automatisation peut faire une écriture sans approbation |
| `changes-serving-account` | high | Le point d’accès d’un fournisseur change, ou d’autres identifiants servent ses requêtes |
| `breaks-dependents` | high | Les identifiants actifs par défaut du fournisseur sont supprimés et rien ne les remplace |
| `requires-empty-corpus` | critical | Le modèle d’embedding change, ce qui exige que les connaissances de l’organisation soient vides |
| `restart-required` | critical | L’environnement d’exécution des sandboxes du déploiement change |
| `reaches-vendor` | high | Le catalogue de modèles d’un fournisseur est relu avec la clé de ton organisation |

La référence des paramètres que `get_docs` renvoie pour le sujet `settings` (aussi `tale://docs/settings`) liste tout le vocabulaire, les champs de chaque type et chaque politique.

## Secrets {#secrets}

Aucun secret n’entre dans un appel de paramètres ni n’en sort. Un secret enregistré se lit `{"masked": true, "preview": "…"}`, de même que tout ce qu’un paramètre enregistré contient et que Tale ne montre jamais dans l’enregistrement d’une exécution : une clé que quelqu’un a collée dans une politique ou une instruction, une clé saisie dans un en-tête dont le nom dit qu’il en contient une, ou un mot de passe dans une adresse. Un en-tête qui ne fait que nommer le secret enregistré, comme `Bearer {{secret}}`, se lit tel qu’il est enregistré. Une clé dans un texte plus long masque tout le texte. Renvoie une valeur masquée telle quelle pour garder ce qui y est enregistré, ou remplace toute la valeur. Une modification qui contient un secret est refusée avec `SECRET_ARGUMENT_REFUSED`, qui indique où le secret a été trouvé, jamais sa valeur. Une personne saisit un nouveau secret dans Tale.

## Quand une modification est refusée {#refusals}

Un refus arrive sous forme de données, avec un `error`, un `code`, un `hint` et parfois `data`, jamais comme une connexion interrompue. Voici les codes qu’un agent rencontre le plus souvent :

| Code | Ce qu’il signifie |
| --- | --- |
| `SETTINGS_STALE` | La ressource a changé depuis sa lecture. Relis-la, planifie par rapport à ce qui est enregistré maintenant et applique avec `data.currentHash`. |
| `SETTINGS_INVALID` | La configuration ne correspond pas au type. `data.issues` indique chaque problème avec son emplacement dans la configuration, y compris un champ que le paramètre ne connaît pas et un texte que Tale ne peut pas enregistrer, comme un caractère NUL. |
| `SECRET_ARGUMENT_REFUSED` | La modification contient un secret. `data.places` indique où. |
| `SETTINGS_TALE_ONLY` | Cette modification se fait uniquement dans Tale, par exemple pour des identifiants avec une clé. |
| `USE_SUBSCRIPTION_FLOW` | Un abonnement se connecte par le parcours propre à Tale, jamais par une modification. Dis à la personne de le connecter sous **Paramètres > Fournisseurs IA** ; le supprimer reste possible ici. |
| `FORBIDDEN`, `ORG_FORBIDDEN`, `FORBIDDEN_DEVELOPER_SETTINGS` | Le rôle de la personne ne permet pas non plus cette modification dans Tale. Réessayer ne sert à rien. |
| `EMBEDDING_CORPUS_NOT_EMPTY` | Le modèle d’embedding ne change que tant que les connaissances de l’organisation sont vides. `data` indique combien de documents et de sites web elles contiennent. |
| `BRANDING_IMAGE_UNKNOWN` | Un nom de fichier du branding ne désigne aucune image téléversée dans l’organisation. |
| `APPROVAL_ALLOWANCE_INVALID` | Un nom n’est pas une écriture d’un connecteur vers un système externe : on ne peut pas l’autoriser. `data.types` les nomme. |
| `PROVIDER_IN_USE`, `CREDENTIAL_IN_USE` | Des identifiants désignent encore le fournisseur, ou le modèle d’embedding utilise ces identifiants. Modifie-les d’abord. |

La référence des paramètres liste les codes que les outils de paramètres renvoient eux-mêmes ; le rédacteur d’un type en renvoie aussi les siens, chacun avec sa phrase et un conseil. La page du [point d’accès MCP](/fr/develop/mcp-endpoint#settings) décrit les arguments et les réponses des outils.
