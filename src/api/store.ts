import { createHash } from "node:crypto";
import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import type { InterviewKit } from "../domain/kit-schema.js";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
}

export interface SavedKit {
  id: string;
  user_id: string;
  kit: InterviewKit;
  practice: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface DatabaseStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<boolean>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(email: string, passwordHash: string): Promise<UserRecord>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
  listKits(userId: string): Promise<SavedKit[]>;
  createKit(userId: string, kit: InterviewKit): Promise<SavedKit>;
  updateKit(userId: string, kitId: string, kit: InterviewKit): Promise<SavedKit | null>;
  deleteKit(userId: string, kitId: string): Promise<boolean>;
  updatePractice(userId: string, kitId: string, flashcardId: string, confidence: number): Promise<SavedKit | null>;
}

interface MongoUser {
  _id: ObjectId;
  email: string;
  password_hash: string;
  created_at: string;
}

interface MongoSession {
  _id: ObjectId;
  user_id: ObjectId;
  token_hash: string;
  expires_at: Date;
}

interface MongoKit {
  _id: ObjectId;
  user_id: ObjectId;
  kit: InterviewKit;
  practice: Array<{ flashcard_id: string; confidence: number }>;
  created_at: string;
  updated_at: string;
}

function userRecord(record: MongoUser): UserRecord {
  return { id: record._id.toHexString(), email: record.email, password_hash: record.password_hash, created_at: record.created_at };
}

function sessionRecord(record: MongoSession): SessionRecord {
  return { id: record._id.toHexString(), user_id: record.user_id.toHexString(), token_hash: record.token_hash, expires_at: record.expires_at };
}

function kitRecord(record: MongoKit): SavedKit {
  return {
    id: record._id.toHexString(),
    user_id: record.user_id.toHexString(),
    kit: record.kit,
    practice: Object.fromEntries((record.practice ?? []).map((item) => [item.flashcard_id, item.confidence])),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export class MongoStore implements DatabaseStore {
  private readonly client: MongoClient;
  private database?: Db;
  private users?: Collection<MongoUser>;
  private sessions?: Collection<MongoSession>;
  private kits?: Collection<MongoKit>;

  constructor(connectionString: string, databaseName?: string) {
    this.client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 });
    this.databaseName = databaseName;
  }

  private readonly databaseName?: string;

  async initialize(): Promise<void> {
    await this.client.connect();
    this.database = this.client.db(this.databaseName);
    this.users = this.database.collection<MongoUser>("users");
    this.sessions = this.database.collection<MongoSession>("sessions");
    this.kits = this.database.collection<MongoKit>("kits");
    await Promise.all([
      this.users.createIndex({ email: 1 }, { unique: true }),
      this.sessions.createIndex({ token_hash: 1 }, { unique: true }),
      this.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      this.kits.createIndex({ user_id: 1, updated_at: -1 }),
    ]);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.database?.command({ ping: 1 });
      return Boolean(this.database);
    } catch {
      return false;
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const record = await this.users!.findOne({ email });
    return record ? userRecord(record) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    if (!ObjectId.isValid(id)) return null;
    const record = await this.users!.findOne({ _id: new ObjectId(id) });
    return record ? userRecord(record) : null;
  }

  async createUser(email: string, passwordHash: string): Promise<UserRecord> {
    const record: MongoUser = { _id: new ObjectId(), email, password_hash: passwordHash, created_at: new Date().toISOString() };
    await this.users!.insertOne(record);
    return userRecord(record);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.sessions!.insertOne({ _id: new ObjectId(), user_id: new ObjectId(userId), token_hash: tokenHash, expires_at: expiresAt });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const record = await this.sessions!.findOne({ token_hash: tokenHash, expires_at: { $gt: new Date() } });
    return record ? sessionRecord(record) : null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.sessions!.deleteOne({ token_hash: tokenHash });
  }

  async listKits(userId: string): Promise<SavedKit[]> {
    return (await this.kits!.find({ user_id: new ObjectId(userId) }).sort({ updated_at: -1 }).toArray()).map(kitRecord);
  }

  async createKit(userId: string, kit: InterviewKit): Promise<SavedKit> {
    const record: MongoKit = {
      _id: new ObjectId(), user_id: new ObjectId(userId), kit, practice: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    await this.kits!.insertOne(record);
    return kitRecord(record);
  }

  async updateKit(userId: string, kitId: string, kit: InterviewKit): Promise<SavedKit | null> {
    if (!ObjectId.isValid(kitId)) return null;
    const result = await this.kits!.findOneAndUpdate(
      { _id: new ObjectId(kitId), user_id: new ObjectId(userId) },
      { $set: { kit, updated_at: new Date().toISOString() } },
      { returnDocument: "after" },
    );
    return result ? kitRecord(result) : null;
  }

  async deleteKit(userId: string, kitId: string): Promise<boolean> {
    if (!ObjectId.isValid(kitId)) return false;
    const result = await this.kits!.deleteOne({ _id: new ObjectId(kitId), user_id: new ObjectId(userId) });
    return result.deletedCount === 1;
  }

  async updatePractice(userId: string, kitId: string, flashcardId: string, confidence: number): Promise<SavedKit | null> {
    if (!ObjectId.isValid(kitId)) return null;
    const result = await this.kits!.findOneAndUpdate(
      { _id: new ObjectId(kitId), user_id: new ObjectId(userId), "kit.flashcards.id": flashcardId },
      [{
        $set: {
          practice: {
            $concatArrays: [
              { $filter: { input: { $ifNull: ["$practice", []] }, as: "entry", cond: { $ne: ["$$entry.flashcard_id", { $literal: flashcardId }] } } },
              [{ flashcard_id: { $literal: flashcardId }, confidence: { $literal: confidence } }],
            ],
          },
          updated_at: { $literal: new Date().toISOString() },
        },
      }],
      { returnDocument: "after" },
    );
    return result ? kitRecord(result) : null;
  }
}

export function hashJwtToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
