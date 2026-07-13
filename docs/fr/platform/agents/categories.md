---
title: Dossiers d’agents
description: Comment les agents se regroupent — des dossiers dérivés de l’identifiant de l’agent, comment les agents installés par une automatisation se rangent, et où vit vraiment la frontière de permission.
---

Les agents se regroupent par dossiers, et un dossier vient de l’identifiant de l’agent : un agent dont l’identifiant est `github/pull-request-reviewer` se range sous un dossier `github` partout où les agents sont listés. Les dossiers sont un outil de rangement, pas une frontière de permission — qui peut utiliser un agent relève de la section **Accès** de sa page **Général**, inchangée par l’endroit où il est rangé.

<Frame caption="La liste des agents avec le dossier chat déplié — le dossier est le préfixe du slug, les lignes sont ses agents.">

![La liste des agents montrant les agents du dossier chat — Assistant et Automation Assistant —, chacun avec son badge de type, son modèle par défaut et son nombre d’outils.](/images/platform/agents-list-expanded.webp)

</Frame>

## Ranger un agent dans un dossier

Les identifiants avec dossier viennent de la plateforme, pas du dialogue de création. Le champ **Nom** du dialogue prend un identifiant plat — minuscules, chiffres, traits d’union et tirets bas, sans `/` —, si bien qu’un agent créé là atterrit non rangé, au niveau supérieur. Le préfixe de dossier (`chat/`, `github/`) est réservé aux agents que la plateforme fournit ou installe : les builtins arrivent déjà rangés, et l’installation d’une [automatisation](/fr/platform/automations/concepts) range ses agents dans le dossier que leur identifiant nomme. Un identifiant ne change plus ensuite, le dossier est donc fixé à la création. Le nom d’affichage est indépendant ; renomme l’agent librement sans le déplacer.

Dans la liste **Agents**, les dossiers s’affichent comme des lignes repliées avec un compte d’agents — clique sur l’une d’elles pour la déplier, et le fil d’Ariane suit où tu es. Les agents intégrés arrivent pré-rangés : les assistants généralistes sous `chat`, les agents GitHub sous `github`.

## Des agents qui arrivent avec une automatisation

Installer une [automatisation](/fr/platform/automations/concepts) range ses agents comme tous les autres — le PR Creator et le PR Reviewer du bundle « Résoudre les issues GitHub » atterrissent dans la même liste, dans le dossier que nomme leur identifiant. Il n’existe pas de boutique d’agents à part : le [catalogue des automatisations](/fr/platform/automations/catalog) est l’endroit d’où viennent les agents groupés, et la liste est l’endroit où ils vivent ensuite.

<Note>

Le sélecteur du chat ne groupe pas par dossier — c’est une liste cherchable, avec **Auto** en tête, qui montre chaque agent activé et visible dans le chat ; les agents de code se rangent dans leur propre section **Agents de code**.

</Note>

## Quand y recourir

| Utilise les dossiers quand…                         | Utilise l’accès d’équipe quand…                           |
| --------------------------------------------------- | --------------------------------------------------------- |
| La liste des agents s’allonge et demande de l’ordre | Un agent ne doit être utilisable que par une seule équipe |
| Chaque département possède son lot d’agents         | Tu traces une frontière de permission, pas un annuaire    |

## Où ça se situe

Les dossiers sont le regroupement le plus léger disponible pour les agents — ils trient la liste et le catalogue, rien de plus. Les séparations plus grandes vivent ailleurs : [Agents de projet](/fr/platform/projects/project-agents) cantonnent un agent à un Projet, et [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) gouvernent ce que n’importe quel agent peut dépenser ou faire.
