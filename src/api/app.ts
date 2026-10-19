import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { z } from "zod";
import { validateKit, type InterviewKit } from "../domain/kit-schema.js";
import { generateInterviewKit, type GenerateKitInput } from "../pipeline/generate-kit.js";
import { hashJwtToken, type DatabaseStore, type SavedKit, type UserRecord } from "./store.js";

interface AppOptions {
  store: DatabaseStore;
  jwtSecret: string;
  allowedOrigins?: string[];
  generateKit?: (input: GenerateKitInput) => Promise<InterviewKit>;
  production?: boolean;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  tokenHash?: string;
}

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();
const createKitSchema = z.object({
  jd: z.string().trim().min(20).max(50_000),
  company_url: z.string().url().max(2048),
  days: z.number().int().min(1).max(60),
}).strict();
const confidenceSchema = z.object({
  flashcard_id: z.string().min(1).max(200),
  confidence: z.number().int().min(1).max(5),
}).strict();

const issuer = "ai-interview-prep-kit";
const audience = "ai-interview-prep-kit-web";

function toPublicKit(saved: SavedKit): Omit<SavedKit, "user_id"> {
  const { user_id: _userId, ...result } = saved;
  return result;
}

function toPublicUser(user: UserRecord): { id: string; email: string; created_at: string } {
  return { id: user.id, email: user.email, created_at: user.created_at };
}

export async function ensureSeedUser(store: DatabaseStore, email: string, password: string): Promise<UserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password.trim();

  if (!normalizedEmail || !normalizedPassword || normalizedPassword.length < 12) {
    return null;
  }

  const existingUser = await store.findUserByEmail(normalizedEmail);
  if (existingUser) {
    return existingUser;
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 12);
  return store.createUser(normalizedEmail, passwordHash);
}

function errorResponse(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

async function authenticate(request: AuthenticatedRequest, response: Response, next: NextFunction, options: AppOptions): Promise<void> {
  const authorization = request.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    errorResponse(response, 401, "UNAUTHENTICATED", "Sign in to continue.");
    return;
  }

  const token = match[1];
  const tokenHash = hashJwtToken(token);
  try {
    const payload = jwt.verify(token, options.jwtSecret, { issuer, audience });
    if (typeof payload === "string" || !payload.sub || typeof payload.sub !== "string") {
      errorResponse(response, 401, "INVALID_TOKEN", "Your session is invalid. Sign in again.");
      return;
    }
    const session = await options.store.findSession(tokenHash);
    if (!session || session.user_id !== payload.sub) {
      errorResponse(response, 401, "SESSION_REVOKED", "Your session has expired. Sign in again.");
      return;
    }
    request.userId = payload.sub;
    request.tokenHash = tokenHash;
    next();
  } catch {
    errorResponse(response, 401, "INVALID_TOKEN", "Your session has expired. Sign in again.");
  }
}

export function createApp(options: AppOptions): express.Express {
  if (options.jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");

  const app = express();
  const origins = new Set(options.allowedOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"]);
  app.disable("x-powered-by");
  app.set("trust proxy", options.production ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin && !origins.has(origin)) {
      errorResponse(response, 403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed.");
      return;
    }
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      callback(null, Boolean(!origin || origins.has(origin)));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  }));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  const generationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.GENERATION_RATE_LIMIT || 5), standardHeaders: "draft-8", legacyHeaders: false });
  const generation = options.generateKit ?? generateInterviewKit;
  const requireUser = (request: Request, response: Response, next: NextFunction) => {
    void authenticate(request as AuthenticatedRequest, response, next, options);
  };

  app.get("/api/health", async (_request, response) => {
    const healthy = await options.store.healthCheck();
    response.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "unavailable",
      persistence: healthy ? options.store.storageMode() : "unavailable",
    });
  });

  app.post("/api/auth/register", authLimiter, async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body);
      const email = input.email.toLowerCase();
      if (await options.store.findUserByEmail(email)) {
        errorResponse(response, 409, "EMAIL_EXISTS", "An account with this email already exists.");
        return;
      }
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await options.store.createUser(email, passwordHash);
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const token = jwt.sign({}, options.jwtSecret, {
        subject: user.id,
        jwtid: randomBytes(16).toString("hex"),
        issuer,
        audience,
        expiresIn: "2h",
      });
      await options.store.createSession(user.id, hashJwtToken(token), expiresAt);
      response.status(201).json({ user: toPublicUser(user), token, expires_at: expiresAt.toISOString() });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        errorResponse(response, 409, "EMAIL_EXISTS", "An account with this email already exists.");
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/login", authLimiter, async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      const user = await options.store.findUserByEmail(input.email.toLowerCase());
      const passwordMatches = await bcrypt.compare(input.password, user?.password_hash ?? "$2a$12$invalid.invalid.invalid.invalid.invalid.invalid.invalid.invalid.");
      if (!user || !passwordMatches) {
        errorResponse(response, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
        return;
      }
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const token = jwt.sign({}, options.jwtSecret, {
        subject: user.id,
        jwtid: randomBytes(16).toString("hex"),
        issuer,
        audience,
        expiresIn: "2h",
      });
      await options.store.createSession(user.id, hashJwtToken(token), expiresAt);
      response.json({ user: toPublicUser(user), token, expires_at: expiresAt.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      await options.store.revokeSession(request.tokenHash!);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const user = await options.store.findUserById(request.userId!);
      if (!user) {
        errorResponse(response, 401, "UNAUTHENTICATED", "Sign in to continue.");
        return;
      }
      response.json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/kits", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kits = await options.store.listKits(request.userId!);
      response.json({ kits: kits.map(toPublicKit) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/kits", requireUser, generationLimiter, async (request: AuthenticatedRequest, response, next) => {
    try {
      const input = createKitSchema.parse(request.body);
      let generated: InterviewKit;
      try {
        generated = validateKit(await generation(input));
      } catch (error) {
        console.error("Kit generation failed:", error instanceof Error ? error.message : "Unknown error");
        errorResponse(response, 502, "GENERATION_FAILED", "The kit could not be generated. Check the URL and provider configuration, then try again.");
        return;
      }
      const saved = await options.store.createKit(request.userId!, generated);
      response.status(201).json({ kit: toPublicKit(saved) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/kits/:id", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kits = await options.store.listKits(request.userId!);
      const kit = kits.find((item) => item.id === request.params.id);
      if (!kit) {
        errorResponse(response, 404, "KIT_NOT_FOUND", "Kit not found.");
        return;
      }
      response.json({ kit: toPublicKit(kit) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/kits/:id", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kit = validateKit(request.body);
      const kitId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
      const updated = await options.store.updateKit(request.userId!, kitId, kit);
      if (!updated) {
        errorResponse(response, 404, "KIT_NOT_FOUND", "Kit not found.");
        return;
      }
      response.json({ kit: toPublicKit(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/kits/:id", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const kitId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
      const deleted = await options.store.deleteKit(request.userId!, kitId);
      if (!deleted) {
        errorResponse(response, 404, "KIT_NOT_FOUND", "Kit not found.");
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/kits/:id/practice", requireUser, async (request: AuthenticatedRequest, response, next) => {
    try {
      const input = confidenceSchema.parse(request.body);
      const kitId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
      const updated = await options.store.updatePractice(request.userId!, kitId, input.flashcard_id, input.confidence);
      if (!updated) {
        errorResponse(response, 404, "FLASHCARD_NOT_FOUND", "Kit or flashcard not found.");
        return;
      }
      response.json({ kit: toPublicKit(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request data is invalid.", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } });
      return;
    }
    console.error(error instanceof Error ? error.message : "Unknown server error");
    errorResponse(response, 500, "INTERNAL_ERROR", "The request could not be completed.");
  });

  return app;
}
