---
title: L’éditeur de workflow
description: Lis une automatisation sur son canevas, suis ses chemins possibles, modifie les champs d’un nœud, enregistre une version, puis déploie-la ou rétablis-en une autre.
---

L’éditeur de workflow permet de lire ce que fait une automatisation, de modifier ses champs et de choisir la version enregistrée qui s’exécute en service. Les changements plus importants, comme de nouveaux nœuds, passent par un agent de code via MCP. Il faut les droits Développeur, Admin ou Propriétaire pour apporter des changements. Enregistrer, tester et mettre en service sont des étapes distinctes : modifier un brouillon laisse la version déployée en place.

Ouvre **Automatisations**, puis sélectionne une automatisation. Elle s’ouvre dans l’onglet **Éditeur**. Une automatisation ouverte depuis l’onglet **Automatisations** d’un projet affiche ce projet au début du fil d’Ariane : choisis le nom du projet pour revenir au projet, ou **Automatisations** pour revenir à ses automatisations. Que tu ouvres une automatisation depuis un projet ou depuis la liste, la barre de navigation met **Automatisations** en évidence. Pour en créer une, consulte [Créer ou importer une automatisation](/fr/platform/automations/catalog).

| Onglet | Utilisation |
| --- | --- |
| **Éditeur** | Lire et modifier le workflow, tester une version enregistrée et choisir celle à mettre en service. |
| **Général** | Choisir ce qui démarre l’automatisation et les projets qui peuvent l’utiliser. |
| **Exécutions** | Examiner les derniers lancements et ouvrir le détail d’une exécution. |
| **Versions** | Voir ce qui est en service, toutes les versions enregistrées et les mises en service, et mettre en service, rétablir ou restaurer une version. |

Le sélecteur **Version** reste à droite des onglets Éditeur, Général et Exécutions, sur ordinateur comme sur téléphone. Il affiche pour chaque version sa note, qui l’a enregistrée et quand, le résultat de ses tests et la version en service ; **Restaure la v3** et **Basée sur la v1** signalent une version qui en restaure une plus ancienne ou qui part d’elle. Sélectionne une ligne pour ouvrir cette version. **Toutes les versions et modifications**, en bas de la liste, ouvre **Versions** avec tout l’historique ; consulte [Versions et mises en service](#versions). Sur ordinateur, les commandes d’exécution se trouvent à côté des onglets, avec **Enregistrer** et **Abandonner** ; dans **Général**, seuls **Enregistrer** et **Abandonner** y figurent. Un point sur un onglet signale ses modifications non enregistrées. Avant de quitter cet onglet ou de changer de version, Tale te demande quoi en faire.

Sur téléphone, la navigation est compacte à l’ouverture d’une automatisation. Le canevas de l’éditeur occupe la hauteur disponible, et les commandes d’exécution et de mise en service se trouvent dans une barre au bas du canevas. Sélectionne un nœud pour ouvrir ses champs — avec Enregistrer et Abandonner — dans un panneau au bas de l’écran.

<Frame caption="Sur téléphone, le canevas prend la hauteur de l’écran et ses commandes d’exécution se trouvent dans une barre en bas.">

![L’éditeur de Triage the Gmail inbox sur téléphone : navigation compacte avec Editor, General et Runs, le canevas avec Start, Inbox et Due, et une barre au bas du canevas avec Deploy v1, Test run, Change model, No problems et Tests.](/images/platform/automation-editor-canvas-mobile.webp)

</Frame>

<Frame caption="Sur un écran large, sélectionne un nœud pour examiner ses champs à côté du canevas.">

![L’éditeur montre les nœuds de Gmail triage inbox entre Début et Fin, une condition formulée en mots au-dessus d’un nœud et les champs du nœud sélectionné à côté du canevas.](/images/platform/automation-editor-canvas.webp)

</Frame>

Pour passer à une autre automatisation sans revenir à la liste, clique sur le nom de celle qui est ouverte dans le fil d’Ariane. Le menu garde toutes les automatisations de l’organisation, même après un changement de projet, sauf celles associées uniquement à des projets que tu ne peux pas ouvrir. Celles qui ne sont rattachées à aucun projet apparaissent en premier, puis viennent celles liées à des projets. Une ligne horizontale sépare les deux groupes. Cherche par nom ou par slug, puis sélectionne une entrée. Tu conserves l’onglet ouvert. Depuis le détail d’une exécution, tu arrives sur la liste **Exécutions** de l’autre automatisation. Le numéro de version sélectionné n’est pas repris : **Éditeur** affiche la dernière version enregistrée de cette autre automatisation.

## Lire le canevas

Tale dessine le canevas à partir du document de l’automatisation et le dispose lui-même : **Début** se trouve en haut, **Fin** en bas, et chaque nœud se place sous les nœuds qu’il lit. Le canevas se lit donc de haut en bas, dans l’ordre que suit une exécution. Personne ne place un bloc, et dessiner ne relie rien. Un trait vient d’une référence comme `{{ nodes.draft.output.text }}` ; pour changer ce qu’un nœud lit, modifie la référence.

### Début et Fin

**Début** indique ce qui démarre une exécution et ce qu’elle reçoit. Sous **Démarre**, il décrit le déclencheur en mots, par exemple une planification avec son fuseau horaire et sa prochaine exécution, et précise si le déclencheur est désactivé ou attend une version en service. Vient ensuite **À la main, via l’API ou MCP**, car ces démarrages sont toujours possibles. Sous **Entrée**, il liste les champs de l’entrée de l’exécution, avec leur type et leur caractère obligatoire. Quand le déclencheur lancerait des exécutions dont l’automatisation refuse l’entrée, Début le signale.

**Fin** indique ce que renvoie une exécution réussie et comment une exécution peut se terminer. Sous **Renvoie**, elle nomme la sortie, par exemple **La sortie de Report**, ou liste ses champs et les nœuds dont ils viennent ; un champ vide lors de certaines exécutions porte **peut être vide**. Sous **Se termine**, elle liste les trois issues : **Réussie** renvoie la sortie, **En échec** survient quand l’un des nœuds qui arrêtent l’exécution échoue, et **Arrêtée** quand quelqu’un arrête l’exécution.

### Nœuds

Chaque nœud est un bloc. Sa première ligne montre son icône et son titre, tiré de son ID : `open_issues` devient **Open issues**. La ligne suivante indique de quel type de nœud il s’agit : le connector et l’action, comme **GitHub · Lister les issues**, **Transformation**, **Modèle de langage** ou **Agent** avec son modèle, ou l’automatisation qu’il appelle. Quand Tale sait ce que le nœud renvoie, une ligne en montre la structure, par exemple `{ issues: object[] }`. La ligne du bas indique ce que le nœud lit, par exemple **Lit Issues et l’entrée (owner, repo)**, ou **Ne lit aucun autre nœud**.

Des puces et de petites icônes ajoutent ce que la disposition ne montre pas. **Continue en cas d’erreur** marque un nœud dont l’exécution tolère l’échec, et **Ne s'exécute jamais** un nœud qu’aucune combinaison de conditions n’atteint. Un bouclier marque un nœud qui modifie des données dans un service connecté, où une exécution réelle peut attendre une approbation ; une bulle marque un agent qui peut poser une question ; une épingle barrée marque un modèle sans fournisseur fixé. Pointe sur une icône pour lire sa phrase ; un lecteur d’écran l’entend avec le bloc. Un bloc qui a des problèmes en affiche le nombre sur sa première ligne.

### Conditions et branches

La condition d’un nœud (`when`) se place au-dessus de lui, dans une pastille qui la formule en mots, par exemple « total de Score est supérieur à 1 000 ». Le nœud du dessous ne s’exécute que si la condition est remplie. Quand un autre nœud est son alternative (`elseOf`), la condition se divise en deux traits : **Oui** mène au nœud de gauche, qui s’exécute quand la condition est remplie, et **Non** à son alternative, à droite. Une condition que Tale ne peut pas formuler en mots affiche l’expression elle-même, en police de code.

```yaml
nodes:
  - id: escalate
    type: transform
    when: '{{ nodes.score.output.total > 1000 }}'
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "Escalate " + input.total };'
  - id: file
    type: transform
    elseOf: escalate
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "File " + input.total };'
```

Dans cet extrait, la condition au-dessus d’Escalate indique « total de Score est supérieur à 1 000 », **Oui** mène à Escalate et **Non** à File. Pointe sur une condition, ou sur son **Oui** ou son **Non**, pour mettre en évidence les chemins qui passent par elle.

### Traits, cadres et blocs tiretés

Un trait plein signifie que le nœud du dessous lit la sortie de celui du dessus. Un trait tireté signifie que le nœud du dessous s’exécute après celui du dessus sans lire sa sortie, par exemple parce que sa condition la lit. Un trait pointillé vers Fin part du dernier nœud d’une exécution dont Fin ne renvoie pas la sortie. Les traits **Oui** et **Non** ont leurs propres couleurs.

Un cadre autour d’un nœud indique qu’il s’exécute plusieurs fois : une fois par élément d’une liste (**Pour chaque élément de …**) ou à nouveau jusqu’à ce qu’une condition soit remplie (**Se répète jusqu’à : …, 5 fois au plus**). Un bloc tireté est un nœud qui peut ne pas s’exécuter ; après une exécution, c’est un nœud qui ne s’est pas exécuté. **Légende**, à côté du zoom, explique chaque type de trait et de bloc.

### Clavier et vue Liste

Le diagramme est un seul arrêt dans l’ordre de tabulation. Atteins-le avec Tab et le focus se pose sur Début ; les flèches suivent les traits de bloc en bloc et le long d’une rangée, Origine et Fin sautent à Début et à Fin, et Entrée ouvre le bloc qui a le focus. Un lecteur d’écran annonce pour chaque bloc son titre, son type et ce qu’il lit ; pour une condition, il annonce le nœud sur lequel elle décide.

Le sélecteur de vue en haut à gauche du canevas passe de **Canevas** à **Liste** et à **Source**. **Liste** montre les mêmes nœuds dans l’ordre de l’exécution, chacun avec ce qu’il lit et sa condition en mots ; Entrée y ouvre aussi un nœud. Quand le canevas est très étroit, il s’ouvre sur **Liste**. L’adresse garde la vue et le nœud ouvert, si bien qu’un lien partagé les rouvre tous les deux.

### Quand une nouvelle version arrive {#new-versions}

Quelqu’un peut enregistrer une nouvelle version pendant que tu consultes l’automatisation, par exemple un agent de code via MCP. Si tu consultes la dernière version sans modifications non enregistrées, le canevas passe à la nouvelle : les blocs glissent vers leur nouvelle place, les nouveaux apparaissent en fondu, ceux qui ont changé s’entourent une fois d’un anneau, et un lecteur d’écran annonce « Affichage de la v6. ». Le nœud ouvert le reste s’il existe encore. Si tu as des modifications non enregistrées, rien ne bouge. Un avis au-dessus du canevas indique **Une version plus récente a été enregistrée**, la version dont part ton brouillon, qui a enregistré la nouvelle et ce qu’elle change. **Voir ce qui a changé dans la v6** ouvre la comparaison dans un nouvel onglet, si bien que ton brouillon reste ouvert, et **Afficher la v6 et abandonner mon brouillon** passe à la nouvelle version.

## Suivre les chemins possibles {#paths}

Les conditions d’une exécution décident des nœuds qui s’exécutent. Le bouton des chemins, en haut à droite du canevas, compte les chemins qu’une exécution réussie peut prendre, par exemple **3 chemins**, et ouvre **Chemins possibles**. Chaque chemin nomme les conditions qui le décident, comme « Triage s’exécute » ou « Propose échoue, l’exécution continue », et le nombre de nœuds qui s’y exécutent.

Pointe sur un chemin, ou atteins-le avec les flèches, pour le prévisualiser sur le canevas. Clique dessus ou appuie sur Entrée pour le garder affiché : les nœuds hors du chemin deviennent tiretés et disent pourquoi ils ne s’exécutent pas, Fin marque les sorties qui restent vides sur ce chemin, et un lecteur d’écran annonce le chemin affiché. **Tout afficher**, ou Échap, affiche de nouveau chaque nœud. La liste reste ouverte pendant que tu sélectionnes des nœuds, pour comparer un chemin avec les champs d’un nœud.

<Frame caption="Trois chemins possibles pour une exécution du tri Gmail ; le chemin 2, épinglé, est celui où Propose échoue et où l’exécution continue.">

![Possible paths ouvert à côté du canevas de Triage the Gmail inbox : Path 1 exécute 6 nœuds sur 6 ; Path 2, épinglé, 5 sur 6, car Triage s’exécute et Propose échoue pendant que l’exécution continue ; Path 3 seulement 1 sur 6, car Triage est ignoré. En dessous, Ends the run when it fails dit ce qui fait échouer Inbox.](/images/platform/automation-editor-paths.webp)

</Frame>

Sous **Arrête l’exécution en cas d’échec**, la liste nomme les nœuds dont l’échec arrête l’exécution, avec ce qui peut faire échouer chacun d’eux. Pointe sur l’un d’eux pour les entourer tous de rouge ; sélectionne-en un pour l’ouvrir.

Sur téléphone, la liste s’ouvre dans un panneau au bas de l’écran. Choisir un chemin ferme le panneau et laisse en haut du canevas une pastille qui nomme le chemin, avec **Tout afficher**. Quand chaque exécution suit le même chemin, la liste le dit. Au-delà de 12 conditions et échecs tolérés, les chemins sont trop nombreux pour être listés ; **Quand il s’exécute** indique toujours, pour chaque nœud, quand il s’exécute. Un canevas qui contient un cycle n’a pas de bouton des chemins. [Les chemins qu’une exécution peut prendre](/fr/platform/automations/concepts#paths) explique comment Tale les détermine.

## Modifier un nœud

Sélectionne un bloc pour l’ouvrir. Sur un écran large, l’inspecteur s’ouvre à côté du canevas ; sans nœud sélectionné, le canevas occupe toute la largeur. Sur un écran plus étroit, il s’ouvre dans un panneau au-dessus du canevas. Son en-tête montre le titre du nœud, son type et son ID avec **Copier l’ID du nœud** ; les problèmes propres au nœud sont listés dessous. **Quand il s’exécute** résume la place du nœud dans le flux : à chaque exécution, sur certains chemins ou jamais, pourquoi il peut être ignoré et ce qui se passe s’il échoue, par exemple « S’il échoue, l’exécution s’arrête avec son erreur. »

Trois onglets suivent :

- **Champs** contient ce que tu peux modifier. Un `transform` possède du **Code** ; un `llm`, **Prompt**, **Prompt système**, **Modèle** et **Schéma de sortie** ; un `agent` y ajoute l’environnement d’agent et l’équipement. **Entrée** contient les valeurs JSON et références transmises au nœud.
- **Structure** montre ce que le nœud reçoit et renvoie, d’où Tale tient cette structure et quels nœuds lisent sa sortie. Sélectionne un lecteur pour l’ouvrir. **Afficher en TypeScript** montre la même structure sous forme de type.
- **Dernière exécution** montre l’**Entrée résolue**, la **Sortie** et les effets du nœud dans l’exécution affichée sur le canevas. L’onglet apparaît tant que le canevas montre une exécution, et s’appelle **Test non enregistré** pour un [essai du brouillon](#try-the-draft) et **Dans ce test** pour l’exécution d’un test.

<Frame caption="L’onglet Structure : ce que Triage renvoie, d’où vient cette structure et quels nœuds la lisent.">

![Le panneau de Triage, un nœud de modèle de langage, ouvert sur Shape : When it runs indique 2 chemins sur 3 et ignoré quand sa condition est fausse ; Returns liste, d’après son schéma de sortie, items avec action, reason, priority et conversationId, puis summary, au-dessus de Show as TypeScript ; Read by propose Record, Due et The automation output.](/images/platform/automation-editor-node-shape.webp)

</Frame>

Le sélecteur **Modèle** d’un nœud `llm` ou `agent` liste les modèles servis par les fournisseurs connectés de ton organisation ; un modèle absent de la liste peut être saisi, mais **Problèmes** avertit alors qu’une exécution réelle échouerait à ce nœud tant que son fournisseur n’est pas connecté. **Changer de modèle**, dans l’en-tête, utilise un autre modèle dans chaque nœud `llm` qui nomme un même modèle — les étapes concernées sont listées d’abord — en une seule modification que tu enregistres ensuite.

<Frame caption="Changer de modèle sur le tri de la boîte Gmail : le modèle que nomment ses deux étapes de modèle de langage, le modèle servi choisi à la place, et les étapes qui changent.">

![La boîte de dialogue Use another model in all steps. Replace affiche anthropic/claude-haiku-4-5 avec 2 steps, With affiche Claude Sonnet 4.6, et Steps that change liste Triage et Draft, au-dessus de Cancel et Use this model.](/images/platform/automation-model-swap.webp)

</Frame>

Ouvre **Contrôle du flux** pour la condition, l’itération et la gestion des échecs du nœud ; si le nœud en utilise une, la section est déjà ouverte. **Si**, **Pour chaque** et **Répéter jusqu’à** prennent des expressions. **Sinon de** ne propose que des nœuds qui ont une condition, et **Aucun** retire l’alternative. **Répétitions maximales** apparaît avec **Répéter jusqu’à** et prend un nombre entier de 1 à 20. **En cas d’erreur** choisit entre **Arrêter l’exécution** et **Continuer sans lui** ; continuer ignore chaque nœud qui lit la sortie du nœud en échec. Sous une condition, une liste ou une alternative, une phrase dit en mots ce que fait le réglage.

Utilise **Fermer** pour revenir au canevas. Sur un écran large, tu peux aussi fermer le panneau en cliquant sur le fond du canevas ou en appuyant sur Échap hors d’un champ de texte. Les réglages du déclencheur et des projets se trouvent dans l’onglet **Général**. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les types de nœuds et les expressions.

### Code, prompts et JSON

Le code, les prompts, les conditions et les champs JSON sont des éditeurs de code. Ils colorent la syntaxe et chaque template `{{ }}`, et connaissent l’automatisation. Tape `{{` dans un prompt et les accolades fermantes apparaissent, avec le curseur entre les deux ; tape `nodes.` pour ne voir que les nœuds qui s’exécutent avant, et `.output.` pour voir les champs de ce nœud avec leurs types. Ctrl+Espace ouvre les suggestions partout. Pointe sur une référence pour voir son type, ou appuie sur ⌘K ⌘I (Ctrl+K Ctrl+I) pour afficher et faire lire le type à la position du curseur.

<Frame caption="Après nodes. dans un template, les suggestions proposent les nœuds qui s’exécutent avant, chacun avec sa structure.">

![Le champ Prompt de Triage dans l’éditeur de code : sa dernière ligne est un template avec le curseur après nodes., et la liste de suggestions propose inbox à côté de la structure qu’il renvoie, un objet avec une liste de conversations.](/images/platform/automation-editor-code.webp)

</Frame>

Un instant après ta dernière frappe, un problème est souligné exactement là où il se trouve. F8 et Maj+F8 passent au problème suivant et précédent et le lisent ; ⌘. (Ctrl+.) applique une correction proposée, comme le nom de nœud le plus proche. Dans un champ de plusieurs lignes, Tab indente ; pour le quitter au clavier, appuie sur Échap, puis sur Tab. **Agrandir l'éditeur** ouvre un long champ dans un éditeur plus grand, et **Revenir au champ** t’y ramène avec ta modification et ton curseur au même endroit.

Un champ JSON comme **Entrée** ne modifie le nœud que si son texte est du JSON valide du bon type. Pendant la saisie, le nœud garde sa dernière valeur valide, et le champ indique ce qui manque, par exemple « Ce doit être un objet JSON, entre accolades. »

### Entrées de Début et sortie de Fin

Sélectionne **Début** pour voir ce qui démarre l’automatisation. **Déclencheur** le décrit en mots ; **Modifier dans Général** ouvre l’onglet **Général**, où tu règles le déclencheur. Sous **Champs**, **Entrées** montre les champs de l’entrée de l’exécution sous forme d’arbre, et **Schéma des données** contient le schéma JSON qui les définit, que tu peux modifier. **Structure** montre l’entrée telle que Tale la lit, et **Dernière exécution** l’entrée de l’exécution affichée.

<Frame caption="Les champs de Début : le déclencheur en mots, les champs de l’entrée d’exécution et le schéma JSON derrière eux.">

![Start sélectionné sur le canevas, avec son panneau à côté : le déclencheur Every 6 hours · UTC, désactivé, et By hand, the API or MCP, au-dessus de Change in General ; sous Fields, Inputs liste limit, firedAt et trigger avec leurs descriptions, et Input schema contient le schéma JSON dans un éditeur de code.](/images/platform/automation-editor-start.webp)

</Frame>

Sélectionne **Fin** pour voir ce que renvoie une exécution. **Comment une exécution se termine** liste les trois issues ; sous **En échec**, chaque nœud dont l’échec arrête l’exécution est un bouton qui l’ouvre. Sous **Champs**, **Sortie** contient la valeur JSON que renvoie une exécution réussie, avec des templates comme `{{ nodes.report.output }}`. **Structure** montre la structure de la sortie, et **Dernière exécution** la sortie de l’exécution affichée.

## Lire la source

Choisis **Source** dans le sélecteur de vue pour lire tout le document en YAML, coloré, avec numéros de ligne, repli et recherche (⌘F ou Ctrl+F). Chaque problème trouvé par la vérification est souligné sur la ligne qu’il concerne : un problème dans une partie sans champ propre, comme le nom, a ainsi un endroit où le lire. La source est en lecture seule : **Copier le YAML** la copie, et **Télécharger le YAML** l’enregistre dans un fichier nommé d’après l’automatisation et la version, par exemple `gmail-triage-inbox-v3.yml`, avec `-draft` en plus tant que tu as des modifications non enregistrées. Pour modifier le document, utilise les champs ou ton agent de code.

<Frame caption="Source : tout le document en YAML coloré, à copier ou à télécharger.">

![La vue Source de Triage the Gmail inbox : du YAML avec numéros de ligne et marques de repli, de name: gmail-triage-inbox jusqu’aux nœuds inbox et triage, sous la ligne To change the document, use the fields or your coding agent, avec Copy YAML, Download YAML et Edit with your coding agent au-dessus.](/images/platform/automation-editor-source.webp)

</Frame>

## Modifier avec ton agent de code

Les changements plus importants, comme ajouter des nœuds ou remanier le flux, passent par un agent de code comme Claude Code, Codex ou Cursor, connecté au serveur MCP de Tale. **Modifier avec ton agent de code** est le dernier bouton en haut à droite du canevas, dans chaque vue, et l’action principale d’une automatisation qui n’a pas encore de nœud. Son dialogue montre le nom de l’automatisation à donner à l’agent, **Configurer MCP**, qui ouvre **Paramètres > API > MCP**, et **Connecter un agent de code**, qui ouvre le guide du [point d’accès MCP](/fr/develop/mcp-endpoint). L’agent lit l’automatisation, la modifie, la vérifie et enregistre une nouvelle version, qui apparaît ensuite sur le canevas comme le décrit [Quand une nouvelle version arrive](#new-versions).

## Trouver et corriger les problèmes

Pendant que tu modifies, Tale vérifie le brouillon comme il vérifie chaque enregistrement. Un instant après ta dernière frappe, le bouton **Problèmes** à côté de **Tests** montre ce que la vérification a trouvé : une icône d’erreur rouge et une icône d’avertissement orange, chacune avec son nombre, ou **Aucun problème**. Sur un téléphone, le bouton se trouve dans la barre au-dessus du canevas. Une erreur fait échouer une exécution, par exemple une référence à un nœud qui n’existe pas. Un avertissement signale un risque, par exemple la lecture de la sortie d’un nœud parfois ignoré. Un nœud, une condition, Début ou Fin qui a des problèmes affiche les mêmes nombres sur son bloc, et un champ concerné explique le problème juste en dessous.

Clique sur **Problèmes** pour les lister. Sur un écran large, la liste s’ouvre sous le canevas ; sur un écran plus étroit, dans un panneau. Chaque entrée indique ce qui ne va pas, où, pourquoi et comment le corriger. **Détails techniques** affiche le message du moteur lui-même, et le code à côté du titre t’aide pour une recherche ou une demande d’assistance. **Tous**, **Erreurs** et **Avertissements** filtrent la liste ; Échap la ferme.

<Frame caption="Une référence à un nœud qui n’existe pas : le champ la signale, Enregistrer attend, et Problèmes dit pourquoi et comment la corriger.">

![L’éditeur avec une erreur : le Prompt de Triage se termine par un template qui lit nodes.nope.output, souligné en rouge, avec la raison sous le champ ; l’en-tête affiche 1 erreur et Tests à côté de Save désactivé, et Problems sous le canevas, à côté de l’onglet Tests, liste Reference to an unknown node à triage › Prompt, son code REF_UNKNOWN_NODE, pourquoi la lecture échoue et comment la corriger.](/images/platform/automation-editor-problems.webp)

</Frame>

Sélectionne une entrée, ou appuie sur Entrée dessus, pour t’y rendre : le nœud s’ouvre, son champ reçoit le focus et la partie en cause est sélectionnée. Un problème sans champ à lui, par exemple un modèle que ton organisation ne sert pas, figure sous **Problèmes de ce nœud** en haut des champs du nœud. Un problème dans les entrées ouvre **Début**, un problème dans la sortie ouvre **Fin**, un problème dans un test ouvre ce test sous **Tests**, l’endroit sélectionné dans son YAML, et un problème dans une autre partie du document, comme le nom, ouvre **Source** sur cette ligne. Un problème dans un nœud que ton brouillon n’a plus indique « Modifie-le avec ton agent de code. »

Tant qu’il reste des erreurs, **Enregistrer** est désactivé et en donne la raison, par exemple « Corrige 1 erreur pour enregistrer ». Sur un téléphone, où **Enregistrer** se trouve sous les champs d’un nœud, **Afficher les problèmes** à côté de cette raison ouvre la liste. Les avertissements ne bloquent jamais l’enregistrement ni la mise en service. Si Tale ne peut pas vérifier le brouillon, par exemple parce que la connexion a été coupée, le bouton affiche **Vérification impossible** et tu peux quand même enregistrer : chaque enregistrement est vérifié à nouveau sur le serveur. Quand un enregistrement ou une mise en service est refusé à cause d’erreurs, la liste s’ouvre avec les problèmes renvoyés par le serveur, en commençant par la première erreur.

La vérification ne s’exécute que pour les rôles Développeur, Admin et Propriétaire, ceux qui peuvent enregistrer. [Ce que Tale vérifie avant une exécution](/fr/platform/automations/concepts#checks) explique chaque type de problème.

## Enregistrer et tester une version

1. Modifie les champs nécessaires et clique sur **Enregistrer**.
2. Explique le changement dans la **Note de version**, puis choisis **Enregistrer une version**. Cela ajoute une version et conserve les précédentes. La boîte de dialogue nomme la version créée, par exemple **Enregistrée comme v6.**, et **Vérifier les modifications** liste ce que ton brouillon change, sous la même forme que [Comparer deux versions](#compare). Si quelqu’un a enregistré une autre version pendant ta modification, Tale refuse l’enregistrement et indique qui a enregistré quelle version et quand ; **Voir ce qui a changé dans la v6** ouvre ses modifications dans un nouvel onglet. **Abandonner mes modifications et recharger** affiche la version plus récente, **Enregistrer quand même** ajoute ta version par-dessus — la plus récente reste dans l’historique des versions, mais la dernière version est alors la tienne. Si l’automatisation a des tests, Tale les exécute à l’enregistrement : **Enregistrer une version** affiche **Enregistrement et exécution des tests…** jusqu’à ce qu’ils se terminent, et la version garde leur résultat, même si un test échoue.
3. Clique sur **Essai**. Si le workflow déclare un schéma d’entrée, saisis l’entrée en JSON dans **Données de l’exécution (JSON)** ; quand tu tapes une clé, le champ propose les noms de champs du schéma, et ⌘Entrée (Ctrl+Entrée) lance l’exécution. Déplie **Schéma des données** pour voir les champs obligatoires et leurs types. Un JSON invalide ou non conforme au schéma empêche le démarrage.
4. Lance le test, passe à l’onglet **Exécutions** et ouvre sa ligne. Compare les données résolues, la sortie et les opérations prévues au résultat attendu.

Pour un workflow qui exige `owner` et `repo`, les données pourraient être :

```json
{
  "owner": "your-organization",
  "repo": "your-repository"
}
```

Utilise le schéma réel du workflow. Un champ numérique attend un nombre JSON, pas une chaîne entre guillemets. Vérifie aussi le périmètre lorsqu’un sélecteur de projet est proposé.

**Essai** utilise la version enregistrée sélectionnée et des simulations déterministes. Aucun e-mail n’est envoyé et aucune fiche externe n’est modifiée. Un brouillon peut être testé avant sa mise en service. Une simulation réussie ne vérifie pas les identifiants réels ni les services externes.

Pour vérifier les mêmes cas à chaque enregistrement et avant chaque mise en service, écris-les sous forme de tests : [Tester une automatisation](/fr/platform/automations/testing) montre comment.

<Frame caption="Pour un workflow avec des données d’entrée, saisis le JSON et vérifie le schéma avant le test.">

![Le dialogue de test montre Start from au-dessus de Run input (JSON), les valeurs JSON owner et repo dans l’éditeur de code et le schéma des données déplié sous forme de liste de champs.](/images/platform/automation-run-input.webp)

</Frame>

### Essayer le brouillon {#try-the-draft}

Avec des modifications non enregistrées, **Essai** demande d’abord **Ce qui s’exécute**. **Ce brouillon (non enregistré)** exécute une fois tes modifications avec les mêmes simulations, sans les enregistrer : l’exécution n’est conservée nulle part et n’apparaît pas sous **Exécutions**. L’autre choix, par exemple **Version 3**, exécute la version enregistrée affichée, comme plus haut. L’entrée est vérifiée par rapport au schéma d’entrée de ce que tu choisis.

**À partir de**, au-dessus de **Données de l’exécution (JSON)**, remplit l’entrée à partir d’un test, de l’une des cinq exécutions les plus récentes, de l’entrée du déclencheur, de rien (**Vide**) ou d’un espace réservé pour chaque champ obligatoire (**Remplir les champs obligatoires**). La boîte de dialogue s’ouvre sur ton dernier choix pour l’automatisation. Quand le test dont tu pars simule des nœuds, **Utiliser les sorties et échecs simulés du test** apparaît, activé par défaut : l’essai remplace alors ces nœuds comme le fait le test, et ils portent **Sortie simulée** ou **Échec simulé** sur le canevas. L’exécution d’une version enregistrée ne les utilise pas.

<Frame caption="À partir de dans la boîte de dialogue d’essai d’un brouillon : les tests et les exécutions d’où peut venir l’entrée, rien, ou les champs obligatoires.">

![La boîte de dialogue d’essai d’Order discounts avec This draft (not saved) choisi sous What runs et le menu Start from ouvert : sous Tests, Small order pays full price, Big order gets 10% off et New test ; sous Runs, une exécution réussie ; sous Other, Empty et Fill the required fields.](/images/platform/automation-run-start-from.webp)

</Frame>

L’exécution du brouillon s’affiche ensuite sur le canevas à la place de la dernière exécution, sous une bande **Test non enregistré** qui indique comment elle s’est terminée et quand, par exemple **Réussi en 12 ms** ou **Échec à Score**, et elle se rejoue étape par étape comme une exécution enregistrée. Sélectionne un nœud pour voir ce qu’il a reçu et renvoyé dans son onglet **Test non enregistré**. Dès que tu modifies le brouillon, la bande indique **Le brouillon a changé depuis cet essai.** **Réessayer** exécute le brouillon tel qu’il est maintenant, avec la même entrée ; ⌘⇧Entrée (Ctrl+Maj+Entrée) fait de même tant que le canevas ou l’inspecteur a le focus. **Masquer le résultat** ramène la dernière exécution. Un essai s’arrête après 20 secondes.

<Frame caption="Un essai du brouillon des remises de commande : la bande indique comment il s’est terminé, et Review, que seule une commande d’au moins mille unités atteint, montre dans son onglet Test non enregistré ce qu’il a reçu.">

![L’éditeur d’Order discounts avec une bande Unsaved test au-dessus du canevas qui indique Succeeded in 13 ms, avec Try again et un bouton qui masque le résultat. Sur le canevas, Discount, Total et Review ont réussi, la condition de Review, quantity of the run input is at least 1,000, indique Yes, et la barre de lecture est à la fin de l’exécution. À côté du canevas, l’onglet Unsaved test de Review montre l’entrée résolue total 22800 et la sortie note Wholesale order of 22800: sales confirms the price.](/images/platform/automation-try-draft.webp)

</Frame>

### Tester un nœud, ou jusqu’à un nœud {#step-tests}

Pour essayer une étape sans le reste, sélectionne son nœud et ouvre **Tester le nœud** à côté de son nom :

- **Tester ce nœud** exécute le nœud seul, tel que le brouillon l’a, avec les données que tu lui donnes. Sous **Utilise les données de**, chaque nœud qu’il lit reçoit sa sortie en JSON : depuis l’exécution sur le canevas quand il y en a une, comme tu as testé le nœud la dernière fois, ou vide pour que tu l’écrives. **Données de l’exécution (JSON)** apparaît quand le nœud lit l’entrée de l’exécution, et **Élément** quand il s’exécute une fois par élément. Sur le canevas, les nœuds qu’il lit portent **Données fixées** et les autres **Exclu de ce test** ; l’onglet **Test du nœud** du nœud montre ce qu’il a reçu et renvoyé. Quand sa condition est fausse avec ces données, la bande indique que le test l’a exécuté quand même.
- **Tester jusqu’ici** exécute le brouillon jusqu’au nœud : tout ce dont il a besoin, et rien après. Il demande l’entrée comme **Essai**, et la bande indique **Jusqu’à Review**.

Les nœuds d’agent sont simulés dans les tests. Comme un essai, un test d’étape ne garde aucune exécution ; les données que tu donnes à un nœud sont gardées pour la session, si bien qu’un nouveau test part d’elles.

<Frame caption="Total testé seul : Discount fixé à une remise de 20 %, le reste du brouillon exclu, et ce que Total a reçu et renvoyé.">

![L’éditeur d’Order discounts avec une bande Node test: Total qui indique Succeeded in 3 ms. Sur le canevas, Discount porte Pinned data et a réussi, Total a réussi, et Review et End sont en pointillés et Left out of this test. À côté du canevas, l’onglet Node test de Total montre l’entrée résolue rate 0.2, quantity 1000 et unitPrice 2, et la sortie gross 2000, discount 400 et total 1600.](/images/platform/automation-step-test.webp)

</Frame>

### Partir d’une version plus ancienne {#older-version}

Quand **Version** affiche une version plus ancienne que la dernière, un bandeau au-dessus du canevas le signale, par exemple **Tu consultes la v2. La plus récente est la v5.** **Afficher la v5** passe à la dernière version, et **Comparer la v2 avec la v5** montre ce qui a changé depuis.

Tu peux quand même modifier la version plus ancienne. Le bandeau ajoute alors **L’enregistrement crée la v6 à partir de la v2.**, et l’enregistrement fait exactement cela, sans te demander de recharger. La boîte de dialogue d’enregistrement indique **Enregistrée comme v6, à partir de la v2.** et avertit, avec un lien vers la comparaison, que les modifications des v3 à v5 ne sont pas dans ton brouillon. Dans l’historique des versions, la nouvelle version porte **Basée sur la v2**. Pour garder ces modifications, passe à la dernière version avant de modifier.

<Frame caption="L’enregistrement d’une modification de la v2 alors que la v4 est la plus récente : la boîte de dialogue dit ce que l’enregistrement crée et quelles modifications le brouillon laisse de côté.">

![La boîte de dialogue Save a new version indique Saves as v5, based on v2, avertit que les modifications des v3 à v4 ne sont pas dans le brouillon avec un lien Compare v2 with v4, et sous Review changes montre Post modifié, son code comparé ligne par ligne.](/images/platform/automation-version-save-review.webp)

</Frame>

## Mettre en service et exécuter en réel

Choisis la version testée sous **Version** et clique sur le bouton voisin, qui nomme cette version, par exemple **Mettre v3 en service** ; pour une version plus ancienne que celle en service, il indique **Revenir à la v2**. Le badge **En service** indique la version déployée. La mise en service se passe comme dans **Versions** : un message la confirme et propose **Annuler**, et si une autre version a été mise en service entre-temps, rien ne change et le message indique qui l’a mise en service. Tu peux aussi mettre en service n’importe quelle version enregistrée depuis **Versions**, comme le décrit [Mettre en service ou revenir en arrière en un clic](#deploy-in-one-click).

Avant la mise en service d’une version, Tale exécute à nouveau ses tests. Si l’un d’eux échoue, la version n’est pas mise en service : **Cette version n’a pas été mise en service** indique combien de tests échouent, et **Tests** s’ouvre avec le focus sur le premier en échec. Corrige la cause et enregistre une nouvelle version ; si tu as des modifications non enregistrées, une boîte de dialogue t’indique plutôt que les tests échouent. Si la version ne passe plus les vérifications actuelles, Tale refuse la mise en service et **Problèmes** liste ce qu’il faut corriger ; si tu as des modifications non enregistrées, abandonne-les d’abord pour voir cette liste.

**Exécuter en réel** lance la version déployée, même si tu en consultes une autre. La confirmation montre le périmètre et, si nécessaire, les **Données de l’exécution (JSON)** pour cette version déployée. Vérifie les deux avant de confirmer. Les exécutions réelles peuvent agir sur les systèmes connectés et attendre une [approbation](/fr/platform/approvals/concepts).

Un déclencheur utilise aussi la version déployée. Configure-le lorsque tu es prêt pour des exécutions répétées ou démarrées par un système externe ; consulte [Déclencheurs d’automatisation](/fr/platform/automations/triggers).

## Versions et mises en service {#versions}

**Versions** montre ce qui s’exécute en service et comment l’automatisation en est arrivée là. La carte du haut nomme la version en service, depuis quand elle l’est, qui l’a mise en service et comment, par exemple **dans l’app** ou **avec Claude Code via MCP**, et combien de ses exécutions sont encore en cours. Ces exécutions se terminent sur la version avec laquelle elles ont démarré, quelle que soit la version mise en service ensuite. **Comparer la v1 avec la v2** montre ce que la version en service a changé par rapport à celle qu’elle a remplacée. Tant qu’aucune version n’est en service, la carte propose de mettre en service la plus récente.

Les versions restent jusqu’à la suppression de l’automatisation, sauf si un admin définit une [période de rétention](/fr/platform/admin/governance/policies-and-limits) pour les versions d’automatisation. Elle supprime les anciennes versions dont plus rien ne se sert ; la version en service, les versions des dernières mises en service, toute version utilisée par une exécution et les vingt plus récentes restent toujours.

<Frame caption="L’onglet Versions : la version en service en haut, puis chaque version enregistrée avec sa note, son auteur, ses modifications et ses tests.">

![L’onglet Versions de Weekly digest : une carte indique v3 is live, depuis quand et par qui, avec Compare v2 with v3 et Roll back to v2 ; en dessous, le tableau Versions liste v4 à v1 avec leurs notes, You in the app, la date, des modifications comme 1 changed et 1 renamed, et No result sous Tests.](/images/platform/automation-versions.webp)

</Frame>

La liste **Versions** sous la carte affiche chaque version enregistrée, de la plus récente à la plus ancienne :

- **Version** porte le badge **En service** sur la version déployée et indique pour les autres quand elles ont été mises en service pour la dernière fois.
- **Note** affiche la note de version. **Restaure la v3** signale une version restaurée, et **Basée sur la v1** une version enregistrée à partir d’une version plus ancienne que la précédente.
- **Enregistrée par** indique qui a enregistré la version et comment. Les versions installées par la plateforme affichent **Tale**.
- **Modifications** compte les nœuds ajoutés, supprimés et modifiés par rapport à la version précédente, et nomme les autres parties modifiées, par exemple **Sortie** ou **Tests**. La première version porte **Première version** ; les versions enregistrées avant ce résumé affichent **Non enregistré**.
- **Tests** indique combien de tests de la version ont réussi lors de sa dernière vérification, par exemple **2 tests sur 3 réussis**, et quand et comment ils ont été vérifiés : **vérifié à l’enregistrement**, **vérifié à la mise en service** ou **vérifié manuellement**. Une version vérifiée avant que Tale ne conserve ces nombres affiche **Réussi** ou **Échoué**. **Aucun résultat** signifie qu’aucun verdict n’a été conservé, par exemple parce que la version n’a pas de tests.

Sélectionne une ligne pour voir ce que cette version a changé, comme le décrit [Comparer deux versions](#compare). Son menu propose aussi **Comparer avec la version en service**, **Ouvrir dans l’éditeur** et **Télécharger le YAML**, qui enregistre la version dans un fichier nommé d’après l’automatisation et la version, par exemple `weekly-digest-v3.yml`.

Choisis **Mises en service** au-dessus de la liste pour voir chaque mise en service : quand, quelle version, s’il s’agissait d’un retour en arrière, quelle version elle a remplacée et qui l’a faite. Une version déjà en service avant que Tale ne tienne cet historique apparaît comme **La v4 était en service**, avec la mention **Enregistré avant le début de l’historique.** Sélectionne une ligne pour voir ce que cette mise en service a changé par rapport à la version remplacée.

La liste des automatisations mène aussi ici : sélectionne le nombre de versions d’une ligne, ou **Historique des versions** dans son menu.

### Mettre en service ou revenir en arrière en un clic {#deploy-in-one-click}

Il faut les droits Développeur, Admin ou Propriétaire. Sur la carte du haut, **Revenir à la v1** remet en service la version que la version actuelle a remplacée ; après un retour, le même emplacement propose de nouveau la version plus récente, par exemple **Mettre v3 en service**. Dans l’une ou l’autre liste, ouvre le menu d’une ligne et choisis **Mettre v5 en service** ou **Revenir à la v3**.

La version est en service immédiatement : les déclencheurs et les nouvelles exécutions réelles l’utilisent, et les exécutions déjà lancées gardent la leur. Un message le confirme, par exemple **La v3 est en service.**, avec **Annuler**, qui remet la version remplacée en service de la même façon. Si le déclencheur de l’automatisation est désactivé, la page le signale et propose **Activer le déclencheur**.

Tale compare la version en service affichée sur ton écran à celle qui est en service au moment du clic. Si quelqu’un d’autre a mis une version en service entre-temps, rien ne change : le message indique qui a mis quelle version en service et quand, et **Afficher les mises en service** ouvre la liste pour que tu puisses choisir à nouveau. Une version qui ne passe plus les vérifications actuelles, ou dont les tests ont échoué, ne peut pas être mise en service. Une boîte de dialogue liste ce qu’il faut corriger, et **Ouvrir la v4 dans l’éditeur** t’y emmène.

### Restaurer une ancienne version {#restore}

Pour faire d’une ancienne version la plus récente, choisis **Restaurer comme nouvelle version** dans le menu de sa ligne. Tale en enregistre une copie par-dessus la dernière version, et les versions intermédiaires restent dans l’historique. La **Note de version** commence par **Restauration de la v3** ; tu peux la modifier. La version en service ne change pas, sauf si tu coches aussi **Mettre la v5 en service tout de suite**.

Après **Restaurer**, un message confirme la nouvelle version, et **Ouvrir la v5** l’affiche dans l’éditeur. Si la dernière version correspond déjà à celle que tu restaures, rien n’est enregistré. Si quelqu’un enregistre une version pendant que la boîte de dialogue est ouverte, celle-ci indique qui et propose de restaurer par-dessus cette version.

### Comparer deux versions {#compare}

La page d’une version montre ce qu’elle a changé. Son en-tête nomme la version, sa note, qui l’a enregistrée et comment, et propose **Ouvrir dans l’éditeur**, le bouton qui la met en service ou y revient, et dans son menu **Restaurer comme nouvelle version** et **Télécharger le YAML**. **Comparer avec** choisit la version avec laquelle comparer ; la version précédente, la version en service et la version de base viennent en premier. Les pastilles à côté comptent les nœuds ajoutés, supprimés, modifiés et renommés, et nomment les autres parties modifiées, par exemple **Entrées** ou **Tests**.

Choisis comment lire les modifications :

- **Graphique** dessine les deux versions sur un même graphique. Un bloc ajouté a un cadre vert et **Ajouté**, un bloc supprimé est rouge et barré, un bloc modifié est orangé avec ce qui a changé à son pied, et un bloc renommé indique son ancien nom, par exemple **Avant : Post**. Un trait que seule une version trace porte un plus ou un moins. Le sélecteur au-dessus du graphique montre le graphique propre à chaque version, avec les modifications mises en avant. Sélectionne un bloc pour voir ses modifications à côté du graphique : Début montre les entrées modifiées, Fin la sortie.
- **Modifications** liste chaque modification selon son emplacement : **Début : entrées de l’exécution**, **Nœuds**, **Fin : sortie**, **Tests** et **Données du paquet**. Ouvre une ligne pour voir ses champs avant et après ; le code, les prompts et les conditions sont comparés ligne par ligne. **Afficher sur le graphique** sélectionne le bloc auquel une modification appartient.
- **YAML** compare la source des deux versions ligne par ligne, l’une sous l’autre ou côte à côte.

<Frame caption="La v4 comparée à la v3 en graphique : Post renommé Publish et le code de Summarize modifié, avec les modifications de l’étape renommée à côté du graphique.">

![La comparaison de la v4 avec la v3 de Weekly digest : les puces indiquent 1 changed et 1 renamed ; le graphique marque Summarize comme Changed avec Code changed et Publish comme Renamed avec Was Post, et le panneau Changes of the node liste Publish comme Renamed, Was Post.](/images/platform/automation-version-compare.webp)

</Frame>

Sur un téléphone, la page s’ouvre sur **Modifications**. Deux versions au contenu identique indiquent **Aucune différence entre la v3 et la v5**, et la page précise quand seules leurs notes diffèrent. La première version n’est comparée à rien : tout y est nouveau. Les déclencheurs et les projets appartiennent à l’automatisation, pas à une version ; une comparaison ne les montre donc jamais.

## Examiner un résultat

Dès que l’automatisation s’est exécutée, le canevas montre sa dernière exécution : la ligne du bas de chaque nœud indique comment il s’est terminé, par exemple **Réussi** ou **Ignoré**, et chaque condition montre comment elle a décidé, **Oui** ou **Non**. Le bouton en forme d’œil, en haut à droite du canevas, **Masquer la dernière exécution**, retire l’exécution du canevas, et **Afficher la dernière exécution** la fait revenir. Sélectionne un nœud et ouvre **Dernière exécution** pour voir son **Entrée résolue**, sa **Sortie** et ses effets. Cela suffit souvent à trouver une référence incorrecte : compare l’entrée du nœud en échec à la sortie du nœud qu’il lit.

Passe à **Exécutions** et ouvre une ligne pour le détail complet. Les onglets restent visibles, avec **Exécutions** actif. **Éditeur** te ramène au workflow. Vérifie s’il s’agissait d’un test ou d’une exécution réelle et examine les opérations déjà réalisées avant de relancer. [Journaux d’exécution](/fr/platform/automations/execution-logs) explique les attentes, échecs, relances automatiques et arrêts.

## Revenir à une version ou supprimer

Pour revenir à une ancienne version, ouvre **Versions** et utilise la carte du haut ou le menu de la ligne d’une version, comme le décrit [Mettre en service ou revenir en arrière en un clic](#deploy-in-one-click). Tu peux aussi sélectionner une version antérieure sous **Version**, à droite des onglets. Sa ligne ouvre **Éditeur** sur cette version ; clique ensuite sur son bouton, par exemple **Revenir à la v2**. Les prochains démarrages l’utiliseront ; l’historique reste intact. Un message comme « Rétablir l’association précédente des destinataires » rend le choix plus facile à relire.

Pour supprimer l’automatisation, retourne à la liste, ouvre le menu de sa ligne et choisis **Supprimer**. Lis la confirmation qui la nomme. Les versions, le déploiement, le déclencheur et les liens aux projets sont retirés. Une exécution inachevée bloque la suppression : arrête-la ou attends sa fin. Les anciennes exécutions restent soumises à la conservation. Supprimer l’automatisation n’annule pas les actions déjà réalisées.
