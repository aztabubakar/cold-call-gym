import { buildApp } from "./app.js";
import { validateGatewayConfig } from "./lib/config.js";

const configResult = validateGatewayConfig(process.env);
if (!configResult.ok) {
  // Fail fast and loudly rather than starting and only discovering a
  // missing Gemini credential on the first real call.
  console.error(`voice-gateway: refusing to start — ${configResult.message}`);
  process.exit(1);
}

const app = buildApp();
await app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
