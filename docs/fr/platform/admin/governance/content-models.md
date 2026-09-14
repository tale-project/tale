---
title: Modèles
description: Définis les modèles par défaut, limite leur accès et choisis le modèle qui lit les images pour les agents textuels.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Modèles** pour choisir les modèles proposés au départ et ceux que les membres peuvent utiliser. Les valeurs par défaut orientent le choix ; les règles d’accès imposent une restriction. Configure d’abord les [identifiants fournisseur](/platform/admin/providers) pour rendre les modèles souhaités disponibles.

<Frame caption="Paramètres > Gouvernance > Modèles — les règles de modèle par défaut par scope, avec la liste d’autorisation de l’accès aux modèles en dessous et le modèle de vision plus bas.">

![La page de gouvernance Modèles montrant le tableau des modèles par défaut avec trois règles — un défaut pour tous les utilisateurs et une règle de rôle pour Développeur et pour Membre, chacune épinglée à un modèle OpenRouter — au-dessus de la section d’accès aux modèles en mode liste d’autorisation, avec une règle de modèles autorisés par rôle.](/images/platform/governance-content-models.webp)

</Frame>

## Définir un modèle par défaut

1. Sous **Modèles par défaut**, choisis **Ajouter une règle**.
2. Choisis la portée par défaut comme base, un rôle ou une équipe. Sélectionne la cible si nécessaire.
3. Choisis un fournisseur et un modèle, puis **Confirmer**. Enregistre les changements en attente dans l’en-tête.
4. Démarre un chat en tant que membre du groupe cible, avec le modèle sur **Auto**, puis vérifie le modèle effectivement choisi.

Le modèle par défaut s’applique lorsqu’aucun modèle n’a été choisi explicitement. Une règle d’équipe passe avant une règle de rôle, puis vient la valeur par défaut générale. Elle n’empêche pas de sélectionner un autre modèle autorisé.

## Limiter l’accès aux modèles

Sous **Accès aux modèles**, choisis le mode et ajoute des règles pour les personnes, équipes, rôles ou la portée par défaut à couvrir.

| Mode | Effet d’une règle correspondante |
| --- | --- |
| Liste d’autorisation | Seuls les modèles autorisés dans la liste sont utilisables ; un modèle bloqué reste refusé. |
| Liste de blocage | Les modèles sont permis sauf s’ils figurent parmi les modèles bloqués. |

Les règles individuelles passent avant celles des équipes, puis des rôles et enfin la règle par défaut. Plusieurs règles d’équipe correspondantes combinent leurs listes ; un blocage explicite reste prioritaire pour le modèle. Si aucune règle ne correspond, la politique ne restreint pas cette personne. Ajoute une règle de base pour couvrir tout le monde.

L’accès est vérifié à l’utilisation, même pour un modèle choisi explicitement ou fixé. Le modèle par défaut doit aussi passer cette vérification. S’il est refusé, la sélection automatique peut se rabattre sur un modèle autorisé. L’éditeur signale les contradictions entre défaut et accès. Corrige-les pour que le défaut prévu soit réellement utilisé.

<Tip>
Après un changement, teste les deux cas pour le membre concerné : un modèle autorisé doit fonctionner et un modèle interdit doit être refusé. Tester uniquement avec un compte admin ne prouve pas une règle propre à un rôle.
</Tip>

## Choisir le modèle qui lit les images

Un agent textuel a besoin d’aide pour lire une image, comme une capture d’écran ou une page scannée. La section du modèle de vision choisit celui qui la transcrit. Un agent dont le propre modèle lit les images n’utilise pas ce recours.

Laisse la sélection du modèle de lecture sur automatique pour suivre le catalogue disponible. Tale préfère un modèle de vision recommandé, puis une option accessible peu coûteuse. Le texte sous la sélection indique le choix actuel et sa raison.

Fixe un modèle si tu souhaites un choix stable. La sélection propose des modèles adaptés à la transcription. Si le modèle fixé devient indisponible, Tale revient à la sélection automatique. Vérifie le choix après une rotation des identifiants ou un changement de disponibilité.

## Expliquer un choix inattendu

Vérifie les rôles et équipes du membre, le choix explicite dans le chat, le défaut correspondant, la règle d’accès et la liste de modèles des identifiants fournisseur. Une entrée au catalogue ne prouve pas que l’organisation dispose d’identifiants utilisables. Les plafonds de coût et de tokens continuent de s’appliquer via [Politiques et limites](/platform/admin/governance/policies-and-limits).
