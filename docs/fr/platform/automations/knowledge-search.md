---
title: Chercher dans tes connaissances depuis une automatisation
description: Trouve avec l’étape knowledge.search les passages de tes documents et de tes sites indexés qui répondent à une question, utilise-les dans une étape suivante, et sache ce qu’une recherche peut lire.
---

Utilise une étape `knowledge.search` quand une automatisation a besoin de ce que ton organisation sait déjà, comme une politique, une fiche produit ou une page de ton centre d’aide, sans étape d’agent. Elle cherche dans tes [documents](/fr/platform/knowledge/documents), tes [sites indexés](/fr/platform/knowledge/crawling) ou les deux, et renvoie les passages qui correspondent le mieux à la requête, le meilleur en premier. Elle ne modifie rien, donc elle ne demande jamais d’approbation. Une exécution de test répond avec un mock.

## Chercher, puis utiliser les passages

```yaml
nodes:
  - id: related
    type: knowledge.search
    input:
      query: '{{ input.question }}'
      corpus: documents
      limit: 3
  - id: answer
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Answer {{ input.question }} from these passages only, and say so when they do not answer it: {{ nodes.related.output.hits }}'
```

| Entrée   | Ce qu’elle contient                                                                   |
| -------- | ------------------------------------------------------------------------------------- |
| `query`  | Ce qu’il faut chercher, en mots, jusqu’à 2 000 caractères.                            |
| `limit`  | Combien de passages renvoyer : de 1 à 20, 5 par défaut.                               |
| `corpus` | `documents`, `web` pour tes sites indexés, ou `all` pour les deux, par défaut.        |
| `folder` | Seulement les documents de ce dossier et des dossiers en dessous, comme `/Policies/`. |

L’étape renvoie `{ hits }`, le meilleur en premier. Aucun résultat signifie que rien ne correspondait, et l’étape réussit quand même. Chaque résultat contient :

| Champ        | Ce qu’il contient                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`       | Le passage, avec l’en-tête de son document.                                                                                                     |
| `title`      | Le titre du document ou de la page, ou `null`.                                                                                                  |
| `source`     | `documents` ou `web`.                                                                                                                           |
| `documentId` | Le document auquel appartient le passage.                                                                                                       |
| `projectId`  | Le projet dans lequel le document est classé. Un document que tous les membres partagent n’en a pas.                                            |
| `url`        | La page d’où vient un passage web.                                                                                                              |
| `score`      | Le rang selon lequel les résultats sont classés.                                                                                                |
| `similarity` | À quel point le sens du passage est proche de la requête, plus proche de 1 quand il est plus proche, quand la recherche par le sens l’a trouvé. |

Une recherche garde chaque résultat qu’elle classe, aussi faible soit-il. Pour écarter les correspondances faibles, compare `similarity` dans une étape suivante.

## Ce qu’une recherche lit

Une recherche lit ce que son exécution peut lire, jamais ce que peut voir la personne qui a écrit l’étape :

- Une exécution dans un projet lit les documents de ce projet et les documents que tous les membres partagent.
- Une exécution d’une automatisation liée à des projets, lancée pour toute l’organisation, lit les documents de ces projets et les documents partagés.
- Une automatisation liée à aucun projet ne lit que les documents que tous les membres partagent.

Elle ne lit jamais une bibliothèque d’équipe qui n’est pas donnée à l’exécution, ni les fichiers envoyés et les e-mails d’une conversation. L’embedding de la requête compte dans les [limites d’utilisation](/fr/platform/admin/governance/policies-and-limits) qui s’appliquent à l’exécution, et il est comptabilisé sous le nom de l’automatisation, comme l’appel d’une étape `llm`.

## Quand une recherche échoue

La page de l’exécution dit pourquoi une étape de recherche a échoué et comment y remédier.

| Échec                                                        | Ce qui s’est passé                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **La recherche dans les connaissances n’est pas configurée** | L’organisation n’a pas de modèle d’embedding. Un administrateur en choisit un dans **Paramètres › Résidence des données**.                                               |
| **La recherche dans les connaissances a échoué**             | Le fournisseur du modèle d’embedding a refusé l’appel ou a échoué.                                                                                                       |
| **Une limite d’utilisation a arrêté l’étape**                | Une limite qui s’applique à l’exécution n’a plus de marge. Elle compte comme une limite, pas comme un échec qui se répète, donc aucune planification ne se met en pause. |
