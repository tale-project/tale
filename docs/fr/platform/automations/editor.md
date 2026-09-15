---
title: L’éditeur de workflow
description: Examine et modifie les nœuds, fournis les données de test, puis enregistre, déploie ou rétablis une version.
---

L’éditeur de workflow permet de modifier le comportement d’une automatisation et de choisir sa version active. Il faut les droits Développeur, Admin ou Propriétaire pour apporter des changements. Enregistrer, tester et mettre en service sont des étapes distinctes : modifier un brouillon laisse la version déployée en place.

Ouvre **Automatisations**, puis sélectionne une automatisation. Elle s’ouvre dans l’onglet **Éditeur**. Pour en créer une, consulte [Créer ou importer une automatisation](/fr/platform/automations/catalog).

| Onglet | Utilisation |
| --- | --- |
| **Éditeur** | Modifier le workflow, tester une version enregistrée et choisir celle à mettre en service. |
| **Versions** | Lire les messages de version et les résultats des tests enregistrés, puis ouvrir une version dans l’éditeur en sélectionnant sa ligne. |
| **Exécutions** | Examiner les derniers lancements et ouvrir le détail d’une exécution. |

Dans **Éditeur**, le sélecteur de version et les commandes d’exécution se trouvent à côté des onglets, avec **Enregistrer** et **Abandonner**. Un point sur l’onglet **Éditeur** signale des modifications non enregistrées. Avant de quitter cet onglet ou de changer de version, Tale te demande quoi en faire.

<Frame caption="Sélectionne un nœud pour examiner ses champs. Les commandes à côté des onglets permettent de tester, d’enregistrer et de mettre en service.">

![L’éditeur montre les nœuds connectés, les réglages du nœud sélectionné les onglets Éditeur, Versions et Exécutions, ainsi que les commandes de version et d’exécution.](/images/platform/automation-editor-canvas.webp)

</Frame>

Pour passer à une autre automatisation sans revenir à la liste, clique sur le nom de celle qui est ouverte dans le fil d’Ariane. Le menu garde toutes les automatisations de l’organisation, même après un changement de projet. Celles qui ne sont rattachées à aucun projet apparaissent en premier, puis viennent celles liées à des projets. Une ligne horizontale sépare les deux groupes. Cherche par nom ou par slug, puis sélectionne une entrée. Tu conserves l’onglet ouvert. Depuis le détail d’une exécution, tu arrives sur la liste **Exécutions** de l’autre automatisation. Le numéro de version sélectionné n’est pas repris : **Éditeur** affiche la dernière version enregistrée de cette autre automatisation.

## Lire le canvas

Chaque bloc est un nœud. Son libellé indique l’étape et le type ; **Lit** désigne les nœuds dont il utilise la sortie. Les flèches viennent des références, comme `{{ nodes.draft.output.text }}`. Modifie la référence pour changer la dépendance ; dessiner une flèche ne crée pas de dépendance.

Les badges indiquent les conditions et boucles : `when`, `else of`, `for each`, `repeat until` et `continue on error`. Un avertissement de cycle signifie que plusieurs nœuds dépendent les uns des autres. Supprime la référence circulaire avant d’enregistrer une version exécutable.

## Modifier un nœud

Sélectionne un bloc pour ouvrir ses champs. Un `transform` possède du **Code** ; un `llm`, des champs de prompt, modèle et schéma de sortie ; un `agent` ajoute le harness et l’équipement. **Entrée** contient les valeurs JSON et références transmises au nœud. Un JSON incomplet est signalé et ne met pas le nœud à jour.

Ouvre **Contrôle du flux** pour les conditions et répétitions. Clique sur le fond du canvas, sur **Fermer** ou appuie sur Échap hors d’un champ de texte pour revenir aux réglages du déclencheur et des projets. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les types de nœuds et les expressions.

## Enregistrer et tester une version

1. Modifie les champs nécessaires et clique sur **Enregistrer**.
2. Explique le changement dans le **Message de version**, puis choisis **Enregistrer la version**. Cela ajoute une version et conserve les précédentes.
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

Choisis la version testée sous **Version** et clique sur **Mettre cette version en service**. Le badge **En service** indique la version déployée. Une version dont les tests enregistrés ont échoué ne peut pas être déployée ; corrige la cause et enregistre une nouvelle version.

**Exécuter en réel** lance la version déployée, même si tu en consultes une autre. La confirmation montre le périmètre et, si nécessaire, les **Données de l’exécution (JSON)** pour cette version déployée. Vérifie les deux avant de confirmer. Les exécutions réelles peuvent agir sur les systèmes connectés et attendre une [approbation](/fr/platform/approvals/concepts).

Un déclencheur utilise aussi la version déployée. Configure-le lorsque tu es prêt pour des exécutions répétées ou démarrées par un système externe ; consulte [Déclencheurs d’automatisation](/fr/platform/automations/triggers).

## Examiner un résultat

**Afficher la dernière exécution** superpose les états au canvas. Sélectionne un nœud pour consulter les données de cette exécution : entrée résolue, sortie et effets. Cela suffit souvent à trouver une référence incorrecte. Compare l’entrée du nœud échoué à la sortie de sa source.

Passe à **Exécutions** et ouvre une ligne pour le détail complet. Les onglets restent visibles, avec **Exécutions** actif. **Éditeur** te ramène au workflow. Vérifie s’il s’agissait d’un test ou d’une exécution réelle et examine les opérations déjà réalisées avant de relancer. [Journaux d’exécution](/fr/platform/automations/execution-logs) explique les attentes, échecs, relances automatiques et arrêts.

## Revenir à une version ou supprimer

Pour revenir à une ancienne version, ouvre **Versions**, lis les messages et sélectionne la version souhaitée. Sa ligne ouvre **Éditeur** sur cette version ; clique ensuite sur **Mettre cette version en service**. Tu peux aussi choisir une ancienne version dans le menu **Version** de l’éditeur. Les prochains démarrages l’utiliseront ; l’historique reste intact. Un message comme « Rétablir l’association précédente des destinataires » rend le choix plus facile à relire.

Pour supprimer l’automatisation, retourne à la liste, ouvre le menu de sa ligne et choisis **Supprimer**. Lis la confirmation qui la nomme. Les versions, le déploiement, le déclencheur et les liens aux projets sont retirés. Une exécution inachevée bloque la suppression : arrête-la ou attends sa fin. Les anciennes exécutions restent soumises à la conservation. Supprimer l’automatisation n’annule pas les actions déjà réalisées.
