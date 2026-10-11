---
title: Tester une automatisation
description: Écris des tests pour une automatisation dans l’éditeur, exécute-les sur ton brouillon ou sur une version enregistrée, et lis ce qu’un test en échec a trouvé.
---

Un test exécute une automatisation avec une entrée de ton choix et vérifie ce qui en ressort : la sortie, les actions qu’elle déclenche et les étapes qui s’exécutent. Les tests font partie du document de l’automatisation, si bien que chaque version garde les siens. Tale les exécute à l’enregistrement, puis à nouveau avant chaque mise en service, et une version dont les tests échouent ne peut pas être déployée. Écrire et exécuter des tests demande le rôle Developer, Admin ou Owner.

## Ouvrir les tests

Dans l’[éditeur de workflow](/fr/platform/automations/editor), sélectionne **Tests** à côté de **Problèmes**. Le bouton compte les résultats, par exemple deux coches vertes et une croix rouge, et ouvre l’onglet **Tests** du panneau sous le canevas ; l’autre onglet est **Problèmes**. Sur un téléphone, la liste s’ouvre dans un panneau à part.

Chaque ligne est un test, dans l’ordre du document : son statut, son nom et, pour un test en échec, la première chose qui n’allait pas. La ligne au-dessus de la liste dit d’où viennent les résultats : **Exécuté sur ton brouillon**, ou la dernière vérification de la version, par exemple **Vérifié au déploiement de la version 3** avec la date. Un test affiche **Pas encore exécuté** tant qu’il n’a pas de résultat, **N'a pas pu s'exécuter** quand l’automatisation elle-même n’a pas pu s’exécuter, et **Modifié depuis ce résultat** dès que l’automatisation ou le test a changé après son exécution ; ce résultat reste affiché, pour que tu voies ce qui l’a changé.

<Frame caption="Tout exécuter sur les remises de commande : le test de la grosse commande échoue, et son résultat dit ce que la sortie aurait dû être.">

![L’éditeur d’Order discounts avec Tests dans l’en-tête, qui montre une coche et une croix, et l’onglet Tests sous le canevas : Small order pays full price a réussi, et Big order gets 10% off a échoué parce que 2 champs vérifiés manquent ou diffèrent. À côté du canevas, l’onglet Result du test en échec liste discount: expected 240, got 120 et total: expected 2160, got 2280, et indique qu’un autre champ n’est pas vérifié.](/images/platform/automation-tests.webp)

</Frame>

## Ajouter un test

1. Dans l’onglet **Tests**, sélectionne **Ajouter un test**, puis **Test vide** si un menu s’ouvre. Un test nommé **Nouveau test** s’ouvre à côté du canevas, avec un espace réservé pour chaque champ que l’entrée de l’exécution exige.
2. Dans **Configuration**, remplis le test : son **Nom**, l’**Entrée** que reçoit l’exécution en JSON, les **Sorties simulées** et les **Échecs simulés** qui remplacent des étapes, et sous **Attentes** ce que l’exécution doit faire. Tes modifications passent dans le brouillon au fil de la saisie.
3. Enregistre le brouillon pour garder le test. L’enregistrement exécute tous les tests et consigne le résultat avec la version.

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

Sans `expect`, un test réussit quand l’exécution réussit. Le menu d’une ligne copie aussi un test avec **Dupliquer** ou le retire avec **Supprimer** ; **Abandonner** fait revenir un test supprimé tant que tu n’as pas enregistré.

### Partir du déclencheur ou d’un chemin

Quand l’automatisation offre plus d’un point de départ, **Ajouter un test** ouvre un menu. **Test vide** ajoute le test décrit plus haut. **À partir de l’entrée du déclencheur** commence avec l’entrée que le déclencheur lié donne à une exécution : une planification qui se déclenche à un moment fixe, la livraison d’exemple d’un webhook ou l’exemple d’un événement, si bien que le test reçoit la même entrée à chaque exécution. **Pour un chemin non testé** liste les chemins possibles qu’aucun test ne suit encore, dans les mots de la [liste des chemins](/fr/platform/automations/editor#paths) ; une fois que chaque chemin en a un, le menu indique **Chaque chemin a un test** à la place. Le nouveau test simule chaque échec dont le chemin a besoin et attend l’état de chaque étape sur ce chemin ; sa description dit quelles conditions l’entrée doit rendre vraies ou fausses.

### Voir ce que les tests couvrent

Une fois des tests exécutés, la ligne au-dessus de la liste indique combien des chemins possibles de l’automatisation ils suivent, par exemple **Couvre 1 chemin sur 2**. Sélectionne-la pour ouvrir la liste des chemins, où chaque chemin indique **Testé par** avec les tests qui le suivent, ou **Non testé**. Un test couvre le chemin que son exécution a réellement pris, qui n’est pas toujours celui pour lequel il a été écrit.

<Frame caption="Tout exécuter sur les remises de commande : les deux tests sautent l’étape Review, donc le chemin où elle s’exécute n’a pas encore de test.">

![L’éditeur d’Order discounts après Run all, avec Possible paths ouvert à côté du canevas : Path 1, où Review s’exécute, est Not tested, et Path 2, où Review est ignorée, est Tested by Small order pays full price and Big order gets 10% off. Sous le canevas, l’onglet Tests indique Covers 1 of 2 paths.](/images/platform/automation-test-coverage.webp)

</Frame>

## Exécuter les tests

**Tout exécuter** exécute chaque test, et **Exécuter** dans le menu d’une ligne ou dans le test ouvert en exécute un seul. Avec des modifications non enregistrées, les tests s’exécutent sur ton brouillon. Sans, ils s’exécutent sur la version affichée, et une exécution de tous ses tests devient le résultat des tests de cette version, marqué **Vérifié manuellement**.

Les tests s’exécutent toujours en simulation : un connecteur, un modèle ou un agent répond par une réponse de substitution, et rien n’est envoyé ni modifié hors de Tale. Un test s’arrête au bout de 10 secondes, et une exécution de tous les tests au bout de 60 secondes. Si beaucoup de tests viennent de s’exécuter dans ton organisation, Tale te demande d’attendre quelques secondes et indique combien.

## Lire un résultat

Sélectionne un test pour l’ouvrir à côté du canevas. Un test qui a un résultat s’ouvre sur **Résultat** : une phrase pour chaque chose qui n’allait pas, et ce qui l’explique.

- **Sortie** : chaque champ qui diffère, comme `total: expected 2160, got 2280`, et les champs que le test attendait sans les obtenir.
- **Actions** : l’action que le test attendait et ce qui s’est passé à la place, ou celle qui n’aurait pas dû avoir lieu.
- **Étapes** : l’étape qui s’est exécutée, a été ignorée ou a échoué contre l’attente du test, avec un moyen de l’afficher sur le canevas.
- **Une exécution en échec** : l’étape où l’exécution a échoué, et pourquoi, dans les mots des [journaux d’exécution](/fr/platform/automations/execution-logs).

**Simulés** nomme les étapes que le test remplace, et **Non utilisés** celles que l’exécution a ignorées. **Détails techniques** affiche le message du moteur lui-même. Un résultat issu de la dernière vérification de la version ne conserve pas les étapes ; exécute le test pour les voir.

### Afficher l’exécution d’un test sur le canevas {#show-on-canvas}

**Afficher sur le canevas**, dans **Résultat** ou dans le menu de la ligne d’un test, affiche la dernière exécution du test sur le canevas à la place de la dernière exécution, pour la rejouer étape par étape comme une exécution enregistrée. Une bande au-dessus du canevas nomme le test, par exemple **Test : Big order gets 10% off**, et indique quand il s’est exécuté et s’il a réussi : **Réussi en 4 ms**, ou son premier échec. Une étape que le test simule porte **Sortie simulée** ou **Échec simulé**. Sélectionne une étape pour voir ce qu’elle a reçu et renvoyé dans son onglet **Dans ce test**. **Exécuter** dans la bande relance le test et affiche la nouvelle exécution, et **Masquer le résultat** ramène la dernière exécution. Dès que l’automatisation ou le test change, la bande le dit : l’exécution ne montre plus ce que fait le brouillon.

## Corriger un problème dans un test

Tale vérifie les tests comme le reste du brouillon. Un test qui ne peut jamais réussir, par exemple parce qu’il simule une étape que l’automatisation n’a pas ou qu’il nomme un champ inconnu, figure dans **Problèmes** avec ce qu’il faut corriger. Sélectionne le problème pour ouvrir le test à cet endroit de son YAML.
