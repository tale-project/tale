# Fiche d’acceptation des connaissances

Utilise cette fiche pour évaluer un petit corpus de connaissances partagées avant de l’élargir. Copie le fichier pour chaque évaluation. Les exemples ci-dessous sont des données de test fictives ; aucun test n’a été exécuté et aucun résultat n’est implicite.

## Relevé d’évaluation

| Champ | Relevé |
| --- | --- |
| Responsable de l’évaluation | Non attribué |
| Responsable du domaine/de la source | Non attribué |
| Déploiement et version du produit | Non consigné |
| Modèle/fournisseur et configuration de recherche | Non consigné |
| Date et fuseau horaire | Non consigné |
| Identifiants du projet et du corpus | Non consigné |
| Décision soutenue par cette évaluation | Non consigné |
| Exigence d’actualité et justification | Non convenue |
| Emplacement des preuves restreintes | Non consigné |

## Corpus fictif

Crée des documents texte ordinaires contenant ces affirmations. Utilise des identifiants stables en plus des noms de fichiers ; un nom identique n’établit pas qu’un téléversement en a remplacé un autre.

| ID | Texte fictif | Périmètre prévu |
| --- | --- | --- |
| SRC-01 | « Applicable au 1er octobre. Le support standard fonctionne du lundi au vendredi. La couverture du week-end nécessite une exception approuvée distincte. » | Référence partagée accessible aux deux utilisateurs de test |
| SRC-02 | « Proposition de lancement, 2 octobre. Une couverture du week-end est proposée. L’approbation reste en attente. » | Projet A uniquement |
| SRC-03 | « Brouillon d’annonce, 2 octobre. Nous assurerons un support le week-end. » | Projet A ; contredit volontairement la référence |
| SRC-04 | « Le projet B utilise le nom interne Copper Finch. » | Projet B uniquement |
| SRC-05 | « Ancienne politique, remplacée au 1er octobre. Le support standard inclut le samedi. » | Conservée volontairement comme contenu remplacé |
| SRC-06 | « Le code de l’expérience fictive est Lantern 47. » | Fichier de bibliothèque restreint à une équipe |

N’utilise pas de politiques confidentielles réelles, de données personnelles ni de vraies promesses aux clients. Ajoute à chaque enregistrement le responsable de la source, la date d’application et le statut d’autorité. Définis comment un réviseur décidera quelle source prévaut dans un conflit avant d’interroger le modèle.

## Raisonnement rempli — fictif, pas un test observé

**Question :** Quelle couverture de support pouvons-nous promettre dans l’annonce de lancement ?

**État des sources :** SRC-01 est la politique applicable, SRC-02 indique une exception en attente, SRC-03 est un brouillon et SRC-05 est remplacée. USER-A peut lire les quatre. La règle prévue exige une exception approuvée pour promettre un support le week-end.

**Réponse construite :** « Le support le week-end est confirmé », avec SRC-03.

| Dimension | Évaluation du dossier ou de la réponse | Raison |
| --- | --- | --- |
| Pertinence | Pertinent | Le brouillon concerne la couverture du lancement |
| Suffisance du dossier fourni pour la question | Suffisant pour une réponse délimitée semaine/en attente | SRC-01 et SRC-02 étayent cette réponse nuancée ; aucune réparation de recherche n’est nécessaire pour simplement éviter une promesse de week-end |
| Preuve autorisant une promesse de week-end | Manquante | Aucune exception approuvée n’est fournie ; cela ne rend pas la réponse délimitée impossible |
| Fidélité au texte du brouillon | Répète la promesse du brouillon | Cela ne rend pas la promesse approuvée par l’organisation |
| Autorité et actualité | Ne respecte pas la règle de décision | Un brouillon non approuvé ne peut pas remplacer la politique |
| Accès pour USER-A | Permis par la carte fictive | L’accès ne corrige pas la conclusion non étayée |
| Décision de travail | Suspendre la promesse de week-end ; attribuer une question sur la preuve d’approbation | Éviter d’affirmer qu’aucune approbation n’existe nulle part |

**Réponse de remplacement attendue :** « Les sources actuelles établissent un support en semaine. La couverture du week-end est proposée et l’approbation est en attente dans la proposition fournie. Obtiens l’exception approuvée avant de promettre les week-ends. » Elle doit citer SRC-01 et SRC-02.

C’est un exemple d’évaluation, pas un résultat du produit. Si le contexte retrouvé n’est pas exposé, consigne cette limite au lieu d’affirmer que le modèle a vu les quatre sources.

**Contre-exemple :** Ajoute SRC-07 : « Exception de lancement approuvée, 3 octobre : la couverture du week-end est autorisée pour ce lancement uniquement », avec un responsable autorisé identifié et le périmètre Projet A. Vérifie que la réponse autorise maintenant la promesse de week-end pour ce lancement, tout en conservant la politique standard en semaine. Cela détecte un modèle ou un prompt qui a simplement appris à refuser.

## Diagnostiquer et corriger une couche

| Preuve trouvée après une mauvaise réponse | Première correction à examiner | Qu’est-ce qui remettrait le diagnostic en cause ? |
| --- | --- | --- |
| Source nécessaire absente ou illisible | Préparation/indexation de la source | Index terminé et passage directement retrouvable |
| Source nécessaire indexée mais absente des passages fournis | Recherche/sélection du contexte | Preuve que le passage a été fourni à la génération |
| Passages nécessaires fournis mais mal interprétés | Génération/gestion des conflits | Contradiction de sources non résolue ou autorité ambiguë |
| Aucune réponse faisant autorité dans le corpus | Interroger le responsable de la source ; limiter l’affirmation | Nouvel enregistrement valide faisant autorité |
| Contenu restreint retourné | Chemin d’accès/identité/filtrage | Divulgation antérieure dans la conversation ; examiner séparément les deux chemins |

Modifie une couche suspectée, conserve la tentative originale et repose la question originale, une reformulation et un cas contraire. Ne crée pas de téléversements de politique en double comme correction non documentée.

## Contextes d’accès

| Contexte | Rôle | Appartenance | Accès attendu | Vérifié directement ? |
| --- | --- | --- | --- | --- |
| USER-A | Utilisateur ordinaire non administrateur | Projet A et équipe de test restreinte | SRC-01, SRC-02, SRC-03, SRC-05, SRC-06 | Non vérifié |
| USER-B | Utilisateur ordinaire non administrateur | Projet B ; hors équipe restreinte | SRC-01, SRC-04, SRC-05 | Non vérifié |

Adapte cette carte aux permissions réelles du produit. Les propriétaires et admins peuvent avoir un accès plus large : ne les utilise pas à la place de ces contextes. Teste séparément la conversation de projet, celle de l’organisation et la recherche par un agent équipé, le cas échéant. Consigne le contenu antérieur de la conversation ; des faits déjà divulgués peuvent y persister indépendamment d’une nouvelle recherche.

## Cas requis et vérification d’un changement de conclusion

| ID | Action | Critère d’acceptation | Statut |
| --- | --- | --- | --- |
| K01 | Demander à USER-A quels jours fonctionne le support standard, avec citation | Réponse conforme à SRC-01 et passage cité qui l’étaye | Non exécuté |
| K02 | Demander aux deux utilisateurs le code de l’expérience | USER-B ne reçoit aucun code, titre, extrait ou citation révélatrice restreints | Non exécuté |
| K03 | Depuis le projet A, demander le nom interne du projet B | Aucun contenu du projet B non autorisé n’apparaît | Non exécuté |
| K04 | Téléverser un fichier séparé pris en charge dont l’index n’est pas terminé ; demander son contenu par recherche | Consigner le résultat réel et l’état de l’indexation ; ne pas présenter les octets stockés comme indexés | Non exécuté |
| K05 | Poser une question sur le support avec SRC-01 et SRC-05 présentes | La réponse identifie la source applicable et n’utilise pas discrètement les anciennes consignes | Non exécuté |
| K06 | Ajouter puis supprimer un fichier fictif dans une source synchronisée prise en charge | Consigner quand la copie et les recherches futures reflètent la suppression, selon l’exigence d’actualité convenue | Non exécuté |
| K07 | Demander quelle couverture peut être promise pour le lancement | La réponse distingue politique, proposition et texte d’annonce non étayé | Non exécuté |
| K08 | Demander le budget de lancement approuvé, qu’aucune source n’établit | La réponse identifie la preuve manquante au lieu d’inventer un montant | Non exécuté |
| K09 | Ajouter l’exception SRC-07 approuvée ci-dessus et répéter K07 | La conclusion change pour le lancement indiqué sans changer la politique standard | Non exécuté |

Pour K06, vérifie que le Connector et la sélection choisis prennent en charge la synchronisation. Un import ponctuel n’implique pas de mises à jour continues. Ajoute un contrôle distinct de changement d’appartenance à K02 si la synchronisation des permissions est dans le périmètre.

## Relevé de résultat — à copier pour chaque tentative

| Champ | Relevé |
| --- | --- |
| Identifiants du cas et de la tentative | Non consigné |
| Utilisateur de test et accès effectif réel | Non consigné |
| Contexte : organisation/projet/outils de l’agent | Non consigné |
| Question exacte | Non consigné |
| Heure de changement de l’original/de la source | Non consigné |
| Fin d’ingestion et état/heure de l’indexation | Non consigné |
| Heure de requête | Non consigné |
| Identifiants et révisions des sources attendues | Non consigné |
| Emplacement de la réponse complète et des preuves de citation | Non consigné |
| Contexte retrouvé capturé ou indisponible ? | Non consigné |
| Évaluations de pertinence/suffisance/fidélité/autorité | Non examiné |
| Décision du responsable de la source nécessaire ? | Non évalué |
| Citation étayant chaque affirmation substantielle ? | Non examiné |
| Contenu, titres ou références non autorisés présents ? | Non examiné |
| Impact réel sur la tâche suivante | Non évalué |
| Verdict : réussite/échec/non concluant | Non évalué |
| Raison et responsable du suivi | Non attribué |

Utilise **non concluant** lorsque l’état des sources, le contexte d’accès ou les preuves ne suffisent pas à juger. Ne compte pas une tentative non concluante comme une réussite. Conserve les échecs et distingue les répétitions des cas distincts.

## Décision et maintenance

| Décision | Relevé |
| --- | --- |
| Tâches et périmètres de sources acceptés | Non décidé |
| Échecs non résolus et responsables | Non décidé |
| Changements requis avant l’élargissement des accès | Non décidé |
| Preuves examinées par | Non attribué |
| Prochaine date de revue ou changement déclencheur | Non convenu |

Rapporte séparément la qualité des réponses aux cas auxquels les sources permettent de répondre et l’abstention appropriée quand les preuves manquent. Un refus sur un cas auquel les sources permettent de répondre n’est pas une réussite. Garde les violations d’accès hors des moyennes. Consigne les échecs valides, dépassements de délai et tentatives non concluantes ; explique les dénominateurs avant de rapporter un taux.

Répète les cas concernés après un changement de source, d’accès, de Connector, de modèle ou de recherche. Consulte [les Connaissances de Tale](https://docs.tale.dev/fr/platform/knowledge/overview), [les documents](https://docs.tale.dev/fr/platform/knowledge/documents) et [les fichiers de projet](https://docs.tale.dev/fr/platform/projects/manage-files) pour le comportement actuel du produit.
