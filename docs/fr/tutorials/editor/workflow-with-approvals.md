---
title: Créer un workflow avec approbation
description: Importe un petit workflow, teste l’e-mail proposé, puis examine et refuse l’approbation réelle sans envoyer le message.
---

Cet exercice crée un workflow en deux étapes : préparer un message, puis demander l’autorisation de l’envoyer. Tu examineras le destinataire et le texte exacts dans une exécution en attente avant de refuser l’opération. Tu parcourras ainsi une approbation complète sans avoir à distribuer de vrai message.

## Avant de commencer

Utilise un compte Développeur, Admin ou Propriétaire. Vérifie que la politique de ton organisation exige une approbation pour `imap-smtp.send` ; c’est le comportement par défaut. Une politique personnalisée peut le modifier. Consulte donc [Configurer les approbations](/fr/platform/approvals/configure) avant la partie réelle.

Le test simulé n’a pas besoin d’identifiants de messagerie. Un envoi réellement approuvé nécessiterait un connecteur IMAP / SMTP configuré et un destinataire que tu souhaites contacter. Cet exercice se termine par **Rejeter**.

## Importer l’exemple

Enregistre le contenu suivant dans `workflow.yml`. Le nœud `draft` renvoie un texte fixe pour faciliter la vérification. Le nœud `send` le lit ; ces références dessinent la connexion sur le canvas.

```yaml
version: 1
name: docs/approval-check
description: Practice reviewing an outgoing message before it is sent.
nodes:
  - id: draft
    type: transform
    code: |
      return {
        subject: "Approval practice",
        text: "This is a test message for the approval walkthrough."
      };
  - id: send
    type: imap-smtp.send
    input:
      to: reviewer@example.com
      subject: '{{ nodes.draft.output.subject }}'
      text: '{{ nodes.draft.output.text }}'
output:
  messageId: '{{ nodes.send.output.messageId }}'
tests:
  - name: prepares the outgoing message
    input: {}
    expect:
      effects:
        - connector: imap-smtp.send
```

1. Ouvre **Automatisations > Nouvelle automatisation > Téléverser un paquet**.
2. Choisis `workflow.yml` et laisse **Installer dans** sur **Organisation**.
3. Clique sur **Téléverser le paquet**. Tale valide le document et enregistre `docs/approval-check` en brouillon.
4. Choisis **Plus tard** dans la proposition de déploiement, puis ouvre **Approval check** dans la liste.

Si ce nom existe déjà, l’import ajoute une version. Choisis une autre valeur de `name` pour garder un exercice séparé.

<Frame caption="Le dialogue d’import accepte le fichier de workflow et propose l’organisation ou un projet comme destination.">

![Le dialogue de téléversement d’un paquet affiche le sélecteur de fichiers et la destination Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

## Tester le flux de données

Clique sur **Essai**. Cet exemple ne demande aucune donnée d’exécution ; un objet vide suffit. La liste **Exécutions** doit afficher un test **Réussie** et le canvas doit indiquer que les deux nœuds ont été exécutés.

Ouvre l’exécution, sélectionne `send` et examine ses données résolues. Le destinataire doit être `reviewer@example.com`, l’objet `Approval practice` et le texte la phrase de `draft`. Le connecteur utilise une simulation déterministe dans ce mode. Aucun e-mail n’est envoyé et aucune carte d’approbation n’apparaît.

Le workflow comprend un test qui attend l’effet `imap-smtp.send`. Une simulation réussie vérifie le graphe et l’appel prévu. Elle ne prouve ni la validité des identifiants de messagerie ni la livraison du message.

## Démarrer la vérification réelle

Clique sur **Mettre cette version en service** pour rendre la version testée active. Laisse le déclencheur non configuré : cet exercice se lance une fois manuellement.

Choisis **Exécuter en réel**, lis la confirmation et le périmètre de l’organisation, puis confirme. Ouvre la nouvelle exécution en attente depuis **Exécutions**. La carte doit présenter l’approbation attendue, `imap-smtp.send`, le nœud `send` et les données de l’appel prévu. Destinataire, objet et texte doivent correspondre au test simulé.

Si l’exécution ne se met pas en attente, examine son statut et la politique avant de continuer. Un appel de connecteur échoué ne prouve pas qu’une approbation a été demandée.

## Refuser et examiner le résultat

Clique sur **Rejeter** sur la carte. L’opération est refusée et l’exécution se termine en **En échec**. C’est le résultat attendu ici : le workflow a atteint la décision humaine et le message n’a pas été envoyé.

Tu ne peux pas modifier les paramètres d’un appel en attente sur la carte. Si un vrai message proposé est incorrect, rejette-le, corrige la définition ou les données et démarre une nouvelle exécution. Approuver ensuite un appel correct autorise l’opération réelle ; cela ne signifie pas seulement que tu as lu la carte.

Lorsqu’un agent a besoin d’une réponse plutôt que d’une permission, il utilise `ask_human`. Cette attente différente est expliquée dans [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows). [Journaux d’exécution](/fr/platform/automations/execution-logs) aide à distinguer ces attentes d’un agent encore au travail.
