# Text to speech — whose replies can be read aloud, and who can hear them

> **Prefix** `TTS-` · **Docs** [`chat/voice-mode`](../../../../../docs/en/platform/chat/voice-mode.md)

A reply in chat can be read aloud. It is turned into audio piece by piece, as the listener
gets to each piece. These rules cover which replies a person can have read aloud and who can
play the audio. The limits on length and rate, the budget, and the switches that turn voice
output on and off are not covered; see Not yet.

## Whose replies can be read aloud

### TTS-R1 · A person can have a reply read aloud only in a thread of their own

The reply must be a message of that thread. A request that names a message of another thread
is refused (`FORBIDDEN`), and the refusal is written to the audit log.

- **Example**: Mia asks for audio of a message that belongs to Noah's thread, naming one of
  her own threads → refused, and the audit log records the attempt.

### TTS-R2 · Only the owner of a thread can play the audio of its replies

Being in the same organization is not enough. Someone else who holds the address of an audio
piece is answered as if it did not exist.

- **Example**: Noah obtains the address of an audio piece from Mia's thread → he gets nothing.

## Producing the audio

### TTS-R3 · One piece of a reply is produced once, even when asked for twice at once

The second request is told that the piece is already being produced, and no second one is
started.

- **Example**: Mia's browser asks for the same piece of a reply from two tabs at the same
  moment → one piece of audio is produced.

## Not yet

- **Limits and cost**: how long a piece and a reply can be, how often a person and an
  organization can ask, and the budget check before audio is produced (`service.ts`).
- **Turning voice output on and off**: the organization's policy, a person's default and the
  setting of one thread.
- **How long audio is kept**, and the cleanup of expired pieces.
- **What happens when the voice provider fails**, and the error a listener gets.
