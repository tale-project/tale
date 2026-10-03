# Grille d’évaluation des agents IA

Copie ce modèle pour une comparaison. Les cellules vides sont intentionnelles : saisis des observations, pas des exemples de résultats. Utilise `inconnu` pour les mesures manquantes et `sans objet` uniquement avec une raison. Un zéro consigné signifie un zéro mesuré.

## Exemple rempli : l’exécution moins chère produit le résultat accepté plus cher

**Exemple pédagogique fictif. Tous les nombres, frais, temps et taux horaires ci-dessous sont supposés. Aucun agent n’a été exécuté pour produire ces chiffres.** Deux configurations reçoivent les mêmes six cas, chacun exécuté deux fois dans des conditions propres, avec un tour de correction autorisé. Chaque configuration compte 12 essais valides démarrés, six cas distincts, aucun test invalide, résultat non noté, échec de démarrage ou effet interdit. Le temps humain comprend préparation, supervision, revue et correction sur toute la cohorte, essais échoués compris.

| Mesure | Configuration A | Configuration B |
| --- | --- | --- |
| Essais valides démarrés N | 12 | 12 |
| Acceptés au premier passage F | 8 | 10 |
| Acceptés dans la limite de correction A, premiers passages compris | 10 | 11 |
| Essais finalement non acceptés | 2 | 1 |
| Acceptation au premier passage F/N | 66,7 % | 83,3 % |
| Acceptation avec aide permise A/N | 83,3 % | 91,7 % |
| Frais de modèle et d’outils couverts | 6 $ | 18 $ |
| Travail humain sur la cohorte | 180 minutes = 3 heures | 120 minutes = 2 heures |
| Taux horaire supposé | 60 $ | 60 $ |
| Coût humain estimé | 180 $ | 120 $ |
| Sous-total estimé des coûts couverts | 186 $ | 138 $ |
| Sous-total par livrable accepté | 18,60 $ | 12,55 $, arrondi |

L’infrastructure, les abonnements et les frais de déploiement sont non mesurés, pas nuls. Il s’agit d’un sous-total estimé des coûts couverts, pas d’un coût complet ni d’un total mesuré. Aucun résultat de délai n’est supposé ici ; respecter le délai reste une condition supplémentaire de la décision.

**Calcul :** A : `(6 + 3 × 60) / 10 = 18.60`. B : `(18 + 2 × 60) / 11 = 12.545...`. Avec le taux horaire `r`, la comparaison est `(6 + 3r)/10` contre `(18 + 2r)/11`. L’égalité exige `66 + 33r = 180 + 20r`, donc `r = 114/13`, soit environ 8,77 $/heure. D’autres coûts manquants peuvent déplacer le seuil.

**Décision remplie :** faire passer B à un pilote supervisé limité si son échec restant a une gravité acceptable et si elle respecte l’échéance. Selon ces hypothèses, son ratio couvert est inférieur au-dessus du taux horaire seuil. Examine les échecs individuels et répète des cas représentatifs avant de généraliser. Sous le seuil, A a le ratio couvert inférieur ; un effet éliminatoire annulerait l’avantage économique de l’une comme de l’autre.

## Calibrer le réviseur

Utilise des résultats volontairement contrastés avant d’évaluer les configurations. Des réviseurs qualifiés les évaluent à partir des sources, résolvent leurs désaccords et figent la grille. Un modèle juge peut aider, mais ses explications doivent aussi être vérifiées.

| Élément de calibration | Distinction attendue | Jugement réel/preuve | Changement nécessaire |
| --- | --- | --- | --- |
| Livrable concis et correct | Réussite malgré un style simple | | |
| Livrable fluide qui change le sens de la source | Échec substantiel malgré la qualité du texte | | |
| Déclaration correcte d’information manquante | Ne pas récompenser une complétude inventée | | |
| Défaut de style sans conséquence | Séparer préférence et erreur éliminatoire | | |
| Même paire dans l’ordre inverse | Examiner un changement de préférence | | |

Audite certains résultats acceptés, pas seulement les refusés, pour chercher les faux succès. Garde les documents de calibration séparés des cas réservés à l’évaluation finale.

## Contrat d’évaluation

| Champ | Valeur |
| --- | --- |
| Décision soutenue par l’évaluation | |
| Charge de travail et utilisateurs prévus | |
| Responsable/réviseur de l’évaluation | |
| Période et fuseau horaire | |
| Révision du jeu de tâches et entrées figées | |
| Cas de mise au point/cas réservés | |
| Configurations candidates | |
| Nombre de cas distincts/essais par cas/total d’essais | |
| Question de répétabilité et plan de répétition | |
| Méthode de notation/relevé de calibration | |
| Aide permise | |
| Maximum de tours de correction/temps/dépense | |
| Classification des dépassements de délai et refus | |
| Conditions invalidant un test | |
| Violations éliminatoires des limites | |
| Seuils d’acceptation choisis avant les exécutions | |

Un essai indépendant part de conditions initiales équivalentes. Les corrections lui appartiennent ; ne compte pas chaque correction comme un nouveau livrable accepté. Les résultats échoués restent dans la cohorte. Suis séparément un test invalide avec sa raison et son coût ; applique les exclusions de façon cohérente aux candidates. Rapporte les échecs de démarrage séparément de la qualité des sorties, sans les faire disparaître de la vue du lecteur.

## Relevé de configuration

| Identifiant | Runtime/version | Modèle/fournisseur | Révision des instructions | Skills/révisions | Outils/accès | Rôle de démarrage | Limites |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |

Consigne le type d’identifiants et le périmètre de mesure ; n’inscris jamais de valeur secrète dans la grille. Préserve les identifiants de fournisseur/modèle pertinents et la date de configuration même si les versions exactes sont indisponibles.

## Grille d’acceptation

| Critère | Obligatoire ou préférence | Preuve à examiner | Condition de réussite | Éliminatoire ? |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

Juge les livrables selon la grille figée. Utilise des preuves d’exécution lorsqu’une action ou une interdiction compte. Une correction ultérieure n’efface pas un effet interdit. Signale les désaccords de notation et leur résolution. Garde le résultat initial séparé de tout résultat accepté avec aide.

## Journal d’essais vierge

| Identifiant d’essai | Identifiant de cas | Configuration | Résultat initial accepté ? | Résultat final aidé accepté ? | Tours de correction | Violation de limite | Livrable/preuve du verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

Valeurs acceptées : `oui`, `non` ou `non noté`. Ne traite pas `non noté` comme une réussite. Nomme les dépassements de délai, essais annulés et échecs de démarrage au lieu de les regrouper dans une catégorie commode.

## Couverture des cas et constance

| Identifiant de cas | Famille de tâches/difficulté | Configuration | Répétitions valides | Séquence de verdicts initiaux | Schéma d’échec répété |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |

Rapporte séparément les cas distincts et les répétitions. Une réussite parmi plusieurs tentatives et une réussite à chaque répétition répondent à des questions différentes ; précise laquelle soutient ton fonctionnement prévu. Répéter des cas n’établit pas la couverture de nouvelles familles de tâches. Ne déduis pas `p^k` d’un taux d’acceptation agrégé sans les hypothèses requises d’indépendance et de probabilité stable.

## Temps et effort

| Identifiant d’essai | Soumis à | Début d’exécution | Résultat initial prêt | Accepté à/arrêt terminal | Préparation min | Supervision min | Revue min | Correction humaine min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

Utilise un seul fuseau horaire. Mesure les intervalles de travail humain ; ne compte pas l’attente passive comme du travail. Consigne tous les contributeurs sans doubler les intervalles chevauchants d’une personne. Les durées d’agents parallèles ne sont pas des délais additionnables. Pour un essai non accepté, conserve sa durée terminale et sa raison sans inventer d’heure d’acceptation.

## Couverture des coûts

| Identifiant essai/cohorte | Catégorie | Montant | Devise | Observé/estimé/inconnu | Preuve ou règle de répartition | Limite de couverture |
| --- | --- | --- | --- | --- | --- | --- |
| | Frais de modèle | | | | | |
| | Frais d’outil/service | | | | | |
| | Répartition d’abonnement | | | | | |
| | Répartition d’infrastructure | | | | | |
| | Travail humain | | | | | |
| | Autres | | | | | |

Ne compte pas deux fois la même dépense fournisseur depuis un relevé de passerelle et une facture. Utilise une devise unique pour les totaux et indique les dates/taux de conversion. Une catégorie inconnue reste inconnue ; répartir un abonnement fournisseur n’est pas mesurer un coût par exécution. L’utilisation enregistrée par Tale n’est pas une facture complète ni un total garanti par tâche. Lis les [analyses d’utilisation](https://docs.tale.dev/fr/platform/admin/governance/usage-analytics) et les [chemins d’authentification des runtimes](https://docs.tale.dev/fr/platform/agents/harnesses).

## Formules

Soit `N` tous les essais valides démarrés dans la cohorte déclarée, y compris ceux qui dépassent le délai ou ne retournent rien ; note-les comme échecs. Soit `F` les essais acceptés au résultat initial et `A` tous les essais acceptés dans le processus de correction autorisé, y compris les acceptations initiales sans tour de correction. Rapporte séparément les tests invalides et les essais encore non notés ; résous les notes manquantes avant de comparer les taux. Rapporte les échecs opérationnels par raison sans retirer les essais valides échoués de `N`.

- Acceptation au premier passage = `F / N`.
- Acceptation avec aide permise = `A / N`.
- Heures humaines = `(minutes de préparation + supervision + revue + correction) / 60`, additionnées sur la cohorte, échecs compris.
- Coût humain estimé = `somme(heures mesurées de chaque contributeur × taux horaire déclaré)`.
- Coût estimé de la cohorte = `frais observés sans doublons + répartitions déclarées + coût humain estimé`.
- Coût estimé par livrable accepté = `coût estimé de la cohorte / A`.
- Heures humaines par livrable accepté = `heures humaines de la cohorte / A`.
- Délai d’un essai accepté = `horodatage d’acceptation − horodatage de soumission`.
- Attente en file, si observable = `horodatage de début d’exécution − horodatage de soumission`.

Si `N = 0`, les deux ratios d’acceptation sont **indéfinis**, pas nuls. Si `A = 0`, les deux ratios par livrable accepté sont **indéfinis** ; montre la dépense/l’effort de la cohorte et zéro livrable accepté. Si des coûts importants sont inconnus, appelle le ratio « sous-total estimé des coûts couverts par livrable accepté » lorsqu’il comprend des répartitions ou estimations de travail, et signale les omissions. Réserve « sous-total mesuré » aux seuls frais observés ; ne le qualifie pas de coût complet. Rapporte les synthèses de délais d’acceptation uniquement pour les essais acceptés, avec les nombres d’échecs/dépassements de délai. Ne présente jamais un échec rapide comme une livraison réussie rapide.

## Relevé de décision

| Élément | Constat |
| --- | --- |
| Forces observées par type de tâche | |
| Schémas d’échec et gravités | |
| Compromis effort de revue/délai | |
| Coûts couverts et sensibilité des estimations | |
| Conditions étayées par ces preuves | |
| Conditions non testées | |
| Disponibilité observée/raisons des échecs de démarrage | |
| Condition qui inverserait la décision | |
| Configuration choisie/pilote plus restreint/pas de déploiement | |
| Responsable et prochain déclencheur de revue | |

Conserve les livrables des tâches et les preuves de verdict avec le relevé. Une comparaison soutient une décision délimitée, pas un classement universel des modèles ou runtimes.
