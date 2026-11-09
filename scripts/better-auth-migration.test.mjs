import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const initial = readFileSync(new URL("../cloudflare/control-plane/migrations/0001_better_auth_1_7_1.sql", import.meta.url), "utf8");
const upgrade = readFileSync(new URL("../cloudflare/control-plane/migrations/0006_better_auth_1_7_3_account_identity.sql", import.meta.url), "utf8");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(initial);
  db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run("fixture-user", "Fixture", "fixture@example.test", 1, 1000, 1000);
  return db;
}

function addAccount(db, id, issuer, provider = "fixture-provider") {
  db.prepare('INSERT INTO "account" (id, issuer, accountId, providerId, userId, accessToken, refreshToken, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, issuer, "fixture-subject", provider, "fixture-user", "fixture-access", "fixture-refresh", "fixture-password-hash", 1000, 2000);
}

function migrate(db) {
  db.exec("BEGIN");
  try { db.exec(upgrade); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

describe("Better Auth 1.7.3 account migration", () => {
  it("preserves accounts, credentials, sessions and retired issuer values", () => {
    const db = fixture();
    try {
      addAccount(db, "fixture-account", "https://issuer.example.test");
      db.prepare('INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)')
        .run("fixture-session", 9000, "fixture-session-token", 1000, 2000, "fixture-user");
      const { issuer, ...before } = db.prepare('SELECT * FROM "account"').get();
      migrate(db);
      expect(db.prepare('SELECT * FROM "account"').get()).toEqual(before);
      expect(db.prepare("SELECT * FROM account_legacy_issuers").get()).toEqual({ accountRowId: "fixture-account", issuer });
      expect(db.prepare('SELECT token FROM "session"').get().token).toBe("fixture-session-token");
      expect(db.prepare('PRAGMA index_list("account")').all().map((index) => index.name)).toContain("account_userId_idx");
      expect(() => db.prepare('INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run("duplicate-account", "fixture-subject", "fixture-provider", "fixture-user", 3000, 3000)).toThrow(/UNIQUE constraint/);
      db.prepare('INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run("new-account", "fixture-subject", "different-provider", "fixture-user", 3000, 3000);
      expect(db.prepare('SELECT COUNT(*) AS n FROM "account"').get().n).toBe(2);
      db.prepare('DELETE FROM "account" WHERE id = ?').run("fixture-account");
      expect(db.prepare("SELECT COUNT(*) AS n FROM account_legacy_issuers").get().n).toBe(0);
      expect(() => db.prepare('INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run("orphan-account", "orphan-subject", "fixture-provider", "missing-user", 3000, 3000)).toThrow(/FOREIGN KEY constraint/);
      db.prepare('DELETE FROM "user" WHERE id = ?').run("fixture-user");
      expect(db.prepare('SELECT COUNT(*) AS n FROM "account"').get().n).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM "session"').get().n).toBe(0);
    } finally { db.close(); }
  });

  it("rejects duplicate provider identities without dropping any original data", () => {
    const db = fixture();
    try {
      addAccount(db, "first-account", "https://first.example.test");
      addAccount(db, "second-account", "https://second.example.test");
      const before = db.prepare('SELECT * FROM "account" ORDER BY id').all();
      expect(() => migrate(db)).toThrow(/UNIQUE constraint/);
      expect(db.prepare('SELECT * FROM "account" ORDER BY id').all()).toEqual(before);
      expect(db.prepare('PRAGMA table_info("account")').all().find((column) => column.name === "issuer").notnull).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('account_legacy_issuers', 'account_providerId_accountId_uidx')").all()).toEqual([]);
      expect(db.prepare('PRAGMA index_list("account")').all().map((index) => index.name)).toEqual(expect.arrayContaining(["account_issuer_accountId_uidx", "account_userId_idx"]));
    } finally { db.close(); }
  });
});
