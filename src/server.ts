import "dotenv/config";
import { setServers } from "node:dns";
import { join } from "node:path";
import express from "express";
import { MemoryStore } from "./api/memory-store.js";
import { MongoStore, type DatabaseStore } from "./api/store.js";
import { createApp, ensureSeedUser } from "./api/app.js";

if (process.env.DNS_SERVERS) setServers(process.env.DNS_SERVERS.split(",").map((server) => server.trim()).filter(Boolean));

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const production = process.env.NODE_ENV === "production";

if (!mongoUri && production) throw new Error("MONGODB_URI is required in production.");
if (production && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required in production.");
if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters.");

const origins = (process.env.FRONTEND_ORIGIN || (production ? process.env.PUBLIC_APP_ORIGIN || "" : "http://localhost:5173,http://127.0.0.1:5173"))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (!mongoUri) console.warn("MONGODB_URI is not set: using the in-memory store. Accounts and kits are lost on restart.");
let store: DatabaseStore = mongoUri ? new MongoStore(mongoUri, process.env.MONGODB_DATABASE || "interview_prep_kit") : new MemoryStore();

try {
  await store.initialize();
} catch (error) {
  if (production || !mongoUri) throw error;
  console.warn(`MongoDB unreachable (${error instanceof Error ? error.message : error}): falling back to the in-memory store for development.`);
  store = new MemoryStore();
  await store.initialize();
}

const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase();
const testPassword = process.env.TEST_PASSWORD?.trim();
if (testEmail && testPassword) {
  const seededUser = await ensureSeedUser(store, testEmail, testPassword);
  if (seededUser) {
    console.log(`Seeded demo account for ${seededUser.email}.`);
  }
}

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
