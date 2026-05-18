---
title: Bibliothèque de prompts
description: Enregistre, parcours et partage des modèles de prompts réutilisables dans toute l'organisation, avec historique de versions, visibilité cadrée et insertion en un clic.
---

La Bibliothèque de prompts est une collection partagée de modèles de prompts réutilisables. Enregistre les prompts que l'équipe utilise souvent, organise-les par catégorie et tags, et partage-les au bon périmètre — brouillons personnels, playbooks d'équipe, ou modèles canoniques à l'échelle de l'organisation. Chaque modification est capturée dans l'historique de versions, donc comparer deux versions et revenir sur un mauvais enregistrement prend quelques secondes au lieu d'un après-midi.

La bibliothèque est joignable depuis la barre d'outils du composeur dans chaque chat. Le public, c'est tout le monde dans le produit ; les périmètres de visibilité décident de ce que chaque rôle voit.

## Parcourir les prompts

Ouvre la bibliothèque depuis la barre d'outils de la saisie du chat — la boîte liste chaque prompt auquel tu as accès. La recherche filtre sur le titre, la description, le contenu, la catégorie et les tags. Quatre onglets filtrent par périmètre : **Tous**, **Global**, **Équipe**, **Personnel**. Les popovers Catégorie et Tag resserrent les lignes visibles selon les facettes de la page chargée ; si un filtre vide la page courante mais que d'autres pages existent, l'état vide propose **Charger plus** pour continuer la recherche, plus **Effacer les filtres** pour réinitialiser. Chaque ligne montre le titre, un aperçu du contenu, un badge de périmètre, la catégorie, les tags et la version courante (par exemple `v3` quand un historique existe).

Clique sur **Utiliser** sur une ligne pour insérer son contenu dans la saisie du chat.

## Créer un prompt

Pour créer un prompt, ouvre la bibliothèque et clique sur l'icône plus. Le formulaire demande sept champs, dont trois sont requis :

| Champ           | Requis       | Ce qu'il faut mettre                                              |
| --------------- | ------------ | ----------------------------------------------------------------- |
| **Titre**       | Oui          | Un nom court pour le prompt.                                      |
| **Contenu**     | Oui          | Le texte du prompt. Affiché en police monospace.                  |
| **Description** | Non          | Brève explication de ce que fait le prompt.                       |
| **Visibilité**  | Oui          | Qui peut voir ce prompt — Global, Équipe ou Personnel.            |
| **Équipe**      | Conditionnel | Requis quand la Visibilité est mise sur Équipe.                   |
| **Catégorie**   | Non          | Un label comme `writing`, `analysis` ou `coding`.                 |
| **Tags**        | Non          | Mots-clés séparés par virgules pour la recherche et le rangement. |

Clique sur **Créer**. Le nouveau prompt apparaît dans la bibliothèque en v1.

### Saisie des tags

Le champ tags est une saisie à puces. Appuie sur **Entrée** ou tape une virgule pour valider un tag ; **Retour arrière** sur une saisie vide retire la dernière puce ; le × sur une puce la retire. Les doublons sont fusionnés silencieusement sans tenir compte de la casse (`Foo` et `foo` donnent un seul tag). Le compteur sous la saisie passe en destructif quand tu atteins le plafond.

## Enregistrer un message de chat comme prompt

Pour capter un message déjà envoyé, ouvre le menu du message dans la conversation et choisis **Enregistrer comme prompt**. Le contenu du message est pré-rempli — ajoute un titre et une description optionnelle, puis enregistre. Le nouveau prompt atterrit en visibilité Personnel et est publié tout de suite.

## Périmètres

Trois niveaux de visibilité décident de qui voit un prompt :

| Périmètre     | Qui peut le voir                   | Qui peut créer à ce périmètre  | Couleur du badge |
| ------------- | ---------------------------------- | ------------------------------ | ---------------- |
| **Personnel** | Toi uniquement.                    | Tout le monde.                 | Bleu.            |
| **Équipe**    | Membres de l'équipe choisie.       | Membres de cette équipe.       | Orange.          |
| **Global**    | Tout le monde dans l'organisation. | Admins et Propriétaires seuls. | Vert.            |

Les prompts non publiés ne sont visibles que par leur créateur, quel que soit le périmètre.

Promouvoir un prompt existant au périmètre **Global** — ou restaurer une version qui était auparavant Globale — est aussi réservé aux Admins et Propriétaires. Un créateur non-admin peut continuer à éditer un prompt Global qui lui appartient déjà.

## Éditer et supprimer

Seul le créateur du prompt ou un Admin peut éditer ou supprimer un prompt. Utilise le menu kebab sur une ligne pour atteindre ces actions. Supprimer un prompt est définitif et irréversible.

## Historique de versions

Chaque enregistrement crée une nouvelle version. Pour parcourir l'historique, ouvre le menu kebab sur une ligne et choisis **Historique de versions** — la boîte liste chaque version avec sa date de publication et son auteur. Les prompts qui n'ont pas été édités depuis la livraison de la versionnalisation n'ont pas encore de dialogue Historique ; fais une première édition pour créer v2, l'élément de menu devient alors disponible et v1 reste préservé comme état antérieur.

### Comparer deux versions

Appuie sur **Entrée** sur une version (ou clique sur **Comparer avec l'actuelle**) pour ouvrir un diff côte à côte. Le diff est ligne par ligne, optimisé pour la prose. Les lignes marquées `−` sont dans le contenu actuel mais pas dans l'instantané comparé ; les lignes marquées `+` sont dans l'instantané — ce sont celles que **Restaurer** ramènerait. Les changements de métadonnées (titre, description, catégorie, tags, périmètre) apparaissent au-dessus du diff de contenu avec la valeur avant/après. Les utilisateurs de lecteurs d'écran entendent chaque ligne ajoutée ou retirée annoncée avec un préfixe explicite.

### Restaurer une version

Appuie sur **R** ou **Maj+Entrée** sur une version (ou clique sur **Restaurer** dans la vue de comparaison) pour ramener le prompt à cet instantané. Restaurer est réversible — ça crée une nouvelle version v(courante + 1) qui porte le contenu et les métadonnées de l'instantané ; la version courante précédente reste dans l'historique pour pouvoir la restaurer plus tard si besoin.

Si quelqu'un d'autre a enregistré une nouvelle version pendant que ta boîte d'historique était ouverte, la restauration échoue avec **L'historique de versions a changé — rafraîchis et réessaie**. Ferme et rouvre la boîte pour voir l'état le plus récent avant de retenter.

### Raccourcis clavier dans la boîte d'historique

| Touche                 | Action                                                 |
| ---------------------- | ------------------------------------------------------ |
| **↑ / ↓**              | Se déplacer entre les versions.                        |
| **Début / Fin**        | Aller à la version la plus récente / la plus ancienne. |
| **Entrée**             | Ouvrir la vue de comparaison pour la ligne focalisée.  |
| **R** / **Maj+Entrée** | Restaurer la version focalisée.                        |
| **Échap**              | Fermer la boîte (ou la vue de comparaison).            |

## Modifications concurrentes

Si tu ouvres un prompt en édition pendant que quelqu'un d'autre publie une nouvelle version, le formulaire affiche une bannière **Nouvelle version disponible**. Clique sur **Charger la dernière** pour ré-ancrer le formulaire sur l'instantané le plus récent avant d'enregistrer. Tes modifications non enregistrées seront jetées, donc l'avertissement passe en destructif quand le formulaire est dirty.

## Limites

Les plafonds par prompt sont appliqués côté serveur et reflétés côté client :

| Champ         | Plafond                                       |
| ------------- | --------------------------------------------- |
| Contenu       | 16 KiB (UTF-8).                               |
| Titre         | 200 caractères.                               |
| Description   | 2 000 caractères.                             |
| Catégorie     | 100 caractères.                               |
| Tag (chacun)  | 50 caractères.                                |
| Tags (nombre) | 20 par prompt.                                |
| Historique    | 12 versions (la plus ancienne tombe au save). |

Quand l'historique atteint le plafond, la version la plus ancienne tombe (FIFO) et un événement d'audit **history truncated** est émis.

## Limites de débit

Les mutations sur les prompts sont rate-limitées par utilisateur pour que les opérations en masse restent fluides. Si tu touches une limite, un toast affiche **Enregistrement trop rapide — patiente un instant avant de réessayer**, et l'action redémarre proprement dès que la fenêtre se réinitialise.

## Suivi d'utilisation

Chaque prompt suit combien de fois il a été inséré. Le compteur d'utilisation apparaît sur la carte du prompt et se met à jour dès qu'on choisit le prompt pour une conversation — un signal utile pour repérer les modèles qui portent l'équipe en silence et ceux qui se sont révélés des coups uniques.

## Où ça s'inscrit

La Bibliothèque de prompts est la surface de texte réutilisable pour le composeur du chat. Elle existe pour la même raison que le contrôle de version : le prompt que tu as écrit la semaine dernière, celui qui a enfin obtenu la bonne réponse, devrait être enregistré une fois et joignable depuis chaque conversation — pas pêché dans une recherche d'historique de chat. Les périmètres personnels sont pour les brouillons ; les périmètres d'équipe pour les playbooks partagés ; les périmètres à l'échelle de l'organisation pour les modèles canoniques que toute l'entreprise devrait prendre.

Pour les prompts qui changent durablement le comportement de l'IA plutôt que d'encadrer un seul message, édite les instructions de l'agent dans [Créer un agent](/fr/platform/agents/create) — les instructions sont le prompt qui tourne avant _chaque_ message d'une conversation d'agent, alors qu'un prompt de bibliothèque est le corps d'un seul message.
