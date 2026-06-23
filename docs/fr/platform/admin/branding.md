---
title: Branding
description: Logo, favicon et couleurs de marque que ton organisation montre à ses membres. Les Administrateurs lisent ceci quand ils whitelabel une instance auto-hébergée ou alignent le chrome in-produit sur la palette de l'entreprise.
---

Le branding est la surface qui échange le chrome par défaut de Tale contre celui de ton organisation. La page couvre les assets que la plateforme habille — logo, favicon, couleurs de marque et d'accent — et explique où chacun apparaît pour que tu aies un aperçu avant d'enregistrer. Le nom du produit lui-même suit automatiquement le nom de ton organisation, il n'y a donc pas de champ séparé à remplir. Les Administrateurs vont vers le branding quand une instance auto-hébergée s'expose à un public externe ou quand un déploiement interne doit sembler natif à l'entreprise.

Seuls les Administrateurs et Propriétaires peuvent éditer le branding. Tous les autres voient le résultat ; le formulaire lui-même est caché aux Éditeurs, Développeurs et Membres.

## Où vit le branding

Ouvre **Paramètres > Branding**. Le formulaire a trois sections (téléversement du logo, téléversement du favicon, couleurs) et un aperçu en direct qui reflète la sidebar avec les valeurs que tu édites. Enregistrer applique le changement pour chaque membre de _cette_ organisation à son prochain chargement de page — il n'y a pas de surcharge par utilisateur.

Le branding est limité à une organisation. Chaque organisation conserve son propre logo, favicon et ses couleurs, donc changer d'organisation bascule le chrome vers le branding de cette organisation au lieu de garder celui de la précédente. Éditer ici ne change que l'organisation dans laquelle tu te trouves actuellement.

## Le nom du produit

Il n'y a pas de champ « nom d'app » ni « logo texte ». La marque de mot dans l'en-tête de la sidebar et le nom dans le titre d'onglet du navigateur sont le nom propre de ton organisation, que tu définis sur la page **Paramètres > Organisation**. Renomme l'organisation et le chrome suit au prochain chargement de page. Téléverse une image de logo (ci-dessous) et elle prend la place de la marque de mot ; sans logo, le nom de l'organisation est rendu comme marque de mot textuelle.

## Les assets

**Logo** est une image — PNG, SVG ou JPG. La plateforme la rend à la hauteur de la sidebar ; vise un fond transparent et une marque de mot lisible à environ 32 pixels de haut. Téléverse une variante claire et une variante sombre séparément si ta marque de mot doit s'inverser sur thème sombre. Sans logo, le chrome retombe sur le nom de ton organisation comme marque de mot textuelle.

**Favicon** est l'icône d'onglet. Téléverse une variante claire et une variante sombre pour que l'icône reste lisible quel que soit le thème choisi par le système d'exploitation — ou laisse-le vide, et Tale en dérive un de ton logo dès que tu le téléverses, si bien qu'un seul téléversement habille à la fois la sidebar et l'onglet du navigateur. Un favicon explicite l'emporte toujours sur celui dérivé automatiquement.

**Couleur de marque** est l'accent primaire — boutons, anneaux de focus, la ligne active de la sidebar. **Couleur d'accent** est le ton secondaire pour les états de sélection et d'activité. Les deux acceptent toute valeur hex. Une couleur est choisie une fois et appliquée aux modes clair et sombre ; si la couleur que tu as choisie serait difficile à lire contre le fond d'un thème, Tale la pousse vers le contraste pour ce thème seulement et laisse l'autre intact — ainsi la même marque se lit proprement sur les deux. L'aperçu reflète la couleur ajustée pour le thème que tu regardes actuellement.

## Un rebranding mis en pratique

Pour rebrander une instance pour `Acme Corp`, mets d'abord le nom de l'organisation à `Acme Corp` sur la page **Paramètres > Organisation** — ce nom devient la marque de mot de la sidebar et le titre d'onglet du navigateur. Ouvre ensuite **Paramètres > Branding**, téléverse la marque de mot de l'entreprise comme logo (variantes claire et sombre), et colle le hex de marque (`#3B82F6` dans l'exemple) dans le champ couleur de marque. Laisse le favicon vide, et Tale en génère un depuis le logo. Le panneau d'aperçu à droite se met à jour pendant que tu tapes. Enregistrer applique le changement ; la sidebar, l'onglet du navigateur et le favicon reflètent le nouveau branding immédiatement.

## L'écran de connexion personnalisé

Les écrans de connexion, d'inscription et de réinitialisation de mot de passe s'affichent avant que tu aies choisi une organisation — il n'y a donc aucune organisation dans le contexte pour les brander. Ils montrent le branding par défaut de la plateforme plutôt que celui d'une organisation précise ; le branding par organisation prend le relais dès que tu arrives dans l'espace de travail de cette organisation. Déconnecte-toi et recharge l'URL de connexion pour vérifier quels assets utilisent les écrans pré-authentification.

## Où ça s'inscrit

Le branding est la couche visuelle au-dessus de toute autre surface admin ; SSO, courriels et journaux d'audit portent le chrome brandé jusqu'à tes membres. Comme le nom du produit est le nom propre de l'organisation, garde-le net dans [membres et rôles](/fr/platform/admin/members-and-roles). Combine le branding avec [fournisseurs](/fr/platform/admin/providers) pour que les noms de modèles dans l'en-tête de chat correspondent au chrome qui les entoure, et avec [membres et rôles](/fr/platform/admin/members-and-roles) pour que les personnes qui peuvent éditer le branding soient les mêmes qui détiennent le reste du chrome de l'org.
