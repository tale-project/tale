---
title: Modèles
description: Définis les modèles par défaut, limite leur accès et choisis des modèles distincts pour les images et la transcription audio.
---

En tant qu’admin ou propriétaire, utilise **Paramètres > Gouvernance > Modèles** pour choisir les modèles proposés au départ et ceux que les membres peuvent utiliser. Les valeurs par défaut orientent le choix ; les règles d’accès imposent une restriction. Configure d’abord les [identifiants fournisseur](/fr/platform/admin/providers) pour rendre les modèles souhaités disponibles.

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

Pour le chat, l’accès est vérifié à l’utilisation, même pour un modèle choisi explicitement ou fixé. Le modèle par défaut doit aussi passer cette vérification. S’il est refusé, la sélection automatique peut se rabattre sur un modèle autorisé. L’éditeur signale les contradictions entre modèle par défaut et accès. Corrige-les pour que le modèle par défaut prévu soit réellement utilisé.

<Tip>
Après un changement, teste les deux cas pour le membre concerné : un modèle autorisé doit fonctionner et un modèle interdit doit être refusé. Tester uniquement avec un compte admin ne prouve pas une règle propre à un rôle.
</Tip>

## Choisir le modèle qui lit les images

Un agent textuel a besoin d’aide pour lire une image, comme une capture d’écran ou une page scannée. La section du modèle de vision choisit celui qui la décrit pour l’agent. Un agent dont le propre modèle lit les images n’utilise pas ce recours.

Laisse la sélection du modèle de lecture sur automatique pour suivre le catalogue disponible. Tale préfère un modèle de vision recommandé, puis une option accessible peu coûteuse. Le texte sous la sélection indique le choix actuel et sa raison.

Fixe un modèle si tu souhaites un choix stable. La sélection propose des modèles capables de lire les images. Si le modèle fixé devient indisponible, rétablis son accès fournisseur ou choisis explicitement **Automatique**, puis enregistre. Tale ne remplace pas silencieusement un modèle fixé. Vérifie le choix après une rotation des identifiants ou un changement de disponibilité.

## Choisir le modèle de transcription audio

**Modèle de transcription audio** contrôle la transcription serveur des pièces jointes audio et vidéo, le recours à l’audio pour les liens vidéo sans sous-titres utilisables et la dictée dans les navigateurs sans reconnaissance vocale intégrée. La reconnaissance vocale du navigateur utilise son propre service et garde la priorité lorsqu’elle est prise en charge.

<Frame caption="La transcription audio a sa propre sélection à l’échelle de l’organisation, automatique ou fixée sur un modèle.">

![La section de transcription audio affiche la sélection automatique et indique le modèle actuellement utilisé par le serveur.](/images/platform/governance-content-models.webp)

</Frame>

Si ton accès OpenRouter par défaut est actif, ses modèles de reconnaissance vocale sont aussi disponibles ici. Tale les découvre dans le catalogue OpenRouter. Vérifie que les modèles autorisés pour cet accès incluent le modèle de transcription souhaité, puis utilise **Automatique** ou sélectionne ce modèle explicitement.

1. Dans **Modèle qui transcrit l'audio**, laisse **Automatique** pour que Tale choisisse un modèle compatible disponible, ou sélectionne un fournisseur et un modèle précis.
2. Enregistre les changements en attente dans l’en-tête. Avant l’enregistrement, la sélection reste un brouillon ; abandonne-le pour conserver le réglage enregistré.
3. Vérifie le modèle actuel affiché sous la sélection. Teste un court enregistrement avant de compter sur cette configuration pour importer un fichier plus long.

Un changement de modèle s’applique aux nouvelles transcriptions ; les pièces jointes déjà traitées conservent leur texte. Importer à nouveau les mêmes octets réutilise le travail terminé pour la même cible de transcription, mais relance la transcription si le fournisseur ou le modèle cible diffère.

Une sélection explicite reste fixe. Si ce modèle devient indisponible, Tale le signale et ne passe pas à un autre modèle. Choisis un autre modèle disponible ou **Automatique**, puis enregistre. Si aucun modèle compatible n’est disponible, configure un accès actif dans [Fournisseurs IA](/fr/platform/admin/providers) et vérifie les modèles autorisés pour cet accès. Si Tale ne peut momentanément pas vérifier la configuration, réessaie plutôt que de changer de modèle pour cette raison.

Si la transcription serveur indisponible empêche un membre de dicter ou de joindre de l’audio ou de la vidéo, une boîte de dialogue explique le problème et peut être fermée. Selon ses droits, un lien mène aux réglages ou un message lui demande de contacter un admin. Une vérification de disponibilité ayant échoué temporairement peut être relancée. Pour gérer ce choix par la configuration du déploiement ou utiliser un endpoint audio personnalisé, consulte la [référence des fournisseurs auto-hébergés](/fr/self-hosted/configuration/providers#configurer-la-transcription-audio).

## Expliquer un choix inattendu

Vérifie les rôles et équipes du membre, le choix explicite dans le chat, le modèle par défaut correspondant, la règle d’accès et la liste de modèles des identifiants fournisseur. Une entrée au catalogue ne prouve pas que l’organisation dispose d’identifiants utilisables. Les plafonds de coût et de tokens continuent de s’appliquer via [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
