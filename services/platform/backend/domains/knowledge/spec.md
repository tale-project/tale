# Knowledge — what a search finds for whom, and what is indexed

> **Prefix** `KNOW-` · **Suite** [`knowledge`](../../../tests/manual/suites/knowledge.md) · **Docs** [`knowledge/overview`](../../../../../docs/en/platform/knowledge/overview.md)

The knowledge base holds an organization's documents and the pages of the websites it added,
prepared for search (indexed). These rules cover whose content a search reads, what it finds
for the person asking, what is indexed and what is refused, what happens when the embedding
model is missing or fails, how much a search returns, and what the website crawler will not
fetch. The settings pages, the repair of the search index, the removal of indexed content,
ranking and most of the crawler are not covered; see Not yet.

## One organization's knowledge base

Each organization has a knowledge base of its own. Most keep it in the deployment's shared
knowledge database. An organization can be given a knowledge database of its own under
**Settings > Data residency**.

### KNOW-R1 · A search reads only the documents and websites of the searcher's organization

This holds inside the shared database too, and for both ways a passage is matched: by its
words and by its meaning. The pages of a website are found only by an organization that added
that website. When two organizations hold the same document, each has it indexed for itself:
the indexed content of one is never reused for the other.

- **Example**: Zoe's organization and Ada's both keep a handbook in the shared database. Zoe
  searches for "parental leave" → she gets passages from her own organization's handbook only.
- **Example**: Ada's organization added `docs.example` as a website; Zoe's did not. Zoe
  searches for a sentence from that site → no page of it is returned.

### KNOW-R2 · An organization with its own knowledge database never uses the shared one

Its documents are indexed into its own database and searched there, and no other organization
is sent to that database. When the settings of its database are incomplete or invalid,
indexing and search fail with an error; they do not fall back to the shared database. An
organization without a database of its own uses the shared one.

- **Example**: An operator edits the database settings of Ada's organization by hand and
  leaves out the database name → every search and every indexing run of that organization
  fails with an error that names the invalid settings, and nothing is read from or written to
  the shared database.

## What a search finds for whom

What a search finds depends on who is asking. Its reach is worked out on the server from the
person's role, teams and projects; a request cannot widen it.

| The content is | A search finds it for |
| --- | --- |
| a library document restricted to no team | every member |
| a library document restricted to teams | members of any of those teams, and owners and admins |
| a file of a project | people who can read the project |
| a file uploaded in a chat | that chat only |
| an email, or a file that arrived by email | people who can read its conversation, in chat only |
| a document in the trash | nobody |

### KNOW-R3 · A search finds a document only for someone who can read that document

A library document restricted to teams is found only for members of any of those teams, and
for owners and admins. A file of a project is found only for people who can read that
project. For anyone else the document is left out of the results, and asking to read it
directly, by the identifier a search result carries, gives the same answer as for a document
that does not exist.

Over the API, the address of a search sets what it covers. A search of the library leaves
project files out. A search of one project covers that project's files only, and when the
caller cannot read the project it is answered as if the project did not exist. A request that
names a project in its body is refused.

- **Example**: A travel policy is restricted to the Finance team. Noah is in Finance, Mia is
  not, and Ada is an admin in no team. All three search for "travel budget" → Noah and Ada get
  passages from the policy, Mia gets none of it.
- **Example**: Mia has the identifier of a file in a project she cannot read, quoted in an old
  chat. She asks the assistant to open it → the answer is the one an identifier that names
  nothing gets, with no file name in it.

### KNOW-R4 · A file uploaded in a chat is found only by a search from that chat

It is not part of the shared library. A search from another chat does not find it, and
neither does a search over the API. A file that belongs to no document and no chat is found
by nobody.

- **Example**: Mia uploads a contract in one chat. In a second chat she asks the assistant
  about the contract → the search from the second chat does not find it.

### KNOW-R5 · An email is found only in chat, by someone who can read its conversation

This covers the text of an incoming email and a file that arrived attached to one. Both are
words an outsider wrote, so only a search that asks for mail and treats it as such returns
it, which the assistant in chat does; a search over the API never returns mail. In chat, it
is returned only to someone who can read the conversation the email arrived on: the person it
is assigned to can, another member cannot, and a conversation assigned to nobody is open to
owners and admins only. Mail of a conversation that is marked as spam, in the trash or
expired is found by nobody. A file that arrived by email and was then filed as a document
follows the document's access instead (`KNOW-R3`).

- **Example**: A customer's email with a price list attached is assigned to Noah. Noah asks
  the assistant about the price list → it is found. Mia asks the same question → it is not.
- **Example**: The conversation is then marked as spam → Noah's next search does not find the
  price list either.

### KNOW-R6 · A document in the trash is not found, from the moment it is trashed

The same holds for a document that has expired or is being removed for good: it drops out of
search at once, before its indexed content has been deleted. A file that no document and no
chat holds any more, such as the file of a deleted document, is not found either.

- **Example**: Noah moves a price list to the trash at 10:00. At 10:01 Mia searches for a
  line from it → nothing from the price list is returned, although its indexed content has
  not been removed yet.

## What is indexed and what is refused

A file is indexed when its text can be read and nothing in it has to be kept out. Otherwise
its indexing status says what happened, with a code (`indexing.errorCode` on the API):

| What happened | Status | Code |
| --- | --- | --- |
| No reader exists for this type of file | Not supported | `unsupported_type` |
| The file is an image | Not supported | `image_no_vision` |
| The file holds no text | Not supported | `empty` |
| The file is named as text and holds binary data | Not supported | `not_text` |
| The file's reader reports it as damaged | Not supported | `malformed` |
| A credential was recognised in the file | Failed | `secret_detected` |
| PII protection blocks the file | Failed | `pii_blocked` |

### KNOW-R7 · A file whose text cannot be read is marked Not supported and is not retried

Its status reads Not supported, never Failed, with one of the five codes in the table above.
A type without a reader and an image are decided from the file's name, before anything is
read. None of the five is tried again automatically: the same file would give the same
answer.

- **Example**: Mia uploads `standup.loop`, a Microsoft Loop file → it shows **Not supported**
  with the reason that no text extractor exists for it, and indexing is not attempted again.
- **Example**: Noah uploads `tool.txt`, a program file renamed to look like text → it shows
  **Not supported** (`not_text`).

### KNOW-R8 · A file in which a credential is recognised is refused, not indexed

Before a file is indexed it is scanned for credentials: an AWS access key, a private key
block, a JSON Web Token, or a long random value assigned to a name such as `api_key` or
`password`. A match refuses the whole file. Nothing of it is indexed, and its status is Failed
with the code `secret_detected`. The reason names the kind of credential and never shows its
value. Placeholders, masked values and text that only talks about keys are not matches.

- **Example**: Mia uploads `deploy-notes.txt`, which contains the line
  `api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"` → the file shows **Failed** with the message
  that it looks like it contains a credential, and no search finds any of its text.

### KNOW-R9 · The organization's PII protection is applied before a document is indexed

When an organization has turned on PII protection, the text of a document, its title and its
stored name pass through it first. In **Mask** mode, and in **Tokenize** mode, each detected
value is replaced by a placeholder, so it reaches neither the embedding provider nor the
index. In **Block** mode a document with a detected value is refused: its status is Failed
with the code `pii_blocked`, and the reason names the kind of data, not the value. With PII
protection off, text is indexed as it is. There is one exception: when the protection cannot
be started for a policy, documents are indexed unmasked and the fault is reported once in the
platform log.

- **Example**: The organization masks email addresses. Noah uploads a letter that contains
  `ada@example.com` → the letter is indexed with the address replaced by a placeholder. A
  search finds the letter by its other words, and no passage shows the address.
- **Example**: The mode is changed to **Block** and Noah uploads the letter again → it shows
  **Failed** (`pii_blocked`), and nothing of it is indexed.

## When the embedding model is missing or fails

Indexing and search both need the organization's embedding model: the model that turns text
into the vectors a search compares. An admin sets it under **Settings > Data residency**.

| What is wrong | Indexing a file | A search over the API |
| --- | --- | --- |
| No embedding model is set | Failed, `embedding_not_configured` | 409 `EMBEDDING_NOT_CONFIGURED` |
| The provider refuses the account | Failed at once, `embedding_provider_refused` | 409 `EMBEDDING_CREDIT_EXHAUSTED` |
| The provider rejects the key, or no usable key exists | Failed at once, `embedding_provider_refused` | 409 `EMBEDDING_CREDENTIAL_REJECTED` |
| The provider's rate limit | waited out | 503 `EMBEDDING_UPSTREAM_ERROR`, with a time to retry after |
| The provider cannot serve the request | Failed, `embedding_upstream`, tried again | 503 `EMBEDDING_UPSTREAM_ERROR`, with a time to retry after |

### KNOW-R10 · Without an embedding model nothing is indexed or searched until one is saved

A file that reaches indexing fails with the code `embedding_not_configured` and a message
that points to the setting; it is not tried again while no model is set. A search is refused
(`EMBEDDING_NOT_CONFIGURED`) as something an admin has to fix, not as something to retry.

When an admin saves the embedding model, every document that failed for a reason the
embedding settings can cure is put back in the queue, without anyone retrying it. A document
that failed for another reason, such as a recognised credential, is left as it is, and so is
a file whose uploader chose not to index it.

- **Example**: No embedding model is set. Mia uploads a guide → it shows **Failed**, with the
  hint that an admin can set an embedding model under Settings.
- **Example**: Three documents are Failed for the lack of a model. Ada saves an embedding
  model → the save reports that 3 documents were put back in the queue.

### KNOW-R11 · A knowledge database holds vectors of one width only

The vector width is the size of the vectors an embedding model produces. It has to be stated
with the model in the settings; it is never guessed from the model's name. The first model
used with a knowledge database fixes the width of that database. From then on a model of
another width is refused: nothing of the other width is written, the stored vectors are left
as they are, and a document that was being indexed fails with both widths named
(`embedding_provider_refused`). Organizations that share a database therefore use one width.
An organization that needs a model of another width needs a database of its own (`KNOW-R2`),
which has its own width.

- **Example**: The shared database holds vectors 1536 wide. Zoe's organization, in the same
  database, saves a model that produces vectors 768 wide → its documents fail with a message
  that names 768 and 1536, and nothing in the database changes.

### KNOW-R12 · Only a failure that waiting can fix is retried

While indexing, a rate limit of the embedding provider is waited out: the request pauses and
is sent again, up to six times, and other indexing with the same model waits with it. A
search is not held back by that pause. A failure that may pass, such as an outage at the
provider, leaves the file Failed with `embedding_upstream`, and indexing is tried again
automatically.

A refusal that no wait can lift ends indexing at the first attempt, with the reason on the
file (`embedding_provider_refused`): the provider refuses the account (a spent balance, a
plan without the model), it rejects the key, or no usable key exists. A search tells its
caller the same thing. `EMBEDDING_UPSTREAM_ERROR` comes with a time to retry after;
`EMBEDDING_CREDIT_EXHAUSTED` and `EMBEDDING_CREDENTIAL_REJECTED` come without one, because
only an admin can lift them.

- **Example**: The provider answers "too many requests" to a batch of passages → the batch is
  sent again after a pause and goes through; the document is indexed.
- **Example**: The organization's balance at its provider is spent. Mia uploads a file → it
  shows **Failed** with the provider's refusal after one attempt, and it is not sent again.

### KNOW-R17 · Indexing and searching count against the usage limits of whoever they are for

Turning text into vectors is a request to the embedding model, and it counts like any other
model request: indexing a file is the spend of the person who uploaded it — else of the
document's creator, such as a synced drive's owner — in the document's project or the chat it
was added to; indexing an emailed attachment, an inbound email or a page of a website a
schedule scanned is the organization's; a search is the spend of the person searching, with
the API key they search with and the project they search in. When a limit that applies has
too little room, a search is refused before the model is asked, naming the limit, and is never
answered as "nothing found"; indexing waits instead of failing: the document shows **Waiting
for a usage limit** and indexing resumes by itself within the hour after the limit resets or
is raised, after what it had already stored.

- **Example**: Mia's monthly cost limit is used up. She uploads a handbook → it shows
  **Waiting for a usage limit**; Ada raises the limit → within the hour the handbook is
  indexed.
- **Example**: A REST client searches with a key whose daily request limit is reached → 429
  `BUDGET_EXCEEDED`, naming the key's limit and when it resets.

## How much a search returns

### KNOW-R13 · A search returns at most 50 passages, and 10 unless asked otherwise

Over the API, `limit` takes a number from 1 to 50, and the query takes 1 to 2,000 characters
after spaces around it are removed. Anything else is refused before the search runs
(`INVALID_BODY`). A part of the platform that asks for more than 50 gets 50.

- **Example**: A script calls the search API with `limit: 51` → refused, and no search runs.
- **Example**: The same script sends no `limit` → at most 10 passages come back.

## What the website crawler will not fetch

The crawler reads the public pages of the websites an organization added. It introduces
itself to every site as `TaleBot`.

### KNOW-R14 · The crawler never requests a page the site's robots.txt disallows

The crawler follows the rules a site writes for it by name (`User-agent: TaleBot`), and
otherwise the rules for every crawler (`*`). The most specific rule decides, and `Allow` wins
a tie. A link to a disallowed page is not followed, and neither is a redirect that leads to
one. A page that was indexed before the site disallowed it leaves the index the next time it
comes up for a fetch. An address in a source's list of addresses is the exception: the person
who listed it asked for that page, so it is fetched whatever the rules say.

- **Example**: `docs.example` publishes `Disallow: /private/`. A scan finds a link to
  `/private/report` → the page is never requested.
- **Example**: Noah adds `https://docs.example/private/report` to a list of addresses → that
  page is fetched.

### KNOW-R15 · The crawler never requests a page on a private or internal address

A page whose address is on the server itself, in a private network range, or under a name
that only resolves inside a company network is not requested. It is shown as failed, with the
reason (`private_ip`). The exception is a deployment whose operator has allowed private
networks for the crawler.

- **Example**: A source for `intranet.corp` was added while the operator allowed private
  networks, and the operator then turns that off → the next scan requests none of its pages
  and shows each as failed, with a private address as the reason.

### KNOW-R16 · The crawler opens a page in the browser again only when it changed

A scan asks for each page once. The page is left as it is when the site's server answers
that it has not changed, or, for a server that gives no modification time, when the text of
the page reads as it did at the last visit. Only a page that changed is opened in the
browser and indexed again. A page whose content only its own JavaScript draws is the
exception: it is opened on every scan. **Scan now** asks the same way as a scheduled scan.

- **Example**: `docs.example` answers `304 Not Modified` for `/pricing` → the page is not
  downloaded, and no browser is opened for it.
- **Example**: `/blog` is built on every request, with a new token in each response around
  the same text → the scan reads it once and leaves it as it is.
- **Example**: The site adds an article to `/blog` → the next scan finds other text, opens
  the page in the browser and indexes it again.
- **Example**: Noah selects **Scan now** → every page is asked once, and only the changed
  ones are opened in the browser.

## Not yet

- **The knowledge settings**: who can change the embedding model and the knowledge database,
  which hosts a database or a model endpoint may name, and the list of recommended models
  (`admin.ts`, the settings routes in `routes.ts`).
- **Repair of the search index**: what indexing does while the keyword index is rebuilt, or
  after its repair failed (`index-health.ts`, `core/knowledge/index_health.ts`).
- **Removing indexed content**: what deleting, replacing or purging a document removes from
  the index and when, the nightly clean-up, and what restoring a document from the trash
  brings back (`release.ts`, `release-queue.ts`, `liveness.ts`). Integration lanes hold parts
  of this, which the guard does not read.
- **Moving a document** between teams, projects and folders, and the folder filter of a
  search (`service.ts`).
- **Emails in the index**: which emails are indexed, and when (`message-index.ts`).
- **Reading a document's text**: paging, and reading a file that is not indexed
  (`core/knowledge/fetch.ts`, `core/knowledge/document_text.ts`).
- **Ranking**: how matches by words and by meaning are combined, the similarity floor,
  repeated passages, and a search without the keyword index (`lib/knowledge/retrieve.ts`,
  `lib/knowledge/fusion.ts`, `core/knowledge/corpus.ts`).
- **How text is read from each file format and cut into passages**
  (`core/lib/knowledge/extraction/`, `lib/knowledge/chunking.ts`).
- **The rest of the crawler**: sitemaps and links, rendering, pages that ask not to be
  indexed, a scan picked up after a restart, and the limits of a scan
  (`core/knowledge/crawl_action.ts`, `core/knowledge/crawl.ts`,
  `core/knowledge/crawl_limits.ts`, `lib/knowledge/crawl-parse.ts`). Of the limits, only the
  size limit for one document has a test, and that test holds the setting, not the refusal.
  The contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records that
  the crawler's clocks and limits are not on the API, and that a changed page is fetched twice
  a scan.
- **`KNOW-R15` covers a page's own address.** A public name that leads to a private address,
  a redirect into a private network, and the cloud provider addresses that the operator's
  setting never opens are held by the tests of the shared fetch guard (`lib/net/`), which name
  no rule here.
- **`KNOW-R7`: which files are reported as damaged.** Only the PDF reader reports `malformed`,
  and no test holds that. A corrupt Office document still fails as a general error and is
  retried; the same ledger records it.
- **Undecided: should the credential scan of `KNOW-R8` read the text extracted from a PDF or
  an Office file?** The scan reads the stored file as plain text
  (`lib/knowledge/secret-scan.ts`), and a test holds that a file it cannot read as text is
  allowed. A credential inside a compressed format is therefore not seen, while the code
  comment on the indexer says a credential "must never be chunked". A scan that itself fails
  allows the file too; the code says so, and no test holds it.
- **Undecided: does a search with no person behind it find a file uploaded in a chat?**
  `KNOW-R4` holds for every search a person or an API key starts. For a caller that passes no
  access scope at all, the decision finds the file and a test asserts it
  (`retrievable.test.ts`), while the description of the access scope says such a file is
  private to its chat, "org-wide callers included" (`lib/knowledge/types.ts`). Nothing calls
  without a scope today.
- **`KNOW-R9` when the policy cannot be read at all.** A PII policy that cannot be read is
  treated as no policy (`service.ts`); no test holds that.
- **A change of embedding model that keeps the vector width** is not noticed: documents that
  are already indexed stay as they are. The user docs tell the admin to plan re-indexing.
- **Website search has no search by meaning, and its fallback is silent**, and
  **`private_knowledge.semantic_cache` is an empty table**; the same ledger records both.
