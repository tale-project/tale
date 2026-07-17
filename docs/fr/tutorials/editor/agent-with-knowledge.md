---
title: Construire un agent avec du savoir
description: Lie des documents de la base de connaissances à un agent neuf pour que ses réponses citent les documents au lieu de deviner depuis la mémoire paramétrique du modèle.
---

Un agent avec du savoir est la forme vers laquelle tu te tournes quand le modèle doit répondre à partir de documents spécifiques — ton manuel produit, tes politiques, les notes d'appel du trimestre dernier — et non depuis ce qu'il a appris durant l'entraînement. L'agent récupère des chunks dans les sources liées au moment de la réponse et les cite. Ce parcours mène un agent neuf de « je veux qu'il connaisse mes docs » à « la réponse cite le bon document » sur une seule instance.

Il te faut un rôle Éditeur, la capacité de charger des documents dans la base de connaissances, et environ trois documents à lier. Le côté conceptuel vit dans [Savoir de l'agent](/fr/platform/agents/knowledge) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Ton rôle est au moins Éditeur — l'édition d'agent est verrouillée à Éditeur et au-dessus. Tu as au moins trois documents prêts à charger (PDF, DOCX, Markdown — tout ce que la base de connaissances accepte). Tu as un fournisseur configuré pour que l'agent puisse tourner — sans cela, la réponse de test à la fin échoue sur l'appel au modèle.

## Étape 1 — Charger les documents dans la base de connaissances

Le premier geste est de mettre les documents dans la base de connaissances de Tale. Des documents hors de la base ne se lient pas ; l'agent ne voit que des sources qu'il peut nommer.

Ouvre **Savoir > Documents** et clique **Charger**. Glisse les trois documents, donne-leur des titres parlants, et attends que la colonne de statut affiche **Prêt** pour chacun. Le statut parcourt `chargé → en traitement → prêt` ; le traitement découpe le document en chunks et calcule les embeddings. Un PDF typique atteint **Prêt** en une ou deux minutes.

Si un document reste sur `en traitement` plus de cinq minutes, ouvre sa ligne pour voir l'erreur — la cause la plus fréquente est un format non supporté (PDF en images, fichiers protégés par mot de passe) ou un fichier plus gros que la limite d'upload de l'organisation.

## Étape 2 — Créer l'agent

Un document lié s'accroche à un agent, donc l'agent doit exister d'abord. Ouvre **Agents > Nouvel agent** et remplis les quatre boutons comme base :

- **Nom** — `Docs Q&A`
- **Instructions** — `You answer questions strictly from the bound documents. If you cannot find the answer in the documents, say so explicitly. Cite the document title for every claim.`
- **Tools** — active **RAG** ; tout le reste désactivé
- **Modèle** — celui que l'organisation utilise par défaut

Enregistre et publie. L'agent existe désormais mais n'a aucun savoir — il refusera toute question, faute de source à trouver.

## Étape 3 — Lier les documents

La liaison est la couture qui donne à l'agent un accès retrieval à un sous-ensemble de la base de connaissances. Ouvre l'onglet **Savoir** de l'agent et clique **Savoir de l'agent**. Choisis les trois documents de l'Étape 1 et enregistre.

L'onglet Savoir liste maintenant trois sources liées. Le tool RAG de l'agent ne récupère que parmi ces trois ; rien d'autre dans la base de connaissances n'est atteignable depuis cet agent, pas même les autres documents de la même bibliothèque.

## Étape 4 — Poser une question et vérifier la citation

Ouvre un chat avec `Docs Q&A` et pose une question à laquelle un des documents répond. La réponse arrive en streaming avec des citations en ligne — survoler montre le titre du document, cliquer ouvre le document au chunk cité. Pose une question qu'aucun des documents ne couvre ; l'agent doit refuser explicitement selon l'instruction, et non inventer une réponse.

Si l'agent invente quand même une réponse, les instructions ne sont pas assez strictes — ajoute un cas de refus explicite (« If you cannot find the answer in the bound documents, respond with exactly: 'I could not find this in the bound documents.' ») et republie.

## Où ça s'utilise

Les quatre gestes ci-dessus sont le build canonique de « l'agent qui répond depuis tes docs » : charger, créer l'agent avec RAG actif, lier, vérifier avec une citation. La même forme passe à l'échelle — lie dix documents au lieu de trois, ajoute un site web ou un dossier client, change de modèle. Ce sont les liaisons, pas le modèle, qui font que l'agent est le tien.

Pour le côté conceptuel — comment le retrieval se compose avec les autres boutons de l'agent — voir [Concepts des agents](/fr/platform/agents/concepts). Pour l'histoire plus large de la base de connaissances — Contacts, Produits, Fournisseurs, Sites web — voir [Aperçu du savoir](/fr/platform/knowledge/overview).
