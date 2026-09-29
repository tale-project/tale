---
title: Gérer les tâches d’un projet
description: Crée une tâche, désigne son responsable, suis sa progression et examine le résultat au même endroit.
---

Une tâche regroupe le but d’un travail, son responsable, son statut, ses fichiers et les échanges autour du résultat. Utilise le tableau du projet pour le travail confié à une personne comme pour celui délégué à un agent. Toute personne qui peut ouvrir le projet peut y créer des tâches ; [qui peut modifier une tâche](#qui-peut-creer-et-modifier-les-taches) dépend de ton rôle et du fait que la tâche soit la tienne ou non. Le projet doit être actif : un projet archivé reste en lecture seule jusqu’à ce qu’un administrateur le restaure.

<Frame caption="Le tableau classe les tâches par statut. Passe à Liste pour retrouver les mêmes tâches sous forme de lignes.">

![Le tableau du projet Website relaunch affiche des cartes dans Backlog, À faire, En cours, En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## Créer une tâche avec un résultat précis

1. Ouvre **Tâches** dans le projet, puis clique sur **Créer une tâche**.
2. Donne au **Titre** le nom du résultat attendu, par exemple « Vérifier le brief de lancement ».
3. Explique dans **Description** ce qui est demandé et comment le résultat sera vérifié. Ajoute les fichiers nécessaires en pièces jointes.
4. Choisis au besoin **Statut**, **Priorité** et **Assigné à**. Une nouvelle tâche commence à **À faire**. Utilise **Backlog** pour une proposition qui n’a pas encore été retenue.
5. Clique sur **Créer une tâche**, puis ouvre la carte pour compléter ses détails.

Un titre compte jusqu’à 200 caractères et une description jusqu’à 20 000 ; la plupart des emojis comptent double. Une description plus longue, collée ou laissée sur une tâche par un import antérieur, n’est pas coupée : le champ indique la limite et compte la longueur, et **Créer une tâche** ou **Enregistrer** reste indisponible tant que tu ne l’as pas raccourcie.

Tale attribue un identifiant à partir de la clé du projet, par exemple `WEB-1`. Utilise-le pour désigner le travail sans confondre des tâches aux titres proches.

Une automatisation conçue pour les tâches peut aussi proposer un modèle dans **Créer une tâche** : son nom apparaît alors à côté de **Tâche vierge**, au-dessus du formulaire. Choisis-la, saisis le nom qu’elle demande, par exemple un trimestre, puis clique sur **Créer une tâche** ; l’automatisation devient responsable de la tâche. Si une tâche existe déjà pour ce nom, Tale l’ouvre au lieu d’en créer une deuxième et indique **Une tâche existe déjà pour ce sujet.** Un Membre peut alors la lire et la commenter, mais ne la modifie que si elle est la sienne. Les modèles qui créent des dossiers ou des fichiers de paramètres dans le projet ne sont proposés qu’aux Éditeurs et aux rôles supérieurs.

<Tip>

Une description utile précise les éléments de départ, le résultat attendu et un critère de fin. Par exemple : « Compare la date de revue du brief joint avec les notes de réunion. Signale toute différence dans un commentaire en citant les deux fichiers. »

</Tip>

<Frame caption="Les détails réunissent description, pièces jointes, sous-tâches et commentaires à côté du responsable et du statut.">

![La tâche Sign off the launch checklist affiche sa description, ses pièces jointes, sous-tâches, commentaires, statut, responsable, relecteur, dates, répétition, étiquettes et dépendances.](/images/platform/project-task-detail.webp)

</Frame>

## Qui peut créer et modifier les tâches

Toute personne qui peut ouvrir un projet peut y créer des tâches. Les Éditeurs et les rôles supérieurs peuvent modifier toutes les tâches du projet. Un Membre modifie les tâches qu’il a créées et celles qui lui sont attribuées, avec les mêmes possibilités qu’un Éditeur :

- Modifier le titre, la description, les pièces jointes, les sous-tâches, les dates, la priorité, les étiquettes, le relecteur et la répétition.
- Attribuer la tâche à lui-même, à un autre membre du projet, à l’un de ses agents ou à une automatisation conçue pour les tâches.
- Démarrer, guider ou arrêter l’agent, y compris en le mentionnant avec @ dans un commentaire.
- Changer le statut, et accepter un résultat en passant la tâche à **Terminé**.
- Archiver la tâche ou la restaurer.

Il en va de même pour les sous-tâches placées sous une telle tâche, quelle que soit la personne qui les a ajoutées, par exemple un agent qui a découpé le travail : elles n’empêchent donc jamais le Membre de clôturer sa tâche.

Sur les tâches des autres, un Membre lit et commente ; s’il y mentionne un agent, la mention reste ordinaire et ne lance rien. Chacun peut modifier et supprimer ses propres commentaires sur toute tâche qu’il peut lire, et les propriétaires et les admins peuvent aussi supprimer ceux des autres.

Si tu confies à quelqu’un d’autre, une personne ou un agent, une tâche qui t’était attribuée, tu lui cèdes aussi le droit de la modifier, sauf si tu l’as créée. Une exécution que tu as démarrée reste toutefois entre tes mains : si ta mention avec @ confie la tâche à un agent, tu peux guider cette exécution par d’autres mentions et l’arrêter avec **Annuler l'exécution** jusqu’à ce qu’elle se termine.

Une dépendance appartient à la tâche qu’elle bloque : un Membre n’enregistre donc de dépendances que pour ses propres tâches, sous **Bloqué par** sur l’une de ses tâches, ou sous **Bloque** sur toute tâche qu’il peut ouvrir, en choisissant l’une de ses tâches comme tâche bloquée. Les paramètres, les agents, les fichiers et le catalogue d’étiquettes du projet restent réservés aux Éditeurs et aux rôles supérieurs ; un Membre choisit parmi les étiquettes que le projet possède déjà. Seuls les propriétaires et les admins peuvent supprimer une tâche ; les autres personnes qui peuvent la modifier l’archivent à la place.

Les automatisations suivent une règle plus stricte, car une automatisation agit en son propre nom, avec les identifiants de connecteurs de l’organisation, et non au nom de la personne qui la démarre. Un Membre ne peut confier une tâche qu’à une automatisation conçue pour les tâches, c’est-à-dire l’une de celles listées sous **Automatisations** dans **Assigné à**, ou à l’automatisation à laquelle la tâche appartient déjà. Ce sont aussi les seules qu’il peut démarrer ou auxquelles il peut demander des modifications. Toutes les autres restent réservées aux Éditeurs et aux rôles supérieurs.

### Exécutions démarrées par un Membre

Une exécution démarrée par une personne qui ne peut pas modifier le projet, par exemple un Membre, s’en tient à sa tâche :

- Ses outils de plateforme ne modifient que cette tâche et ses sous-tâches : l’agent ne crée de nouvelles tâches que comme sous-tâches de celle-ci, n’utilise que des étiquettes que le projet possède déjà et ne peut pas synchroniser dans le projet des éléments venant d’autres systèmes.
- Elle ne peut pas enregistrer de documents dans le projet. Les fichiers produits arrivent quand même sur la tâche, sous **Fichiers produits**.
- L’exécution ne reçoit ni les **Secrets** de l’agent ni le jeton d’un accès GitHub équipé. L’agent apprend quels identifiants ont été retenus et doit le signaler dans son compte rendu si le travail en a besoin ; un Éditeur ou un rôle supérieur doit alors le démarrer. Les connecteurs équipés sur l’agent continuent de fonctionner, au nom de la personne qui a démarré l’exécution.
- Elle travaille dans son propre espace de travail, conservé pour les exécutions de cette personne avec cet agent : les fichiers des exécutions que des Éditeurs ont démarrées n’y sont pas, et ce que cette exécution laisse ne parvient jamais à celles-ci. Les exécutions suivantes de la même personne avec cet agent le retrouvent.

L’exécution peut toujours lire les tâches et les connaissances du projet, et elle garde ces limites même si un Éditeur la guide ensuite. Une exécution qu’un Éditeur ou un rôle supérieur démarre dispose, sur toute tâche, de l’équipement complet de l’agent. Le commentaire d’un Membre peut changer cela : si l’environnement de l’agent redémarre pour prendre en compte le commentaire, comme le font [tous les environnements sauf Claude Code](/fr/platform/agents/harnesses), la suite de l’exécution compte comme celle du Membre, avec les mêmes limites pour ses outils et ses identifiants.

## Désigner un responsable et un relecteur

**Assigné à** indique qui fait le travail : une personne, un agent du projet ou une automatisation disponible dans ce projet. **Relecteur** désigne la personne à prévenir lorsque le résultat d’un agent attend une revue. Seuls les membres qui peuvent modifier le projet peuvent être relecteurs.

Assigner un agent et lancer son exécution sont deux choix distincts. Après l’assignation, clique sur **Démarrer l'agent** ou passe la tâche à **En cours**. Lis [Automatiser les tâches](/fr/platform/projects/task-automation) avant de lancer un travail qui utilise des services connectés ou produit des fichiers.

Le relecteur reçoit la demande de revue, sans être le seul autorisé à décider. Toute autre personne qui peut modifier la tâche peut aussi accepter le résultat : un Éditeur ou un rôle supérieur, ou le Membre à qui la tâche appartient. Si ton organisation exige une relecture indépendante, la personne qui a démarré l’exécution d’agent examinée ne peut toutefois pas en accepter le résultat ; quand aucune exécution d’agent n’a produit le résultat, c’est la personne qui a créé la tâche qui ne le peut pas. Une exécution qu’un Membre a démarrée sur sa propre tâche attend alors un Éditeur ou un rôle supérieur, tandis que le Membre peut toujours accepter une exécution qu’un Éditeur y a démarrée.

## Montrer la progression avec les statuts

Modifie **Statut** dans les détails de la tâche ou déplace sa carte vers une autre colonne du tableau. Le sélecteur de statut offre une alternative au glisser-déposer utilisable au clavier.

| Statut | Signification |
| --- | --- |
| **Backlog** | Travail proposé, mais pas encore retenu. |
| **À faire** | Travail prêt à démarrer. |
| **En cours** | Travail commencé. Pour une tâche assignée à un agent, passer à ce statut lance son exécution. |
| **En revue** | Résultat en attente d’une vérification humaine. |
| **Terminé** | Une personne a accepté le travail accompli. |
| **Annulé** | Travail abandonné. |

Pour une tâche d’agent, changer de statut peut démarrer ou annuler une exécution. Lis l’indication de l’action avant de déplacer la carte. Un agent remet son résultat à **En revue** ; il ne peut pas le marquer lui-même **Terminé**.

## Garder les décisions avec le travail

Ouvre la tâche pour ajouter une description, des pièces jointes, des dates, des étiquettes, des sous-tâches ou des commentaires. Consigne dans les commentaires les questions, décisions et retours qu’un futur relecteur devra comprendre.

Saisis `@` dans un commentaire pour ouvrir le sélecteur de mentions. Mentionner l’agent assigné constitue une instruction : cela peut guider une exécution en cours ou en démarrer une autre si l’agent est inactif. Un commentaire sans mention conserve l’échange sans demander cette action à l’agent.

Les mentions dans la description de la tâche agissent de la même façon quand tu enregistres la tâche : les personnes citées sont notifiées, et un agent cité est guidé ou démarre une exécution comme décrit ci-dessus. S’il démarre une exécution, la tâche passe à **En cours**, quelle que soit la colonne où tu l’as créée. Quand tu modifies la description plus tard, seules les mentions que tu ajoutes comptent. Reformuler le texte autour d’une mention existante ne notifie personne à nouveau. L’agent lit la description telle qu’elle est au démarrage de son exécution : si tu la modifies pendant que l’exécution attend encore, c’est ta nouvelle version qu’il suit.

Utilise **Sous-tâches** pour séparer des résultats vérifiables indépendamment. Une sous-tâche nomme sa tâche parente en haut de ses détails (**Partie de …**) ; clique dessus pour y remonter. Une tâche parente ne peut pas être clôturée tant que ses sous-tâches restent ouvertes. **Dépendances** indique ce qui bloque la tâche et ce qu’elle bloque. Les dépendances circulaires sont refusées.

Quand tu modifies un champ, l’**Activité** de la tâche affiche sa valeur d’avant et celle d’après. Un champ que tu vides indique ce qui reste, par exemple **Aucune échéance** ou **Non assigné**, au lieu de répéter seulement l’ancienne valeur. Les titres, descriptions, étiquettes et noms de fichiers apparaissent exactement tels qu’ils ont été saisis, même quand le texte correspond à un nom de statut comme `done`. Les statuts, les priorités, les dates et les mentions d’un champ vide s’affichent dans ta langue.

## Rendre une tâche récurrente

Si le même travail revient régulièrement, comme un point d’avancement hebdomadaire, rends la tâche récurrente. Chaque fois que tu la clôtures, la tâche suivante apparaît dans **À faire**, avec pour échéance le prochain jour prévu par la répétition.

Clique sur **Répéter**, sous **Échéance**, dans les détails de la tâche ou dans **Créer une tâche**, puis choisis comment la tâche se répète. Ton choix est enregistré dès que tu cliques dessus :

- **Jamais**
- **Tous les jours**
- **Tous les jours ouvrés**, du lundi au vendredi
- **Chaque semaine le …**, **Chaque mois le …** ou **Chaque année le …**, qui reprennent le jour de l’échéance ; sans échéance, celui de la date de début si elle est encore à venir, sinon celui d’aujourd’hui

<Frame caption="Choisis la répétition dans les détails de la tâche ; l’aperçu indique les prochaines échéances.">

![Le menu Repeat de la tâche Sign off the launch checklist propose Never, Daily, Every weekday, Weekly on Monday (sélectionné), Monthly on day 28, Yearly on Sep 28 et Custom, avec les prochaines échéances et l’option de créer la tâche suivante à l’échéance.](/images/platform/project-task-repeat.webp)

</Frame>

**Prochaines échéances** indique quand les trois prochaines tâches arriveront à échéance. Une tâche sans échéance en reçoit une dès que tu choisis une répétition : le premier jour prévu à partir d’aujourd’hui, ou à partir de sa date de début si celle-ci est plus tardive. Une répétition mensuelle le 31 tombe le dernier jour des mois plus courts. Si tu retires l’échéance d’une tâche déjà récurrente, la répétition reste : la tâche suivante arrive alors quand tu clôtures celle-ci, avec pour échéance le premier jour prévu après la clôture, et **Répéter** le signale à l’ouverture. Toute modification de la répétition redonne une échéance à la tâche.

Si les dates dépassent la plage de dates prise en charge, l’aperçu le signale. Choisis une date de début ou une échéance antérieure avant de définir la répétition.

### Définir une répétition personnalisée

Pour tout autre rythme, choisis **Personnalisé** dans la même liste. Choisis **Jour**, **Semaine**, **Mois** ou **Année**, indique à quelle fréquence la tâche revient, puis sélectionne les jours de la semaine, le jour du mois ou la date, par exemple toutes les 2 semaines le mardi et le jeudi. **Prochaines échéances** suit chaque modification. Clique sur **Enregistrer** pour garder la répétition. **Annuler**, **Échap** ou un clic en dehors de la liste abandonnent tes modifications ; la flèche de retour ramène à la liste en les conservant.

### Créer la tâche suivante à l’échéance

Par défaut, la tâche suivante apparaît quand tu passes celle-ci à **Terminé** ou **Annulé**. Si le travail doit revenir à temps même quand la tâche précédente n’est pas terminée, ouvre **Répéter** sur une tâche récurrente, coche **Créer la tâche suivante à l'échéance** sous les dates et clique sur **Enregistrer**. La tâche suivante apparaît alors au début du jour d’échéance, à minuit dans le fuseau horaire de la personne qui a réglé la répétition, même si cette tâche est encore ouverte. Si la tâche est déjà à échéance, la suivante apparaît en quelques minutes, et si tu clôtures la tâche avant son jour d’échéance, la suivante est créée tout de suite. L’activité attribue cette création à **Système**. **Répéter** affiche alors une icône de calendrier, et l’infobulle de l’icône de répétition dans **Tableau** et **Liste** se termine par **tâche suivante à l'échéance**.

Les tâches ouvertes ne retiennent plus une telle série : elles peuvent donc s’accumuler si personne ne les clôture. Une série ne compte jamais plus de 10 tâches ouvertes : la suivante attend que quelqu’un en clôture une. Si tu modifies la répétition, ou choisis **Jamais** puis à nouveau une répétition, les tâches encore ouvertes dans la série restent comptées.

### Ce que reprend la tâche suivante

La tâche suivante a son propre identifiant et commence dans **À faire**. Elle reprend le titre, la description, la priorité, les étiquettes, les pièces jointes, le responsable, le relecteur, les personnes qui suivent la tâche et la répétition. Ses sous-tâches reviennent avec elle, chacune dans **À faire** avec des dates décalées du même intervalle, ainsi que les dépendances qui les relient. Les commentaires, les dépendances vers d’autres tâches, les sous-tâches archivées et les fichiers produits par un agent restent sur la tâche précédente. Les personnes ne sont reprises que si elles ont encore accès au projet : le responsable s’il peut encore être assigné, le relecteur s’il peut encore modifier le projet, et les personnes qui suivent la tâche si elles voient encore le projet. Qui a cessé de suivre la tâche ne suit pas non plus la suivante, même s’il l’a créée.

L’échéance de la tâche suivante est le premier jour prévu par la répétition après l’échéance de la tâche précédente, et une date de début garde le même nombre de jours d’avance. Cette échéance n’est jamais dans le passé : si tu clôtures une tâche en retard, la suivante est due aujourd’hui ou au prochain jour prévu. Les dates manquées ne s’accumulent donc pas en tâches en retard.

Sous **Répéter**, la tâche précédente renvoie à la suivante, par exemple **Tâche suivante : WEB-13**. Si tu rouvres la tâche précédente puis la clôtures à nouveau, aucune deuxième tâche n’est créée. Dans **Tableau** et **Liste**, une icône de répétition signale la tâche qui porte la série à ce moment-là ; son infobulle indique la répétition.

### Arrêter une série

Quand tu clôtures une tâche récurrente, le message **Tâche suivante créée** indique l’échéance de la suivante et propose **Arrêter la répétition**. Le même bouton reste sous **Répéter** sur la tâche qui a créé la suivante, à côté de **Tâche suivante**, tant que la tâche suivante se répète. Si personne n’a encore touché à la tâche suivante (elle est toujours dans **À faire**, inchangée, sans commentaire ni exécution d’agent), elle est supprimée avec ses sous-tâches. Sinon, elle reste en place mais ne se répète plus. Dans les deux cas, la série s’arrête : sur la tâche depuis laquelle tu l’as arrêtée, **Répéter** affiche **Jamais**, et son infobulle indique **La série a été arrêtée.** Si tu as utilisé le bouton sous **Répéter**, le focus passe ensuite sur **Répéter**. Tu peux aussi ouvrir la tâche la plus récente de la série et régler son champ **Répéter** sur **Jamais**.

**Arrêter la répétition** n’agit que sur les tâches que tu peux modifier : celle sur laquelle tu l’utilises et les tâches ultérieures de la série que tu peux modifier aussi. Les tâches antérieures continuent d’afficher leur répétition. Si une tâche ultérieure appartient désormais à quelqu’un d’autre, par exemple après une réattribution, elle garde sa répétition et la série continue à partir d’elle ; aucune tâche suivante n’est alors supprimée.

Si tu supprimes la tâche la plus récente d’une série, la série s’arrête. La tâche précédente n’en crée pas d’autre, même si tu la rouvres puis la clôtures à nouveau : elle n’affiche pas d’icône de répétition, et son champ **Répéter** reste verrouillé, avec l’infobulle **La tâche suivante a été supprimée. Cette tâche ne peut plus se répéter.** Si tu supprimes une tâche plus ancienne, la série continue à partir de la plus récente.

### Quand la répétition ne peut pas être modifiée

Survole **Répéter** ou place le focus clavier dessus pour lire pourquoi le champ est verrouillé :

- Une tâche qui a déjà créé sa tâche suivante lui a transmis la série et ne se répète plus, même si tu la rouvres. Tant que la série continue, modifie la répétition sur la tâche suivante, que le lien **Tâche suivante** ouvre. Si la série a été arrêtée ou si la tâche suivante a été supprimée, **Répéter** l’indique.
- Toute autre tâche passée à **Terminé** ou **Annulé** garde la répétition avec laquelle elle a été clôturée. Rouvre-la pour modifier sa répétition.
- Une sous-tâche n’a pas de répétition propre. Tant que sa tâche parente se répète, **Répéter** affiche par exemple **Avec WEB-3**, et chaque tâche suivante de la parente apporte une nouvelle copie de la sous-tâche. Une sous-tâche archivée n’a pas de champ **Répéter** : elle ne revient pas. Un travail qui suit son propre rythme a besoin d’une tâche à part entière.
- Une tâche qu’une automatisation prend en charge ne se répète pas, et assigner une tâche récurrente à une automatisation arrête sa série.
- Dans **Créer une tâche**, **Répéter** affiche **Jamais** tant que **Statut** est sur **Terminé** ou **Annulé**, ou qu’une automatisation est assignée.

## Vérifier le résultat avant de clôturer

Pour une tâche humaine, compare le travail au critère de fin décrit dans la tâche. Pour un agent, lis son compte rendu dans les commentaires et examine les fichiers produits. Une exécution terminée indique que l’agent a cessé de travailler ; le résultat attend encore son acceptation par une personne.

Passe la tâche à **Terminé** lorsqu’elle répond au besoin. Si l’agent doit reprendre son travail, explique précisément la modification attendue dans un commentaire et mentionne-le. [Automatiser les tâches](/fr/platform/projects/task-automation) détaille les reprises, nouvelles tentatives et annulations.

## Ouvrir tes tâches depuis Accueil

[Accueil](/fr/platform#home) liste les tâches ouvertes qui te sont attribuées ou qui attendent ta relecture, dans tous les projets que tu peux consulter ; **Tâches**, au-dessus de la liste, n’affiche qu’elles. Une tâche ouverte depuis **Accueil** s’affiche sur une page à part, à côté du panneau latéral, et non dans la boîte de dialogue du tableau :

- La demande vient en premier, sous forme de carte : la description, les pièces jointes et les sous-tâches.
- La discussion suit comme une conversation, des éléments les plus anciens aux plus récents, regroupés par jour. Elle réunit les commentaires et l’historique de la tâche, par exemple les changements de statut, les attributions et les exécutions d’agents.
- Le champ de commentaire se trouve en bas. Envoie avec **⌘+Entrée** ou **Ctrl+Entrée**, ou avec le bouton d’envoi rond ; **Entrée** seule passe à la ligne. Saisis `@` pour mentionner un agent ou une personne, avec le même effet que dans la boîte de dialogue du tableau. Le texte que tu n’as pas encore envoyé reste dans le champ pour cette tâche, ici comme dans la boîte de dialogue du tableau, et la ligne de la tâche dans **Accueil** affiche **Brouillon** tant que tu travailles ailleurs.
- **Détails**, à côté de la discussion, regroupe le statut, la priorité, la personne assignée, le relecteur, les dates, la répétition, les étiquettes et les dépendances, ainsi que **Suivre** et **Archiver**. Les propriétaires et administrateurs de l’organisation y trouvent aussi **Supprimer** : la tâche disparaît définitivement avec ses sous-tâches, leurs commentaires et leurs fichiers, et leurs exécutions d’agent en cours s’arrêtent. **Masquer les détails**, au bout de l’en-tête, replie ce panneau et **Afficher les détails** le rouvre. Dans une fenêtre trop étroite pour afficher les deux côte à côte, **Afficher les détails** ouvre plutôt les détails dans un volet au-dessus de la discussion — sur le côté, ou en bas de l’écran sur téléphone.

**Tableau**, dans l’en-tête, ouvre le tableau des tâches du projet. Une tâche ouverte depuis le tableau s’affiche toujours dans sa boîte de dialogue ; les deux vues modifient la même tâche. **Copier le lien**, l’icône de lien à côté de **Tableau**, copie le lien de cette page de tâche. Pour copier l’identifiant de la tâche, par exemple `WEB-2`, clique dessus dans la ligne sous le titre ; un message confirme chaque copie.

## Retrouver le travail à suivre

Réduis le tableau avec les filtres ou passe à la liste pour parcourir les tâches ligne par ligne. Garde les propositions dans le [Backlog](/fr/platform/projects/backlog) jusqu’à leur démarrage. Utilise des étiquettes pour les distinctions qui ne demandent pas un nouveau statut.

Dans les vues **Tableau** et **Liste**, appuie sur **Tab** jusqu’à placer le focus sur le titre de la tâche, puis sur **Entrée** pour l’ouvrir.

Si tu peux modifier la tâche, place le focus sur son titre et appuie sur **Espace** pour la saisir. Déplace-la avec les touches fléchées, puis appuie de nouveau sur **Espace** pour la déposer. **Échap** annule le déplacement et laisse la tâche à sa place. Un lecteur d’écran nomme la tâche quand tu la saisis, puis annonce son statut et sa position pendant le déplacement.

Si une modification est refusée, vérifie l’état de la tâche avant de réessayer : une exécution active empêche de réassigner l’agent, des sous-tâches ouvertes empêchent la clôture, et ton rôle, ainsi que le fait que la tâche soit la tienne ou non, déterminent si tu peux la modifier.
