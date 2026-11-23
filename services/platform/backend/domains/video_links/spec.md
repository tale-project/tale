# Video links — which links are accepted, and what pasting one starts

> **Prefix** `VID-` · **Suite** [`video-links`](../../../tests/manual/suites/video-links.md) · **Docs** [`chat/attachments`](../../../../../docs/en/platform/chat/attachments.md)

Pasting a link to a video into the chat message field turns the video into an attachment: its
captions are read, or its sound is transcribed. These rules cover which links are accepted,
what pasting the same link again does, how many videos are prepared at once, where a video is
fetched and how much of it, which proxy it is fetched through, and what removing a link does.
How a video is read is not covered; see Not yet.

## Which links are accepted

### VID-R1 · Only an https link to a video on the public internet is accepted

Refused are: a link that is not a web address (`invalidUrl`), a link that is not `https`, a
link that carries a user name or password, a link to a bare network address instead of a
name, a link to the server itself, and a link to a playlist instead of one video.

- **Example**: Mia pastes `http://videos.example/abc`, without the `s` → refused.

### VID-R2 · A link that leads to a private or internal address is refused

The name in the link is looked up before anything is fetched. When any address it leads to is
inside a private network or is a cloud provider's internal service address, the link is
refused, and so is a name that cannot be looked up.

- **Example**: Mia pastes a link whose name leads to `10.0.0.5` → refused, and nothing is
  fetched from that address.

## Preparing a video

### VID-R3 · Pasting the same link again in one chat does not prepare the video twice

The video already being prepared, or already prepared, for that chat is used again. Another
chat gets its own, and pasting the link there does not disturb the first chat's.

- **Example**: Mia pastes a link, removes the text and pastes it again in the same chat → one
  video is prepared.

### VID-R4 · An organization prepares at most three videos at the same time

A fourth is refused (`inFlightCap`) until one of the three has finished, for a new link and
for a retry of a failed one. The count is taken together with the start, so two links pasted
at the same moment cannot both slip past it.

- **Example**: Three videos are being prepared in Mia's organization. She pastes a fourth link
  → refused, and she can paste it again once one of them is done.

## Fetching a video

### VID-R8 · A video is fetched in a sandbox session, and waits for a free one

Its captions and its sound are fetched by a program that runs in a sandbox session opened for
the video and removed after it, never beside the application. The session counts as one of the
organization's render sessions. When none is free, or the sandbox host has no room for one
more, the video stays queued and asks again, for at most 15 minutes. That wait is none of its
attempts.

- **Example**: Mia pastes a link while a website scan uses both of her organization's render
  sessions → her video stays queued and starts once the scan gives a session back.
- **Example**: No session comes free for 15 minutes → her video fails as a temporary problem,
  and she can try it again.

### VID-R9 · A video's sound is fetched as it is served, and may weigh 1 GiB

Nothing is converted while a video is fetched. Of the streams a platform offers, the best one
of sound alone that weighs up to 200 MiB is taken, and the smallest one where none does. From
a platform that serves sound only with a picture, a small picture is taken: at most 480 pixels
in height, or in width for a video that stands upright. A sound over 1 GiB fails the video as
too large (`videoTooLarge`), and it is not tried again.

- **Example**: Mia pastes a four-hour talk whose best sound stream weighs 230 MB → a smaller
  stream of the same talk is fetched.
- **Example**: Mia pastes a one-minute portrait clip that its platform serves from 360 to
  1080 pixels wide, each with its sound → the one 480 pixels wide is fetched, about 6 MB.
- **Example**: Mia pastes a video whose only stream weighs 3 GB → the video fails as too
  large, without a retry.

## Fetching through proxies

### VID-R7 · A video keeps one proxy and moves on when the platform refuses it

Through the deployment's outbound proxies, or through video ingestion's own list of proxies
when one is set, a video's metadata, captions and sound go out through one proxy. When the
platform refuses the video there (a bot check, a rate limit, a refused request), or the proxy
cannot carry it, the video moves to the next proxy of that list that has not failed it. Each
fetch (metadata, captions, sound) makes at most five attempts and retries only within the first
90 seconds of its step; when a Vimeo video's page fails, the metadata step also tries Vimeo's
embedded player, with attempts of its own. A fetch through a single proxy is not retried. The
platform's next video starts on the proxy it last served. Video ingestion's own list never hands
a video to the outbound proxies or a direct connection: once every proxy in it has failed the
video, the video ends with the platform's reason.

- **Example**: Mia's deployment lists three proxies and YouTube asks the first for a bot check
  → her video is fetched through the second, captions and sound included, and the next video
  starts on the second.
- **Example**: Mia's deployment gives video two proxies of its own and YouTube asks both for a
  bot check → her video ends with the bot check, and none of its requests goes out through the
  outbound proxies or directly.

## Removing a link

### VID-R5 · Removing a video link stops its preparation and deletes what it produced

The transcript is deleted with it, unless something else still uses the same content. A video
that finished at the very moment it was removed is left as it is.

- **Example**: Mia pastes a link, changes her mind and removes the chip while the video is
  still being prepared → the preparation stops and no transcript is kept.

### VID-R6 · A video nobody attached to a message is cleaned up later

A prepared video that never became part of a message or a document is removed after a while,
with its transcript, unless a document took it over.

- **Example**: Mia pastes a link and closes the tab without sending the message → the prepared
  video is removed by a later cleanup.

## Not yet

- **How a video is read**: captions before sound, the languages preferred, and the tools that
  fetch it (`core/video_links/`).
- **Which failures can be retried**, and what a failed link shows (`service.ts`).
- **Reusing a transcript** that was made for the same video before.
- **Spending**: what preparing a video costs and the budget check before it starts.
