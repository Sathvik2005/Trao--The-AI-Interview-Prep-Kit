import "dotenv/config";
import { join } from "node:path";
import express from "express";
import { MongoStore } from "./api/store.js";
import { createApp } from "./api/app.js";

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const production = process.env.NODE_ENV === "production";

if (!mongoUri) throw new Error("MONGODB_URI is required.");
if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters.");

const origins = (process.env.FRONTEND_ORIGIN || (production ? process.env.PUBLIC_APP_ORIGIN || "" : "http://localhost:5173,http://127.0.0.1:5173"))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const store = new MongoStore(mongoUri, process.env.MONGODB_DATABASE || "interview_prep_kit");

await store.initialize();
const app = createApp({ store, jwtSecret, allowedOrigins: origins, production });
if (production) {
  app.use(express.static(join(process.cwd(), "dist"), { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(join(process.cwd(), "dist", "index.html")));
}

const server = app.listen(port, "0.0.0.0", () => console.log(`Interview Prep Kit listening on port ${port}`));

async function shutdown(): Promise<void> {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
