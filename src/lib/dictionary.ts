/** Offline English-Korean dictionary: Korean Wiktionary entries (CC BY-SA 4.0), built by scripts/build-dict.py. */

export interface Sense {
  pos: string;
  ipa: string;
  glosses: string[];
  example: string;
}

export interface Entry {
  /** The headword found, which may differ from the clicked form ("began" → "begin"). */
  word: string;
  senses: Sense[];
}

type Raw = Record<string, [string, string, string[], string][]>;

let data: Promise<Raw> | null = null;

function load(): Promise<Raw> {
  data ??= fetch("/dict/en-ko.json").then((r) => {
    if (!r.ok) throw new Error("사전 파일을 불러오지 못했습니다.");
    return r.json() as Promise<Raw>;
  });
  data.catch(() => (data = null)); // allow a retry
  return data;
}

const IRREGULAR: Record<string, string> = {
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
  has: "have", had: "have", having: "have", does: "do", did: "do", done: "do",
  said: "say", made: "make", went: "go", gone: "go", took: "take", taken: "take", came: "come",
  saw: "see", seen: "see", knew: "know", known: "know", got: "get", gotten: "get", gave: "give",
  given: "give", found: "find", thought: "think", told: "tell", became: "become", left: "leave",
  felt: "feel", brought: "bring", began: "begin", begun: "begin", kept: "keep", held: "hold",
  wrote: "write", written: "write", stood: "stand", heard: "hear", meant: "mean", met: "meet",
  ran: "run", paid: "pay", sat: "sit", spoke: "speak", spoken: "speak", lay: "lie", lain: "lie",
  led: "lead", grew: "grow", grown: "grow", lost: "lose", fell: "fall", fallen: "fall", sent: "send",
  built: "build", understood: "understand", drew: "draw", drawn: "draw", broke: "break",
  broken: "break", spent: "spend", rose: "rise", risen: "rise", drove: "drive", driven: "drive",
  bought: "buy", wore: "wear", worn: "wear", chose: "choose", chosen: "choose", sought: "seek",
  threw: "throw", thrown: "throw", caught: "catch", dealt: "deal", won: "win", fought: "fight",
  taught: "teach", ate: "eat", eaten: "eat", flew: "fly", flown: "fly", forgot: "forget",
  forgotten: "forget", hid: "hide", hidden: "hide", shook: "shake", shaken: "shake", sold: "sell",
  slept: "sleep", stole: "steal", stolen: "steal", struck: "strike", swam: "swim", swum: "swim",
  woke: "wake", woken: "wake", bore: "bear", borne: "bear", fed: "feed", fled: "flee", froze: "freeze",
  frozen: "freeze", laid: "lay", lent: "lend", rode: "ride", ridden: "ride", rang: "ring", rung: "ring",
  sang: "sing", sung: "sing", sank: "sink", sunk: "sink", sprang: "spring", sprung: "spring",
  stuck: "stick", stung: "sting", swore: "swear", sworn: "swear", tore: "tear", torn: "tear",
  undertook: "undertake", undertaken: "undertake", withdrew: "withdraw", withdrawn: "withdraw",
  children: "child", men: "man", women: "woman", people: "person", feet: "foot", teeth: "tooth",
  mice: "mouse", geese: "goose", lives: "life", wives: "wife", knives: "knife", leaves: "leaf",
  halves: "half", selves: "self", analyses: "analysis", hypotheses: "hypothesis", crises: "crisis",
  theses: "thesis", phenomena: "phenomenon", criteria: "criterion", data: "datum", media: "medium",
  better: "good", best: "good", worse: "bad", worst: "bad", less: "little", least: "little",
  more: "many", most: "many", further: "far", farther: "far",
};

/** British → American spellings tried when the British form is missing (and the reverse). */
const SPELLING: [RegExp, string][] = [
  [/our$/, "or"],
  [/ours$/, "ors"],
  [/ise$/, "ize"],
  [/ised$/, "ized"],
  [/ising$/, "izing"],
  [/isation$/, "ization"],
  [/yse$/, "yze"],
  [/tre$/, "ter"],
  [/ogue$/, "og"],
  [/ence$/, "ense"],
  [/lled$/, "led"],
  [/lling$/, "ling"],
  [/or$/, "our"],
  [/ize$/, "ise"],
];

/** Base forms worth looking up for a word as it appears in text, most likely first. */
export function candidates(raw: string): string[] {
  const w = raw.toLowerCase().replace(/[’']s$/, "").replace(/[^a-z-]/g, "");
  if (!w) return [];
  const out = [w];
  const add = (s: string | undefined) => s && s.length > 1 && !out.includes(s) && out.push(s);
  add(IRREGULAR[w]);
  const doubled = (s: string) => (/([b-df-hj-np-tv-z])\1$/.test(s) ? s.slice(0, -1) : undefined);
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    add(doubled(w.slice(0, -2)));
  }
  if (w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + "e");
    add(doubled(w.slice(0, -3)));
  }
  if (w.endsWith("ier")) add(w.slice(0, -3) + "y");
  if (w.endsWith("iest")) add(w.slice(0, -4) + "y");
  if (w.endsWith("er")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    add(doubled(w.slice(0, -2)));
  }
  if (w.endsWith("est")) {
    add(w.slice(0, -3));
    add(w.slice(0, -2));
  }
  if (w.endsWith("ily")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ly")) add(w.slice(0, -2));
  for (const base of [...out]) for (const [re, to] of SPELLING) if (re.test(base)) add(base.replace(re, to));
  return out;
}

/** Looks a word up, trying its inflected and alternative spellings. null when nothing matches. */
export async function lookup(word: string): Promise<Entry | null> {
  const dict = await load();
  for (const c of candidates(word)) {
    const hit = dict[c];
    if (hit) return { word: c, senses: hit.map(([pos, ipa, glosses, example]) => ({ pos, ipa, glosses, example })) };
  }
  return null;
}

/** Starts loading in the background so the first lookup is instant. */
export function preloadDictionary(): void {
  void load().catch(() => {});
}

export const DICTIONARY_CREDIT = "위키낱말사전(ko.wiktionary.org) · CC BY-SA 4.0";
