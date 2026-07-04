---
title: Créer un agent
description: Du dialogue Create-agent vide à un agent publié — choisir le modèle, écrire les instructions, lier des connaissances, activer des outils, et vérifier dans Chat.
---

Ce tutoriel parcourt du dialogue **Create agent** vide à un agent que tu publies et utilises. Le résultat est un agent fonctionnel qui connaît son domaine, qui a les outils pour agir sur ce qu'il lit, et qui est joignable depuis n'importe quel chat de ton organisation. Environ quinze minutes si tu as déjà un fournisseur de modèles configuré ; plus si tu dois en configurer un en plus.

Il te faut le rôle Éditeur ou supérieur et un fournisseur de modèles configuré sous **Paramètres > Providers** ; le premier prérequis ci-dessous renvoie vers le walk-through de configuration si ce n'est pas le cas. La voix qu'utilise ce tutoriel est la même que celle que construit la page [Concepts d'agent](/fr/platform/agents/concepts) — lis cette page une fois avant d'écrire les instructions de ton premier agent.

## Avant de commencer

Vérifie deux choses :

- Un fournisseur de modèles est configuré sous **Paramètres > Providers**. Les utilisateurs Cloud en ont un par défaut ; les utilisateurs auto-hébergés suivent [Configuration → providers](/fr/self-hosted/configuration/providers).
- Tu détiens le rôle Éditeur ou supérieur dans cette organisation. Regarde **Paramètres > Personnes** si tu n'es pas sûr ; le rôle est sur ta ligne de membre.

Le tutoriel utilise un agent de tri de support comme exemple fil rouge — celui que [Concepts d'agent](/fr/platform/agents/concepts) introduit. Substitue ton propre domaine librement ; les étapes ne dépendent pas de l'exemple.

## Étape 1 — Choisir le modèle primaire

Ouvre **Agents** dans la sidebar et clique **Create agent**. Le dialogue te dépose sur l'onglet **Instructions & model**. Ouvre le sélecteur de modèles et le champ de recherche attend un nom de modèle ou une famille — tape « gpt », « claude » ou « llama » pour filtrer. Choisis un modèle capable en primaire ; le comportement de l'agent s'appuie fortement sur ce choix. Le sélecteur expose aussi un slot de fallback — choisis un modèle plus petit, moins cher, pour que l'agent continue de tourner quand le primaire est rate-limité.

## Étape 2 — Écrire les instructions

Le champ d'instructions est du markdown brut. Trois conseils de terrain :

- **Ouvre par la voix.** Un paragraphe qui nomme qui est l'agent, à qui il répond, et le ton qu'il prend. Le modèle traite ça comme le signal le plus fort.
- **Nomme les cas de refus explicitement.** Trois ou quatre phrases qui disent ce que l'agent refuse de faire et ce qu'il dit quand il refuse.
- **Résiste à la tentation de spécifier chaque comportement.** Les longues instructions se diluent dans les longues conversations. Si un comportement appartient au code, appuie-toi sur un outil ; s'il appartient aux données, appuie-toi sur les connaissances.

Enregistre l'agent avec le bouton **Save** en haut à droite. Le dialogue reste ouvert avec l'ID de l'agent visible dans l'URL — tu peux revenir affiner.

## Étape 3 — Lier des sources de connaissances

Passe à l'onglet **Knowledge**. Les connaissances sont ce que l'agent peut regarder ; rien n'est lié par défaut. Clique **Agent knowledge** et choisis parmi les documents, clients, produits, fournisseurs ou sites web de l'organisation. L'agent récupérera depuis ces sources à la réponse et citera ce qu'il a utilisé.

Deux précautions :

- Lie le plus petit ensemble utile. Un document lié mais rarement récupéré coûte quand même des cycles d'embedding.
- Les connaissances liées ici s'ajoutent à tout ce que les instructions de l'agent lui disent de récupérer directement. Les instructions nomment la politique ; la liaison nomme la surface.

## Étape 4 — Activer les outils

Passe à l'onglet **Tools**. Les outils sont ce que l'agent peut faire au-delà de générer du texte. Les bascules sont groupées par famille — web, fichiers, RAG, exécution de code, sous-agents, workflows, MCP, intégrations, entrée humaine. Active ce dont l'agent a besoin et laisse le reste éteint. Chaque bascule élargit la frontière de confiance, alors sois économe.

Les bascules qui méritent une attention particulière :

- **Run code** est gouvernée par la [politique run-code](/fr/platform/admin/governance/run-code-policy) de l'organisation. Si la politique de ton organisation l'interdit, la bascule apparaît désactivée.
- Les agents de chat lancent d'eux-mêmes des **workers** ciblés pour des sous-tâches ponctuelles ; [Workers d'agent](/fr/platform/agents/delegation) couvre quand c'est le bon mouvement.

## Étape 5 — Publier et essayer

De retour sur **Instructions & model**, bascule **Visible in chat** sur on et clique **Save**. Un toast confirme **Agent saved**. Ouvre un nouveau chat, choisis l'agent dans le sélecteur, et envoie un message qui sollicite les connaissances et outils que tu as liés. Si l'agent répond comme tu l'as écrit, c'est fini ; sinon, l'onglet **History** sur l'agent montre chaque changement que tu as fait et te laisse comparer ou restaurer.

## Dépannage

- **Save est grisé.** Le champ d'instructions est vide ou le sélecteur de modèles n'a pas de sélection. Les deux sont obligatoires.
- **L'agent n'apparaît pas dans le sélecteur du chat.** Confirme que **Visible in chat** est activé. Si oui, confirme que l'utilisateur qui choisit l'agent y a accès — les agents de Projet n'apparaissent pas hors de leur Projet.
- **Les réponses disent « pas d'accès » à un outil.** Une politique de gouvernance limite l'outil. La définition de l'agent l'autorise ; l'exécution refuse. Regarde [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).
- **La récupération ne retourne rien.** Les sources de connaissances que tu as liées ne contiennent peut-être pas ce que le prompt a demandé. Vérifie que la source est indexée en l'ouvrant depuis [Documents](/fr/platform/knowledge/documents) et en confirmant que les chunks s'affichent.

## Où ça s'utilise

Créer un agent est le moment où le reste de la plateforme commence à sentir comme Tale plutôt que comme un chat générique. La marche suivante naturelle est [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge) — même forme, mais lie un dossier de PDF et exerce la pipeline de citations de bout en bout. Pour voir un agent confier une sous-tâche à un worker, [Confier du travail à un worker](/fr/tutorials/editor/delegate-between-agents) est le parcours.
