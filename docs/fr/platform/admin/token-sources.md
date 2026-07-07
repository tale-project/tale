---
title: Sources de jetons
description: Paramètres > Sources de jetons est l'endroit où les Administrateurs branchent un agent bring-your-own-key sur un courtier externe qui distribue un pool d'identifiants LLM. L'agent tire un jeton par run et bascule sur un autre en cas d'erreur de débit ou d'auth, pour qu'une clé bridée ou expirée ne bloque jamais le run.
---

Paramètres > Sources de jetons sert au cas où une seule clé API statique ne suffit pas : au lieu de lier un agent bring-your-own-key à un secret unique, tu le branches sur un courtier externe qui renvoie un _pool_ d'identifiants. L'agent choisit un jeton par run et, si ce jeton revient bridé ou expiré, bascule sur un autre du même pool — jusqu'à trois tentatives avant l'échec du run. C'est la couche de rotation sous un [agent externe](/fr/platform/agents/external-agent) BYO, rien de plus : les agents managés continuent d'utiliser le gateway de l'org et ignorent entièrement cette page.

Cette page couvre l'UI : ce que montre la liste, les champs quand tu ajoutes une source, comment une source se lie à un agent, et ce que fait vraiment la rotation au moment du run. Le secret d'auth du courtier est en écriture seule ici ; ses formes fichier et variable d'environnement vivent un onglet plus loin sous la référence de [configuration self-hosted](/fr/self-hosted/configuration/environment-reference).

## Ce que la liste montre

Ouvre **Paramètres > Sources de jetons** et tu atterris sur le tableau des sources que l'org a configurées. Chaque ligne nomme la source, montre l'URL du point de terminaison de son courtier, et montre la variable d'environnement cible sous laquelle le moteur de rotation injecte le jeton choisi (pour un agent Claude Code c'est généralement `CLAUDE_CODE_OAUTH_TOKEN`). La recherche filtre par nom ou point de terminaison ; le menu **···** d'une ligne la modifie ou la supprime, et sélectionner des lignes fait apparaître une barre de suppression groupée.

Une source n'est que de la config — elle stocke _comment_ joindre le courtier et _comment_ lire sa réponse, jamais les jetons eux-mêmes. Les jetons sont récupérés frais auprès du courtier à chaque démarrage de run d'agent, donc la liste ne se périme jamais face au pool courant du courtier.

## Ajouter une source

Clique sur **Nouvelle source de jetons** et remplis le panneau latéral. Le formulaire est organisé en quatre sections :

- **Identité** — un `Identifiant` (en minuscules, stable ; il nomme le fichier de config et le secret) et un nom affiché.
- **Connexion** — l'**URL du point de terminaison** du courtier avec sa **Méthode HTTP**, et comment Tale s'authentifie _auprès du courtier_ : aucune, un jeton Bearer, ou un en-tête personnalisé. Pour Bearer ou en-tête tu saisis le secret du courtier. Le secret est en écriture seule — il n'est jamais renvoyé au navigateur, donc à la modification le champ apparaît vide et le laisser vide conserve la valeur stockée.
- **Correspondance de la réponse** — comment lire le JSON du courtier. Le **Chemin des jetons** est un JSONPath vers le tableau de jetons (ex. `$.tokens`) ; le **Champ du jeton** nomme la propriété qui porte chaque jeton. Les **Champ de statut (facultatif)** / **Valeur de statut actif (facultatif)** filtrent les jetons inactifs, et le **Champ d'expiration (facultatif)** (un timestamp ISO ou des secondes/ms epoch) écarte ceux déjà expirés avant que le pool soit utilisé.
- **Liaison** — la **Variable d'environnement cible** sous laquelle le jeton est injecté et la **Stratégie de sélection** : **Aléatoire** (le défaut, choisit uniformément par run) ou **Première** (déterministe).

Avant d'enregistrer, appuie sur **Tester le courtier** dans la section Correspondance de la réponse : Tale interroge le courtier côté serveur avec la config en cours et prévisualise la correspondance — combien de jetons utilisables les chemins produisent, combien d'éléments ont été écartés comme inactifs, expirés ou sans champ de jeton, et la prochaine expiration. Un JSONPath erroné apparaît ainsi dans le formulaire plutôt qu'au moment du run de l'agent. Enregistrer valide la config, l'écrit, et rend la source immédiatement sélectionnable dans l'onglet Environnement de l'agent.

## Lier une source à un agent

Une source de jetons ne fait rien tant qu'un agent n'y tire pas. Ouvre l'onglet **Environnement** de l'agent, ajoute une ligne, et change son type de **Valeur** / **Secret** vers **Source de jetons** — un second menu déroulant te laisse alors choisir quelle source. Le nom de variable de la ligne est la variable d'environnement où atterrit le jeton choisi, surchargeant le défaut propre à la source pour cet agent.

La liaison ne prend effet que pour les agents bring-your-own-key. Un agent managé s'authentifie à travers le gateway de l'org, donc une ligne source de jetons sur l'un d'eux est ignorée avec un avertissement plutôt que de changer en silence comment l'agent est facturé.

## Ce que fait la rotation au moment du run

Quand un agent BYO lié démarre, Tale récupère le pool du courtier, filtre les jetons inactifs et expirés, et injecte un choix. Si le run finit sur un échec rotatable — une erreur de débit (`429`/`529`) ou une erreur d'auth (`401`/`403`) — Tale échange un autre jeton du pool et relance, jusqu'à trois jetons au total, tant qu'il reste assez de la fenêtre du run. Une erreur d'auth est coupée court tôt plutôt que laissée à orager les retries internes du fournisseur. Si chaque jeton essayé échoue de la même façon, le run échoue vite avec une erreur claire au lieu de boucler.

Si le courtier est injoignable, renvoie du JSON malformé, ou ne donne aucun jeton actif et non expiré, le run échoue immédiatement — il n'y a aucun fallback silencieux vers une clé statique, parce qu'un agent BYO n'en a aucune.

## Retirer une source

Ouvre le menu **···** et choisis **Supprimer**, ou sélectionne des lignes et utilise la barre de suppression groupée. Supprimer retire la config et son secret stocké. Tout agent encore lié à la source supprimée échoue son prochain run avec une erreur de configuration plutôt que de basculer ailleurs, donc re-pointe ou retire la liaison dans l'onglet Environnement de l'agent d'abord.

## Où cela s'inscrit

Les sources de jetons se tiennent à côté des [fournisseurs IA](/fr/platform/admin/providers) comme la seconde façon dont Tale acquiert des identifiants de modèle : les fournisseurs sont le chemin managé, routé par gateway ; les sources de jetons sont le chemin BYO, à rotation par courtier, pour les agents qui apportent leurs propres clés. La lecture suivante naturelle est la page [agent externe](/fr/platform/agents/external-agent) pour comment un agent BYO est construit, et la [référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) pour la forme `TALE_TOKEN_SOURCE_` du secret du courtier quand tu configures une source depuis des fichiers plutôt que l'UI.
