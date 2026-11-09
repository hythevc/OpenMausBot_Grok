# SquadBots owned release identity

This source increment uses the owned `hythevc/OpenMausBot_Grok` release feed,
the display name `SquadBots`, bundle `ai.squadbots.app`, its share/widget
extensions, and App Group `group.ai.squadbots.app`. Existing author attribution,
LICENSE and NOTICE remain in place. The central About/help/download links use
the owned repository. Some iOS onboarding, settings, share and error strings
still use the inherited product name and need a separate copy pass. These settings do not prove a signed release,
live account service, Apple product catalogue or customer purchase path.

## Distribution stop

`scripts/check-owned-release.mjs` stops the production release workflow. The
`release:check` command exposes the same readiness failure. The iOS pre-build
script stops archive/install and Release device builds. There is no environment
override.

Normal simulator builds and isolated unsigned packaging verification remain
available, including the existing CI package/security smoke jobs. Generated test
artifacts are not approved for distribution. They must use disposable fixture
accounts/data and must not exercise upstream services. Local package creation
does not clear the release stop.

Production distribution remains blocked until compatible account admission and
enrollment, an owned companion control plane, an owned Composio broker, and
installed-client credential migration have verified evidence. The current source
still contains upstream service defaults. They must not be shipped in an owned
product or replaced by guessed domains. The existing commercial authority at
`app.squadbots.ai` has a different contract from the companion control plane.

The account source is in the existing HelixAgents `mybots` project. Reuse that
authority and the reviewed native adapters; do not add another account service,
billing ledger, worker or scheduler to resolve this gate.

## Compatibility boundaries

The `openmausbot` pairing URL scheme, Bonjour names, CLI command, protocol
identifiers (including the coupled CUA host bundle ID), server data paths and speech-helper resource name are retained in
this increment. Pairing emitters and consumers therefore continue to agree.
The iOS App Group and default app Keychain group are the owned identifiers.
Their change does not transfer another app's stored data or credentials.

Electron credentials use the application's user-data directory separately from
conversation data under the existing server path. Product/package identity can
change that directory. No upgrade, automatic migration or existing-install
compatibility is claimed. CUA host identity and privacy-permission migration remain unverified.
Test the selected predecessor and recovery path before
removing the distribution stop. Do not export or copy credentials as a workaround.

## Publication boundaries

The desktop updater points only at `hythevc/OpenMausBot_Grok`. Release automation
retains exact-commit selection, draft defaults, signatures, notarization, complete
asset checks and post-upload digest verification. It has no upstream release
mirror, website deploy hook or npm/Docker publication dispatch.

Registry publication has no workflow job. Locally generated npm compatibility
packages remain `private: true`, retain the existing command and include LICENSE
and NOTICE. A registry release requires its own reviewed namespace and contents.

Remove each distribution blocker only through a reviewed source change with
exact revision, owned-service and installed-device evidence. Public release,
notarization, TestFlight and App Store acceptance remain separate checks.
