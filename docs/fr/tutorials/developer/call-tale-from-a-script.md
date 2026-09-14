---
title: Appeler Tale depuis un script
description: Crée une clé API, choisis un modèle disponible et affiche une réponse terminée avec Python.
---
Envoie un message à Tale et affiche sa réponse dans ton terminal. Ce tutoriel crée un thread personnel, vérifie chaque réponse HTTP et attend la fin du tour. Il utilise curl et la bibliothèque standard de Python 3 ; aucun paquet Python supplémentaire n’est nécessaire.

## Préparer l’accès

Il te faut une instance accessible, le droit de créer une clé API, le slug de ton organisation et un modèle directement appelable. Les Admins et Développeurs peuvent créer des clés. Un modèle présent dans le catalogue peut encore échouer si le compte du fournisseur manque de crédit ou n’y donne pas accès.

Ouvre **Paramètres > API > REST**, choisis **Créer une clé API**, donne-lui un nom comme `Reporting script` et choisis une expiration. Sélectionne **Créer la clé** et copie le secret affiché une seule fois. Charge-le dans `TALE_API_KEY` depuis ton gestionnaire de secrets ou un environnement shell privé ; ne le place ni dans le fichier Python ni dans Git.

<Frame caption="Donne à la clé un nom qui explique son usage pour pouvoir la révoquer sans toucher à une autre intégration.">

![La boîte de création d’une clé API permet de choisir un nom et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

Définis les valeurs non secrètes ci-dessous. Utilise le slug, pas l’ID de l’organisation. Envoie cet en-tête à chaque requête pour conserver une destination explicite si ton compte rejoint une autre organisation.

```bash
export TALE_BASE_URL="https://your-host.example.com"
export TALE_ORG_SLUG="your-org-slug"
export TALE_MODEL="model-id-from-the-catalog"
```

## Trouver un modèle accessible

Liste les modèles accessibles au titulaire de la clé :

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Une réponse `200` contient un tableau `models`. Définis `TALE_MODEL` avec l’`id` d’une entrée. Si cet ID apparaît chez plusieurs fournisseurs, définis aussi `TALE_PROVIDER` avec le `providerSlug` choisi. Un tableau vide signifie qu’aucun modèle n’est directement accessible à ce compte. Demande à un admin de vérifier les identifiants et l’accès aux modèles.

## Envoyer et attendre une réponse

Enregistre ce code dans `tale-chat.py`, puis lance `python3 tale-chat.py` dans l’environnement préparé. Le script crée un thread dans ton historique personnel et peut entraîner des frais d’utilisation du modèle.

```python
import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ["TALE_BASE_URL"].rstrip("/")
headers = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
    "Content-Type": "application/json",
}

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(f"{base}/api/v1{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error

models = request("GET", "/models")["models"]
model_id = os.environ["TALE_MODEL"]
provider = os.environ.get("TALE_PROVIDER")
candidates = [m for m in models if m["id"] == model_id
              and (not provider or m["providerSlug"] == provider)]
if len(candidates) != 1:
    raise SystemExit("Choose one available model/provider pair from GET /api/v1/models")

thread = request("POST", "/threads", {})
path = f"/threads/{thread['id']}"
sent = request("POST", f"{path}/messages", {
    "content": "In one sentence: what is Tale?",
    "model": candidates[0]["id"],
    "providerSlug": candidates[0]["providerSlug"],
})
reply_id = sent["messageId"]
deadline = time.monotonic() + 600
while True:
    generation = request("GET", f"{path}/generation")
    if generation["status"] == "idle":
        break
    if time.monotonic() >= deadline:
        request("DELETE", f"{path}/generation")
        raise SystemExit("Stopped the turn after the local 10-minute deadline")
    time.sleep(2)

if generation.get("lastMessageId") != reply_id:
    raise SystemExit("The accepted turn did not finish in this thread scope")
reply = request("GET", f"{path}/messages/{reply_id}")
if reply["status"] != "complete":
    raise SystemExit(f"Turn {reply['status']}: {reply.get('errorCode', '')} {reply.get('error', '')}")
if reply.get("finishReason") == "length":
    raise SystemExit("The reply reached its output limit; inspect it before using it")
text = "".join(part["text"] for part in reply["parts"] if part.get("type") == "text")
if not text:
    raise SystemExit("The turn completed without a text answer")
print(text)
```

L’envoi renvoie `202` et une `messageId` avant la fin de la génération. L’état `idle` indique que le tour s’est arrêté, pas forcément qu’il a réussi. Le script lit ensuite ce message précis et vérifie son statut, sa limite de sortie et son texte avant de l’afficher.

<Tip>

Conserve l’ID du thread pour prolonger cette intégration. Envoie les messages suivants au même thread pour garder le contexte ; créer un thread à chaque appel démarre une nouvelle conversation.

</Tip>

## Diagnostiquer un échec

| Résultat | Action suivante |
| --- | --- |
| `401` | Vérifie si la clé a expiré, a été révoquée ou a été mal copiée. |
| `400` avec `ORG_SLUG_REQUIRED` | Fournis le slug de l’organisation visée. |
| `403` | Vérifie l’appartenance et les droits du titulaire de la clé. |
| Aucun modèle correspondant | Relis `/models` et choisis une paire exacte ID/fournisseur. |
| `429` | Respecte `Retry-After` ; consulte les [limites de débit](/fr/develop/rate-limits). |
| Statut du message `failed` | Lis `errorCode` et corrige le compte ou le modèle avant de réessayer. |
| Délai réseau dépassé | Vérifie l’instance et le thread existant avant de renvoyer le message. |

Un POST dont le délai expire peut déjà avoir été accepté. Ne le renvoie pas sans vérifier l’état de génération et les messages du thread.

La limite de dix minutes est un choix de cet exemple, pas un délai du serveur. Un tour en file peut attendre derrière d’autres clients ; le raisonnement peut garder le modèle actif avant tout texte visible. Le script ne répète pas automatiquement un envoi en échec. Pour des relances autonomes, conserve un `Idempotency-Key` de 1 à 255 caractères ASCII imprimables avec le corps de la requête, réutilise les deux après une réponse perdue et respecte `Retry-After` en cas de `429`. Consulte [les relances sans doublon](/fr/develop/api-reference#relancer-un-envoi-sans-doublon).

## Prolonger l’intégration

Pour les conversations d’un projet, utilise `/api/v1/projects/{id}/threads` pour la création, les messages, la génération et les lectures. Tu dois avoir accès au projet actif. Ajouter `projectId` au corps d’une requête de thread personnel ne change pas son périmètre.

La [référence API](/fr/develop/api-reference) décrit les droits sur les projets, les parties des messages et les exécutions d’automations. Pour déclencher du travail à l’arrivée d’un événement externe, poursuis avec [Déclencher une automation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook).
