---
title: Contenu et modèles
description: Contrôles au niveau modèle — quels modèles sont autorisés par rôle ou équipe, et le modèle par défaut sur lequel chaque groupe d’utilisateurs atterrit. Les Administrateurs et Propriétaires lisent ceci quand une règle de conformité épingle une charge à un modèle approuvé ou quand une équipe a besoin d’un défaut moins cher.
---

Contenu et modèles est la surface où tu décides quels LLMs les personnes de ton organisation peuvent atteindre et celui sur lequel chaque groupe atterrit par défaut. Elle associe une liste d’autorisation ou de blocage par scope (organisation, équipe, rôle) à une règle de modèle par défaut que le résolveur applique quand aucun choix explicite ne l’a outrepassée. Les Administrateurs et Propriétaires lisent cette page quand une règle de conformité épingle une charge à un modèle approuvé, quand une équipe doit avoir un modèle par défaut moins cher que le reste de l’organisation, ou quand un nouveau modèle d’un fournisseur existant doit être rendu joignable.

<Frame caption="Paramètres > Gouvernance > Modèles — les règles de modèle par défaut par scope, avec l’accès aux modèles et le modèle de vision en dessous.">

![La page de gouvernance Contenu et modèles montrant les champs de préfixe et de suffixe de prompt système obligatoires remplis des règles maison de l’organisation, au-dessus d’un tableau de modèles par défaut qui porte trois règles — un défaut pour tous les utilisateurs et une règle de rôle pour Développeur et pour Membre, chacune épinglée à un modèle OpenRouter.](/images/platform/governance-content-models.webp)

</Frame>

## Un défaut mis en pratique

Pour régler le modèle par défaut du rôle Éditeur, ouvre **Paramètres > Gouvernance > Modèles** et clique sur **Ajouter une règle** sous **Modèles par défaut**. Choisis **Rôle** comme scope, **Éditeur** comme cible, puis choisis le fournisseur et le modèle. Enregistre et le prochain chat qu’un Éditeur lance sans choix de modèle explicite atterrit sur le modèle de la règle. Les scopes plus étroits l’emportent — une règle équipe bat une règle rôle bat le défaut org.

## Les deux couches

**Accès au modèle** est la liste d’autorisation ou de blocage qui régit quels modèles un scope peut utiliser tout court. Un modèle absent de la liste d’autorisation est refusé à la requête — le tour revient avec un refus qui nomme la politique, même si un agent l’a épinglé. Va vers la liste d’autorisation quand un régulateur nomme les modèles approuvés ; va vers la liste de blocage quand un seul modèle doit être hors-limites partout ailleurs.

**Modèles par défaut** est la règle du résolveur qui choisit le modèle quand rien d’autre ne l’a fait — pas de choix explicite, pas de surcharge par conversation. Le défaut s’applique quand un chat tourne en **Auto** : le résolveur prend le défaut de gouvernance avant le choix automatique, et si ce défaut est lui-même refusé par l’accès aux modèles, il le saute et choisit automatiquement un modèle que l’appelant a le droit d’utiliser.

## Scopes et priorité

Les deux couches portent un scope : toute l’organisation, une équipe ou un rôle. Le résolveur évalue du plus étroit au plus large — une règle équipe l’emporte sur une règle rôle, qui l’emporte sur le défaut org. La couche d’accès au modèle se combine avec la couche de modèle par défaut ; le défaut que le résolveur choisit doit aussi passer le contrôle d’accès, sinon le résolveur le saute et choisit automatiquement un modèle que l’appelant a le droit d’utiliser.

## Avertissements liste d’autorisation et liste de blocage

L’éditeur de modèles par défaut affiche un avertissement quand une règle nomme un modèle que la liste d’autorisation du même scope n’autorise pas, ou quand la liste de blocage du même scope le bloque. L’avertissement n’empêche pas d’enregistrer — le résolveur saute le défaut refusé à la requête — mais il signale l’incohérence pour que tu corriges l’une ou l’autre.

## Le modèle qui lit les images

Tous les modèles ne voient pas. Quand un agent tournant sur un modèle texte seul ouvre une capture d’écran, une facture scannée ou une diapositive rendue, Tale confie cette image à un second modèle et rend la transcription à l’agent. Tout passe par la passerelle, donc aucune clé de fournisseur n’entre dans le sandbox — et un modèle qui lit déjà les images se passe entièrement du détour.

**Modèle pour les images** décide qui fait ce travail. Laisse-le sur **Automatique** et Tale choisit à ta place : d’abord un modèle recommandé, sinon le moins cher que tes accès atteignent. La ligne sous le sélecteur nomme toujours le modèle qui lit les images en ce moment, et pourquoi celui-là — « quel modèle lit nos images » n’est donc jamais une devinette.

Fixe un modèle quand tu veux que ce choix cesse de bouger. Automatique lit un catalogue de fournisseur vivant : le modèle le moins cher change à chaque nouvelle publication, alors qu’un modèle fixé tient la ligne sur celui que tu as testé. Seuls les modèles capables de transcrire sont proposés — les générateurs de médias et les accès gratuits sont écartés, car les deux acceptent une image puis refusent la requête. Si un modèle fixé devient inatteignable — accès renouvelé, liste d’autorisation resserrée, retrait par le fournisseur — Tale le consigne et revient à Automatique plutôt que de laisser tes agents sans lecture.

## Où cela s’inscrit

Contenu et modèles est la porte que chaque chat et chaque agent franchissent à la requête. Associer accès au modèle et modèles par défaut permet de livrer une posture de conformité serrée sans forcer chaque auteur d’agent à se souvenir du modèle approuvé ce trimestre. La page compagnon est [politiques et limites](/fr/platform/admin/governance/policies-and-limits) — elle couvre les plafonds de coût et de requêtes qui s’appliquent au-dessus des choix de modèle faits ici.
