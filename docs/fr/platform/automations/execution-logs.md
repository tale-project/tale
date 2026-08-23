---
title: Journaux d’exécution
description: Comment lire les exécutions d’une automatisation — les statuts, le mode, ce qui a lancé chacune, les résultats par nœud et les effets, plus une séance de débogage jouée de bout en bout.
---

Chaque lancement d’une automatisation ouvre une exécution, et cette exécution continue de s’écrire elle-même jusqu’à ce qu’elle se termine. Elle enregistre ce qui l’a lancée, la version qu’elle a utilisée, ce qu’elle a reçu, ce que chaque nœud a produit et tout ce qu’elle a changé hors de la plateforme. C’est la surface vers laquelle pointe chaque autre page d’automatisation quand quelque chose ne s’est pas passé comme prévu : autant savoir en lire une avant d’en avoir besoin.

## La liste des exécutions

La page d’une automatisation se termine par une liste **Exécutions**, la plus récente en premier. Chaque ligne porte le statut de l’exécution, s’il s’agissait d’un essai ou d’une exécution réelle, la version employée, l’heure de départ et ce qui l’a lancée. Une exécution en échec ou en attente affiche la raison sur la ligne même plutôt que son lanceur : la liste répond donc souvent à la question sans qu’il faille ouvrir quoi que ce soit.

Une automatisation qui ne s’est jamais exécutée le dit, au lieu d’afficher un tableau vide.

## Ce que dit chaque statut

| Statut                | Ce qu’il t’apprend                                                             |
| --------------------- | ------------------------------------------------------------------------------ |
| **En file d’attente** | L’exécution existe et attend que le moteur la prenne en charge                 |
| **En cours**          | Le moteur avance à travers les nœuds                                           |
| **En attente**        | L’exécution est arrêtée sur une décision humaine ou une réponse qu’elle attend |
| **Réussie**           | Chaque nœud atteint est allé au bout et la sortie a été produite               |
| **En échec**          | Un nœud a levé une erreur et rien n’était réglé pour continuer au-delà         |
| **Arrêtée**           | Quelqu’un a annulé l’exécution ; ce qui était déjà fait n’est pas défait       |

**En attente** est le statut le plus mal lu. Ce n’est ni un blocage ni un échec : l’exécution garde sa place et repartira du nœud où elle s’est arrêtée dès que la décision qu’elle attend sera prise. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique ce qu’elle attend.

## Essais et exécutions réelles

Chaque exécution est marquée comme l’un ou l’autre, et la différence tient à ce que le monde extérieur ait été touché ou non. Un **essai** utilise la valeur déterministe de chaque connecteur : aucun courrier ne part, aucun enregistrement n’est écrit, rien n’est facturé. Une exécution **réelle** peut faire les trois, et c’est pourquoi en lancer une demande un droit de développeur et pourquoi chacun de ses effets est enregistré.

Lire un essai te dit si le graphe et le flux de données sont justes. Seule une exécution réelle te dit si les systèmes extérieurs se sont comportés comme tu le pensais.

## Lire une exécution

Ouvre une exécution et tu obtiens le canvas de l’automatisation avec cette exécution peinte dessus, plus les faits propres à l’exécution autour : la version, le mode, l’heure de départ et l’heure de fin.

### Résultats par nœud

Chaque boîte du canvas porte le statut que l’exécution lui a donné — **Exécuté**, **Ignoré**, **En échec**, **Jamais atteint**, ou **Pas encore atteint** tant que l’exécution continue. Un échec est donc une position dans le graphe plutôt qu’une ligne à chercher, et les nœuds en aval montrent clairement qu’ils n’ont jamais été atteints.

Sélectionne un nœud et le panneau montre ce qui lui est arrivé : l’**Entrée résolue** qu’il a réellement reçue une fois tous les templates évalués, et sa **Sortie**. L’entrée résolue est le champ le plus utile de cette page. Elle montre la valeur qu’une référence a produite plutôt que la référence que tu as écrite, et c’est ainsi qu’on attrape un template qui s’est résolu en silence vers rien.

Les nœuds ignorés méritent d’être lus plutôt que survolés, car la raison diffère : un nœud peut être ignoré par sa propre condition, parce qu’un nœud dont il dépend a été ignoré, parce qu’il est la branche « sinon » d’un nœud qui s’est exécuté, ou parce qu’il a échoué sous un réglage qui laisse l’exécution continuer.

### Effets

Une exécution conserve aussi la liste ordonnée de tout ce qu’elle a changé hors de la plateforme — chaque entrée nommant le nœud responsable, l’connector appelée et l’entrée avec laquelle elle a été appelée. Une exécution qui n’a rien changé hors de la plateforme le dit explicitement, et c’est une vraie réponse plutôt qu’une section vide.

La liste des effets est ce qui rend une exécution vérifiable après coup. Quand quelqu’un demande si un message est vraiment parti, c’est cette liste qui répond, et elle reste attachée à l’exécution en permanence.

## Pourquoi une longue exécution ne se répète pas

Une exécution réelle ne se déroule pas d’un seul tenant. Elle avance nœud par nœud, et chaque nœud terminé est enregistré comme point de reprise avant que le suivant ne commence : quand l’exécution atteint la fenêtre de temps de la plateforme, elle se rend la main et repart du dernier nœud terminé. Un nœud déjà exécuté n’est jamais atteint une seconde fois, et c’est ce qui empêche une exécution interrompue d’envoyer deux fois le même message.

Ces mêmes points de reprise couvrent une exécution dont la continuation a été perdue. Une exécution restée dans un état non terminal au-delà d’un délai de grâce est reprise automatiquement et continue là où ses points de reprise la situent, plutôt que de redémarrer ou de rester inachevée pour toujours.

## Quand une étape agent échoue

Quand une étape agent échoue pour une raison qu’une nouvelle tentative peut changer — le fournisseur a refusé l’appel, la sandbox est morte sous elle, le harness s’est écrasé — l’exécution la retente d’elle-même : jusqu’à trois tentatives automatiques, immédiates, en plus de la tentative d’origine. Tout ce qui est en amont garde ses points de reprise, l’exécution reste vivante tout du long, et son en-tête compte les tentatives de la plateforme — **Tentative automatique 1 sur 3** — pour distinguer la relance du moteur d’une relance que tu aurais lancée toi-même. Une tentative qui a réellement progressé — quinze minutes d’exécution effective — recharge le budget au lieu de le dépenser ; et chez les fournisseurs servis par un pool de comptes d’abonnement, chaque nouvelle tentative évite les comptes qui viennent d’échouer.

Deux échecs ne sont jamais retentés, parce qu’une tentative fraîche ne pourrait pas finir autrement : une étape qui a épuisé toute sa fenêtre de temps, et une question restée sans réponse jusqu’à son expiration. Une fois le budget épuisé, l’exécution échoue avec la dernière erreur et dit combien de tentatives elle a brûlées ; chaque tentative est facturée séparément — une exécution qui a retenté trois fois en a payé quatre. Une exécution qui retente reste une seule exécution réelle — **Arrêter l’exécution** est la porte de sortie quand tu vois que les tentatives ne changeront plus rien.

## Une séance de débogage jouée de bout en bout

La relance quotidienne n’est pas partie. Ouvre l’automatisation et regarde la liste **Exécutions** : celle de ce matin est là et elle est **En échec**, avec sa raison sur la ligne.

Ouvre-la. Le canvas montre les trois premiers nœuds comme exécutés, le quatrième en échec, et tout ce qui suit comme jamais atteint : la question est déjà réduite à une boîte. Sélectionne le nœud en échec et lis son **Entrée résolue** : le nom du client est là, l’id de facture est une chaîne vide. Cela renvoie un nœud plus haut.

Sélectionne ce nœud en amont et lis sa sortie. Il a retourné un enregistrement sans champ `id`, parce que le champ qu’il lisait avait été renommé. Le template qui le référençait s’est résolu vers rien, et le nœud en aval a échoué sur la valeur vide plutôt que sur quoi que ce soit qui lui soit propre.

<Tip>

Lis la liste des effets avant de corriger quoi que ce soit. Elle te dit si l’exécution est allée assez loin pour toucher le monde extérieur, ce qui décide si relancer est sans risque ou demande d’abord un nettoyage.

</Tip>

Corrige la référence dans le panneau du nœud, enregistre une version avec une note nommant le champ renommé, et appuie sur **Essai**. L’essai parcourt le même graphe et cette fois chaque boîte apparaît comme exécutée. Mets cette version en service, et la planification de demain la reprendra.

## Arrêter une exécution

Tant qu’une exécution n’est pas terminée, tu peux l’arrêter, et une exécution arrêtée est définitive : le moteur vérifie à chaque frontière de nœud et cesse de planifier le suivant. Ce qui a déjà été fait n’est pas annulé, parce que cela ne peut pas l’être : un message envoyé est envoyé. Lis la liste des effets pour voir jusqu’où elle est allée avant de décider de la suite.

## Où cela s’inscrit

Une exécution est le reçu que laisse une automatisation : son statut dit ce qui s’est passé, ses résultats par nœud disent où, ses entrées résolues disent pourquoi, et ses effets disent ce qu’elle a changé hors de la plateforme. Associe cette page à [Déclencheurs de workflow](/fr/platform/automations/triggers) pour les sortes de lancement qui ouvrent ces enregistrements, et aux [journaux d’audit](/fr/platform/admin/governance/audit-logs) pour la trace, à l’échelle de l’organisation, de qui a changé quoi.
