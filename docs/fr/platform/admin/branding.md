---
title: Branding
description: Logo, favicon, nom d'app et couleurs de marque que ton organisation montre à ses membres. Les Administrateurs lisent ceci quand ils whitelabel une instance auto-hébergée ou alignent le chrome in-produit sur la palette de l'entreprise.
---

Le branding est la surface qui échange le chrome par défaut de Tale contre celui de ton organisation. La page couvre les quatre assets que la plateforme habille — nom d'app, logo, favicon, couleurs de marque et d'accent — et explique où chacun apparaît pour que tu aies un aperçu avant d'enregistrer. Les Administrateurs vont vers le branding quand une instance auto-hébergée s'expose à un public externe ou quand un déploiement interne doit sembler natif à l'entreprise.

Seuls les Administrateurs et Propriétaires peuvent éditer le branding. Tous les autres voient le résultat ; le formulaire lui-même est caché aux Éditeurs, Développeurs et Membres.

## Où vit le branding

Ouvre **Paramètres > Branding**. Le formulaire a quatre sections (nom d'app et logo texte, téléversement du logo, téléversement du favicon, couleurs) et un aperçu en direct qui reflète la sidebar avec les valeurs que tu édites. Enregistrer applique le changement pour chaque membre de _cette_ organisation à son prochain chargement de page — il n'y a pas de surcharge par utilisateur.

Le branding est limité à une organisation. Chaque organisation conserve son propre logo, favicon, nom d'app et ses couleurs, donc changer d'organisation bascule le chrome vers le branding de cette organisation au lieu de garder celui de la précédente. Éditer ici ne change que l'organisation dans laquelle tu te trouves actuellement.

## Les quatre assets

**Nom d'app** remplace le mot `Tale` dans l'en-tête de la sidebar, le titre d'onglet du navigateur et les courriels sortants. Choisis une chaîne courte qui se lit comme ton organisation appelle l'outil en interne.

**Logo texte** est une forme courte optionnelle pour les endroits serrés — la sidebar repliée, l'en-tête adjacent au favicon. Laisse-le vide pour retomber sur les premières lettres du nom d'app.

**Logo** est une image — PNG, SVG ou JPG. La plateforme la rend à la hauteur de la sidebar ; vise un fond transparent et une marque de mot lisible à environ 32 pixels de haut. Téléverse une variante claire et une variante sombre séparément si ta marque de mot doit s'inverser sur thème sombre.

**Favicon** est l'icône d'onglet de 64 par 64 pixels. Téléverse une variante claire et une variante sombre pour que l'icône reste lisible quel que soit le thème que le système d'exploitation a choisi pour le chrome du navigateur.

**Couleur de marque** est l'accent primaire — boutons, anneaux de focus, la ligne active de la sidebar. **Couleur d'accent** est le ton secondaire pour les états de survol et de sélection. Les deux acceptent toute valeur hex ; l'aperçu montre le contraste contre des fonds clairs et sombres.

## Un rebranding mis en pratique

Pour rebrander une instance pour `Acme Corp`, ouvre **Paramètres > Branding** et remplis le formulaire de haut en bas. Mets le nom d'app à `Acme AI`, téléverse la marque de mot de l'entreprise comme logo (variantes claire et sombre), téléverse la marque carrée Acme comme favicon, et colle le hex de marque (`#3B82F6` dans l'exemple) dans le champ couleur de marque. Le panneau d'aperçu à droite se met à jour pendant que tu tapes. Enregistrer applique le changement ; la sidebar, l'onglet du navigateur et le prochain courriel sortant reflètent le nouveau branding immédiatement.

## L'écran de connexion personnalisé

Les écrans de connexion, d'inscription et de réinitialisation de mot de passe s'affichent avant que tu aies choisi une organisation — il n'y a donc aucune organisation dans le contexte pour les brander. Ils montrent le branding par défaut de la plateforme plutôt que celui d'une organisation précise ; le branding par organisation prend le relais dès que tu arrives dans l'espace de travail de cette organisation. Déconnecte-toi et recharge l'URL de connexion pour vérifier quels assets utilisent les écrans pré-authentification.

## Où ça s'inscrit

Le branding est la couche visuelle au-dessus de toute autre surface admin ; SSO, courriels et journaux d'audit portent le chrome brandé jusqu'à tes membres. Combine-le avec [fournisseurs](/fr/platform/admin/providers) pour que les noms de modèles dans l'en-tête de chat correspondent au chrome qui les entoure, et avec [membres et rôles](/fr/platform/admin/members-and-roles) pour que les personnes qui peuvent éditer le branding soient les mêmes qui détiennent le reste du chrome de l'org.
