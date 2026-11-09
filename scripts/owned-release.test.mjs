import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { assertOwnedReleaseReady } from "./check-owned-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const workflow = parse(read(".github/workflows/release.yml"));
const builder = parse(read("electron-builder.yml"));
const ios = parse(read("ios/project.yml"));
const cleanEnv = { PATH: process.env.PATH, TMPDIR: os.tmpdir(), LANG: "en_US.UTF-8" };
const directories = [];
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squadbots-release-"));
  directories.push(dir);
  return dir;
};
afterEach(() => directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const macStep = (name) => workflow.jobs.mac.steps.find((step) => step.name === name).run;

describe("owned native distribution boundary", () => {
  it("uses the owned desktop feed and draft-only default", () => {
    expect(builder.appId).toBe("ai.squadbots.app");
    expect(builder.productName).toBe("SquadBots");
    expect(builder.publish).toEqual([{ provider: "github", owner: "hythevc", repo: "OpenMausBot_Grok" }]);
    expect(workflow.jobs.prepare.if).toBe("github.repository == 'hythevc/OpenMausBot_Grok'");
    expect(workflow.on.workflow_dispatch.inputs.publish.default).toBe(false);
    expect(workflow.jobs.assemble.permissions).toEqual({ contents: "write" });
  });

  it("cannot mirror upstream, invoke website hooks or dispatch registry publishing", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).not.toMatch(/milind-soni|RELEASES_PAT|gh workflow run|DEPLOY_HOOK/);
    const mirror = parse(read(".github/workflows/sync-published-release.yml"));
    expect(Object.keys(mirror.on)).toEqual(["workflow_dispatch"]);
    expect(JSON.stringify(mirror)).not.toMatch(/secrets\.|gh release|uses|curl/);
    expect(mirror.jobs.explain.steps[0].run).toContain("exit 1");
    for (const [file, jobs] of [["npm-package", ["publish-npm", "update-github-release"]], ["docker", ["publish"]]]) {
      const doc = parse(read(`.github/workflows/${file}.yml`));
      for (const job of jobs) expect(doc.jobs[job]).toBeUndefined();
      expect(read(`.github/workflows/${file}.yml`)).not.toMatch(/npm publish|push: true|docker\/login-action/);
    }
  });

  it("retains signature, notarization, server smoke and exact asset verification", () => {
    const release = read(".github/workflows/release.yml");
    for (const gate of ["codesign --verify --deep --strict", "xcrun notarytool submit", "xcrun stapler staple", "scripts/smoke-packaged-server.mjs", "asset.digest", "okHash", "okSize", "needs.prepare.outputs.sha"]) {
      expect(release).toContain(gate);
    }
    expect(read("LICENSE")).toContain("Apache License");
    expect(read("NOTICE")).toContain("OpenMausBot");
  });

  it("blocks distribution while leaving isolated package verification available", () => {
    expect(builder.beforePack).toBeUndefined();
    expect(() => assertOwnedReleaseReady()).toThrow("Owned companion control-plane");
    const result = spawnSync(process.execPath, [path.join(root, "scripts/check-owned-release.mjs")], { env: cleanEnv, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SquadBots distribution is blocked");
    expect(read("scripts/check-owned-release.mjs")).not.toContain("process.env");
    expect(JSON.parse(read("package.json")).scripts["package:prepare"]).not.toContain("release:check");
    expect(workflow.jobs.prepare.steps.some((step) => step.run === "node scripts/check-owned-release.mjs")).toBe(true);
  });

  it("keeps every iOS target gated and aligns the app-group consumers", () => {
    for (const target of Object.values(ios.targets)) {
      expect(target.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toMatch(/^ai\.squadbots\.app(?:\.|$)/);
      expect(target.preBuildScripts[0].script).toContain("check-owned-ios-release.sh");
      expect(target.preBuildScripts[0].basedOnDependencyAnalysis).toBe(false);
      expect(target.preBuildScripts[0].showEnvVars).toBe(false);
    }
    const main = ios.targets.OpenMausCompanion;
    expect(main.info.properties.CFBundleDisplayName).toBe("SquadBots");
    expect(main.entitlements.properties["com.apple.security.application-groups"]).toEqual(["group.ai.squadbots.app"]);
    expect(read("ios/AppShared/OpenMausSharedConfiguration.swift")).toContain('appGroupIdentifier = "group.ai.squadbots.app"');
    expect(read("ios/AppShared/OpenMausSharedConfiguration.swift")).toContain('legacyAppBundleIdentifier = "ai.squadbots.app"');
    expect(read("ios/ExportOptions.plist")).toContain("<string>4QGB5QX6RN</string>");
  });

  it("preserves the pairing scheme in configuration, emitter and parser", () => {
    expect(builder.protocols[0].schemes).toContain("openmausbot");
    expect(ios.targets.OpenMausCompanion.info.properties.CFBundleURLTypes[0].CFBundleURLSchemes).toContain("openmausbot");
    expect(read("server/cli.ts")).toContain("openmausbot://pair?");
    expect(read("ios/Sources/CompanionCore/Client.swift")).toContain('url.scheme?.lowercased() == "openmausbot"');
  });
});

describe.skipIf(process.platform === "win32")("real release commands with disposable fixtures", () => {
  it.each([
    [{ ACTION: "install", CONFIGURATION: "Debug", PLATFORM_NAME: "iphoneos" }, 1],
    [{ ACTION: "build", CONFIGURATION: "Release", PLATFORM_NAME: "iphoneos" }, 1],
    [{ ACTION: "build", CONFIGURATION: "Release", PLATFORM_NAME: "iphonesimulator" }, 0],
    [{ ACTION: "build", CONFIGURATION: "Debug", PLATFORM_NAME: "iphonesimulator" }, 0],
  ])("refuses distribution while allowing simulator verification: %j", (variables, status) => {
    const result = spawnSync("/bin/sh", [path.join(root, "scripts/check-owned-ios-release.sh")], { env: { ...cleanEnv, ...variables }, encoding: "utf8" });
    expect(result.status).toBe(status);
    if (status) expect(result.stderr).toContain("SquadBots distribution is blocked");
  });

  it("accepts both owned updater files and rejects an upstream feed", () => {
    const dir = fixture();
    const write = (arch, owner) => {
      const resources = path.join(dir, "release", arch, "SquadBots.app", "Contents", "Resources");
      fs.mkdirSync(resources, { recursive: true });
      fs.writeFileSync(path.join(resources, "app-update.yml"), `owner: ${owner}\nrepo: OpenMausBot_Grok\n`);
    };
    for (const arch of ["mac-arm64", "mac"]) write(arch, "hythevc");
    const run = () => execFileSync("/bin/bash", ["-e", "-c", macStep("Gate: both packaged apps use the canonical updater feed")], { cwd: dir, env: cleanEnv, stdio: "pipe" });
    expect(run).not.toThrow();
    write("mac", "milind-soni");
    expect(run).toThrow();
  });

  it("rejects a Windows feed with the right repository name under the wrong owner", () => {
    const doc = parse(read(".github/workflows/package-win.yml"));
    const command = doc.jobs.package.steps.find((step) => step.name === "verify the packaged tree").run;
    const start = command.indexOf("grep -Eq '^owner:");
    const end = command.indexOf("# while the build is unsigned", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const dir = fixture();
    const run = (owner) => {
      fs.writeFileSync(path.join(dir, "app-update.yml"), `owner: ${owner}\nrepo: OpenMausBot_Grok\n`);
      return spawnSync("/bin/bash", ["-e", "-c", `res=.; fail=0; ${command.slice(start, end)}\nexit "$fail"`], { cwd: dir, env: cleanEnv, encoding: "utf8" });
    };
    expect(run("hythevc").status).toBe(0);
    expect(run("milind-soni").status).toBe(1);
  });

  it("refuses replacement when a release becomes published before asset upload", () => {
    const dir = fixture();
    fs.mkdirSync(path.join(dir, "assets"));
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "assets", "fixture.zip"), "fixture");
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/bin/sh\ncase "$*" in\n  *upload*) echo unexpected-upload >> upload.log; exit 1;;\n  *isDraft*) echo false;;\n  *targetCommitish*) echo fixture-sha;;\n  api*) echo fixture-sha;;\n  *) exit 0;;\nesac\n`, { mode: 0o755 });
    const command = workflow.jobs.assemble.steps.find((step) => step.name === "Create or update the canonical draft").run;
    const result = spawnSync("/bin/bash", ["-e", "-o", "pipefail", "-c", command], {
      cwd: dir,
      env: { ...cleanEnv, PATH: `${path.join(dir, "bin")}:${cleanEnv.PATH}`, VERSION: "1.2.3", SHA: "fixture-sha", GITHUB_REPOSITORY: "hythevc/OpenMausBot_Grok" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("refusing to replace published assets");
    expect(fs.existsSync(path.join(dir, "upload.log"))).toBe(false);
  });

  it("copies the actual branded DMGs without losing architecture identity", () => {
    const dir = fixture();
    fs.mkdirSync(path.join(dir, "release"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    for (const arch of ["arm64", "x64"]) fs.writeFileSync(path.join(dir, "release", `SquadBots-1.2.3-${arch}.dmg`), arch);
    execFileSync("/bin/bash", ["-e", "-c", macStep("Stable-named copies for the README's /latest/download links")], { cwd: dir, env: cleanEnv, stdio: "pipe" });
    expect(fs.readFileSync(path.join(dir, "release/SquadBots.dmg"), "utf8")).toBe("arm64");
    expect(fs.readFileSync(path.join(dir, "release/SquadBots-intel.dmg"), "utf8")).toBe("x64");
  });
});

it("generates a private compatibility package with owned metadata and notices", () => {
  const dir = fixture();
  for (const subdir of ["scripts", "dist-server", "dist"]) fs.mkdirSync(path.join(dir, subdir));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  fs.copyFileSync(path.join(root, "scripts/build-npm-package.mjs"), path.join(dir, "scripts/build-npm-package.mjs"));
  for (const file of ["dist-server/index.js", "dist-server/openmausbot.js", "dist/index.html", "LICENSE", "NOTICE"]) fs.writeFileSync(path.join(dir, file), `fixture ${file}`);
  execFileSync(process.execPath, [path.join(dir, "scripts/build-npm-package.mjs")], { env: cleanEnv, stdio: "pipe" });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "release/npm/package.json"), "utf8"));
  expect(manifest.private).toBe(true);
  expect(manifest.repository.url).toBe("https://github.com/hythevc/OpenMausBot_Grok.git");
  expect(manifest.bin).toEqual({ openmausbot: "cli.js" });
  expect(manifest.files).toContain("NOTICE");
  expect(fs.readFileSync(path.join(dir, "release/npm/NOTICE"), "utf8")).toBe("fixture NOTICE");
});
