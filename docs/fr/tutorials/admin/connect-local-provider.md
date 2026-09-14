---
title: Connecter un serveur de modèles local
description: Préparer l’endpoint avec l’opérateur, ajouter un accès fournisseur et vérifier une requête de modèle.
---
Connecte un serveur local pour utiliser un modèle hébergé sur l’infrastructure de ton organisation. Il te faut un endpoint d’inférence actif, l’identifiant exact du modèle, l’accès à **Paramètres > Fournisseurs IA** et un opérateur capable de configurer la politique réseau du déploiement. Tale n’installe pas le serveur et ne charge pas ses modèles.

Un fournisseur de chat local détermine la destination de cette requête de modèle. Les embeddings, la parole, les outils et les autres fournisseurs ont leurs propres parcours. Cette connexion ne maintient donc pas automatiquement tout le trafic de l’organisation sur son réseau.

## Préparer l’endpoint avec l’opérateur

Demande le nom du fournisseur, le format d’API compatible, l’URL de base, les identifiants des modèles et la méthode d’authentification. L’adresse doit être joignable depuis les processus backend, pas seulement depuis ton navigateur. Dans un conteneur, `localhost` désigne ce conteneur.

Pour un déploiement auto-hébergé, l’opérateur suit [Endpoints de fournisseurs locaux](/self-hosted/configuration/providers#endpoints-de-fournisseurs-locaux). Les hôtes privés exigent une activation explicite dans le déploiement. Les endpoints publics nécessitent HTTPS ; les adresses privées prises en charge peuvent utiliser HTTP si l’opérateur accepte cette configuration réseau. Un nom de proxy ne contourne pas la politique des hôtes privés.

Ollama, LM Studio et vLLM peuvent exposer des API compatibles, mais cela dépend des fonctions activées et du modèle. Vérifie la liste réelle des modèles et un appel de chat pris en charge avant de configurer Tale.

## Ajouter l’accès de l’organisation

1. Ouvre **Paramètres > Fournisseurs IA** et choisis **Ajouter des identifiants**.
2. Sélectionne la définition de fournisseur préparée par l’opérateur.
3. Donne un nom utile à cet accès et choisis une méthode d’authentification proposée.
4. Saisis le vrai jeton du serveur ou la référence de variable d’environnement fournie. Si le serveur ignore l’authentification, conviens de la valeur de remplacement avec son opérateur ; ne réutilise pas un autre secret.
5. Vérifie la **Liste de modèles autorisés**, puis enregistre. Définis cet accès par défaut pour le fournisseur si les appels ordinaires doivent l’utiliser.

<Frame caption="L’accès fournisseur appartient à l’organisation ; sa valeur par défaut et sa liste de modèles influencent la sélection.">

![La page Fournisseurs IA présente un accès fournisseur avec son indicateur par défaut.](/images/get-started/settings-providers.webp)

</Frame>

Avec un catalogue, une liste vide autorise les modèles de ce catalogue. Sans catalogue, il faut des identifiants de modèle explicites. Utilise **Actualiser les catalogues** après un changement des modèles disponibles sur le serveur. La politique d’accès aux modèles de l’organisation s’applique aussi.

## Prouver qu’une requête atteint le serveur

Commence un chat et sélectionne explicitement le modèle local. Garde **Auto** pour plus tard : ce contrôle exige un fournisseur et un modèle connus. Envoie une courte demande sans contenu sensible, comme « Réponds par prêt. »

Demande à l’opérateur de confirmer la requête dans les journaux du serveur d’inférence prévu. Vérifie que Tale affiche une réponse complète. Enregistrer un accès ou obtenir une liste de modèles prouve moins qu’une génération terminée. Sa durée dépend du modèle, du matériel et de la charge.

## Comprendre un échec

| Symptôme | Vérification |
| --- | --- |
| Fournisseur absent de la sélection | Emplacement et validation de sa définition, organisation concernée. |
| Hôte privé refusé | Activation explicite des fournisseurs privés dans le déploiement ; un nom DNS ne change pas la règle. |
| Liste de modèles vide | Découverte des modèles, modèles chargés, liste autorisée et politique de modèles. |
| Erreur de connexion ou de certificat | Accès réseau depuis le backend, nom du conteneur et confiance TLS. |
| Modèle refusé ou aucune réponse | Identifiant exact, authentification, compatibilité de l’API et capacité du serveur. |

[Fournisseurs IA](/platform/admin/providers) explique le remplacement des accès et les valeurs par défaut. Documente l’endpoint et le modèle dans les consignes d’exploitation pour qu’un autre administrateur puisse répéter le test après une modification du serveur.
