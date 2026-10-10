# Video links — which links are accepted, and what pasting one starts

> **Prefix** `VID-` · **Suite** [`video-links`](../../../tests/manual/suites/video-links.md) · **Docs** [`chat/attachments`](../../../../../docs/en/platform/chat/attachments.md)

Pasting a link to a video into the chat message field turns the video into an attachment: its
captions are read, or its sound is transcribed. These rules cover which links are accepted,
what pasting the same link again does, how many videos are prepared at once, and what removing
a link does. How a video is fetched and read is not covered; see Not yet.

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

- **How a video is fetched and read**: captions before sound, the languages preferred, and
  the tools that fetch it (`core/video_links/`).
- **Which failures can be retried**, and what a failed link shows (`service.ts`).
- **Reusing a transcript** that was made for the same video before.
- **Spending**: what preparing a video costs and the budget check before it starts.
