import { buildApp } from "./app.js";

const app = buildApp();
await app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
