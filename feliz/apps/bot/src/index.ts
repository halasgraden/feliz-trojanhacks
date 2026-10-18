import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { createPhotonApp } from "./photon.js";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) {
  console.log("Photon is not configured. Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env to connect.");
} else {
  const app = await createPhotonApp();
  console.log("Photon messaging initialized. Echoing text messages.");

  process.once("SIGINT", () => { void app.stop(); });
  process.once("SIGTERM", () => { void app.stop(); });

  for await (const [space, message] of app.messages) {
    if (message.content.type === "text") {
      await space.send(`echo: ${message.content.text}`);
      console.log("Replied to an iMessage.");
    }
  }
}
