import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Remove a blocker only in a reviewed change carrying the matching release evidence.
// There is deliberately no environment-variable override for production packaging.
export const OWNED_RELEASE_BLOCKERS = Object.freeze([
  "Compatible SquadBots account admission and enrollment are not integrated and deployed.",
  "Owned companion control-plane and Composio broker contracts are not verified.",
  "Installed-client credential, App Group and Keychain migration is not verified.",
]);

export function assertOwnedReleaseReady() {
  throw new Error(`SquadBots distribution is blocked:\n${OWNED_RELEASE_BLOCKERS.map((reason) => `- ${reason}`).join("\n")}\nSee docs/squadbots-owned-release.md.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertOwnedReleaseReady();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
