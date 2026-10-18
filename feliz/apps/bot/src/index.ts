import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { createRuntime, handleIncoming, isFromRenter, senderPhone } from "./message-handler.js";
import { createPhotonApp } from "./photon.js";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

const runtime = createRuntime();
console.log(`Feliz agent ready. Model: ${runtime.modelId}. Legal search embeds questions with gemini-embedding-001.`);

if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) {
  console.log("Photon is not configured. Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env to connect.");
} else {
  const app = await createPhotonApp();
  console.log("Photon messaging initialized.");

  process.once("SIGINT", () => {
    void app.stop();
  });
  process.once("SIGTERM", () => {
    void app.stop();
  });

  for await (const [space, message] of app.messages) {
    if (!isFromRenter(message)) continue; // skip our own replies echoed back, and non-text
    const phone = senderPhone(message);
    if (!phone) {
      await space.send("I can keep a case only when this message has a phone number.");
      continue;
    }
    try {
      const turn = await handleIncoming(runtime.store, runtime.model, { phone, message: message.content.text });
      for (const text of turn.texts) await space.send(text);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      await space.send("I could not finish that turn. Please send the message again.");
    }
  }
}
