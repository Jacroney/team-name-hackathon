// Dev-only SOS report simulator.
// Streams realistic emergency reports into POST /sos so the console board
// updates live over the realtime WebSocket.
//
// Usage:
//   node scripts/simulate-sos.mjs [count] [intervalMs]
//   BASE=http://localhost:8788 TOKEN=devsos node scripts/simulate-sos.mjs 15 3500

const BASE = process.env.BASE ?? "http://localhost:8788";
const TOKEN = process.env.TOKEN ?? "devsos";
const JURISDICTION = process.env.JURISDICTION ?? "metro-central";
const count = Number(process.argv[2] ?? 15);
const intervalMs = Number(process.argv[3] ?? 3500);

// Rough bounding box around downtown metro-central (Chicago-ish coords).
const CENTER = { lat: 41.8781, lng: -87.6298 };
const jitter = (base, spread) => base + (Math.random() - 0.5) * spread;

const REPORTS = [
  { channel: "voice", text: "There's a fire in my apartment building, third floor, I can see smoke coming from the unit next door." },
  { channel: "voice", text: "My father collapsed and isn't breathing normally, he's 68 and has a heart condition. Please hurry." },
  { channel: "sms", text: "Car accident at the intersection, two vehicles, one person trapped and bleeding." },
  { channel: "voice", text: "I hear someone screaming for help from the river, I think they fell in near the bridge." },
  { channel: "voice", text: "Gas smell is really strong in the whole building hallway, people are coughing." },
  { channel: "sms", text: "Someone broke into the store next to me, they're still inside, I'm hiding in the back." },
  { channel: "voice", text: "Elderly neighbor hasn't answered in two days, mail piling up, I'm worried something happened." },
  { channel: "voice", text: "Kitchen grease fire spreading to the cabinets, we evacuated but it's getting bigger." },
  { channel: "web", text: "Multi-car pileup on the expressway ramp, at least four cars, traffic fully stopped." },
  { channel: "voice", text: "My daughter is having a severe allergic reaction, her face is swelling and she can't breathe well." },
  { channel: "sms", text: "Downed power line sparking on the sidewalk near the school, kids are walking past." },
  { channel: "voice", text: "Flooding in the basement is rising fast, an elderly couple is stuck down there." },
  { channel: "voice", text: "Someone is unconscious on the train platform, bystanders are gathering, no medics yet." },
  { channel: "web", text: "Chemical spill from an overturned truck, strong fumes, several people feeling dizzy." },
  { channel: "voice", text: "Building partially collapsed after a loud boom, dust everywhere, people may be inside." },
  { channel: "sms", text: "Assault in progress in the parking garage level 2, victim is on the ground." },
  { channel: "voice", text: "Wildfire smoke and flames approaching the ridge homes, we need evacuation guidance now." },
  { channel: "voice", text: "Diabetic emergency, my coworker is confused and shaking, he skipped meals all day." },
];

const shuffled = [...REPORTS].sort(() => Math.random() - 0.5);

const send = async (i) => {
  const report = shuffled[i % shuffled.length];
  const payload = {
    idempotencyKey: `sim-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    jurisdictionId: JURISDICTION,
    channel: report.channel,
    text: report.text,
    location: {
      latitude: Number(jitter(CENTER.lat, 0.08).toFixed(5)),
      longitude: Number(jitter(CENTER.lng, 0.08).toFixed(5)),
      accuracyMeters: Math.floor(5 + Math.random() * 40),
    },
  };
  try {
    const res = await fetch(`${BASE}/sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    const id = body.incidentId ?? body.incident?.id ?? "?";
    console.log(`[${i + 1}/${count}] ${res.status} ${id}  ${report.channel.toUpperCase()}  "${report.text.slice(0, 48)}..."`);
  } catch (error) {
    console.log(`[${i + 1}/${count}] ERROR ${String(error)}`);
  }
};

console.log(`Simulating ${count} SOS reports -> ${BASE}/sos every ${intervalMs}ms\n`);
for (let i = 0; i < count; i += 1) {
  await send(i);
  if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
}
console.log("\nDone. Watch the board update live.");
