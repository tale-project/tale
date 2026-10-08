---
title: L’éditeur de workflow
description: Examine et modifie les nœuds, fournis les données de test, puis enregistre, déploie ou rétablis une version.
---

L’éditeur de workflow permet de modifier le comportement d’une automatisation et de choisir sa version active. Il faut les droits Développeur, Admin ou Propriétaire pour apporter des changements. Enregistrer, tester et mettre en service sont des étapes distinctes : modifier un brouillon laisse la version déployée en place.

Ouvre **Automatisations**, puis sélectionne une automatisation. Elle s’ouvre dans l’onglet **Éditeur**. Une automatisation ouverte depuis l’onglet **Automatisations** d’un projet affiche ce projet au début du fil d’Ariane : choisis le nom du projet pour revenir au projet, ou **Automatisations** pour revenir à ses automatisations. Que tu ouvres une automatisation depuis un projet ou depuis la liste, la barre de navigation met **Automatisations** en évidence. Pour en créer une, consulte [Créer ou importer une automatisation](/fr/platform/automations/catalog).

| Onglet | Utilisation |
| --- | --- |
| **Éditeur** | Modifier le workflow, tester une version enregistrée et choisir celle à mettre en service. |
| **Général** | Choisir ce qui démarre l’automatisation et les projets qui peuvent l’utiliser. |
| **Exécutions** | Examiner les derniers lancements et ouvrir le détail d’une exécution. |

Le sélecteur **Version** reste à droite des onglets Éditeur, Général et Exécutions, sur ordinateur comme sur téléphone. Il affiche les messages de version, les dates, les résultats des tests et la version en service. Sélectionne une ligne pour ouvrir cette version. Sur ordinateur, les commandes d’exécution se trouvent à côté des onglets, avec **Enregistrer** et **Abandonner** ; dans **Général**, seuls **Enregistrer** et **Abandonner** y figurent. Un point sur un onglet signale ses modifications non enregistrées. Avant de quitter cet onglet ou de changer de version, Tale te demande quoi en faire.

Sur téléphone, la navigation est compacte à l’ouverture d’une automatisation. Le canevas de l’éditeur occupe la hauteur disponible. Les commandes d’exécution et de mise en service se trouvent dans le canevas, à côté du zoom. Sélectionne un nœud pour ouvrir ses champs — avec Enregistrer et Abandonner — dans un panneau au bas de l’écran.

<Frame caption="Sur un écran large, sélectionne un nœud pour examiner ses champs à côté du canvas.">

![L’éditeur montre les nœuds connectés et les champs du nœud sélectionné à côté du canvas.](/images/platform/automation-editor-canvas.webp)

</Frame>

Pour passer à une autre automatisation sans revenir à la liste, clique sur le nom de celle qui est ouverte dans le fil d’Ariane. Le menu garde toutes les automatisations de l’organisation, même après un changement de projet, sauf celles associées uniquement à des projets que tu ne peux pas ouvrir. Celles qui ne sont rattachées à aucun projet apparaissent en premier, puis viennent celles liées à des projets. Une ligne horizontale sépare les deux groupes. Cherche par nom ou par slug, puis sélectionne une entrée. Tu conserves l’onglet ouvert. Depuis le détail d’une exécution, tu arrives sur la liste **Exécutions** de l’autre automatisation. Le numéro de version sélectionné n’est pas repris : **Éditeur** affiche la dernière version enregistrée de cette autre automatisation.

## Lire le canvas

Chaque bloc est un nœud. Son libellé indique l’étape et le type ; **Lit** désigne les nœuds dont il utilise la sortie. Les flèches viennent des références, comme `{{ nodes.draft.output.text }}`. Modifie la référence pour changer la dépendance ; dessiner une flèche ne crée pas de dépendance.

Les badges indiquent les conditions et boucles : `when`, `else of`, `for each`, `repeat until` et `continue on error`. Un avertissement de cycle signifie que plusieurs nœuds dépendent les uns des autres. Supprime la référence circulaire avant d’enregistrer une version exécutable.

## Modifier un nœud

Sélectionne un bloc pour ouvrir ses champs. Sur un écran large, le panneau apparaît à côté du canvas ; sans nœud sélectionné, le canvas occupe toute la largeur. Sur un écran plus étroit, les champs s’ouvrent dans un dialogue au-dessus du canvas. Un `transform` possède du **Code** ; un `llm`, des champs de prompt, modèle et schéma de sortie ; un `agent` ajoute l’environnement d’agent et l’équipement. Le sélecteur **Modèle** d’un nœud `llm` ou `agent` liste les modèles servis par les fournisseurs connectés de ton organisation ; un modèle absent de la liste peut être saisi, mais la validation avertit qu’une exécution en direct échouerait à ce nœud tant que son fournisseur n’est pas connecté. **Entrée** contient les valeurs JSON et références transmises au nœud. Un JSON incomplet est signalé et ne met pas le nœud à jour.

Ouvre **Contrôle du flux** pour les conditions et répétitions. Si le nœud en a, la section est déjà ouverte. Utilise **Fermer** pour revenir au canvas. Sur un écran large, tu peux aussi fermer le panneau en cliquant sur le fond du canvas ou en appuyant sur Échap hors d’un champ de texte. Les réglages du déclencheur et des projets se trouvent dans l’onglet **Général**. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les types de nœuds et les expressions.

## Enregistrer et tester une version

1. Modifie les champs nécessaires et clique sur **Enregistrer**.
2. Explique le changement dans la **Note de version**, puis choisis **Enregistrer une version**. Cela ajoute une version et conserve les précédentes. Si quelqu’un a enregistré une autre version pendant ta modification, Tale refuse l’enregistrement et te demande : **Abandonner mes modifications et recharger** affiche la version plus récente, **Enregistrer quand même** ajoute ta version par-dessus — la plus récente reste dans l’historique des versions, mais la dernière version est alors la tienne.
3. Clique sur **Essai**. Si le workflow déclare un schéma d’entrée, remplis **Données de l’exécution (JSON)** dans le dialogue. Déplie **Schéma des données** pour vérifier les champs obligatoires et leurs types. Un JSON invalide ou non conforme au schéma empêche le démarrage.
4. Lance le test, passe à l’onglet **Exécutions** et ouvre sa ligne. Compare les données résolues, la sortie et les opérations prévues au résultat attendu.

Pour un workflow qui exige `owner` et `repo`, les données pourraient être :

```json
{
  "owner": "your-organization",
  "repo": "your-repository"
}
```

Utilise le schéma réel du workflow. Un champ numérique attend un nombre JSON, pas une chaîne entre guillemets. Vérifie aussi le périmètre lorsqu’un sélecteur de projet est proposé.

**Essai** utilise la version enregistrée sélectionnée et des simulations déterministes. Aucun e-mail n’est envoyé et aucune fiche externe n’est modifiée. Un brouillon peut être testé avant sa mise en service. Une simulation réussie ne vérifie pas les identifiants réels ni les services externes.

<Frame caption="Pour un workflow avec des données d’entrée, saisis le JSON et vérifie le schéma avant le test.">

![Le dialogue de test montre les valeurs JSON owner et repo et le schéma des données déplié.](/images/platform/automation-run-input.webp)

</Frame>

## Mettre en service et exécuter en réel

Choisis la version testée sous **Version** et clique sur le bouton voisin, qui nomme cette version, par exemple **Mettre v3 en service**. Le badge **En service** indique la version déployée. Une version dont les tests enregistrés ont échoué ne peut pas être déployée ; corrige la cause et enregistre une nouvelle version.

**Exécuter en réel** lance la version déployée, même si tu en consultes une autre. La confirmation montre le périmètre et, si nécessaire, les **Données de l’exécution (JSON)** pour cette version déployée. Vérifie les deux avant de confirmer. Les exécutions réelles peuvent agir sur les systèmes connectés et attendre une [approbation](/fr/platform/approvals/concepts).

Un déclencheur utilise aussi la version déployée. Configure-le lorsque tu es prêt pour des exécutions répétées ou démarrées par un système externe ; consulte [Déclencheurs d’automatisation](/fr/platform/automations/triggers).

## Examiner un résultat

**Afficher la dernière exécution** superpose les états au canvas. Sélectionne un nœud pour consulter les données de cette exécution : entrée résolue, sortie et effets. Cela suffit souvent à trouver une référence incorrecte. Compare l’entrée du nœud échoué à la sortie de sa source.

Passe à **Exécutions** et ouvre une ligne pour le détail complet. Les onglets restent visibles, avec **Exécutions** actif. **Éditeur** te ramène au workflow. Vérifie s’il s’agissait d’un test ou d’une exécution réelle et examine les opérations déjà réalisées avant de relancer. [Journaux d’exécution](/fr/platform/automations/execution-logs) explique les attentes, échecs, relances automatiques et arrêts.

## Revenir à une version ou supprimer

Pour revenir à une ancienne version, ouvre **Version** à droite des onglets, lis les messages et sélectionne la version souhaitée. Sa ligne ouvre **Éditeur** sur cette version ; clique ensuite sur le bouton qui la met en service, par exemple **Mettre v2 en service**. Les prochains démarrages l’utiliseront ; l’historique reste intact. Un message comme « Rétablir l’association précédente des destinataires » rend le choix plus facile à relire.

Pour supprimer l’automatisation, retourne à la liste, ouvre le menu de sa ligne et choisis **Supprimer**. Lis la confirmation qui la nomme. Les versions, le déploiement, le déclencheur et les liens aux projets sont retirés. Une exécution inachevée bloque la suppression : arrête-la ou attends sa fin. Les anciennes exécutions restent soumises à la conservation. Supprimer l’automatisation n’annule pas les actions déjà réalisées.
