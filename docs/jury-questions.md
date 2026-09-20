# WeatherGPT — Jury Questions & Sharp Answers

Rehearse these verbatim. Every answer is true of the code today.

## "Why don't you use the IMD API directly?"

"Because we legally cannot. IMD's official API requires an
institutional registration with a permission letter from the head of
the organization, a whitelisted static outbound IP, and a fresh JWT
every hour. As a student team we meet none of those. So we built a
multi-source architecture — Open-Meteo for forecast, SACHET CAP for
official alerts — that degrades gracefully instead of failing. And our
code tries IMD first in every chain: the day we get credentials, IMD
takes over with zero code changes. The barrier became the architecture."

## "Where do the farmer/fisherman advisories come from? An LLM?"

"No. Our advisories are deterministic rule templates — verified
warning plus persona plus language — with a mandatory caveat that the
guidance is general, not crop/vessel/route-specific. The LLM only
phrases and translates. We do not scrape IMD's agromet bulletins
today; that integration is listed as future work, and we won't claim
otherwise."

## "What if a user files a fake disaster report?"

"Four layers, and honesty about what they don't do: a closed
report-type vocabulary (no free-form 'aliens'), required text,
5-per-hour per-reporter rate limiting, and permanent COMMUNITY labels.
Reports are never auto-promoted to warnings — promotion requires the
official pipeline. We bound harm; we don't claim to verify truth."

## "What if there's no phone in range — the message goes nowhere?"

"Correct, and we say so. Store-and-forward needs a carrier: the packet
waits in the outbox with a 72-hour replay window and 10-hop cap, and
the UI reports pending, never delivered. A mesh carries messages; it
doesn't conjure connectivity. Our demo shows the queue-and-sync truth,
not magic."

## "What if someone in the middle opens the message?"

"They see ciphertext. Every SOS is Fernet-encrypted with an HMAC
signature; relays verify integrity and forward bytes they cannot read.
Tampering fails the integrity check and the packet is dropped — tested.
One honest caveat: the prototype uses a pre-shared key, so production
would need per-user key exchange. The encryption itself is real,
audited-library crypto, not obfuscation."

## "What if the network dies mid-emergency?"

"The app keeps working: last verified warning stays on-device with a
live expiry countdown, chat answers from cached guidance labelled
CACHED, SOS queues locally and syncs on reconnect. And an expired
cached warning renders greyed-out historical — never as active. That's
our second demo if you want it."

## "Why PWA instead of a native app?"

"Our users lose connectivity; a native app that silently fails offline
is worse than a PWA that degrades honestly. Ours installs, precaches
the shell, and tells the user exactly which facts are stale. For
fishermen and farmers, that honesty beats an app-store icon."

## "How do you handle scale?"

"Stateless FastAPI behind any reverse proxy, per-source timeouts and
independent failures, file cache instead of managed infra for the
prototype. The expensive calls (LLM, TTS) happen once per question,
not per user per second. Real scale-out is Render/Vercel configs
already in the repo."

## Live demo script (5 minutes)

1. Ask *"Is there a red alert?"* → refusal with the real severity. (90s)
2. Flip persona farmer → fisherman, same question → advice differs. (60s)
3. Tap mic, ask in Telugu, hear Telugu. (60s)
4. Alerts tab → community report → SOS → sync → simulated A→B→C relay. (90s)
5. If time: kill backend → cached warning + expiry countdown → reconnect toast. (30s)
