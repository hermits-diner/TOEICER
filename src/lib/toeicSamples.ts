// Built-in TOEIC practice sets, written for this app (not taken from any ETS publication).
import { audioJob, photoJob, sampleAudioName, samplePhotoName, type SampleAudioJob, type SamplePhotoJob } from "./sampleMedia";
// Types only: the generator itself stays out of the Reader build.
import type { P12, P3, P4, RawMcq } from "./toeicGen";
import type { SpeakerInfo, SynthTurn } from "./tts";
import type { ImportGroup, ImportPassage, ImportTest } from "./types";

const L = ["A", "B", "C", "D"];
const opts = (texts: string[]) => texts.map((text, i) => ({ key: L[i], text }));

type Q = [prompt: string, options: string[], answer: string];
const mcq = (start: number, qs: Q[], instructions?: string): ImportGroup => ({
  type: "mcq",
  instructions,
  questions: qs.map(([prompt, options, answer], i) => ({ number: start + i, prompt, options: opts(options), answer: [answer] })),
});

/* ---------- Listening ---------- */

// Written in the generator's draft form (toeicGen.ts) and laid out the way its listeningTest lays out a generated set:
// Part 1 photographs read by a narrator, Part 2 in passages of five read by a woman (question) and a man (responses),
// Part 3 conversations between a woman and a man, Part 4 talks by one speaker, a graphic as "Graphic\n…" in the
// directions. A third of the real Listening test (100 questions): every part, both kinds of Part 3 and Part 4 set, and
// Part 2 long enough to show its passages of five. Unlike a generated set, the keys stay where they are written here.

export const listeningDrafts: { p12: P12; p3: P3; p4: P4 } = {
  p12: {
    photos: [
      {
        scene:
          "Inside a bright warehouse, a man in a yellow safety vest and work gloves bends slightly to set a cardboard box down on a flat, four-wheeled hand cart that already holds two boxes. He stands on the floor beside the cart. Tall metal shelving units full of boxes line the aisle behind him. He is the only person in the picture.",
        statements: ["He's climbing a ladder.", "He's pushing a cart through a doorway.", "He's putting a box on a cart.", "Some shelves are being assembled."],
        answer: "C",
      },
      {
        scene:
          "In a modern meeting room, three coworkers in business-casual clothes, two women and a man, sit side by side at a wooden table looking at an open laptop. One of the women points at the laptop screen with her finger while the other two watch. Some papers and two coffee mugs rest on the table. A large window with raised blinds is behind them.",
        statements: ["A woman is pointing at a screen.", "A man is pouring coffee into a mug.", "They're arranging chairs around a table.", "The window blinds are being lowered."],
        answer: "A",
      },
      {
        scene:
          "In a small café, a female barista in a dark apron stands behind the counter and hands a paper cup of coffee across the counter to a male customer, who reaches out to take it. An espresso machine is on the counter behind her, and clean cups are already stacked on a shelf. Daylight comes in through a window.",
        statements: ["The man is wiping the counter.", "The woman is writing on a menu board.", "Some cups are being stacked on a shelf.", "A drink is being handed to a customer."],
        answer: "D",
      },
    ],
    qr: [
      { question: "Where should I put these boxes of printer paper?", responses: ["In the supply closet, please.", "Yes, I printed them yesterday.", "About twenty boxes."], answer: "A" },
      { question: "When does the new receptionist start?", responses: ["At the front desk.", "Yes, she's very experienced.", "I haven't heard yet."], answer: "C" },
      { question: "Would you like to join us for lunch at the café downstairs?", responses: ["A table by the window.", "Sure, I'll be ready in five minutes.", "Lunch was delicious, thanks."], answer: "B" },
      { question: "Why is the elevator out of service?", responses: ["On the fifth floor.", "It's being inspected this morning.", "The service was excellent."], answer: "B" },
      { question: "Who's in charge of ordering office supplies?", responses: ["You should ask Ms. Ramirez in accounting.", "Usually by email.", "Yes, I ordered them."], answer: "A" },
      { question: "Should we hold the workshop in the morning or the afternoon?", responses: ["It's a two-day workshop.", "I worked late last night.", "Most people prefer the morning."], answer: "C" },
      { question: "The quarterly sales figures look much better than last year's.", responses: ["Yes, the new advertising campaign really helped.", "He's our new sales manager.", "Every quarter of an hour."], answer: "A" },
      { question: "Haven't you finished the client presentation yet?", responses: ["A presentation on marketing.", "He presented it very well.", "I'm adding the last two slides now."], answer: "C" },
      { question: "Can you send me the hotel confirmation number?", responses: ["It's a four-star hotel.", "Didn't you get my email this morning?", "A double room, please."], answer: "B" },
      { question: "Let's ask the tech support team to update our software.", responses: ["They're already working on it.", "A new laptop computer.", "Our team won the game."], answer: "A" },
    ],
  },
  p3: {
    sets: [
      {
        title: "New seating plan",
        speakers: { A: { role: "Woman", gender: "female" }, B: { role: "Man", gender: "male" } },
        turns: [
          { speaker: "A", text: "Hi, Daniel. Have you seen the new seating plan for the third floor? Facilities sent it out this morning." },
          { speaker: "B", text: "I have. I like that our marketing team will sit closer to the designers, but I'm worried about the noise near the kitchen." },
          { speaker: "A", text: "That's a fair point. People do gather there to chat during their breaks." },
          { speaker: "B", text: "Exactly. It might be hard to concentrate, especially during phone calls with clients." },
          { speaker: "A", text: "Facilities mentioned they could put up some sound panels on that wall. I'll call them this afternoon and ask how long that would take." },
          { speaker: "B", text: "Thanks. We're supposed to move on the fifteenth, so it would be great to have them in place before then." },
        ],
        graphic: "",
        questions: [
          { prompt: "What are the speakers mainly discussing?", options: ["A kitchen renovation", "A new office layout", "A marketing campaign", "A design competition"], answer: "B" },
          { prompt: "What is the man concerned about?", options: ["The cost of a move", "The size of a team", "A missed deadline", "Noise in a work area"], answer: "D" },
          { prompt: "What does the woman say she will do this afternoon?", options: ["Contact another department", "Install some panels", "Visit the third floor", "Revise a schedule"], answer: "A" },
        ],
      },
      {
        title: "Business cards",
        speakers: { A: { role: "Woman", gender: "female" }, B: { role: "Man", gender: "male" } },
        turns: [
          { speaker: "A", text: "Good morning. Welcome to Rapid Print. How can I help you?" },
          { speaker: "B", text: "Hi. I need business cards for a new employee at my company. I was going to order 250 of them." },
          { speaker: "A", text: "Certainly. Do you have a design ready, or would you like to choose one of our templates?" },
          { speaker: "B", text: "We have our own design. Actually, she'll be meeting a lot of clients at a trade show next month, so let's go with the next size up." },
          { speaker: "A", text: "Good idea. If you email us the design file today, the cards will be ready on Thursday." },
          { speaker: "B", text: "Perfect. I'll send it as soon as I get back to my office." },
        ],
        graphic: "Business Card Prices\n100 cards — $25\n250 cards — $45\n500 cards — $70\n1,000 cards — $120",
        questions: [
          { prompt: "Where most likely does the woman work?", options: ["At a print shop", "At a bank", "At a furniture store", "At a travel agency"], answer: "A" },
          { prompt: "Look at the graphic. How much will the man most likely pay?", options: ["$25", "$45", "$70", "$120"], answer: "C" },
          { prompt: "What will the man do when he returns to his office?", options: ["Call a manager", "Send a file", "Interview a job applicant", "Pick up an order"], answer: "B" },
        ],
      },
      {
        title: "Conference travel",
        speakers: { A: { role: "Man", gender: "male" }, B: { role: "Woman", gender: "female" } },
        turns: [
          { speaker: "A", text: "Sofia, have you booked your flight to the conference in Denver yet?" },
          { speaker: "B", text: "Not yet. I was planning to do it today, but the fares have gone up a lot since last week." },
          { speaker: "A", text: "Have you tried the company travel portal? We get a discount with two of the major airlines." },
          { speaker: "B", text: "Oh, I didn't know about that. Where can I find it?" },
          { speaker: "A", text: "It's on the intranet, under the Finance tab. But you'll need an approval code from your manager first." },
          { speaker: "B", text: "Well, Mr. Lopez is on vacation until Monday." },
          { speaker: "A", text: "In that case, ask his assistant, Rachel. She handles approvals while he's away." },
          { speaker: "B", text: "Great. I'll send her a message right now." },
        ],
        graphic: "",
        questions: [
          { prompt: "What are the speakers mainly discussing?", options: ["Planning a client visit", "Changing a vacation schedule", "Choosing a conference topic", "Booking business travel"], answer: "D" },
          {
            prompt: 'What does the woman mean when she says, "Mr. Lopez is on vacation until Monday"?',
            options: ["She will travel to Denver on Monday.", "She cannot get a code from her manager right away.", "She needs to reschedule a meeting.", "She has already made a reservation."],
            answer: "B",
          },
          { prompt: "What will the woman most likely do next?", options: ["Call an airline", "Attend a conference", "Contact an assistant", "Update a budget report"], answer: "C" },
        ],
      },
    ],
  },
  p4: {
    sets: [
      {
        title: "Order update",
        genre: "voicemail",
        speaker: { role: "Woman", gender: "female" },
        text: "Hello, this is Priya Shah from Greenfield Office Supplies, returning your call about your order of printer paper and ink. I'm afraid the ink cartridges you asked for are out of stock until next Tuesday. We can send the paper today and the cartridges as soon as they arrive, at no extra shipping cost. Or, if you'd prefer a different brand that we have in stock now, we can include it in today's shipment. Just call me back before three o'clock this afternoon and let me know which you'd like.",
        graphic: "",
        questions: [
          { prompt: "Who most likely is the speaker?", options: ["A delivery driver", "A printer technician", "A store employee", "An office manager"], answer: "C" },
          { prompt: "What problem does the speaker mention?", options: ["An item is unavailable.", "A payment failed.", "An address is incorrect.", "A machine is broken."], answer: "A" },
          { prompt: "Why should the listener call before three o'clock?", options: ["To cancel an order", "To receive a discount", "To change a delivery address", "To make a decision about an order"], answer: "D" },
        ],
      },
      {
        title: "Survey results",
        genre: "meeting excerpt",
        speaker: { role: "Man", gender: "male" },
        text: "Good morning, everyone. Before we open, I'd like to share the results of last month's customer survey. Thanks again to all of you for handing out the forms at the register. As you can see on the chart, the most common request was for longer opening hours. Unfortunately, we can't do that until we hire more staff. So instead, we'll start with the second most popular request. We should have it ready by the end of the month. One more thing: from now on, the work schedule will be posted on Thursdays instead of Fridays, so you'll have more time to plan your weekends.",
        graphic: "Customer Survey: Most Requested Improvements\nLonger opening hours — 42%\nOnline ordering — 31%\nMore outdoor seating — 17%\nA larger menu — 10%",
        questions: [
          { prompt: "Where does the speaker most likely work?", options: ["At a restaurant", "At a bank", "At a library", "At a fitness center"], answer: "A" },
          { prompt: "Look at the graphic. Which improvement will be made first?", options: ["Longer opening hours", "Online ordering", "More outdoor seating", "A larger menu"], answer: "B" },
          {
            prompt: "What change does the speaker announce?",
            options: ["Staff will receive new uniforms.", "The business will open earlier.", "A new manager will start work.", "Work schedules will be posted earlier in the week."],
            answer: "D",
          },
        ],
      },
      {
        title: "Factory tour",
        genre: "tour",
        speaker: { role: "Woman", gender: "female" },
        text: "Welcome to the Lindell Chocolate Factory, and thank you for joining today's tour. My name is Grace, and I'll be your guide for the next hour. We'll begin in the room where the cocoa beans are roasted, and then we'll watch our team wrap the chocolate bars by hand. While we're on the factory floor, please keep your safety glasses on at all times. You're welcome to take photos, but please turn off your camera's flash, because it can distract the workers. At the end of the tour, everyone will receive a free sample of our newest flavor, which goes on sale in stores next month.",
        graphic: "",
        questions: [
          { prompt: "Who most likely is the speaker?", options: ["A store clerk", "A safety inspector", "A tour guide", "A photographer"], answer: "C" },
          { prompt: "What are the listeners asked to do on the factory floor?", options: ["Wear safety glasses", "Leave their bags in a locker", "Stay behind a yellow line", "Sign a visitor log"], answer: "A" },
          { prompt: "What will the listeners receive at the end of the tour?", options: ["A discount coupon", "A product sample", "A factory map", "A souvenir photo"], answer: "B" },
        ],
      },
    ],
  },
};

const NARRATOR: SpeakerInfo = { role: "Narrator", gender: "male", accent: "american" };
const info = (s: { role: string; gender: "female" | "male" }): SpeakerInfo => ({ role: s.role, gender: s.gender, accent: "american" });

/** A passage's speech (and Part 1 photograph) as the generator would ask Gemini for them. */
export interface SampleMedia {
  passage: number;
  turns: SynthTurn[];
  speakers: Record<string, SpeakerInfo>;
  audio: SampleAudioJob;
  photo?: SamplePhotoJob;
}

/** The Listening set (questions 1–31) and the media of its passages; mirrors listeningTest in toeicGen.ts. */
export function listeningSample(): { test: ImportTest; media: SampleMedia[] } {
  const { p12, p3, p4 } = listeningDrafts;
  let n = 0;
  const next = () => ++n;
  const passages: ImportPassage[] = [];
  const media: SampleMedia[] = [];
  const add = (p: ImportPassage, turns: SynthTurn[], speakers: Record<string, SpeakerInfo>, photoPrompt?: string) => {
    const id = `q${p.groups[0].questions[0].number}`;
    const m: SampleMedia = { passage: passages.length, turns, speakers, audio: audioJob(id, turns, speakers, media.length) };
    if (photoPrompt) {
      m.photo = photoJob(id, photoPrompt);
      p.groups[0].image = samplePhotoName(m.photo);
    }
    p.audio = sampleAudioName(m.audio);
    media.push(m);
    passages.push(p);
  };
  const group = (qs: RawMcq[], graphic: string): ImportGroup => ({
    type: "mcq",
    instructions: graphic ? `Graphic\n${graphic}` : undefined,
    questions: qs.map((q) => ({ number: next(), prompt: q.prompt, options: opts(q.options), answer: [q.answer] })),
  });

  p12.photos.forEach((p, i) => {
    const num = next();
    add(
      {
        title: `Part 1 · Photograph ${i + 1}`,
        body: p.statements.map((s, k) => `Narrator: (${L[k]}) ${s}`).join("\n\n"),
        groups: [
          {
            type: "lmcq",
            instructions: "Look at the picture. Select the statement that best describes it.",
            questions: [{ number: num, prompt: `Number ${num}`, options: opts(p.statements), answer: [p.answer] }],
          },
        ],
      },
      [{ speaker: "N", text: `Number ${num}. Look at the picture. ${p.statements.map((s, k) => `(${L[k]}) ${s}`).join(" ")}` }],
      { N: NARRATOR },
      `A realistic, natural-looking photograph for an English test: ${p.scene} No text, signs with words, or logos.`,
    );
  });

  for (let start = 0; start < p12.qr.length; start += 5) {
    const chunk = p12.qr.slice(start, start + 5);
    const numbers = chunk.map(() => next());
    add(
      {
        title: `Part 2 · ${numbers[0]}–${numbers[numbers.length - 1]}`,
        body: chunk.map((q, k) => `Speaker: Number ${numbers[k]}. ${q.question}\n\nResponder: ${q.responses.map((r, j) => `(${L[j]}) ${r}`).join(" ")}`).join("\n\n"),
        groups: [
          {
            type: "lmcq",
            instructions: "Listen to the question or statement and the three responses. Select the best response.",
            questions: chunk.map((q, k) => ({ number: numbers[k], prompt: `Number ${numbers[k]}`, options: opts(q.responses), answer: [q.answer] })),
          },
        ],
      },
      chunk.flatMap((q, k) => [
        { speaker: "Q", text: `Number ${numbers[k]}. ${q.question}` },
        { speaker: "R", text: q.responses.map((r, j) => `(${L[j]}) ${r}`).join(" ") },
      ]),
      { Q: { role: "Speaker", gender: "female", accent: "american" }, R: { role: "Responder", gender: "male", accent: "american" } },
    );
  }

  p3.sets.forEach((s, i) =>
    add(
      {
        title: `Part 3 · Conversation ${i + 1} (${s.title})`,
        body: s.turns.map((t) => `${s.speakers[t.speaker].role}: ${t.text}`).join("\n\n"),
        groups: [group(s.questions, s.graphic)],
      },
      s.turns,
      Object.fromEntries(Object.entries(s.speakers).map(([k, v]) => [k, info(v)])),
    ),
  );

  p4.sets.forEach((s, i) =>
    add(
      { title: `Part 4 · Talk ${i + 1} (${s.genre})`, body: `${s.speaker.role}: ${s.text}`, groups: [group(s.questions, s.graphic)] },
      [{ speaker: "S", text: s.text }],
      { S: info(s.speaker) },
    ),
  );

  return { test: { title: "샘플 · Listening (Part 1–4)", kind: "listening", passages }, media };
}

/** Everything the built-in Listening set has Gemini read, for scripts/sample-audio.mjs. */
export const toeicSampleAudioJobs = (): SampleAudioJob[] => listeningSample().media.map((m) => m.audio);
/** Every Part 1 photograph the built-in Listening set shows, for scripts/sample-photos.mjs. */
export const toeicSamplePhotoJobs = (): SamplePhotoJob[] => listeningSample().media.flatMap((m) => (m.photo ? [m.photo] : []));

/* ---------- Reading ---------- */

const PART5: Q[] = [
  ["All employees must ------- their time sheets by Friday at noon.", ["submit", "submits", "submitting", "submission"], "A"],
  ["The new software is ------- easier to use than the previous version.", ["much", "very", "so", "too"], "A"],
  ["Ms. Rivera will lead the meeting ------- Mr. Chen is traveling.", ["during", "while", "because of", "despite"], "B"],
  ["Please contact the help desk if you have ------- questions about the system.", ["any", "every", "each", "much"], "A"],
  ["The factory has increased production ------- 20 percent this year.", ["at", "by", "on", "for"], "B"],
  ["Customers who ------- before March 1 will receive a free gift.", ["register", "registers", "registration", "registered"], "A"],
  ["The report was ------- prepared and contained no errors.", ["careful", "carefully", "care", "caring"], "B"],
  ["Our sales team ------- the target for three consecutive quarters.", ["has exceeded", "exceeding", "to exceed", "exceed"], "A"],
  ["Mr. Park asked that the documents ------- to him by courier.", ["be sent", "are sent", "sending", "sent"], "A"],
  ["The conference room is available ------- 2:00 P.M. and 4:00 P.M.", ["among", "within", "between", "from"], "C"],
];

const part5Passage: ImportPassage = {
  title: "Part 5 · Incomplete Sentences",
  body: "A word or phrase is missing in each of the sentences below. Select the best answer to complete the sentence.",
  groups: [mcq(1, PART5)],
};

const part6Passage: ImportPassage = {
  title: "Part 6 · Text Completion (email)",
  body: [
    "To: All Staff",
    "From: Facilities Department",
    "Subject: Parking Garage Maintenance",
    "The parking garage on Elm Street will be closed for repairs from June 3 to June 7. During this period, employees ---(11)--- to park in the visitor lot behind Building C. ---(12)--- . Shuttle buses will run every fifteen minutes between the lot and the main entrance.",
    "We understand that this may cause some ---(13)--- . Thank you for your patience while we make these ---(14)--- improvements.",
  ].join("\n\n"),
  groups: [
    mcq(11, [
      ["(11)", ["are permitted", "permitting", "to permit", "permission"], "A"],
      [
        "(12)",
        [
          "The garage was built more than twenty years ago.",
          "Please display your staff pass on the dashboard.",
          "Visitors are always welcome at our offices.",
          "The repairs were completed ahead of schedule.",
        ],
        "B",
      ],
      ["(13)", ["inconvenience", "inconvenient", "inconveniently", "inconvenienced"], "A"],
      ["(14)", ["necessity", "necessary", "necessarily", "necessitate"], "B"],
    ], "Read the text. A word, phrase, or sentence is missing in parts of the text. Select the best answer to complete the text."),
  ],
};

const part7Passage: ImportPassage = {
  title: "Part 7 · Text-message chain",
  body: [
    "Kenji Mori (9:12 A.M.): Are you still at the printer's? The client wants twenty more brochures for Thursday's trade show.",
    "Alicia Grant (9:14 A.M.): I'm here now. They have enough paper, but the color proof needs your approval first.",
    "Kenji Mori (9:15 A.M.): Can you send me a photo of it?",
    "Alicia Grant (9:17 A.M.): Just did. The blue looks a little darker than on screen.",
    "Kenji Mori (9:20 A.M.): That's fine. Go ahead and order them.",
  ].join("\n\n"),
  groups: [
    mcq(15, [
      ["Why does Mr. Mori contact Ms. Grant?", ["To request extra copies of a document", "To cancel a trade show booth", "To change a printing company", "To schedule a client meeting"], "A"],
      ["At 9:20 A.M., what does Mr. Mori most likely mean when he writes, \"That's fine\"?", ["He agrees to a higher price.", "He accepts the color of the proof.", "He will pick up the brochures himself.", "He has received the client's payment."], "B"],
    ]),
  ],
};

export function toeicSampleTests(): ImportTest[] {
  return [
    listeningSample().test,
    { title: "샘플 · Reading (Part 5–7)", kind: "reading", passages: [part5Passage, part6Passage, part7Passage] },
  ];
}
