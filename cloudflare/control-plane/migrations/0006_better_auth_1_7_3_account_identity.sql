-- Better Auth 1.7.3+ recognizes providerId/accountId and no longer writes issuer.
-- Source: https://better-auth.com/docs/guides/1-7-upgrade-guide
-- Preserve the retired values for an operator-reviewed rollback before removing
-- the old NOT NULL column. Do not merge duplicate provider identities silently.
CREATE TABLE account_legacy_issuers (
  accountRowId TEXT NOT NULL PRIMARY KEY REFERENCES "account" ("id") ON DELETE CASCADE,
  issuer TEXT NOT NULL
);

INSERT INTO account_legacy_issuers (accountRowId, issuer)
SELECT "id", "issuer" FROM "account";

-- A duplicate requires operator reconciliation while the original data remains.
CREATE UNIQUE INDEX account_providerId_accountId_uidx
ON "account" ("providerId", "accountId");

DROP INDEX account_issuer_accountId_uidx;
ALTER TABLE "account" DROP COLUMN "issuer";
