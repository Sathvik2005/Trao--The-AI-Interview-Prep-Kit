import type { InterviewKit } from "../domain/kit-schema.js";
import type { DatabaseStore, SavedKit, SessionRecord, UserRecord } from "./store.js";

/** Non-persistent store for running without MongoDB (local dev, tests). Data is lost on restart. */
export class MemoryStore implements DatabaseStore {
  users: UserRecord[] = [];
  sessions: SessionRecord[] = [];
  kits: SavedKit[] = [];
  storageMode(): "memory" { return "memory"; }
  async initialize() {}
  async close() {}
  async healthCheck() { return true; }
  async findUserByEmail(email: string) { return this.users.find((user) => user.email === email) ?? null; }
  async findUserById(id: string) { return this.users.find((user) => user.id === id) ?? null; }
  async createUser(email: string, password_hash: string) {
    const user = { id: `user-${this.users.length + 1}`, email, password_hash, created_at: new Date().toISOString() };
    this.users.push(user);
    return user;
  }
  async createSession(user_id: string, token_hash: string, expires_at: Date) {
    this.sessions.push({ id: `session-${this.sessions.length + 1}`, user_id, token_hash, expires_at });
  }
  async findSession(token_hash: string) { return this.sessions.find((session) => session.token_hash === token_hash && session.expires_at > new Date()) ?? null; }
  async revokeSession(token_hash: string) { this.sessions = this.sessions.filter((session) => session.token_hash !== token_hash); }
  async listKits(user_id: string) { return this.kits.filter((kit) => kit.user_id === user_id); }
  async createKit(user_id: string, kit: InterviewKit) {
    const record = { id: `kit-${this.kits.length + 1}`, user_id, kit, practice: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.kits.push(record);
    return record;
  }
  async updateKit(user_id: string, kit_id: string, kit: InterviewKit) {
    const record = this.kits.find((item) => item.id === kit_id && item.user_id === user_id);
    if (!record) return null;
    record.kit = kit;
    record.updated_at = new Date().toISOString();
    return record;
  }
  async deleteKit(user_id: string, kit_id: string) {
    const originalLength = this.kits.length;
    this.kits = this.kits.filter((item) => !(item.id === kit_id && item.user_id === user_id));
    return this.kits.length !== originalLength;
  }
  async updatePractice(user_id: string, kit_id: string, flashcard_id: string, confidence: number) {
    const record = this.kits.find((item) => item.id === kit_id && item.user_id === user_id && item.kit.flashcards.some((card) => card.id === flashcard_id));
    if (!record) return null;
    record.practice[flashcard_id] = confidence;
    return record;
  }
}
