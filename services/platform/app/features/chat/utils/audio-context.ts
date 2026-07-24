/** Window globals for the (optionally WebKit-prefixed) AudioContext constructor. */
export interface AudioContextGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}
