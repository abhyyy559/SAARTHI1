# WeatherGPT — Jury questions and true answers

Every answer below is true of the app on branch
`feat/real-data-offline-qr-redesign` (9 Oct 2026). Where something is not
built, the answer says so. Rehearse these; do not add claims.

## Data and trust

**"Do you use IMD data?"**
"We have an IMD API key and IMD whitelisted our server's IP, but IMD's API
still rejects the key, so the app shows *IMD: Not reachable* in Data sources —
honestly. Every chain tries IMD first and retries every 10 minutes; the day it
is accepted, IMD takes over with no code change. Official alerts meanwhile come
from NDMA SACHET, the national Common Alerting Protocol feed, for all 36 states
and UTs."

**"Open-Meteo isn't official. Why trust it?"**
"We don't present it as official. Open-Meteo serves the same numerical models
the world uses — GFS, ECMWF, ICON, GEM — and we label every number with its
source. The *Do weather models agree?* card shows when the models disagree.
Warnings come only from official alerts; a model can never raise an alert."

**"How do you stop the AI from making things up?"**
"The AI never computes anything. The server fetches the facts and decides the
severity; the model only turns them into simple sentences. Then a validator
checks the answer: it blocks a higher severity than the official one, invented
percentages, claims of a warning that doesn't exist, and 'no warning' when the
warning service couldn't be reached. If the answer fails, or is in the wrong
language, the user gets a fixed template built from the same facts. 393 backend
tests cover these rules."

**"What if the official feed is down?"**
"The card turns grey and says the warning status could not be checked, and
which sources were checked. It never turns green on missing data: absence of
data is not safety."

**"Is 'will it rain tomorrow' just yes/no?"**
"We use IMD's rainfall categories. Under 2.5 mm is 'very light rain, not a
rainy day', so a farmer is never told 'yes, it will rain' for 0.1 mm. 2.5 mm or
more is a rainy day, and heavier rain uses IMD's light / moderate / heavy
names."

## Features

**"Can I ask about another place?"**
"Yes. 'Will it rain in Patna tomorrow?' is answered with Patna's data and the
answer is labelled *Patna, Bihar*; 'what about tomorrow there?' remembers it.
It understands English, 'Patna mein', and common city names in Telugu and
Hindi script. It only switches place on an exact district name, so a wrong
place is never guessed."

**"Where does the farmer / fisherman advice come from?"**
"Fixed rule tables per role (farmer, fisher, driver, outdoor worker,
everyone), driven by the official verdict and the forecast numbers — not by
the AI. Each says it is general guidance, not an official order. The
thresholds are general weather rules; they have not yet been validated by an
agronomist or against a Gramin Krishi Mausam Sewa bulletin."

**"Which NWP models? GFS? WRF?"**
"GFS, ECMWF IFS, GEM and ICON through Open-Meteo, compared side by side for
tomorrow's rain. WRF is not included."

**"Climate and history?"**
"20 years of ERA5 reanalysis for the user's place: last complete year against
the earlier-years normal, for rain and temperature. Ask 'was last year hotter
than usual?' and the chat answers from the same series, naming the years."

**"Languages and voice?"**
"English, Hindi and Telugu, with voice in and out through Sarvam (Indian
speech models) and the browser's voice as a fallback. Every block of text has a
Listen button; units and hazard names are spoken in the user's language. More
languages need the interface strings translated; Sarvam already supports them."

**"How do alerts reach people?"**
"Web push: a phone that turned on alerts gets a lock-screen notification, in
its own language, when the official verdict for its district starts, changes,
escalates or ends — even with the app closed. The server checks each
subscribed district every 5 minutes. SMS, IVR and WhatsApp are not built yet;
they would be extra delivery channels on the same decision."

**"Is there an acknowledgement funnel / officials' dashboard?"**
"The backend records delivered, opened and acknowledged events per district
(`/api/ack`, `/api/coverage`), but there is no officials' screen in the app
yet."

## Offline and phone-to-phone

**"What happens with no internet?"**
"The app is installed and opens offline. Every card shows the last data with
its age ('Saved · 20 min ago'). The chat answers from saved data, clearly
labelled, and sends the question when the network returns. Spoken answers
heard once can be replayed offline."

**"Phone-to-phone relay — Bluetooth? Mesh?"**
"No: QR codes. The Share screen shows a code whose link carries the whole
snapshot inside it — any phone camera opens it, no app, no login, and the data
never touches our server. A text-only code works with no internet at all.
Another phone can scan it in the app and pass it on, up to 5 hops, with the
original time shown. We don't claim a mesh network."

**"SOS?"**
"112, 108, 1077 and 1070 open the phone's dialler, and *Send my location*
uses the phone's own share/SMS — both work without our server and without
internet."

## Engineering

**"Privacy / DPDP?"**
"No accounts. Place, role and chat history stay on the phone. The server
stores only what alerts need, and only if the user turns alerts on: the push
endpoint, district, state, language and role — no name, no number, no GPS
point. A chat question and the facts for it are sent to the language model
(Groq) to phrase the answer."

**"How does it scale?"**
"Costs scale with places, not users: each state feed is fetched once and
shared by everyone in that state; the alert watcher checks each subscribed
district once per pass. The server is stateless FastAPI behind HTTPS. The
language model is the limit on the free tier (8,000 tokens a minute); repeat
questions reuse the answer for 10 minutes and a second model takes over when
the first is rate-limited."

**"Why a PWA, not an Android app?"**
"One app for every phone, installable from the browser, works offline, gets
push alerts, and opens from a QR code with nothing to download."

**"How fast is it?"**
"About 1-3 seconds for an answer; the first words appear in about 1.3 s."
