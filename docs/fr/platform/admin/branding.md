---
title: Image de marque
description: Personnalise le nom de l'application, le logo, le favicon et les couleurs de marque pour que l'application en cours d'exécution se lise comme ton organisation et non comme Tale.
---

L'image de marque est la couche cosmétique posée sur Tale. Elle remplace le mot « Tale » dans l'onglet du navigateur et dans l'en-tête par le nom de ton organisation, remplace logo et favicon, et choisit les deux couleurs utilisées pour les boutons et les surlignages dans toute l'application. Le public, ce sont les Admins — pour tout autre rôle, le bouton est caché — et l'usage, c'est réduire le nombre de moments où un membre ouvre Tale et voit un nom qui n'est pas le sien. Les changements s'appliquent à l'échelle de l'organisation dès l'enregistrement ; aucun rechargement client n'est requis.

L'image de marque ne change pas ce que le produit fait, ni quels modèles sont disponibles. Pour cela, regarde plutôt [Fournisseurs IA](/fr/platform/admin/providers) et [Gouvernance](/fr/platform/admin/governance).

## Options disponibles

Le formulaire vit sous **Paramètres > Image de marque** et expose un seul écran d'options.

| Option                     | Description                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nom de l'application**   | Remplace « Tale » dans le titre de l'onglet du navigateur et dans l'en-tête de la page. Le placeholder est `ex., Acme corp`.                                                                                           |
| **Logo texte**             | Texte court optionnel rendu à côté de l'image du logo dans la barre de navigation — utile quand l'image seule ne porte pas le nom.                                                                                     |
| **Logo**                   | L'image affichée dans la barre de navigation. Téléverse du PNG, du JPEG ou du SVG ; le SVG est recommandé pour un rendu net à chaque taille. Des variantes Clair et Sombre séparées laissent livrer un logo par thème. |
| **Favicon**                | L'icône 64 × 64 que Tale sert à l'onglet du navigateur. Comme pour le logo, des variantes Clair et Sombre sont acceptées.                                                                                              |
| **Couleur de marque**      | Couleur primaire — utilisée pour boutons, états actifs, anneaux de focus.                                                                                                                                              |
| **Couleur d'accentuation** | Couleur secondaire — utilisée pour les surlignages et les badges.                                                                                                                                                      |

Le formulaire affiche un aperçu de la marque en direct, de sorte que le choix de couleur et de logo est visible avant l'enregistrement.

## Variantes Clair et Sombre

Logo et favicon acceptent tous deux des fichiers séparés pour les modes Clair et Sombre. Le mode actif suit la préférence de thème de chaque utilisateur — réglée sous [Tes préférences](/fr/platform/member/preferences) — ce qui permet à une seule marque de livrer deux logos visuellement distincts sans bascule de mode explicite dans l'interface. Téléverse une seule variante et Tale s'en sert pour les deux modes.

## Couleurs

Les couleurs s'entrent en codes hex. Tale vérifie chaque couleur choisie contre le ratio de contraste avec l'arrière-plan et avertit si la valeur tombe sous le ratio 4,5:1 que WCAG AA exige pour du texte normal ; le sélecteur de couleur propose une alternative proche qui passe le contraste. L'avertissement ne bloque pas l'enregistrement — tu peux passer outre quand la charte graphique l'exige — mais le journal d'audit garde trace du passage en force.

## Où cela s'insère

L'image de marque est la couche de personnalisation de surface. Elle change la manière dont Tale se présente à l'équipe et aux destinataires des courriels de l'équipe ; elle ne change pas ce que le produit fait, quels modèles existent ou ce que les rôles peuvent faire. Traite les réglages d'ici comme bon marché et réversibles — chaque champ a une icône de réinitialisation qui restaure la valeur Tale par défaut en un clic, pour expérimenter sans t'engager.

Pour les surfaces de personnalisation plus profondes — le menu des modèles, la politique de rétention, la matrice des rôles — [Fournisseurs IA](/fr/platform/admin/providers), [Gouvernance](/fr/platform/admin/governance) et [Membres et rôles](/fr/platform/admin/members-and-roles) sont les pages.
