# Websites — who can add a website to the knowledge base, and when it is scanned

> **Prefix** `WEB-` · **Docs** [`knowledge/crawling`](../../../../../docs/en/platform/knowledge/crawling.md)

An organization can add a website so that its pages are read into the knowledge base and
scanned again at an interval. A source is either a whole website or a list of addresses. These
rules cover who can manage a source, which addresses are accepted, when a site is scanned, and
what happens to a scan that fails or is interrupted. How a page is fetched and read is not
covered; see Not yet.

## Who can manage a website source

### WEB-R1 · Only editors, developers, admins and owners can change a website source

Adding a source, changing it, deleting it, resuming it and starting a scan are refused for a
member (`RBAC_FORBIDDEN`). Every member can read the sources, their pages and their status.

- **Example**: Mia is a member. She opens the list of websites → she sees it. She selects
  **Scan now** → refused.

## Which addresses are accepted

### WEB-R2 · An organization has one source per website

Adding a website that is already there is refused (`WEBSITE_DUPLICATE_DOMAIN`), and so is the
`www` form of a website stored without it, or the reverse; the refusal names the spelling
that is stored. Adding more addresses to a website that is a list extends that list instead.
A list cannot be added on top of a source that scans the whole website.

- **Example**: `example.com` is a source. Noah adds `www.example.com` → refused, with the
  message that `example.com` is already there.

### WEB-R3 · A website on a private or internal address is refused

A domain that leads to an address inside a private network, or to a cloud provider's internal
service address, is refused when it is added (`WEBSITE_DOMAIN_NOT_CRAWLABLE`). A domain that
cannot be looked up yet is accepted, and its first scan reports the problem.

- **Example**: Noah adds `intranet.corp`, which leads to `10.0.0.5` → refused.

### WEB-R4 · A source's website cannot be changed afterwards

Changing the domain of an existing source is refused (`WEBSITE_DOMAIN_IMMUTABLE`); sending
the same domain again, in any letter case, is not a change. A domain that is not one is
refused when it is added (`WEBSITE_DOMAIN_INVALID`), and a list is checked against its
website before anything else (`WEBSITE_INVALID_LIST_URL`).

- **Example**: Noah edits a source for `docs.example` and enters `renamed.example` as its
  domain → refused. He deletes the source and adds the new website instead.

## When a website is scanned

### WEB-R5 · A website is scanned when it is added, and again after each interval

A site that was never scanned is due at once. A paused site and a site that is being deleted
are never scanned, however long it has been.

- **Example**: A source has a six-hour interval and was scanned at 08:00 → its next scan is
  due at 14:00.

### WEB-R6 · A website whose scan failed is not tried again on the next check

It is tried again after a waiting time that does not depend on its own interval, so a site
that keeps failing is not fetched over and over.

- **Example**: A site is down and its 10:00 scan fails → the check at 10:05 leaves it alone.

### WEB-R7 · An interrupted scan carries on from where it began, a limited number of times

A scan whose work stopped, for example because the server restarted, is picked up again and
counts the pages it had already read. After a set number of pickups the scan is no longer
resumed. One site that cannot be resumed does not hold up the others.

- **Example**: The server restarts while a large site is half scanned → the scan continues
  after the restart instead of starting over.

### WEB-R8 · Scan now starts a scan of a failed site and clears its failure record

A site that is already being scanned or deleted is left as it is.

- **Example**: A site's scan failed overnight. Noah selects **Scan now** → a new scan is
  queued, and the site no longer shows its failure.

## What a scan fills in

### WEB-R9 · A scan fills in a title and description only where the author set none

- **Example**: Noah named a source "Product docs". A scan discovers the page title "Home" →
  the source keeps the name "Product docs".

### WEB-R10 · Websites can be searched in chat only once an embedding model can be called

Search is ready when the organization has an embedding model configured and a credential that
can call it. Without either, the websites page says that chat cannot search the websites yet.

- **Example**: The organization's embedding model lost its credential → the websites page
  shows that chat cannot search these websites yet.

### WEB-R11 · A usage limit pauses a scan's search by meaning, not the scan

A scan's embeddings are the spend of whoever asked for it — the member who added the source or
chose **Scan now** — or the organization's for a scan the schedule started. When a limit that
applies has too little room, the scan still stores the pages, which the source's own search
reads, but embeds nothing more; the source says that a usage limit stopped it, and the scan
resumes by itself, under the same person, once the limit resets or is raised.

- **Example**: Noah adds a site while his monthly limit is used up → the pages are stored, the
  site's details say a usage limit stopped the scan, and once Ada raises the limit the site
  becomes searchable by meaning within the hour.

## Not yet

- **How a page is fetched and read**: sitemaps, links, `robots.txt`, rendering, and the limits
  of a scan (the knowledge domain's crawler).
- **Websites over the REST API**: the limits of its lists and searches, and the shape of its
  answers (`rest/v1-websites.ts`). Its tests hold `WEB-R2` to `WEB-R4`.
- **The length of the waiting time in `WEB-R6` and the number of pickups in `WEB-R7`.**
- **The crawler's clocks and limits are not on the API**, and a changed page is fetched twice
  a scan; the contract debt ledger in [`.agents/repo.md`](../../../../../.agents/repo.md)
  records both.
