---
title: Bibliothèque de prompts
description: Enregistre, parcours et partage des modèles de prompt réutilisables dans ton organisation.
---

La Bibliothèque de prompts est une collection partagée de modèles de prompt réutilisables. Enregistre les prompts que tu utilises souvent, organise-les par catégorie et étiquettes, et partage avec ton équipe ou toute l’organisation. Chaque modification est conservée dans l’historique des versions, ce qui te permet de comparer et de revenir en arrière sans perdre de travail.

## Parcourir les prompts

Ouvre la Bibliothèque de prompts depuis la barre d’outils du chat. Le dialogue affiche tous les prompts auxquels tu as accès.

- **Recherche** filtre sur titre, description, contenu, catégorie et étiquettes.
- **Onglets** filtrent par visibilité : Tous, Global, Équipe ou Personnel.
- Les popovers **Catégorie** et **Étiquette** restreignent les lignes visibles selon les facettes de la page chargée. Si un filtre vide la page courante mais que d’autres pages existent, l’état vide propose **Charger plus** pour continuer la recherche, ainsi que **Effacer les filtres** pour réinitialiser.
- Chaque ligne montre le titre, l’aperçu du contenu, le badge de visibilité, la catégorie, les étiquettes et la version courante (ex. `v3` quand un historique existe).

Clique **Utiliser ce prompt** sur une ligne pour insérer son contenu dans la saisie du chat.

## Créer un prompt

1. Ouvre la Bibliothèque de prompts et clique l’icône **plus**.
2. Remplis le formulaire :

| Champ           | Requis       | Description                                                             |
| --------------- | ------------ | ----------------------------------------------------------------------- |
| **Titre**       | Oui          | nom court du prompt.                                                    |
| **Contenu**     | Oui          | texte du prompt. Affiché en monospace.                                  |
| **Description** | Non          | brève explication de ce que fait le prompt.                             |
| **Visibilité**  | Oui          | qui peut voir le prompt (voir [Visibilités](#visibilités)).             |
| **Équipe**      | Conditionnel | requis si la visibilité est Équipe.                                     |
| **Catégorie**   | Non          | un label comme "writing", "analysis" ou "coding".                       |
| **Tags**        | Non          | mots-clés séparés par des virgules pour la recherche et l’organisation. |

3. Clique **Créer**.

### Saisie des étiquettes

Le champ **Étiquettes** est une saisie à puces. Appuie sur **Entrée** ou tape une **virgule** pour valider une étiquette ; **Retour arrière** sur une saisie vide supprime la dernière puce ; le **×** sur une puce la retire. Les doublons sont silencieusement fusionnés sans tenir compte de la casse (`Foo` et `foo` deviennent une seule étiquette). Le compteur sous la saisie devient destructif dès que la limite est atteinte (voir [Limites](#limites)).

## Enregistrer un message comme prompt

Tu peux enregistrer n’importe quel message de chat comme modèle directement depuis la conversation :

1. Ouvre le menu du message et choisis **Enregistrer le prompt**.
2. Le contenu est pré-rempli. Ajoute un titre et une description optionnelle.
3. Le prompt est enregistré en visibilité **Personnel** et publié immédiatement.

C’est un moyen rapide de capter des prompts efficaces sans quitter le chat.

## Visibilités

Les prompts ont trois niveaux :

| Visibilité    | Qui peut le voir            | Couleur du badge |
| ------------- | --------------------------- | ---------------- |
| **Personnel** | toi uniquement              | bleu             |
| **Équipe**    | membres de l’équipe choisie | orange           |
| **Global**    | toute l’organisation        | vert             |

Les prompts non publiés ne sont visibles que par leur créateur quelle que soit la visibilité.

## Éditer et supprimer

Seul le créateur du prompt ou un Admin peut éditer ou supprimer. Utilise le menu contextuel sur une ligne pour accéder à ces actions.

La suppression est définitive et irréversible.

## Historique des versions

Chaque enregistrement crée une nouvelle version. Ouvre le menu contextuel sur une ligne et choisis **Historique des versions** pour voir toutes les versions passées de ce prompt. Le dialogue liste chaque version avec sa date de publication et son auteur. Les prompts sans historique (antérieurs à la versionnalisation) affichent une **v1** synthétisée pour le contenu d’origine.

### Comparer les versions

Appuie sur **Entrée** sur une version (ou clique **Comparer avec l’actuelle**) pour ouvrir le diff côte à côte. Le diff est ligne à ligne, optimisé pour la prose :

- Les lignes marquées `−` sont dans le contenu actuel mais pas dans l’instantané comparé.
- Les lignes marquées `+` sont dans l’instantané. Ce sont elles que **Restaurer** ramènerait.
- Les changements de métadonnées (titre, description, catégorie, étiquettes, visibilité) apparaissent au-dessus du diff de contenu avec les valeurs avant/après.

Les utilisateurs de lecteurs d’écran entendent chaque ligne ajoutée/retirée annoncée avec un préfixe explicite.

### Restaurer une version

Appuie sur **R** ou **Maj+Entrée** sur une version (ou clique **Restaurer** dans la vue de comparaison) pour ramener le prompt à cet instantané. La restauration est **réversible** — elle crée une nouvelle version v(actuelle + 1) reprenant le contenu et les métadonnées de l’instantané ; la version actuelle précédente reste dans l’historique et peut être restaurée plus tard.

Si quelqu’un d’autre a enregistré une nouvelle version pendant que ton dialogue d’historique était ouvert, la restauration échoue avec **L’historique des versions a changé — actualise et réessaie**. Ferme et rouvre le dialogue pour voir le dernier état avant de retenter.

### Raccourcis clavier dans le dialogue d’historique

| Touche                 | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| **↑ / ↓**              | Naviguer entre les versions                           |
| **Début / Fin**        | Aller à la version la plus récente / la plus ancienne |
| **Entrée**             | Ouvrir la vue de comparaison pour la ligne focalisée  |
| **R** / **Maj+Entrée** | Restaurer la version focalisée                        |
| **Échap**              | Fermer le dialogue (ou la vue de comparaison)         |

## Modifications concurrentes

Si tu ouvres un prompt en édition pendant que quelqu’un d’autre publie une nouvelle version, le formulaire affiche une bannière : **Nouvelle version disponible**. Clique **Charger la dernière** pour ré-ancrer le formulaire sur le dernier instantané avant d’enregistrer — tes modifications non enregistrées seront perdues, donc l’avertissement passe en destructif quand le formulaire est modifié.

## Limites

Limites par prompt (appliquées côté serveur, miroir côté client) :

| Champ               | Limite                               |
| ------------------- | ------------------------------------ |
| Contenu             | 16 KiB (UTF-8)                       |
| Titre               | 200 caractères                       |
| Description         | 2 000 caractères                     |
| Catégorie           | 100 caractères                       |
| Étiquette (chacune) | 50 caractères                        |
| Étiquettes (nombre) | 20 par prompt                        |
| Historique          | 12 versions (la plus ancienne tombe) |

Quand l’historique atteint la limite, la version la plus ancienne est retirée (FIFO) et un événement d’audit **history truncated** est émis.

## Limites de débit

Les mutations sur les prompts sont rate-limitées par utilisateur pour que les opérations en masse restent fluides. Si tu atteins la limite, un toast affiche **Enregistrement trop rapide — patiente un instant avant de réessayer**, et l’action repart proprement dès que la fenêtre se réinitialise.

## Suivi d’utilisation

Chaque prompt suit combien de fois il a été utilisé. Le compteur est visible sur la carte et se met à jour à chaque insertion.
