import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { HttpError, readJsonBody } from "../../src/server/local-server.ts";

/** A request body that arrives in the given chunks, as a socket can deliver it. */
function bodyInChunks(chunks: Buffer[]): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe("readJsonBody", () => {
  test("reads a character whose bytes are split across two chunks", async () => {
    const bytes = Buffer.from(JSON.stringify({ text: "♪" }));
    const splitAt = bytes.indexOf(0xe2) + 1;
    const body = bodyInChunks([bytes.subarray(0, splitAt), bytes.subarray(splitAt)]);
    await expect(readJsonBody(body, 1024)).resolves.toEqual({ text: "♪" });
  });

  test("counts the size of the body in bytes, not characters", async () => {
    // Three characters, nine bytes.
    const body = bodyInChunks([Buffer.from("♪♪♪")]);
    const reading = readJsonBody(body, 8);
    await expect(reading).rejects.toBeInstanceOf(HttpError);
    await expect(reading).rejects.toMatchObject({ status: 413 });
  });
});
