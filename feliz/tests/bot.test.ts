import { expect, test } from "vitest";
import { isFromRenter } from "../apps/bot/src/message-handler.js";

const msg = (direction: string | undefined, type = "text") => ({ direction, content: { type } });

test("the bot answers renters, not its own replies echoed back by Photon", () => {
  expect(isFromRenter(msg("inbound"))).toBe(true);
  expect(isFromRenter(msg(undefined))).toBe(true); // providers that don't set direction
  expect(isFromRenter(msg("outbound"))).toBe(false); // our own sent message
  expect(isFromRenter(msg("inbound", "image"))).toBe(false);
});

test("one renter message produces one round of replies, not an endless loop", async () => {
  // Photon's stream: the renter's text, then each reply we send comes back as "outbound".
  const stream = [msg("inbound")];
  let handled = 0;
  for (let i = 0; i < stream.length && i < 50; i++) {
    if (!isFromRenter(stream[i])) continue;
    handled++;
    stream.push(msg("outbound"), msg("outbound")); // the bot sends two texts, both echoed back
  }
  expect(handled).toBe(1);
  expect(stream).toHaveLength(3);
});
