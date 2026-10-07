# Image proxy — how a remote image in an email reaches its reader

> **Prefix** `IMGPX-`

An email can draw images from its sender's server. The reader's browser never fetches them:
the platform does, and hands back the image and nothing else, so the sender does not learn the
reader's address or that the message was opened. These rules say who can ask for an image,
what the platform will fetch, and what it hands back.

## Who can load an image

### IMGPX-R1 · Only a signed-in person can load an image through the proxy

A request without a session is refused before anything is fetched.

- **Example**: Zoe is not signed in. She opens a proxy address copied from a message →
  refused, and the image's server is never contacted.

### IMGPX-R2 · Each person can load a limited number of images in a period

Once the budget is spent, further images are refused (`RATE_LIMITED`) without being fetched,
and the answer says how many seconds to wait.

- **Example**: Mia opens a newsletter with more images than her budget allows → the images
  over the budget are refused, each with the time after which she can retry.

## What the platform will fetch

### IMGPX-R3 · Only an http or https address is fetched

A missing or unreadable address, and one of any other kind (`javascript:`, `file:`, `data:`),
is refused (`INVALID_IMAGE_URL`) and nothing is fetched.

- **Example**: A message draws an image from a `file:` address → refused.

### IMGPX-R4 · The image's server receives no cookie and no credential of the reader

- **Example**: Mia opens a message with a tracking image → the sender's server sees a request
  from the platform that carries no cookie and no sign-in of hers.

### IMGPX-R5 · An address on a private or internal network is refused

This holds however the address is spelled and wherever it redirects (`IMAGE_HOST_REFUSED`).

- **Example**: A message draws an image from `http://10.0.0.5/status.png` → refused.

### IMGPX-R6 · An image larger than 10 MB is refused

The fetch stops at the limit (`IMAGE_TOO_LARGE`).

- **Example**: A message draws a 40 MB image → refused, and Mia sees no image there.

## What the reader gets back

### IMGPX-R7 · Only a picture is handed back, judged by its content

What the server calls the file does not count. A web page labelled as an image is refused,
and so is an SVG, because it can carry script (`NOT_AN_IMAGE`). A picture is handed back under
the type its content is.

- **Example**: A sender's server answers an image address with a web page labelled
  `image/png` → refused.

### IMGPX-R8 · A handed-back image cannot run anything, and only the reader's browser keeps it

The image is inert even when opened in a tab of its own. The reader's browser can reuse it for
an hour; a cache shared between people cannot keep it. A refusal is never kept.

- **Example**: Mia opens a proxied image in its own tab → it shows as a picture, and nothing
  in it runs.

## Not yet

- **How many images are fetched at once, and how long a fetch can take**: 16 at a time, 10
  seconds each (`IMAGE_FETCH_TIMEOUT`). The first has a test; neither is a rule here yet.
- **The size of a person's budget** (`IMGPX-R2`): set with the other rate limits, not in this
  domain.
- **Which images of a message go through the proxy**: decided by the email preview in the app.
