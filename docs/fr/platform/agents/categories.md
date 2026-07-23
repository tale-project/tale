---
title: Dossiers d’agents
description: Comment les agents se regroupent — des dossiers dérivés de l’identifiant de l’agent, comment les agents installés par une automatisation se rangent, et où vit vraiment la frontière de permission.
---

Les agents se regroupent par dossiers, et un dossier vient de l’identifiant de l’agent : un agent dont l’identifiant est `github/review-pull-requests/pr-reviewer` se range sous un dossier `github/review-pull-requests` partout où les agents sont listés. Les dossiers mettent de l’ordre dans une longue liste ; ils ne tracent aucune frontière de permission. Qui peut atteindre un agent, c’est sa **visibilité** sur l’onglet **Général**, et cette réponse ne change pas selon l’endroit où il est rangé.

## Ranger un agent dans un dossier

Les identifiants à dossiers viennent de la plateforme, pas du dialogue de création. Le champ **Nom** y accepte un identifiant plat — minuscules, chiffres, traits d’union et tirets bas, pas de `/` — si bien qu’un agent que tu crées atterrit sans dossier au premier niveau. Le préfixe de dossier (`chat/`, `github/review-pull-requests/`) est réservé aux agents que la plateforme livre ou installe : les agents livrés arrivent déjà rangés, et installer une [automatisation](/fr/platform/automations/concepts) range ses agents sous le dossier que nomme leur identifiant. Un identifiant ne change plus ensuite, donc le dossier est fixé à la création. Le nom affiché en est indépendant : renomme l’agent autant que tu veux sans le déplacer.

Dans la liste **Agents**, les dossiers apparaissent en lignes repliées avec un compteur d’agents. Clique pour déplier, et le fil d’Ariane suit où tu te trouves. Les agents livrés arrivent déjà rangés, les assistants généraux sous `chat`.

## Les agents qui arrivent avec une automatisation

Installer une [automatisation](/fr/platform/automations/concepts) range ses agents comme tous les autres : le PR Creator et le PR Reviewer du bundle « Résoudre les issues GitHub » atterrissent dans la même liste, dans le dossier que nomme leur identifiant. Il n’existe pas de boutique d’agents séparée à parcourir — le [catalogue d’automatisations](/fr/platform/automations/catalog) est d’où viennent les agents groupés, et la liste est où ils vivent ensuite.

<Note>

Le composer ne regroupe pas par dossier. Son sélecteur est une liste cherchable à deux sections — **Models** pour un tour ordinaire et **Sandbox agents** pour un tour exécuté dans un harness d’agent de code — et rien n’est choisi à ta place.

</Note>

## Quand y recourir

| Prends les dossiers quand…                        | Prends la visibilité quand…                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| La liste d’agents s’allonge et demande de l’ordre | Un agent doit rester joignable seulement par la personne qui le construit |
| Chaque service possède son propre lot d’agents    | Tu traces une frontière de permission, pas un annuaire                    |

## Où cela se place

Les dossiers sont le regroupement le plus léger disponible pour les agents : ils trient la liste et le catalogue, et rien de plus. Les séparations plus fortes vivent ailleurs — les [agents de projet](/fr/platform/projects/project-agents) rattachent un agent à un projet, et [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) régissent ce qu’un agent peut dépenser ou faire.
