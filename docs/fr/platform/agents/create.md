---
title: Créer un agent
description: Du dialogue vide à un agent utilisable — nomme-le, écris ses instructions, accorde outils et skills, cadre ses connaissances et essaie-le dans le chat.
---

Ce parcours va d’un dialogue vide à un agent que tes collègues peuvent choisir. À l’arrivée, tu as une persona qui connaît son domaine, dispose des outils pour agir sur ce qu’elle lit, et reste joignable depuis n’importe quelle conversation de ton organisation. Compte une quinzaine de minutes.

L’exemple fil rouge est un agent de tri du support, celui-là même que présente [Concepts d’agent](/fr/platform/agents/concepts). Remplace-le par ton propre domaine sans hésiter : aucune étape ne dépend de l’exemple.

## Avant de commencer

Deux choses doivent être en place :

- Ton organisation dispose d’au moins un accès fournisseur sous **Paramètres > Fournisseurs**. L’agent lui-même ne nomme aucun modèle — c’est celui qui envoie le message qui le choisit dans le composer — mais le composer n’a rien à proposer tant qu’aucun accès n’existe. En Cloud, il y en a un par défaut ; en auto-hébergement, suis [Configuration → fournisseurs](/fr/self-hosted/configuration/providers).
- Tu as ici le rôle Editor ou plus. Vérifie sur [Membres et rôles](/fr/platform/admin/members-and-roles) si tu as un doute.

## Étape 1 — Le nommer et décider qui le voit

Ouvre **Agents** dans la barre latérale et crées-en un. Le dialogue demande un **Nom** — l’identifiant unique utilisé dans les liens et l’API, impossible à changer ensuite, donc parlant et en minuscules, `support-triage` plutôt que `agent2` — puis un **Nom affiché** sous lequel l’équipe le rencontre et une courte **Description**. Valide, et l’éditeur s’ouvre sur **Général**.

**Général** porte l’identité : le nom affiché, la description, une icône et la **visibilité** de l’agent. Garde-le privé tant que tu le façonnes, et toi seul l’atteins ; partage-le avec l’organisation, et chaque membre peut le choisir dans le composer. Un agent privé enregistre un propriétaire, en l’occurrence toi : un agent que personne ne possède et que personne ne voit ne serait joignable par personne.

## Étape 2 — Écrire les instructions

Ouvre **Instructions**. Le champ est du markdown simple, plafonné à 20 000 caractères, et il est placé en tête de chaque tour auquel l’agent répond. Trois conseils de terrain :

- **Commence par la voix.** Un paragraphe qui dit qui est l’agent, à qui il répond et sur quel ton. Le modèle en fait le signal le plus fort de tout le fichier.
- **Nomme explicitement les cas de refus.** Trois ou quatre phrases sur ce que l’agent ne fait pas, et sur ce qu’il répond quand il refuse.
- **Résiste à tout spécifier.** De longues instructions se diluent dans les longues conversations. Si un comportement relève du code, appuie-toi sur un outil ; s’il relève des documents, sur la portée des connaissances ; s’il se répète d’un agent à l’autre, sur un skill.

Les instructions se traduisent par langue, au même titre que le nom affiché et la description : un lecteur français obtient ainsi un agent briefé en français, plutôt qu’un briefing anglais qui répond en français.

## Étape 3 — Accorder outils et skills

Passe sur **Outils**. Les outils sont des interrupteurs individuels regroupés en cartes de catégorie — contacts, produits, fichiers, connaissances, automatisations et le reste — et chacun que tu accordes élargit ce que l’agent peut lire ou modifier en ton nom. Accorde le plus petit ensemble qui fait le travail et laisse le reste éteint. Les intégrations connectées et les automatisations de l’organisation figurent dans la même liste : en lier une revient exactement à accorder un outil de la plateforme.

<Frame caption="Le catalogue d’outils — une carte par catégorie, chacune comptant combien de ses outils l’agent a reçus.">

![L’onglet Outils de l’éditeur d’agent, défilé jusqu’aux cartes de catégorie, avec Connaissances à trois outils cochés sur quatre et Fichiers à sept sur sept, tandis que Conversations, Discussions, Analytique et Tâches et projets n’ont rien d’accordé.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Exécuter du code** lance des scripts dans une sandbox et relève de la [politique d’exécution de code](/fr/platform/admin/governance/run-code-policy) de l’organisation : l’interrupteur accorde l’outil, la politique décide de ce qu’une exécution a réellement le droit de faire.

</Note>

Ouvre ensuite **Skills** et lie les bundles que cet agent doit pouvoir déplier, dix au plus. Un skill est un paquet de connaissances issu de la [bibliothèque de skills](/fr/platform/workspace/skills) de l’organisation : lie ici le bundle maison sur le ton des réponses, et l’agent de tri formulera comme tous les autres. Laisse la liste vide et il ne déplie rien.

## Étape 4 — Cadrer ses connaissances

Passe sur **Connaissances**. Un seul réglage décide quel corpus la recherche de l’agent a le droit de lire : les **documents** téléversés par l’organisation, les pages **web** récupérées pour son compte, **tout** cela fusionné, ou **rien**, auquel cas aucune recherche ne lui est proposée. La recherche ne part que si l’agent la juge utile : rien n’est injecté dans une réponse sans qu’il l’ait demandé.

Resserre la portée quand tu le peux. Tout ce qui est dans le périmètre se dispute la pertinence à chaque question, et un agent pointé sur les documents qui comptent répond mieux qu’un agent pointé sur tout ce que possède l’organisation.

## Étape 5 — Enregistrer et essayer

Clique sur **Enregistrer**. Ouvre une nouvelle conversation, choisis l’agent, choisis un modèle dans le sélecteur du composer et envoie un message qui sollicite les connaissances et les outils que tu as accordés. Le modèle est ton choix à chaque tour : le même agent peut donc traiter une question bon marché sur un petit modèle et une question difficile sur un grand, sans la moindre modification.

S’il répond comme tu l’as écrit, c’est terminé. Sinon, le bouton **Historique** en haut à droite de l’éditeur conserve chaque version enregistrée et permet de comparer ou de restaurer — voir [Versions d’agent](/fr/platform/agents/versions).

## Dépannage

- **L’agent n’apparaît pas dans le sélecteur du chat.** Sa visibilité est encore privée, donc toi seul le vois. Partage-le avec l’organisation depuis l’onglet **Général**.
- **Les réponses ignorent les connaissances.** La portée est peut-être réglée sur rien, ou le document n’est pas encore indexé — ouvre-le depuis [Documents](/fr/platform/knowledge/documents) pour vérifier son état.
- **Un skill lié ne sert jamais.** Un modèle va chercher un skill par sa description, donc une description vague est ignorée : dis ce qu’il fait et quand il s’applique. Un bundle marqué `disable-model-invocation` attend délibérément qu’on le nomme.
- **Un appel d’outil est refusé à l’exécution.** Une politique de gouvernance filtre l’outil : l’agent a le droit de l’appeler, et l’exécution refuse. Regarde du côté de [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Où cela sert

Créer un premier agent, c’est le moment où le reste de la plateforme se met à ressembler à Tale plutôt qu’à une fenêtre de chat générique. Tu as écrit une persona, tracé ses limites avec deux listes d’autorisation et une portée de connaissances, et laissé à la conversation toute question sur le déroulé d’un tour. La suite naturelle est [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge) — même forme, mais avec un dossier de documents lié et la chaîne de citations exercée de bout en bout. Pour voir un agent confier une sous-tâche à un worker, parcours [Confier du travail à un worker](/fr/tutorials/editor/delegate-between-agents).
