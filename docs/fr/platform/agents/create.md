---
title: Créer un agent
description: Va du dialogue Créer un agent à un agent publié — nomme-le, écris ses instructions, cadre ses connaissances, accorde ses outils et vérifie-le dans le chat.
---

Ce tutoriel va d’un dialogue **Créer un agent** vide à un agent que tu publies et utilises. Le résultat est un agent qui connaît son domaine, a les outils pour agir sur ce qu’il lit, et reste joignable depuis n’importe quel chat de ton organisation. Compte une quinzaine de minutes si un fournisseur de modèles est déjà configuré ; davantage s’il faut aussi en mettre un en place.

Le tutoriel prend un agent de tri de support comme exemple filé — le même que celui qu’introduit [Concepts d’agent](/fr/platform/agents/concepts). Remplace librement par ton propre domaine ; les étapes ne dépendent pas de l’exemple.

## Avant de commencer

Vérifie que deux choses sont en place :

- Un fournisseur de modèles est configuré sous **Paramètres > Fournisseurs**. Les utilisateurs Cloud en ont un par défaut ; les opérateurs auto-hébergés suivent [Configuration → fournisseurs](/fr/self-hosted/configuration/providers). Sans lui, le dialogue t’arrête : un agent a besoin d’un modèle pour tourner.
- Tu détiens le rôle Éditeur ou supérieur dans cette organisation. En cas de doute, vérifie ta ligne de membre sous **Paramètres > Organisation**.

## Étape 1 — Créer l’agent

Ouvre **Agents** dans la barre latérale et clique sur **Créer un agent**, puis choisis **Vierge** (le menu propose aussi **À partir d'un modèle** et **Téléverser un fichier** pour importer du JSON d’agent). Le dialogue demande quatre choses : un **Nom** — l’identifiant unique utilisé dans les liens et l’API, que tu ne peux plus changer ensuite ; utilise uniquement des lettres minuscules, des chiffres, des tirets et des underscores, par exemple `seo-writer` — un **Nom d'affichage** que tes coéquipiers voient dans le chat, une **Description**, et la liste **Modèle**. Le premier modèle est celui par défaut et les suivants sont des fallbacks ; glisse pour réordonner ou ajoutes-en d’autres à tout moment. Clique sur **Continuer** et l’éditeur s’ouvre sur l’onglet **Général**.

<Frame caption="La liste des agents — Créer un agent se trouve en haut à droite.">

![La liste des agents avec le dossier chat déplié, montrant les lignes Assistant et Automation Assistant avec leurs modèles par défaut et le nombre d’outils.](/images/platform/agents-list-expanded.webp)

</Frame>

## Étape 2 — Écrire les instructions

Ouvre **Instructions et modèles**. Le champ **Instructions système** est du markdown pur, avec **Parcourir les prompts** pour partir de la bibliothèque de prompts de l’organisation et des variables de template résolues à l’exécution. Trois conseils venus du terrain :

- **Ouvre par la voix.** Un paragraphe qui nomme qui est l’agent, à qui il répond et quel ton il adopte. Le modèle traite cela comme le signal le plus fort.
- **Nomme explicitement les cas de refus.** Trois ou quatre phrases qui disent ce que l’agent refuse de faire et ce qu’il dit quand il refuse.
- **Résiste à l’envie de tout spécifier.** De longues instructions se diluent dans les longues conversations. Si un comportement relève du code, appuie-toi sur un outil ; s’il relève des données, appuie-toi sur les connaissances.

Le même onglet contient la liste de modèles fixée dans le dialogue — le premier modèle est le primaire, et chaque modèle en dessous est le fallback suivant quand celui du dessus est indisponible.

<Frame caption="Instructions et modèles — le prompt système au-dessus, la liste ordonnée de modèles en dessous.">

![L’onglet Instructions et modèles de l’éditeur d’agent, montrant le champ d’instructions système avec ses onglets de langue et une liste ordonnée de cinq modèles avec leurs contrôles de réordonnancement.](/images/platform/agent-editor-instructions.webp)

</Frame>

## Étape 3 — Cadrer ses connaissances

Passe à l’onglet **Base de connaissances**. Choisis un **Mode de récupération** — **Outil** laisse l’agent chercher à la demande, **Contexte** injecte les connaissances pertinentes dans chaque réponse, **Les deux** fait les deux, **Désactivé** coupe la base de connaissances. Cadre ensuite ce qui est interrogeable : **Inclure les documents de l'équipe**, **Inclure les documents de l'organisation**, et les **Documents de l'agent** que tu téléverses pour cet agent seul. Lie le plus petit ensemble utile — tout ce que tu inclus concourt à la récupération à chaque question.

<Frame caption="L’onglet Base de connaissances — le mode de récupération, les portées de documents et les documents d’organisation indexés.">

![L’onglet Base de connaissances de l’éditeur d’agent montrant les options du mode de récupération, les interrupteurs des documents d’équipe et d’organisation, et trois documents d’organisation indexés.](/images/platform/agent-editor-knowledge.webp)

</Frame>

## Étape 4 — Accorder les outils

Passe à l’onglet **Outils**. Les outils sont des cases à cocher individuelles groupées par catégorie — clients, produits, fichiers, workflows et plus — plus un sélecteur de mode **Recherche web** en haut. Accorde ce dont l’agent a besoin et laisse le reste éteint ; chaque case cochée élargit la frontière de confiance.

<Frame caption="L’onglet Outils — une liste de cases par outil, groupée par catégorie, avec le mode de recherche web en haut.">

![L’onglet Outils de l’éditeur d’agent montrant les options du mode de recherche web et des cases à cocher par outil groupées sous les catégories des clients, des produits, des fournisseurs et des connaissances.](/images/platform/agent-editor-tools.webp)

</Frame>

<Note>

**Exécuter du code** (sous **Système**) exécute des scripts dans une sandbox et relève de la [politique run-code](/fr/platform/admin/governance/run-code-policy) de l’organisation — la case accorde l’outil, la politique décide de ce qu’une exécution peut faire.

</Note>

## Étape 5 — Le rendre visible et l’essayer

De retour sur **Général**, active **Visible dans le chat** et clique sur **Enregistrer**. Un toast confirme **Agent enregistré**. Ouvre un nouveau chat, choisis l’agent dans le sélecteur et envoie un message qui sollicite les connaissances et les outils accordés. Si l’agent répond comme tu l’as écrit, c’est terminé ; sinon, le bouton **Historique** en haut à droite de l’éditeur montre chaque version enregistrée et te laisse comparer ou restaurer.

## Dépannage

- **L’enregistrement échoue avec un avertissement de modèle.** L’agent n’a aucun modèle — ajoutes-en un sur l’onglet Instructions et modèles avant d’enregistrer.
- **L’agent n’apparaît pas dans le sélecteur du chat.** Confirme que **Visible dans le chat** est activé ; éteint, l’agent n’est joignable que par délégation. S’il est activé, regarde la section **Accès** — un agent assigné à une équipe n’est utilisable que par cette équipe.
- **Les réponses ignorent les connaissances.** Le mode de récupération est peut-être **Désactivé**, les interrupteurs de portée éteints, ou le document pas encore **Indexé** — ouvre-le depuis [Documents](/fr/platform/knowledge/documents) pour vérifier.
- **Un appel d’outil est refusé à l’exécution.** Une politique de gouvernance verrouille l’outil : la définition de l’agent l’autorise, l’exécution le refuse. Regarde [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Où ça sert ensuite

Créer un agent est le moment où le reste de la plateforme commence à sentir comme Tale plutôt que comme un chat générique. La marche suivante naturelle est [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge) — même forme, mais lie un dossier de PDF et exerce la pipeline de citations de bout en bout. Pour voir un agent confier une sous-tâche à un worker, [Confier du travail à un worker](/fr/tutorials/editor/delegate-between-agents) est le parcours.
