# iOS event-stream recovery

An event the phone cannot decode must stop that stream before a later sequence
can advance the replay cursor. Otherwise the next connection can skip an event
that never reached the conversation. An unreadable `hello` must also report an
error instead of leaving the phone on “Connecting…”.

`eventStream` throws `EventStreamError.undecodableFrame` without retaining the
payload, arbitrary event kind, or decoder diagnostics. `Session` shows an offline
message with pull-to-refresh guidance and returns from its retry loop. Pairing
and conversation state remain intact. Pull-to-refresh explicitly opens a new
stream with the last applied cursor; foregrounding can also reconnect through
the existing app lifecycle.

This applies to decoder failures. Future event kinds still become `.unknown`, and
the existing `bot.queued` policy still tolerates unreadable queue entries. A
persistent format error needs a compatible app/server update before replay can
continue. The error does not advance the replay cursor past the unreadable event.

## Verification

The public seam is `eventStream(request:session:)` over a real `URLSession` with
the existing `URLProtocol` origin stub. `EventStreamTests` covers:

- An unreadable message at sequence 5 followed by sequence 6 fails before 6 is
  delivered; applying received frames leaves the cursor at sequence 4.
- A `hello` without a cursor reports an error before the next frame is delivered.
- Invalid JSON produces a fixed recovery message without a payload sentinel.
- A future frame kind is delivered and does not block the next valid frame.
- Incremental delivery, split frames, 401 responses and cancellation still work.

Run `swift test --package-path ios --filter EventStreamTests`, then the complete
package suite with `swift test --package-path ios`. Generate the Xcode project
from `ios/project.yml` and compile the iOS app to verify the `Session` handler.
The package tests do not execute SwiftUI `Session` or establish production
recovery, signing, installation or real-device login.

## Codync provenance and reuse boundaries

The recovery behavior was informed by a read-only review of
[`jaimedhenriques/codync` at `115f0d729574f805706012367855778edbcc8399`](https://github.com/jaimedhenriques/codync/tree/115f0d729574f805706012367855778edbcc8399).
Its [`BotStore+Sync.swift`, lines 138–151](https://github.com/jaimedhenriques/codync/blob/115f0d729574f805706012367855778edbcc8399/apps/ios/Kit/Sources/CodyncUI/Store/BotStore%2BSync.swift#L138-L151)
rewinds once after an undecodable event and checks whether an update is required.
This fix uses an original implementation of the narrower stop-before-skipping
rule. No Codync source, assets, dependencies or runtime were copied.

Codync's root [LICENSE](https://github.com/jaimedhenriques/codync/blob/115f0d729574f805706012367855778edbcc8399/LICENSE)
is Apache 2.0 with a [NOTICE](https://github.com/jaimedhenriques/codync/blob/115f0d729574f805706012367855778edbcc8399/NOTICE).
Its [desktop manifest](https://github.com/jaimedhenriques/codync/blob/115f0d729574f805706012367855778edbcc8399/apps/desktop/package.json)
declares `UNLICENSED`, an inconsistency to resolve before redistributing that
package. Its [brand and cloud policy](https://github.com/jaimedhenriques/codync/blob/115f0d729574f805706012367855778edbcc8399/TRADEMARK.md)
requires separate branding and independently operated accounts and relays for
hosted or multitenant services. These constraints remain relevant to any future
broader reuse; source availability alone does not prove release readiness.
