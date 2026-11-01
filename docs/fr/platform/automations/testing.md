---
title: Tester une automatisation
description: Écris des tests pour une automatisation dans l’éditeur, exécute-les sur ton brouillon ou sur une version enregistrée, et lis ce qu’un test en échec a trouvé.
---

Un test exécute une automatisation avec une entrée de ton choix et vérifie ce qui en ressort : la sortie, les actions qu’elle déclenche et les étapes qui s’exécutent. Les tests font partie du document de l’automatisation, si bien que chaque version garde les siens. Tale les exécute à l’enregistrement, puis à nouveau avant chaque mise en service, et une version dont les tests échouent ne peut pas être déployée. Écrire et exécuter des tests demande le rôle Développeur, Admin ou Propriétaire.

## Ouvrir les tests

Dans l’[éditeur de workflow](/fr/platform/automations/editor), sélectionne **Tests** à côté de **Problèmes**. Le bouton compte les résultats, par exemple deux coches vertes et une croix rouge, et ouvre l’onglet **Tests** du panneau sous le canevas ; l’autre onglet est **Problèmes**. Sur un téléphone, la liste s’ouvre dans un panneau à part.

Chaque ligne est un test, dans l’ordre du document : son statut, son nom et, pour un test en échec, la première chose qui n’allait pas. La ligne au-dessus de la liste dit d’où viennent les résultats : **Exécuté sur ton brouillon**, ou la dernière vérification de la version, par exemple **Vérifié à la mise en service de la version 3** avec la date. Un test affiche **Pas encore exécuté** tant qu’il n’a pas de résultat, **N'a pas pu s'exécuter** quand l’automatisation elle-même n’a pas pu s’exécuter, et **Modifié depuis ce résultat** dès que l’automatisation ou le test a changé après son exécution ; ce résultat reste affiché, pour que tu voies ce qui l’a changé.

<Frame caption="Tout exécuter sur les remises de commande : le test de la grosse commande échoue, et son résultat dit ce que la sortie aurait dû être.">

![L’éditeur d’Order discounts avec Tests dans l’en-tête, qui montre une coche et une croix, et l’onglet Tests sous le canevas : Small order pays full price a réussi, et Big order gets 10% off a échoué parce que 2 champs vérifiés manquent ou diffèrent. À côté du canevas, l’onglet Result du test en échec liste discount: expected 240, got 120 et total: expected 2160, got 2280, et indique qu’un autre champ n’est pas vérifié.](/images/platform/automation-tests.webp)

</Frame>

## Ajouter un test

1. Dans l’onglet **Tests**, sélectionne **Ajouter un test**, puis **Test vide** si un menu s’ouvre. Un test nommé **Nouveau test** s’ouvre à côté du canevas, avec un espace réservé pour chaque champ que l’entrée de l’exécution exige.
2. Dans **Configuration**, remplis le test : son **Nom**, l’**Entrée** que reçoit l’exécution en JSON, les **Sorties simulées** et les **Échecs simulés** qui remplacent des étapes, et sous **Attentes** ce que l’exécution doit faire. Tes modifications passent dans le brouillon au fil de la saisie.
3. Enregistre le brouillon pour garder le test. L’enregistrement exécute tous les tests et consigne le résultat avec la version.

Une nouvelle sortie simulée est vide : `{}` pour un nœud, ou `[]` s’il s’exécute une fois par élément. **Utiliser la sortie de la dernière exécution** copie la sortie de l’exécution sur le canevas lorsque tu le choisis. Vérifie cette valeur avant d’enregistrer.

<Frame caption="La configuration d’un test : l’entrée de l’exécution en JSON, les étapes qu’il simule et ce qu’il attend de l’exécution.">

![L’onglet Setup du test Big order gets 10% off à côté du canevas d’Order discounts : Name, une Description vide, un Input avec quantity 120 et unitPrice 20, Simulated outputs et Simulated failures avec chacun un sélecteur, et Expectations, où la sortie est vérifiée avec Includes.](/images/platform/automation-test-setup.webp)

</Frame>

**Modifier en YAML** affiche le même test sous forme de texte, pour une partie que le formulaire ne montre pas ; tant que le texte ne se lit pas, le test garde sa dernière version lisible. En YAML, un test a un `name`, l’`input` que reçoit l’exécution, et `expect`, ce que l’exécution doit faire :

```yaml
name: Big order gets 10% off
input:
  quantity: 120
  unitPrice: 20
expect:
  outputIncludes:
    discount: 240
    total: 2160
```

- `output` doit être exactement la sortie de l’exécution ; `outputIncludes` ne vérifie que les champs qu’il liste, et la sortie peut en contenir davantage.
- `nodes` nomme des étapes et ce qui doit arriver à chacune : `ran`, `skipped`, ou `failed` quand l’exécution continue après l’échec.
- `effects` liste des actions que l’exécution doit déclencher, comme un e-mail à envoyer, par type de nœud ; avec `absent: true`, une action qui ne doit pas avoir lieu.
- `failure` indique que l’exécution doit échouer, si tu veux à une étape donnée et avec un message qui contient le texte indiqué.
- `mocks` donne à une étape une sortie à utiliser au lieu d’appeler son service ou son modèle, et `failures` fait échouer une étape avec le message indiqué.
- `scenarios` donne à une étape qui appelle un connector l’un des cas que fournit son action, comme le décrit [Choisir un scénario d’un connector](#scenarios).

Sans `expect`, un test réussit quand l’exécution réussit. Le menu d’une ligne copie aussi un test avec **Dupliquer** ou le retire avec **Supprimer** ; **Abandonner** fait revenir un test supprimé tant que tu n’as pas enregistré.

### Choisir un scénario d’un connector {#scenarios}

Une action de connector peut fournir des scénarios : des cas nommés de ce que répond son service, comme une liste vide, une écriture refusée ou une limite de débit. `scenarios` associe à l’identifiant d’une étape le nom d’un scénario que fournit son action, pour que le test montre ce que fait l’automatisation dans ce cas. Dans ce test, l’étape `post` appelle `slack.send_message` avec le canal de l’entrée, et reçoit la réponse que donne Slack pour un canal qui n’existe pas :

```yaml
name: Slack rejects an unknown channel
input:
  channel: C0000000009
scenarios:
  post: channel_not_found
expect:
  failure:
    node: post
```

L’entrée de l’étape est toujours calculée et vérifiée. Un appel dont l’entrée correspond au scénario reçoit la réponse du scénario ; tout autre appel reçoit la réponse simulée habituelle du connector.

- Quand le scénario répond par une sortie, elle devient la sortie de l’étape, et l’étape porte **Sortie simulée** comme si le test avait donné cette sortie. Une écriture consigne toujours l’action qu’elle aurait effectuée.
- Quand le scénario répond par une erreur, l’étape échoue avec le message du scénario, marqué comme simulé par le test, et porte **Échec simulé**. L’exécution traite cette erreur comme le même échec venu du service, par exemple un accès refusé ou une limite de débit, si bien que le reste de l’automatisation la gère comme dans une exécution réelle.
- Quand aucun appel de l’étape ne correspond au scénario, il figure sous **Non utilisés**, comme une sortie simulée inutilisée.

Une étape n’accepte qu’un seul remplacement : un scénario, une sortie simulée ou un échec simulé. Le formulaire **Configuration** n’a pas encore de champ pour `scenarios` : écris-les avec **Modifier en YAML**, et le formulaire les garde tels quels. [Connectors](/fr/develop/connectors#scenarios) explique comment une action déclare ses scénarios et comment leurs échecs sont classés. Par le [point d’accès MCP](/fr/develop/mcp-endpoint#authoring), `get_catalog` liste les scénarios que fournit chaque action.

### Partir du déclencheur ou d’un chemin

Quand l’automatisation offre plus d’un point de départ, **Ajouter un test** ouvre un menu. **Test vide** ajoute le test décrit plus haut. **À partir de l’entrée du déclencheur** commence avec l’entrée que le déclencheur lié donne à une exécution : une planification qui se déclenche à un moment fixe, la livraison d’exemple d’un webhook ou l’exemple d’un événement, si bien que le test reçoit la même entrée à chaque exécution. **Pour un chemin non testé** liste les chemins possibles qu’aucun test ne suit encore, dans les mots de la [liste des chemins](/fr/platform/automations/editor#paths) ; une fois que chaque chemin en a un, le menu indique **Chaque chemin a un test** à la place. Le nouveau test simule chaque échec dont le chemin a besoin et attend l’état de chaque étape sur ce chemin ; sa description dit quelles conditions l’entrée doit rendre vraies ou fausses. **À partir d’une exécution** enregistre l’une des cinq exécutions les plus récentes comme test, comme le décrit [Enregistrer une exécution comme test](#save-a-run).

### Enregistrer une exécution comme test {#save-a-run}

Une exécution qui a fait ce qu’il fallait, ou une qui a mal tourné, devient un test à part entière. **À partir d’une exécution** dans le menu **Ajouter un test** liste les cinq exécutions les plus récentes, la page d’une exécution et sa ligne dans l’onglet **Exécutions** proposent **Enregistrer comme test…** dans leurs menus, et un [essai du brouillon](/fr/platform/automations/editor#try-the-draft) propose **Enregistrer comme test** dans sa bande. La boîte de dialogue fait de l’exécution un test, avec son entrée :

- **Le test attend** suit la façon dont l’exécution s’est terminée : **Elle renvoie cette sortie**, ou **Sa sortie contient ceci**, pour une exécution réussie ; **Elle réussit** pour une exécution en échec, si bien que le test échoue tant que l’échec n’est pas corrigé, ou **Elle échoue à Score** quand elle a échoué à Score. **Rien pour l’instant** vérifie seulement que l’exécution réussit.
- **Simuler avec les données de cette exécution** liste les étapes qui ont appelé un modèle, un agent, un connector ou une autre automatisation, chacune activée par défaut : dans le test, elle répond comme dans l’exécution. Une étape de code reste désactivée, car ton code est ce que le test vérifie.
- **Attendre aussi les mêmes actions** attend chaque action de l’exécution, sans son entrée.

**Ajouter le test** place le test dans ton brouillon et l’ouvre sur **Configuration** ; enregistrer le brouillon le conserve. Les valeurs qui ressemblent à des identifiants sont laissées de côté, et la boîte de dialogue dit combien. L’entrée de l’exécution et les sorties que tu gardes font partie de l’automatisation, donc toute personne qui peut l’ouvrir peut les lire.

Les entrées, sorties et messages d’erreur copiés font partie du contenu rédigé dans la version enregistrée. Ils peuvent rester dans les versions conservées après la suppression de l’exécution d’origine, y compris par rétention ou effacement. Supprimer un test dans une version ultérieure ne modifie pas les versions précédentes. Avant d’enregistrer, vérifie **Entrée**, **Sorties simulées**, **Échecs simulés** et **Attentes**, puis remplace les données personnelles par des exemples synthétiques.

<Frame caption="Une exécution réelle d’Answer launch questions enregistrée comme test : elle attend ce que l’exécution a renvoyé, et la recherche répond comme dans l’exécution.">

![La boîte de dialogue Save the run as a test : Name From the run of Oct 11, 2026, 12:29 PM ; sous The test expects, It returns this output est choisi ; sous Simulate with this run's data, Related est activé et répond avec la sortie renvoyée dans l’exécution ; Also expect the same actions est désactivé ; puis la ligne sur l’endroit où va le test et qui peut le lire, avec Cancel et Add test.](/images/platform/automation-save-as-test.webp)

</Frame>

### Voir ce que les tests couvrent

Une fois des tests exécutés, la ligne au-dessus de la liste indique combien des chemins possibles de l’automatisation ils suivent, par exemple **Couvre 1 chemin sur 2**. Sélectionne-la pour ouvrir la liste des chemins, où chaque chemin indique **Testé par** avec les tests qui le suivent, ou **Non testé**. Un test couvre le chemin que son exécution a réellement pris, qui n’est pas toujours celui pour lequel il a été écrit.

<Frame caption="Tout exécuter sur les remises de commande : les deux tests sautent l’étape Review, donc le chemin où elle s’exécute n’a pas encore de test.">

![L’éditeur d’Order discounts après Run all, avec Possible paths ouvert à côté du canevas : Path 1, où Review s’exécute, est Not tested, et Path 2, où Review est ignorée, est Tested by Small order pays full price and Big order gets 10% off. Sous le canevas, l’onglet Tests indique Covers 1 of 2 paths.](/images/platform/automation-test-coverage.webp)

</Frame>

## Exécuter les tests

**Tout exécuter** exécute chaque test, et **Exécuter** dans le menu d’une ligne ou dans le test ouvert en exécute un seul. Avec des modifications non enregistrées, les tests s’exécutent sur ton brouillon. Sans, ils s’exécutent sur la version affichée, et une exécution de tous ses tests devient le résultat des tests de cette version, marqué **Vérifié manuellement**.

Chaque version garde sa dernière vérification, et [Versions](/fr/platform/automations/editor#versions) l’affiche, par exemple **2 tests sur 3 réussis · vérifié à la mise en service**. Quand des tests en échec bloquent une mise en service, **Tests** s’ouvre avec le focus sur le premier test en échec.

Les tests s’exécutent toujours en simulation : un connector, un modèle ou un agent répond par une réponse de substitution, et rien n’est envoyé ni modifié hors de Tale. Un test s’arrête au bout de 10 secondes, et une exécution de tous les tests au bout de 60 secondes. Si beaucoup de tests viennent de s’exécuter dans ton organisation, Tale te demande d’attendre quelques secondes et indique combien.

## Lire un résultat

Sélectionne un test pour l’ouvrir à côté du canevas. Un test qui a un résultat s’ouvre sur **Résultat** : une phrase pour chaque chose qui n’allait pas, et ce qui l’explique.

- **Sortie** : chaque champ qui diffère, comme `total: expected 2160, got 2280`, et les champs que le test attendait sans les obtenir.
- **Actions** : l’action que le test attendait et ce qui s’est passé à la place, ou celle qui n’aurait pas dû avoir lieu.
- **Étapes** : l’étape qui s’est exécutée, a été ignorée ou a échoué contre l’attente du test, avec un moyen de l’afficher sur le canevas.
- **Une exécution en échec** : l’étape où l’exécution a échoué, et pourquoi, dans les mots des [journaux d’exécution](/fr/platform/automations/execution-logs).

**Simulés** nomme les étapes que le test remplace, chacune par une sortie simulée, un échec simulé ou un scénario. **Non utilisés** nomme les étapes dont aucun appel n’a utilisé le remplacement : une étape que l’exécution a ignorée, ou une étape dont aucun appel ne correspondait au scénario, et qui a donc reçu la réponse simulée habituelle du connector. **Détails techniques** affiche le message du moteur lui-même. Un résultat issu de la dernière vérification de la version ne conserve pas les étapes ; exécute le test pour les voir.

### Afficher l’exécution d’un test sur le canevas {#show-on-canvas}

**Afficher sur le canevas**, dans **Résultat** ou dans le menu de la ligne d’un test, affiche la dernière exécution du test sur le canevas à la place de la dernière exécution, pour la rejouer étape par étape comme une exécution enregistrée. Une bande au-dessus du canevas nomme le test, par exemple **Test : Big order gets 10% off**, et indique quand il s’est exécuté et s’il a réussi : **Réussi en 4 ms**, ou son premier échec. Une étape que le test simule porte **Sortie simulée** ou **Échec simulé**. Sélectionne une étape pour voir ce qu’elle a reçu et renvoyé dans son onglet **Dans ce test**. **Exécuter** dans la bande relance le test et affiche la nouvelle exécution, et **Masquer le résultat** ramène la dernière exécution. Dès que l’automatisation ou le test change, la bande le dit : l’exécution ne montre plus ce que fait le brouillon.

## Corriger un problème dans un test

Tale vérifie les tests comme le reste du brouillon. Un test qui ne peut jamais réussir, par exemple parce qu’il simule une étape que l’automatisation n’a pas ou qu’il nomme un champ inconnu, figure dans **Problèmes** avec ce qu’il faut corriger. C’est aussi le cas d’un test qui choisit un scénario pour une étape que l’automatisation n’a pas, en choisit un que l’action de l’étape ne fournit pas, ou donne deux remplacements à une étape. Pour un scénario que l’action ne fournit pas, le problème nomme le plus proche et liste les scénarios que fournit l’action. Un tel test ne peut pas s’exécuter tant que tu ne l’as pas corrigé. Sélectionne le problème pour ouvrir le test à cet endroit de son YAML.
