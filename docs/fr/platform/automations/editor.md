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

Le sélecteur **Version** reste à droite des onglets Éditeur, Général et Exécutions, sur ordinateur comme sur téléphone. Il affiche les messages de version, les dates, les résultats des tests et la version en service. Sélectionne une ligne pour ouvrir cette version. Sur ordinateur, les commandes d’exécution se trouvent à côté des onglets, avec **Enregistrer** et **Abandonner** ; dans **Général**, seuls **Enregistrer** et **Abandonner** y figurent. Un point sur un onglet signale ses modifications non enregistrées. Avant de quitter cet onglet ou de changer de version, Tale te demande quoi en faire.

Sur téléphone, la navigation est compacte à l’ouverture d’une automatisation. Le canevas de l’éditeur occupe la hauteur disponible, et les commandes d’exécution et de mise en service se trouvent dans une barre au bas du canevas. Sélectionne un nœud pour ouvrir ses champs — avec Enregistrer et Abandonner — dans un panneau au bas de l’écran.

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

Chaque nœud est un bloc. Sa première ligne montre son icône et son titre, tiré de son ID : `open_issues` devient **Open issues**. La ligne suivante indique de quel type de nœud il s’agit : le connecteur et l’action, comme **GitHub · Lister les issues**, **Transformation**, **Modèle de langage** ou **Agent** avec son modèle, ou l’automatisation qu’il appelle. Quand Tale sait ce que le nœud renvoie, une ligne en montre la structure, par exemple `{ issues: object[] }`. La ligne du bas indique ce que le nœud lit, par exemple **Lit Issues et l’entrée (owner, repo)**, ou **Ne lit aucun autre nœud**.

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

Quelqu’un peut enregistrer une nouvelle version pendant que tu consultes l’automatisation, par exemple un agent de code via MCP. Si tu consultes la dernière version sans modifications non enregistrées, le canevas passe à la nouvelle : les blocs glissent vers leur nouvelle place, les nouveaux apparaissent en fondu, ceux qui ont changé s’entourent une fois d’un anneau, et un lecteur d’écran annonce « Affichage de la v6. ». Le nœud ouvert le reste s’il existe encore. Si tu as des modifications non enregistrées, rien ne bouge. Un avis au-dessus du canevas indique **Une version plus récente a été enregistrée**, et **Afficher la v6 et abandonner mon brouillon** y passe.

## Suivre les chemins possibles {#paths}

Les conditions d’une exécution décident des nœuds qui s’exécutent. Le bouton des chemins, en haut à droite du canevas, compte les chemins qu’une exécution réussie peut prendre, par exemple **3 chemins**, et ouvre **Chemins possibles**. Chaque chemin nomme les conditions qui le décident, comme « Triage s’exécute » ou « Propose échoue, l’exécution continue », et le nombre de nœuds qui s’y exécutent.

Pointe sur un chemin, ou atteins-le avec les flèches, pour le prévisualiser sur le canevas. Clique dessus ou appuie sur Entrée pour le garder affiché : les nœuds hors du chemin deviennent tiretés et disent pourquoi ils ne s’exécutent pas, Fin marque les sorties qui restent vides sur ce chemin, et un lecteur d’écran annonce le chemin affiché. **Tout afficher**, ou Échap, affiche de nouveau chaque nœud. La liste reste ouverte pendant que tu sélectionnes des nœuds, pour comparer un chemin avec les champs d’un nœud.

Sous **Arrête l’exécution en cas d’échec**, la liste nomme les nœuds dont l’échec arrête l’exécution, avec ce qui peut faire échouer chacun d’eux. Pointe sur l’un d’eux pour les entourer tous de rouge ; sélectionne-en un pour l’ouvrir.

Sur téléphone, la liste s’ouvre dans un panneau au bas de l’écran. Choisir un chemin ferme le panneau et laisse en haut du canevas une pastille qui nomme le chemin, avec **Tout afficher**. Quand chaque exécution suit le même chemin, la liste le dit. Au-delà de 12 conditions et échecs tolérés, les chemins sont trop nombreux pour être listés ; **Quand il s’exécute** indique toujours, pour chaque nœud, quand il s’exécute. Un canevas qui contient un cycle n’a pas de bouton des chemins. [Les chemins qu’une exécution peut prendre](/fr/platform/automations/concepts#paths) explique comment Tale les détermine.

## Modifier un nœud

Sélectionne un bloc pour l’ouvrir. Sur un écran large, l’inspecteur s’ouvre à côté du canevas ; sans nœud sélectionné, le canevas occupe toute la largeur. Sur un écran plus étroit, il s’ouvre dans un panneau au-dessus du canevas. Son en-tête montre le titre du nœud, son type et son ID avec **Copier l’ID du nœud** ; les problèmes propres au nœud sont listés dessous. **Quand il s’exécute** résume la place du nœud dans le flux : à chaque exécution, sur certains chemins ou jamais, pourquoi il peut être ignoré et ce qui se passe s’il échoue, par exemple « S’il échoue, l’exécution s’arrête avec son erreur. »

Trois onglets suivent :

- **Champs** contient ce que tu peux modifier. Un `transform` possède du **Code** ; un `llm`, **Prompt**, **Prompt système**, **Modèle** et **Schéma de sortie** ; un `agent` y ajoute l’environnement d’agent et l’équipement. **Entrée** contient les valeurs JSON et références transmises au nœud.
- **Structure** montre ce que le nœud reçoit et renvoie, d’où Tale tient cette structure et quels nœuds lisent sa sortie. Sélectionne un lecteur pour l’ouvrir. **Afficher en TypeScript** montre la même structure sous forme de type.
- **Dernière exécution** montre l’**Entrée résolue**, la **Sortie** et les effets du nœud dans l’exécution affichée sur le canevas. L’onglet apparaît tant que le canevas montre une exécution.

Le sélecteur **Modèle** d’un nœud `llm` ou `agent` liste les modèles servis par les fournisseurs connectés de ton organisation ; un modèle absent de la liste peut être saisi, mais **Problèmes** avertit alors qu’une exécution réelle échouerait à ce nœud tant que son fournisseur n’est pas connecté.

Ouvre **Contrôle du flux** pour la condition, l’itération et la gestion des échecs du nœud ; si le nœud en utilise une, la section est déjà ouverte. **Si**, **Pour chaque** et **Répéter jusqu’à** prennent des expressions. **Sinon de** ne propose que des nœuds qui ont une condition, et **Aucun** retire l’alternative. **Répétitions maximales** apparaît avec **Répéter jusqu’à** et prend un nombre entier de 1 à 20. **En cas d’erreur** choisit entre **Arrêter l’exécution** et **Continuer sans lui** ; continuer ignore chaque nœud qui lit la sortie du nœud en échec. Sous une condition, une liste ou une alternative, une phrase dit en mots ce que fait le réglage.

Utilise **Fermer** pour revenir au canevas. Sur un écran large, tu peux aussi fermer le panneau en cliquant sur le fond du canevas ou en appuyant sur Échap hors d’un champ de texte. Les réglages du déclencheur et des projets se trouvent dans l’onglet **Général**. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les types de nœuds et les expressions.

### Code, prompts et JSON

Le code, les prompts, les conditions et les champs JSON sont des éditeurs de code. Ils colorent la syntaxe et chaque template `{{ }}`, et connaissent l’automatisation. Tape `{{` dans un prompt et les accolades fermantes apparaissent, avec le curseur entre les deux ; tape `nodes.` pour ne voir que les nœuds qui s’exécutent avant, et `.output.` pour voir les champs de ce nœud avec leurs types. Ctrl+Espace ouvre les suggestions partout. Pointe sur une référence pour voir son type, ou appuie sur ⌘K ⌘I (Ctrl+K Ctrl+I) pour afficher et faire lire le type à la position du curseur.

Un instant après ta dernière frappe, un problème est souligné exactement là où il se trouve. F8 et Maj+F8 passent au problème suivant et précédent et le lisent ; ⌘. (Ctrl+.) applique une correction proposée, comme le nom de nœud le plus proche. Dans un champ de plusieurs lignes, Tab indente ; pour le quitter au clavier, appuie sur Échap, puis sur Tab. **Agrandir l'éditeur** ouvre un long champ dans un éditeur plus grand, et **Revenir au champ** t’y ramène avec ta modification et ton curseur au même endroit.

Un champ JSON comme **Entrée** ne modifie le nœud que si son texte est du JSON valide du bon type. Pendant la saisie, le nœud garde sa dernière valeur valide, et le champ indique ce qui manque, par exemple « Ce doit être un objet JSON, entre accolades. »

### Entrées de Début et sortie de Fin

Sélectionne **Début** pour voir ce qui démarre l’automatisation. **Déclencheur** le décrit en mots ; **Modifier dans Général** ouvre l’onglet **Général**, où tu règles le déclencheur. Sous **Champs**, **Entrées** montre les champs de l’entrée de l’exécution sous forme d’arbre, et **Schéma des données** contient le schéma JSON qui les définit, que tu peux modifier. **Structure** montre l’entrée telle que Tale la lit, et **Dernière exécution** l’entrée de l’exécution affichée.

Sélectionne **Fin** pour voir ce que renvoie une exécution. **Comment une exécution se termine** liste les trois issues ; sous **En échec**, chaque nœud dont l’échec arrête l’exécution est un bouton qui l’ouvre. Sous **Champs**, **Sortie** contient la valeur JSON que renvoie une exécution réussie, avec des templates comme `{{ nodes.report.output }}`. **Structure** montre la structure de la sortie, et **Dernière exécution** la sortie de l’exécution affichée.

## Lire la source

Choisis **Source** dans le sélecteur de vue pour lire tout le document en YAML, coloré, avec numéros de ligne, repli et recherche (⌘F ou Ctrl+F). Chaque problème trouvé par la vérification est souligné sur la ligne qu’il concerne : un problème dans une partie sans champ propre, comme un test ou le nom, a ainsi un endroit où le lire. La source est en lecture seule : **Copier le YAML** la copie, et **Télécharger le YAML** l’enregistre dans un fichier nommé d’après l’automatisation et la version, par exemple `gmail-triage-inbox-v3.yml`, avec `-draft` en plus tant que tu as des modifications non enregistrées. Pour modifier le document, utilise les champs ou ton agent de code.

## Modifier avec ton agent de code

Les changements plus importants, comme ajouter des nœuds ou remanier le flux, passent par un agent de code comme Claude Code, Codex ou Cursor, connecté au serveur MCP de Tale. **Modifier avec ton agent de code** est le dernier bouton en haut à droite du canevas, dans chaque vue, et l’action principale d’une automatisation qui n’a pas encore de nœud. Son dialogue montre le nom de l’automatisation à donner à l’agent, **Configurer MCP**, qui ouvre **Paramètres > API > MCP**, et **Connecter un agent de code**, qui ouvre le guide du [point d’accès MCP](/fr/develop/mcp-endpoint). L’agent lit l’automatisation, la modifie, la vérifie et enregistre une nouvelle version, qui apparaît ensuite sur le canevas comme le décrit [Quand une nouvelle version arrive](#new-versions).

## Trouver et corriger les problèmes

Pendant que tu modifies, Tale vérifie le brouillon comme il vérifie chaque enregistrement. Un instant après ta dernière frappe, le bouton **Problèmes** à côté d’**Enregistrer** montre ce que la vérification a trouvé : une icône d’erreur rouge et une icône d’avertissement orange, chacune avec son nombre, ou **Aucun problème**. Sur un téléphone, le bouton se trouve dans la barre au-dessus du canevas. Une erreur fait échouer une exécution, par exemple une référence à un nœud qui n’existe pas. Un avertissement signale un risque, par exemple la lecture de la sortie d’un nœud parfois ignoré. Un nœud, une condition, Début ou Fin qui a des problèmes affiche les mêmes nombres sur son bloc, et un champ concerné explique le problème juste en dessous.

Clique sur **Problèmes** pour les lister. Sur un écran large, la liste s’ouvre sous le canevas ; sur un écran plus étroit, dans un panneau. Chaque entrée indique ce qui ne va pas, où, pourquoi et comment le corriger. **Détails techniques** affiche le message du moteur lui-même, et le code à côté du titre t’aide pour une recherche ou une demande d’assistance. **Tous**, **Erreurs** et **Avertissements** filtrent la liste ; Échap la ferme.

Sélectionne une entrée, ou appuie sur Entrée dessus, pour t’y rendre : le nœud s’ouvre, son champ reçoit le focus et la partie en cause est sélectionnée. Un problème sans champ à lui, par exemple un modèle que ton organisation ne sert pas, figure sous **Problèmes de ce nœud** en haut des champs du nœud. Un problème dans les entrées ouvre **Début**, un problème dans la sortie ouvre **Fin**, et un problème dans une autre partie du document, comme un test ou le nom, ouvre **Source** sur cette ligne. Un problème dans un nœud que ton brouillon n’a plus indique « Modifie-le avec ton agent de code. »

Tant qu’il reste des erreurs, **Enregistrer** est désactivé et en donne la raison, par exemple « Corrige 1 erreur pour enregistrer ». Sur un téléphone, où **Enregistrer** se trouve sous les champs d’un nœud, **Afficher les problèmes** à côté de cette raison ouvre la liste. Les avertissements ne bloquent jamais l’enregistrement ni la mise en service. Si Tale ne peut pas vérifier le brouillon, par exemple parce que la connexion a été coupée, le bouton affiche **Vérification impossible** et tu peux quand même enregistrer : chaque enregistrement est vérifié à nouveau sur le serveur. Quand un enregistrement ou une mise en service est refusé à cause d’erreurs, la liste s’ouvre avec les problèmes renvoyés par le serveur, en commençant par la première erreur.

La vérification ne s’exécute que pour les rôles Développeur, Admin et Propriétaire, ceux qui peuvent enregistrer. [Ce que Tale vérifie avant une exécution](/fr/platform/automations/concepts#checks) explique chaque type de problème.

## Enregistrer et tester une version

1. Modifie les champs nécessaires et clique sur **Enregistrer**.
2. Explique le changement dans la **Note de version**, puis choisis **Enregistrer une version**. Cela ajoute une version et conserve les précédentes. Si quelqu’un a enregistré une autre version pendant ta modification, Tale refuse l’enregistrement et te demande : **Abandonner mes modifications et recharger** affiche la version plus récente, **Enregistrer quand même** ajoute ta version par-dessus — la plus récente reste dans l’historique des versions, mais la dernière version est alors la tienne.
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

<Frame caption="Pour un workflow avec des données d’entrée, saisis le JSON et vérifie le schéma avant le test.">

![Le dialogue de test montre les valeurs JSON owner et repo dans l’éditeur de code et le schéma des données déplié sous forme de liste de champs.](/images/platform/automation-run-input.webp)

</Frame>

## Mettre en service et exécuter en réel

Choisis la version testée sous **Version** et clique sur le bouton voisin, qui nomme cette version, par exemple **Mettre v3 en service**. Le badge **En service** indique la version déployée. Une version dont les tests enregistrés ont échoué ne peut pas être déployée ; corrige la cause et enregistre une nouvelle version.

**Exécuter en réel** lance la version déployée, même si tu en consultes une autre. La confirmation montre le périmètre et, si nécessaire, les **Données de l’exécution (JSON)** pour cette version déployée. Vérifie les deux avant de confirmer. Les exécutions réelles peuvent agir sur les systèmes connectés et attendre une [approbation](/fr/platform/approvals/concepts).

Un déclencheur utilise aussi la version déployée. Configure-le lorsque tu es prêt pour des exécutions répétées ou démarrées par un système externe ; consulte [Déclencheurs d’automatisation](/fr/platform/automations/triggers).

## Examiner un résultat

Dès que l’automatisation s’est exécutée, le canevas montre sa dernière exécution : la ligne du bas de chaque nœud indique comment il s’est terminé, par exemple **Réussi** ou **Ignoré**, et chaque condition montre comment elle a décidé, **Oui** ou **Non**. Le bouton en forme d’œil, en haut à droite du canevas, **Masquer la dernière exécution**, retire l’exécution du canevas, et **Afficher la dernière exécution** la fait revenir. Sélectionne un nœud et ouvre **Dernière exécution** pour voir son **Entrée résolue**, sa **Sortie** et ses effets. Cela suffit souvent à trouver une référence incorrecte : compare l’entrée du nœud en échec à la sortie du nœud qu’il lit.

Passe à **Exécutions** et ouvre une ligne pour le détail complet. Les onglets restent visibles, avec **Exécutions** actif. **Éditeur** te ramène au workflow. Vérifie s’il s’agissait d’un test ou d’une exécution réelle et examine les opérations déjà réalisées avant de relancer. [Journaux d’exécution](/fr/platform/automations/execution-logs) explique les attentes, échecs, relances automatiques et arrêts.

## Revenir à une version ou supprimer

Pour revenir à une ancienne version, ouvre **Version** à droite des onglets, lis les messages et sélectionne la version souhaitée. Sa ligne ouvre **Éditeur** sur cette version ; clique ensuite sur le bouton qui la met en service, par exemple **Mettre v2 en service**. Les prochains démarrages l’utiliseront ; l’historique reste intact. Un message comme « Rétablir l’association précédente des destinataires » rend le choix plus facile à relire.

Pour supprimer l’automatisation, retourne à la liste, ouvre le menu de sa ligne et choisis **Supprimer**. Lis la confirmation qui la nomme. Les versions, le déploiement, le déclencheur et les liens aux projets sont retirés. Une exécution inachevée bloque la suppression : arrête-la ou attends sa fin. Les anciennes exécutions restent soumises à la conservation. Supprimer l’automatisation n’annule pas les actions déjà réalisées.
