export interface BuiltinVoice {
  value: string;
  label: string;
  desc: string;
  group: "original" | "flagship";
}

/** All 26 xAI built-in voices (5 original + 21 new flagship). Voice IDs are lowercase per API. */
export const BUILTIN_VOICES: BuiltinVoice[] = [
  // Original five (retrained Jul 2026)
  { value: "eve",   label: "Eve",   desc: "Warm female (default)", group: "original" },
  { value: "ara",   label: "Ara",   desc: "Expressive",            group: "original" },
  { value: "leo",   label: "Leo",   desc: "Friendly male",         group: "original" },
  { value: "rex",   label: "Rex",   desc: "Deep male",             group: "original" },
  { value: "sal",   label: "Sal",   desc: "Clear, balanced",       group: "original" },
  // 21 new flagship voices
  { value: "altair",   label: "Altair",   desc: "Bright, uplifting",      group: "flagship" },
  { value: "atlas",    label: "Atlas",    desc: "Strong, authoritative",  group: "flagship" },
  { value: "carina",   label: "Carina",   desc: "Support, patient",       group: "flagship" },
  { value: "castor",   label: "Castor",   desc: "Warm narrator",          group: "flagship" },
  { value: "celeste",  label: "Celeste",  desc: "Ethereal, soft",         group: "flagship" },
  { value: "cosmo",    label: "Cosmo",    desc: "Energetic, upbeat",      group: "flagship" },
  { value: "helios",   label: "Helios",   desc: "Bold, confident",        group: "flagship" },
  { value: "helix",    label: "Helix",    desc: "Technical, precise",     group: "flagship" },
  { value: "iris",     label: "Iris",     desc: "Gentle, calm",           group: "flagship" },
  { value: "kepler",   label: "Kepler",   desc: "Curious, engaging",      group: "flagship" },
  { value: "lumen",    label: "Lumen",    desc: "Warm storyteller",       group: "flagship" },
  { value: "luna",     label: "Luna",     desc: "Soft, soothing",         group: "flagship" },
  { value: "lux",      label: "Lux",      desc: "Polished, premium",      group: "flagship" },
  { value: "naksh",    label: "Naksh",    desc: "Rich, expressive",       group: "flagship" },
  { value: "orion",    label: "Orion",    desc: "Rich, deep",             group: "flagship" },
  { value: "perseus",  label: "Perseus",  desc: "Heroic, dramatic",       group: "flagship" },
  { value: "rigel",    label: "Rigel",    desc: "Commanding",             group: "flagship" },
  { value: "sirius",   label: "Sirius",   desc: "Bright, clear",          group: "flagship" },
  { value: "ursa",     label: "Ursa",     desc: "Grounded, steady",       group: "flagship" },
  { value: "zagan",    label: "Zagan",    desc: "Character, dynamic",     group: "flagship" },
  { value: "zenith",   label: "Zenith",   desc: "Crisp, professional",    group: "flagship" },
];