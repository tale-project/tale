# Fiche de choix entre workflow et agent

Utilise cette fiche avant de choisir un workflow, un agent ou une approche hybride. Remplis d’abord les sections sur le processus et l’acceptation. Consigne les inconnues comme telles ; ne transforme pas les mesures manquantes en zéros.

## Extrait rempli — rapport fictif de retours

Ces entrées inventées illustrent une décision de conception, pas un benchmark ni un résultat de modèle observé.

| Champ de décision | Exemple rempli |
| --- | --- |
| Invariant de comptage | Garder une ligne par identifiant de retour selon la règle du responsable ; 22 lignes moins deux identifiants répétés donnent 20 retours distincts |
| Totaux du mois précédent | Mise en route 4, facturation 6, fiabilité 5, autres 5 : total 20 |
| Totaux du mois actuel | Mise en route 8, facturation 5, fiabilité 4, autres 3 : total 20 |
| Calcul accepté | La part de la mise en route dans les retours enregistrés passe de 20 % à 40 %, soit une hausse de 20 points de pourcentage |
| Interprétation non étayée | « 40 % des clients ont du mal à démarrer » utilise un dénominateur de clients que l’export n’établit pas |
| Cause rejetée | Deux commentaires sur l’authentification et une note de version du même mois n’établissent pas que cette version a causé la hausse |
| Conception choisie | Étapes définies de validation et de comptage, suivies d’une investigation délimitée lorsque les découvertes déterminent la prochaine source autorisée à examiner |
| Résultat protégé | Préserver les totaux acceptés et les enregistrements originaux ; garder les annotations thématiques proposées à part |

L’investigation peut recommander un audit des instructions d’invitation à partir des trois retours concernés sans déclarer de cause commune. Une demande de totaux seuls n’a pas besoin d’agent ; un court dossier complet peut ne nécessiter qu’une étape de modèle. Des versions contradictoires d’un même identifiant exigent une règle d’exception définie par le responsable avant l’acceptation des totaux.

## Définition du processus

- Processus et responsable : [Nom et personne responsable]
- Déclencheur ou demande initiale : [Ce qui lance le travail]
- Entrées et sources de référence : [Emplacements, formats, périmètre]
- Résultat souhaité : [Livrable ou effet observable]
- Méthode actuelle : [Comment le travail se fait aujourd’hui]
- Fréquence et variabilité : [Preuves connues ou inconnu]
- Conséquences d’un résultat erroné : [Impact précis]
- Effets externes autorisés : [Périmètre exact ou aucun]
- Décisions humaines conservées : [Décision, responsable, preuves requises]

## Décomposer le travail en étapes

| Étape | Entrée requise | Qui choisit l’action suivante ? | Mise en œuvre proposée | Vérification |
| --- | --- | --- | --- | --- |
| [Étape] | [Entrée] | [Règle/modèle/personne] | [Étape définie/un appel de modèle/agent/personne] | [Contrôle observable] |

## Préserver les règles autour de l’interprétation

| Invariant ou définition | Autorité | Qui peut le modifier ? | Que faut-il recalculer ou réapprouver après un changement ? |
| --- | --- | --- | --- |
| [Unité de comptage, règle de doublon, périmètre des sources ou contrôle obligatoire] | [Responsable et révision de la règle] | [Autorité nommée] | [Calculs, conclusions ou actions concernés] |

- Dénominateur et population : [Ce que la proportion mesure ; ce qu’elle ne peut pas établir]
- Enregistrements originaux et trace des lignes exclues : [Emplacements et versions]
- Annotations proposées conservées séparément : [Emplacement ; approbation nécessaire avant de changer les catégories officielles]
- Validation du résultat du modèle : [Contrôles de structure et contrôles du fond des preuves]
- Interprétation dépassant les preuves : [Conclusion tentante concrète, mais non étayée]

Pour chaque étape d’agent proposée, réponds :

- Quelle incertitude demande une investigation ? [Réponse]
- Quels outils peut-il choisir ? [Outils nommés et limites]
- Quel résultat structuré ou document doit-il retourner ? [Contrat]
- Quelles affirmations nécessitent des preuves ? [Critères]
- Qu’est-ce qui doit provoquer un arrêt ou une question ? [Conditions]
- Quelle mise en œuvre plus simple a été envisagée ? [Option et raison]
- Quelle découverte déterminerait le prochain outil ou la prochaine source ? [S’il n’y en a aucune, réexamine si un seul appel de modèle suffit]
- Qu’est-ce qui ferait abandonner le choix d’un agent ? [Règle stable, dossier complet, vérification indisponible ou charge mesurée]

## Conceptions candidates

| Candidate | Description | Avantage attendu à tester | Charge supplémentaire à mesurer |
| --- | --- | --- | --- |
| Workflow défini | [Étapes et embranchements] | [Hypothèse] | [Exceptions/maintenance] |
| Agent délimité | [Objectif, outils, limites] | [Hypothèse] | [Revue/variabilité/coût] |
| Hybride | [Limite fixe autour du travail de l’agent] | [Hypothèse] | [Intégration/validation] |

Ne remplis pas ces colonnes avec des résultats supposés. Une candidate peut être exclue avant le test si une entrée, un accès ou une vérification nécessaire est indisponible ; consigne cette raison.

## Cas d’acceptation et d’exception

| Identifiant | Entrée ou condition | Résultat requis | Preuve à examiner | Résultat réel |
| --- | --- | --- | --- | --- |
| C01 | [Entrée complète représentative] | [Résultat attendu] | [Contrôle] | [Non exécuté/observation] |
| C02 | [Entrée obligatoire manquante] | [Traitement explicite] | [Contrôle] | [Non exécuté/observation] |
| C03 | [Preuves contradictoires] | [Préserver le conflit] | [Contrôle] | [Non exécuté/observation] |
| C04 | [Outil/référence indisponible] | [Échec délimité ou escalade] | [Contrôle] | [Non exécuté/observation] |
| C05 | [Demande répétée] | [Comportement convenu pour les doublons] | [Contrôle] | [Non exécuté/observation] |

Critères obligatoires d’acceptation : [Liste des conditions observables].

Résultat éliminatoire : [Échec précis nécessitant une nouvelle conception ou l’arrêt du pilote].

## Compte rendu d’essai

- Candidate et révision de configuration : [Identifiant]
- Modèle/runtime/outils : [Configuration exacte]
- Versions des sources et des entrées : [Identifiants]
- Date, opérateur et responsable de la revue : [Valeurs]
- Cas exécutés et répétitions : [Échantillon réel]
- Résultats acceptés : [Nombre et définition]
- Acceptation au premier passage et après correction : [Nombres et dénominateurs séparés]
- Relevé des cas répétés : [Cas, état réinitialisé, configuration, chaque tentative valide et résultat]
- Réussite obtenue au fil des tentatives et acceptation constante : [Observations séparées ; ne masque pas les tentatives échouées]
- Révisions et échecs : [Nombre et raisons]
- Délai d’achèvement : [Périmètre observé et unités]
- Effort humain de préparation, revue et correction : [Mesuré ou non mesuré]
- Coût du modèle, des outils et de l’infrastructure : [Composants mesurés et exclus]
- Effets externes : [Relevé observé]
- Limites de l’essai : [Échantillon, couverture, mesures manquantes]

Conserve les tentatives valides échouées ou arrivées au délai maximal. Des essais répétés sur un petit échantillon servent au diagnostic, pas à garantir la fiabilité générale. Ne suppose pas l’indépendance des échecs et ne déduis pas le taux de réussite du processus entier en multipliant les taux des étapes sans justification.

## Décision et condition de réexamen

Conception retenue : [Candidate ou maintien de la méthode actuelle].

Preuves du choix : [Observations précises au regard des critères].

Incertitude restante : [Ce que l’essai ne peut pas établir].

Responsable et prochaine étape délimitée : [Personne et action].

Réexaminer lorsque : [Changement d’entrée, seuil d’échec, évolution des capacités ou date de revue].
