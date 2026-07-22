# Flare Net Presentation Design

## Goal

Create a three-minute personal presentation for Flare Net: 90 seconds of live storytelling and product framing followed by a 90-second demo video. The deck should connect a team member's experience of recurring floods in Ghana to specific emergency-response problems, show how those problems shaped Flare Net, and close with a high-level Cloudflare architecture.

## Audience Takeaway

The audience should leave with one clear idea: Flare Net turns fragmented requests for help into trusted, responder-ready incidents, even when disaster conditions overload normal communication and coordination.

## Narrative Principles

- Lead with recurring flooding as a public crisis, not as an isolated personal event.
- Use the team member's firsthand experience to make the crisis concrete.
- Keep the personal account separate from externally reported facts.
- Derive every highlighted feature from a specific observed response problem.
- Keep a human dispatcher in control of consequential decisions.
- Present the technical slide as the intended Flare Net system architecture.
- Avoid unsupported performance claims such as a quantified reduction in response time.

## Timing

| Section | Time |
| --- | ---: |
| Slides 1-2: crisis and personal experience | 30 seconds |
| Slides 3-4: response gaps and Flare Net | 35 seconds |
| Slide 5: technical overview | 20 seconds |
| Slide 6: demo handoff | 5 seconds |
| Demo video | 90 seconds |

## Slide Sequence

### Slide 1: A Recurring Crisis

**Purpose:** Establish that flooding is a recurring emergency affecting Ghanaian communities.

**Headline:** `When the rain comes, entire communities can be cut off overnight.`

**Supporting facts:**

- On June 29, 2026, heavy rain beginning around 10 p.m. flooded parts of Accra and Greater Accra.
- Homes and roads were submerged, residents were trapped, and vulnerable people required evacuation.
- Use one short source line in the footer rather than a block of statistics.

**Visual:** Full-bleed flood image with a dark overlay, a restrained location/date label, and one dominant sentence. Do not begin with a product screenshot.

### Slide 2: For Our Teammate, It Was Personal

**Purpose:** Let the team member describe what the recurring crisis felt like firsthand.

**On-slide language:** Use a short first-person quote assembled from the supplied account, such as: `We woke up to water filling homes. Streets became rivers. Cars were swept away, and people who could not swim had nowhere to go.` The speaker can add detail verbally about damaged walls, children, older people, and the difficulty of finding help.

**Visual:** One portrait or contextual image with no more than three short lines of text. The teammate speaks; the slide does not reproduce the full transcript.

### Slide 3: Where Emergency Response Breaks

**Purpose:** Convert the experience into a concise problem-to-feature model.

| Observed problem | Flare Net response |
| --- | --- |
| Many people need help simultaneously | Prioritized incident queue |
| Callers cannot clearly communicate their location | Map-based incident pings and structured location |
| Calls disconnect or networks become unstable | Progressive incident saving and delayed synchronization |
| Languages differ | Live transcription and translation |
| Mobility and accessibility risks are discovered late | Structured accessibility and vulnerability fields |
| Information arrives across calls, messages, and updates | One evidence-linked incident report |

**Visual:** A left-to-right transformation rather than a dense matrix: problem fragments flow into one organized incident packet.

### Slide 4: Flare Net

**Purpose:** State the product clearly before showing its architecture.

**Headline:** `From a call for help to a responder-ready incident.`

**Flow:** `Calls and messages -> AI-assisted intake -> evidence-linked incident -> dispatcher approval -> responders`

**Key boundary:** A human dispatcher remains the authorized decision-maker. AI assists with transcription, translation, extraction, summaries, and recommendations.

**Visual:** Use the Flare Net console UI as the hero image, emphasizing the queue, map, incident report, evidence, and dispatch decision panel.

### Slide 5: Built for Disaster Conditions

**Purpose:** Give a memorable high-level technical overview without turning the pitch into an architecture lecture.

**Resilience story:**

- Local-first capture retains incident updates during connectivity loss.
- Delayed synchronization sends queued updates when connectivity returns.
- Phone and SMS provide lower-bandwidth intake paths alongside the web experience.
- Realtime status makes stale or disconnected feeds visible to dispatchers.

**Cloudflare architecture:**

- Cloudflare Workers: intake and API layer
- Durable Objects: realtime coordination for each incident or jurisdiction
- D1: structured incidents, lifecycle state, and audit history
- R2: photos, audio, video, and supporting evidence
- Queues: absorb intake surges and process work asynchronously
- Workers AI: transcription, translation, fact extraction, and summaries
- Workers Static Assets: delivery of the dispatcher console

**Visual:** A simple architecture strip with three layers: `People and channels`, `Cloudflare coordination`, and `Dispatchers and responders`. Keep product logos secondary to the disaster-resilience story.

### Slide 6: Demo

**Purpose:** Transfer attention cleanly to the product video.

**Headline:** `See how fragmented information becomes coordinated action.`

**Visual:** A clean frame from the console with a large play treatment. Do not repeat architecture details.

## Demo Story

The 90-second video should show one complete incident path:

1. A flood-related request enters through a call or message.
2. Flare Net progressively creates an incident instead of waiting for intake to finish.
3. The interface surfaces location, urgency, people involved, accessibility needs, missing information, and source evidence.
4. Translation or transcript provenance is shown briefly.
5. The dispatcher reviews the recommendation, remains in control, and approves simulated dispatch.
6. The incident status updates and preserves an audit trail.

## Visual Direction

- Match the Flare Net console's dark command-center visual language.
- Use near-black navy backgrounds, cool blue information accents, amber warnings, red critical states, and green confirmation states.
- Use IBM Plex Sans for presentation text and IBM Plex Mono for timestamps, locations, labels, and technical annotations.
- Prefer one strong visual and one sentence per slide.
- Avoid generic startup gradients, decorative glass cards, dense bullet lists, and excessive Cloudflare logos.
- Keep flood imagery respectful; avoid identifiable victims or graphic imagery.

## Source Handling

- Personal account: supplied by a Flare Net team member in conversation on July 22, 2026.
- External context: Citi Newsroom, `Accra Floods: Homes submerged, residents trapped as roads are blocked`, June 29, 2026.
- Product decisions and problem framing: Flare Net knowledge-base project page and Crisis Mesh PRD handoff.
- Clearly distinguish personal testimony, reported facts, product assumptions, and intended architecture.

## Delivery Format

- Primary format: the provided Google Slides presentation titled `flare net`.
- Canvas: widescreen 16:9.
- Keep all text editable and place source notes in speaker notes or a restrained footer.
- The Figma UI file is a visual reference for product styling; the presentation should not depend on access to editable Figma assets.
