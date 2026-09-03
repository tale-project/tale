---
title: L’éditeur de workflow
description: Le manuel d’exploitation de la page d’une automatisation — lire le canvas, modifier un nœud, enregistrer une version, la lancer contre des simulations, la mettre en service et revenir en arrière.
---

Cette page est la moitié pratique des automatisations : ce que tu cliques, et dans quel ordre, pour transformer une idée en la version que tes déclencheurs exécutent. Le modèle en dessous — un document, des versions immuables, une seule en service, des déclencheurs rattachés au nom — vit dans les [concepts d’automatisation](/fr/platform/automations/concepts), et cette page le suppose acquis. Enregistrer, tester et mettre en service sont trois gestes distincts ici, et c’est cette séparation qui te laisse modifier une automatisation en service sans déranger la moindre exécution en cours.

## Où vit une automatisation

Ouvre **Automatisations** dans la barre latérale. La liste montre chaque automatisation de l’organisation avec son nombre de versions et soit la version en service, soit **Pas en service** tant qu’il n’y en a aucune. Clique sur l’une d’elles et tu arrives sur sa page.

Cette page est un plan de travail, pas une série d’onglets. Le nom porte le badge **En service** quand la version à l’écran est en service. **Version**, **Essai**, **Exécuter en réel**, **Abandonner** et **Enregistrer** sont à droite — **Mettre cette version en service** se place à côté de **Version** quand le choix n’est pas en service. À côté du canvas, le panneau montre **Déclencheur** et **Projets** — les projets dont les boards de tâches voient l’automatisation ; aucun veut dire toute l’organisation — jusqu’à ce que tu cliques sur une boîte. Le panneau a la hauteur du canvas, qui remplit la fenêtre sous l’en-tête. Quand tu sélectionnes un nœud, le canvas ne s’agrandit pas — les champs en trop défilent dans le panneau. Clique sur **Fermer**, appuie sur Échap, clique à nouveau sur la boîte sélectionnée, ou sur le canvas vide, pour les retrouver. **Versions** et **Exécutions** sont en dessous.

## Lire le canvas

Le canvas dessine la version affichée. Chaque boîte est un nœud, étiqueté avec son id et son type, et les boîtes qui lisent la sortie d’un autre nœud le disent : une ligne **Lit** nomme les nœuds dont elles dépendent. Les flèches entre les boîtes ne sont pas quelque chose que tu traces — une flèche existe parce que le champ d’un nœud référence la sortie d’un autre. Le graphe correspond donc toujours au document.

Le contrôle du flux apparaît en badge sur la boîte concernée, dans le même vocabulaire que le document : `si …`, `sinon de …`, `pour chaque …`, `répéter jusqu’à …` (avec le plafond quand il y en a un) et `continuer en cas d’erreur`. Rien de la forme du graphe ne se cache dans un écran de réglages à part.

Deux états valent la peine d’être reconnus. Une version sans nœud le dit et t’invite à en ajouter un au document. Une version dont les nœuds se référencent en boucle t’avertit que l’ordre affiché est celui dans lequel ils sont écrits, pas un ordre que le moteur pourrait exécuter, et te demande de retirer l’une des références pour rompre la boucle.

Un agent qui nomme un modèle sans fournisseur épinglé affiche un avertissement sur sa boîte. Épingle le fournisseur sur le nœud, enregistre, puis mets la nouvelle version en service.

<Note>

Le canvas sert à lire et à sélectionner. Tu relies des nœuds en les référençant, pas en tirant une liaison entre deux boîtes.

</Note>

## Modifier un nœud

Clique sur une boîte et le panneau à côté du canvas passe de **Déclencheur** aux champs de ce nœud. Clique sur **Fermer**, appuie sur Échap (quand tu ne tapes pas dans un champ), clique à nouveau sur la boîte, ou sur le canvas vide, pour revenir. Les champs affichés dépendent du type : **Code** pour un `transform`, **Prompt**, **Prompt système**, **Modèle** et **Schéma de sortie** pour un `llm`, **Workflow** pour un `subworkflow`, et **Entrée** partout où il y en a une. Les champs propres au type se trouvent au-dessus de **Entrée**.

**Entrée** est un objet JSON, et c’est là que vivent les références. Une valeur texte peut référencer la sortie d’un autre nœud, et c’est précisément cette référence qui trace la flèche sur le canvas. Tant que le JSON est incomplet, le panneau te dit qu’il n’est pas encore valide et laisse le nœud inchangé : une modification à moitié tapée ne peut donc jamais être enregistrée par accident.

Ouvre **Contrôle du flux** pour **Si**, **Sinon de**, **Pour chaque** et **Répéter jusqu’à**. Ce sont les mêmes champs que reflètent les badges du canvas : en régler un ici change le badge immédiatement. Le groupe s’ouvre dès qu’un de ces champs est déjà renseigné.

## Enregistrer, lancer, mettre en service

Les trois gestes sont volontairement distincts. Parcours-les dans l’ordre la première fois et la séparation cesse de ressembler à du travail en plus.

<Steps>

<Step title="Enregistrer une version">

Les modifications affichent la mention **Modifications non enregistrées** jusqu’à ce que tu enregistres. Clique sur **Enregistrer**, écris une **Note de version** qui dit ce qui a changé — cette note sera plus tard la seule chose qui distingue deux versions dans la liste — puis confirme **Enregistrer une version**. L’enregistrement ajoute une version et laisse chaque précédente exactement telle qu’elle était. Si rien n’a changé, le bouton te le dit au lieu de créer une version identique.

</Step>

<Step title="La lancer contre des simulations">

**Essai** lance une exécution en mode simulé : les connecteurs renvoient leurs valeurs déterministes et rien hors de la plateforme n’est touché. Tu peux appuyer autant de fois que tu veux, et c’est ce qui en fait la boucle où travailler tant qu’un nœud prend encore forme.

Quand l’automatisation est liée à plus d’un projet, un sélecteur de **portée du projet** se place à côté des commandes d’exécution. Il vaut « toute l’organisation » par défaut ; choisis l’un des projets liés pour que l’exécution — et les outils de tâches et de documents de ses agents — n’agisse que dans ce projet.

</Step>

<Step title="Mettre en service la version voulue">

Quand la version du canvas n’est pas en service, **Mettre cette version en service** à côté de **Version** met en service celle à l’écran. Celle en service porte le badge **En service** dans **Versions**, et en mettre une autre en service déplace ce badge sans toucher au contenu d’aucune version.

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
        - connector: email.send
```

Le résultat des tests d’une version est consigné à l’enregistrement, et la liste **Versions** l’affiche en badge **Tests réussis** ou **Tests en échec**. La mise en service lit ce fait : une version enregistrée avec des tests en échec est refusée, et la page indique qu’elle n’a pas été mise en service plutôt que de ne rien faire en silence. Corrige la cause et enregistre une nouvelle version — un résultat consigné est un fait sur cette version-là et ne change jamais.

## Revenir en arrière

Revenir en arrière, c’est mettre en service une version plus ancienne. Choisis-la dans **Version** en haut — ou trouve-la dans **Versions**, lis sa note et clique dessus — puis clique sur **Mettre cette version en service**. Le badge se déplace, les versions plus récentes restent intactes dans la liste, et aucun document n’est réécrit.

C’est pour cela que les notes de version comptent plus qu’il n’y paraît. Six versions plus tard, c’est la note qui te dit laquelle était le dernier bon état : écris-la donc pour la personne qui la lira pendant un incident.

## Supprimer une automatisation

La suppression porte sur l’automatisation entière : toutes les versions, le déploiement, le déclencheur et les liens avec les projets partent ensemble — une planification ne se déclenche plus, une URL de webhook cesse de fonctionner immédiatement. Tu le fais depuis la liste, pas depuis cette page : ouvre **Automatisations**, le menu de la ligne, et clique **Supprimer**. La confirmation (**Supprimer l’automatisation**) la nomme d’abord. Les exécutions passées restent lisibles jusqu’à ce que la rétention les supprime : ce que l’automatisation a fait reste vérifiable après coup.

Deux garde-fous. Une exécution encore en file, en cours ou en attente bloque la suppression — annule-la ou laisse-la se terminer. Et un pack intégré supprimé reste supprimé au fil des mises à jour de la plateforme ; recrée une automatisation sous le même nom et le nom revit.

## Lire la dernière exécution sur le canvas

Dès qu’une automatisation s’est exécutée, **Afficher la dernière exécution** superpose cette exécution au canvas depuis une icône sur le canvas (elle devient **Masquer la dernière exécution** tant que la superposition est active). Chaque boîte reprend le statut que l’exécution lui a donné — **Exécuté**, **Ignoré**, **En échec**, **Jamais atteint**, ou **Pas encore atteint** tant que l’exécution continue. Un échec devient ainsi une position dans le graphe plutôt qu’une ligne à chercher dans un log.

Sélectionne un nœud avec la superposition active et le panneau ajoute une section **Dans cette exécution** : l’**Entrée résolue** que le nœud a réellement reçue une fois tous les templates évalués, sa **Sortie**, et les effets qu’il a produits, ou une note disant qu’il n’a rien changé hors de la plateforme. L’entrée résolue est en général la réponse la plus rapide à la question de savoir pourquoi un nœud a fait ce qu’il a fait : elle montre la valeur qu’une référence a produite, pas la référence que tu as écrite.

Un clic sur une ligne sous **Exécutions** ouvre la page de cette exécution, où le même canvas côtoie son entrée, sa sortie et la liste complète des effets. [Journaux d’exécution](/fr/platform/automations/execution-logs) lit cette page de bout en bout.

## Où cela s’inscrit

La boucle est courte une fois les trois gestes bien séparés : modifier un nœud, enregistrer une version avec une note qui vaut la peine d’être lue, la lancer contre des simulations jusqu’à ce qu’elle fasse ce que tu voulais, puis la mettre en service — et mettre en service une version plus ancienne quand il faut défaire. [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle que cette page manœuvre ; [Déclencheurs de workflow](/fr/platform/automations/triggers) est ce qui lancera la version en service une fois que tu en seras content.
