export interface BuiltinVoice {
  value: string;
  label: string;
  desc: string;
  group: "original" | "flagship";
}

/** All 27 xAI built-in voices (6 original + 21 flagship). Voice IDs are lowercase per API. */
export const BUILTIN_VOICES: BuiltinVoice[] = [
  // Original six (retrained Jul 2026; Gork is the Grok-app personality voice)
  { value: "eve",   label: "Eve",   desc: "Energetic and upbeat (default)", group: "original" },
  { value: "ara",   label: "Ara",   desc: "Warm and friendly",              group: "original" },
  { value: "leo",   label: "Leo",   desc: "Authoritative and strong",       group: "original" },
  { value: "rex",   label: "Rex",   desc: "Confident and clear",            group: "original" },
  { value: "sal",   label: "Sal",   desc: "Smooth and balanced",            group: "original" },
  { value: "gork",  label: "Gork",  desc: "Playful, irreverent",            group: "original" },
  // 21 flagship voices
  { value: "altair",   label: "Altair",   desc: "Elegant, refined, premium",     group: "flagship" },
  { value: "atlas",    label: "Atlas",    desc: "Confident, commanding",         group: "flagship" },
  { value: "carina",   label: "Carina",   desc: "Soft, empathetic support",      group: "flagship" },
  { value: "castor",   label: "Castor",   desc: "Charismatic, easygoing",        group: "flagship" },
  { value: "celeste",  label: "Celeste",  desc: "Compassionate, reassuring",     group: "flagship" },
  { value: "cosmo",    label: "Cosmo",    desc: "Bright, curious",               group: "flagship" },
  { value: "helios",   label: "Helios",   desc: "Upbeat, versatile",             group: "flagship" },
  { value: "helix",    label: "Helix",    desc: "Bold, dynamic commentary",      group: "flagship" },
  { value: "iris",     label: "Iris",     desc: "Friendly, upbeat",              group: "flagship" },
  { value: "kepler",   label: "Kepler",   desc: "Inventive, charismatic",        group: "flagship" },
  { value: "lumen",    label: "Lumen",    desc: "Warm, articulate storyteller",  group: "flagship" },
  { value: "luna",     label: "Luna",     desc: "Gentle, nurturing education",   group: "flagship" },
  { value: "lux",      label: "Lux",      desc: "Grounded, calmly wise",         group: "flagship" },
  { value: "naksh",    label: "Naksh",    desc: "Warm, thoughtful",              group: "flagship" },
  { value: "orion",    label: "Orion",    desc: "Rich, cinematic narration",     group: "flagship" },
  { value: "perseus",  label: "Perseus",  desc: "Strong, confident",             group: "flagship" },
  { value: "rigel",    label: "Rigel",    desc: "Precise, professional",         group: "flagship" },
  { value: "sirius",   label: "Sirius",   desc: "Quick-witted, playful",         group: "flagship" },
  { value: "ursa",     label: "Ursa",     desc: "Friendly, warm, steadfast",     group: "flagship" },
  { value: "zagan",    label: "Zagan",    desc: "Powerful, dramatic character",  group: "flagship" },
  { value: "zenith",   label: "Zenith",   desc: "Sharp, focused, driven",        group: "flagship" },
];
