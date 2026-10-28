/**
 * Live ATC through Media Source Extensions.
 *
 * LiveATC streams are ~16 kbps MP3. Given one as a plain `src`, browsers
 * buffer tens of kilobytes before playing, which at that bitrate is 15–30
 * seconds of "connecting". Fetching the stream and appending it to a
 * SourceBuffer starts playback after a second or two of audio instead.
 */

/** Seconds of played audio kept behind the playhead before it's released. */
const KEEP_BEHIND_S = 20;
/** How far behind live playback may fall (say, in a throttled tab) before it skips ahead. */
const MAX_LAG_S = 12;

export function canStreamLive(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaSource !== "undefined" &&
    MediaSource.isTypeSupported("audio/mpeg")
  );
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Plays the MP3 stream at `url` through `audio`. Calls `onError` once if the
 * stream fails or ends; the returned function stops it quietly.
 */
export function attachLiveStream(
  audio: HTMLAudioElement,
  url: string,
  onError: () => void,
): () => void {
  const source = new MediaSource();
  const controller = new AbortController();
  const objectUrl = URL.createObjectURL(source);
  let stopped = false;

  const fail = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    onError();
  };

  source.addEventListener(
    "sourceopen",
    async () => {
      URL.revokeObjectURL(objectUrl);
      let buffer: SourceBuffer;
      try {
        buffer = source.addSourceBuffer("audio/mpeg");
        buffer.mode = "sequence";
      } catch {
        fail();
        return;
      }

      const queue: Uint8Array[] = [];
      const pump = () => {
        if (stopped || buffer.updating || queue.length === 0) return;
        const ranges = buffer.buffered;
        if (ranges.length && audio.currentTime - ranges.start(0) > KEEP_BEHIND_S * 2) {
          buffer.remove(ranges.start(0), audio.currentTime - KEEP_BEHIND_S);
          return;
        }
        try {
          buffer.appendBuffer(concat(queue.splice(0)));
        } catch {
          fail();
        }
      };
      buffer.addEventListener("updateend", () => {
        const ranges = buffer.buffered;
        if (ranges.length) {
          const end = ranges.end(ranges.length - 1);
          if (end - audio.currentTime > MAX_LAG_S) audio.currentTime = end - 1;
        }
        pump();
      });

      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          queue.push(value);
          pump();
        }
        fail();
      } catch {
        fail();
      }
    },
    { once: true },
  );

  audio.src = objectUrl;
  return () => {
    stopped = true;
    controller.abort();
  };
}
