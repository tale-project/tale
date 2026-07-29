---
title: L’éditeur de workflow
description: Le manuel d’exploitation de la page d’une automatisation — lire le canvas, modifier un nœud, enregistrer une version, la lancer contre des simulations, la mettre en service et revenir en arrière.
---

Cette page est la moitié pratique des automatisations : ce que tu cliques, et dans quel ordre, pour transformer une idée en la version que tes déclencheurs exécutent. Le modèle en dessous — un document, des versions immuables, une seule en service, des déclencheurs rattachés au nom — vit dans les [concepts d’automatisation](/fr/platform/automations/concepts), et cette page le suppose acquis. Enregistrer, tester et mettre en service sont trois gestes distincts ici, et c’est cette séparation qui te laisse modifier une automatisation en service sans déranger la moindre exécution en cours.

## Où vit une automatisation

Ouvre **Automatisations** dans la barre latérale. La liste montre chaque automatisation de l’organisation avec son nombre de versions et soit la version en service, soit **Pas en service** tant qu’il n’y en a aucune. Clique sur l’une d’elles et tu arrives sur sa page.

Cette page est une seule surface qui défile, pas une série d’onglets. En haut se trouvent le nom de l’automatisation, la version que tu regardes, celle qui est en service et le bouton de lancement. En dessous vient le canvas avec le panneau du nœud à côté, puis la barre d’enregistrement, le panneau **Déclencheur** et le panneau **Projets** — les projets dont les boards de tâches voient l’automatisation ; aucun veut dire toute l’organisation — et tout en bas les listes **Versions** et **Exécutions** côte à côte.

## Lire le canvas

Le canvas dessine la version affichée. Chaque boîte est un nœud, étiqueté avec son id et son type, et les boîtes qui lisent la sortie d’un autre nœud le disent : une ligne **Lit** nomme les nœuds dont elles dépendent. Les flèches entre les boîtes ne sont pas quelque chose que tu traces — une flèche existe parce que le champ d’un nœud référence la sortie d’un autre. Le graphe correspond donc toujours au document.

Le contrôle du flux apparaît en badge sur la boîte concernée, dans le même vocabulaire que le document : `si …`, `sinon de …`, `pour chaque …`, `répéter jusqu’à …` (avec le plafond quand il y en a un) et `continuer en cas d’erreur`. Rien de la forme du graphe ne se cache dans un écran de réglages à part.

Deux états valent la peine d’être reconnus. Une version sans nœud le dit et t’invite à en ajouter un au document. Une version dont les nœuds se référencent en boucle t’avertit que l’ordre affiché est celui dans lequel ils sont écrits, pas un ordre que le moteur pourrait exécuter, et te demande de retirer l’une des références pour rompre la boucle.

<Note>

Le canvas sert à lire et à sélectionner. Tu relies des nœuds en les référençant, pas en tirant une liaison entre deux boîtes.

</Note>

## Modifier un nœud

Clique sur une boîte et le panneau à côté du canvas se remplit des champs de ce nœud. Les champs affichés dépendent du type : **Code** pour un `transform`, **Prompt**, **Prompt système**, **Modèle** et **Schéma de sortie** pour un `llm`, **Workflow** pour un `subworkflow`, et **Entrée** partout où il y en a une.

**Entrée** est un objet JSON, et c’est là que vivent les références. Une valeur texte peut référencer la sortie d’un autre nœud, et c’est précisément cette référence qui trace la flèche sur le canvas. Tant que le JSON est incomplet, le panneau te dit qu’il n’est pas encore valide et laisse le nœud inchangé : une modification à moitié tapée ne peut donc jamais être enregistrée par accident.

Sous les champs propres au type se trouve le groupe **Contrôle du flux** avec **Si**, **Sinon de**, **Pour chaque** et **Répéter jusqu’à**. Ce sont les mêmes champs que reflètent les badges du canvas : en régler un ici change le badge immédiatement.

## Enregistrer, lancer, mettre en service

Les trois gestes sont volontairement distincts. Parcours-les dans l’ordre la première fois et la séparation cesse de ressembler à du travail en plus.

<Steps>

<Step title="Enregistrer une version">

Les modifications affichent la mention **Modifications non enregistrées** jusqu’à ce que tu enregistres. Écris une **Note de version** qui dit ce qui a changé — cette note sera plus tard la seule chose qui distingue deux versions dans la liste — puis clique sur **Enregistrer une version**. L’enregistrement ajoute une version et laisse chaque précédente exactement telle qu’elle était. Si rien n’a changé, le bouton te le dit au lieu de créer une version identique.

</Step>

<Step title="La lancer contre des simulations">

**Essai** lance une exécution en mode simulé : les connecteurs renvoient leurs valeurs déterministes et rien hors de la plateforme n’est touché. Tu peux appuyer autant de fois que tu veux, et c’est ce qui en fait la boucle où travailler tant qu’un nœud prend encore forme.

</Step>

<Step title="Mettre en service la version voulue">

Dans la liste **Versions**, clique sur **Mettre en service** pour la version que tes déclencheurs doivent exécuter. Celle en service porte le badge **En service**, et en mettre une autre en service déplace ce badge sans toucher au contenu d’aucune version.

</Step>

</Steps>

<Note>

Le bouton de lancement de cette page exécute toujours contre des simulations. Une exécution autorisée à atteindre le monde extérieur est lancée par un déclencheur ou par un appel programmatique, et cela demande un droit de développeur.

</Note>

## Les tests et la porte de mise en service

Les tests font partie du document, pas d’un panneau séparé. Chacun porte un nom, une entrée et des attentes sur la sortie comme sur les effets que l’exécution doit produire, et ils voyagent avec la version comme n’importe quel autre champ.

```yaml
tests:
  - name: relance un mauvais payeur
    input: { invoiceId: 'inv-1' }
    expect:
      effects:
        - integration: email.send
```

Le résultat des tests d’une version est consigné à l’enregistrement, et la liste **Versions** l’affiche en badge **Tests réussis** ou **Tests en échec**. La mise en service lit ce fait : une version enregistrée avec des tests en échec est refusée, et la liste indique qu’elle n’a pas été mise en service plutôt que de ne rien faire en silence. Corrige la cause et enregistre une nouvelle version — un résultat consigné est un fait sur cette version-là et ne change jamais.

## Revenir en arrière

Revenir en arrière, c’est mettre en service une version plus ancienne. Trouve-la dans la liste, lis sa note pour confirmer que c’est la bonne, et clique sur **Mettre en service**. Le badge se déplace, les versions plus récentes restent intactes dans la liste, et aucun document n’est réécrit.

C’est pour cela que les notes de version comptent plus qu’il n’y paraît. Six versions plus tard, c’est la note qui te dit laquelle était le dernier bon état : écris-la donc pour la personne qui la lira pendant un incident.

## Lire la dernière exécution sur le canvas

Dès qu’une automatisation s’est exécutée, **Afficher la dernière exécution** superpose cette exécution au canvas. Chaque boîte reprend le statut que l’exécution lui a donné — **Exécuté**, **Ignoré**, **En échec**, **Jamais atteint**, ou **Pas encore atteint** tant que l’exécution continue. Un échec devient ainsi une position dans le graphe plutôt qu’une ligne à chercher dans un log.

Sélectionne un nœud avec la superposition active et le panneau ajoute une section **Dans cette exécution** : l’**Entrée résolue** que le nœud a réellement reçue une fois tous les templates évalués, sa **Sortie**, et les effets qu’il a produits, ou une note disant qu’il n’a rien changé hors de la plateforme. L’entrée résolue est en général la réponse la plus rapide à la question de savoir pourquoi un nœud a fait ce qu’il a fait : elle montre la valeur qu’une référence a produite, pas la référence que tu as écrite.

**Ouvrir la dernière exécution** mène à la page complète de l’exécution, où le même canvas côtoie son entrée, sa sortie et la liste complète des effets. [Journaux d’exécution](/fr/platform/automations/execution-logs) lit cette page de bout en bout.

## Où cela s’inscrit

La boucle est courte une fois les trois gestes bien séparés : modifier un nœud, enregistrer une version avec une note qui vaut la peine d’être lue, la lancer contre des simulations jusqu’à ce qu’elle fasse ce que tu voulais, puis la mettre en service — et mettre en service une version plus ancienne quand il faut défaire. [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle que cette page manœuvre ; [Déclencheurs de workflow](/fr/platform/automations/triggers) est ce qui lancera la version en service une fois que tu en seras content.
