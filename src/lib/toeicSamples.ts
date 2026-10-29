// Built-in TOEIC practice sets, written for this app (not taken from any ETS publication).
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

const PART2: [question: string, responses: string[], answer: string][] = [
  ["When is the budget report due?", ["By the end of the week.", "It's on the second floor.", "Yes, I reported it."], "A"],
  ["Who's leading the training session tomorrow?", ["About two hours.", "Ms. Kim from Human Resources.", "In the main conference room."], "B"],
  ["Would you like me to print the slides for you?", ["The printer is new.", "He slid on the floor.", "Thanks, that would help."], "C"],
  ["Why was the delivery delayed?", ["There was a problem at the warehouse.", "A large delivery truck.", "No, it arrived early."], "A"],
  ["You've already reserved a table for the client dinner, haven't you?", ["The client is from Osaka.", "Yes, for seven o'clock.", "A table and four chairs."], "B"],
];

const part2Passage: ImportPassage = {
  title: "Part 2 · Question-Response",
  body: PART2.map(([q, rs], i) => `Speaker: Number ${i + 1}. ${q}\n\nResponder: ${rs.map((r, k) => `(${L[k]}) ${r}`).join(" ")}`).join("\n\n"),
  groups: [
    {
      type: "lmcq",
      instructions: "You will hear a question or statement and three responses. Select the best response.",
      questions: PART2.map(([, rs, answer], i) => ({ number: i + 1, prompt: `Number ${i + 1}`, options: opts(rs), answer: [answer] })),
    },
  ],
};

const part3a: ImportPassage = {
  title: "Part 3 · Conversation 1",
  body: [
    "Woman: Hi, Daniel. Have you had a chance to look at the new seating plan for the third floor?",
    "Man: I have. I like that the marketing team will sit closer to design, but I'm worried about the noise near the kitchen.",
    "Woman: That's a fair point. Facilities said they could install some sound panels on that wall.",
    "Man: That would help. Could you ask them how long it would take? We're supposed to move on the fifteenth.",
    "Woman: Sure, I'll call them this afternoon and let you know.",
  ].join("\n\n"),
  groups: [
    mcq(6, [
      ["What are the speakers mainly discussing?", ["A new office layout", "A kitchen renovation", "A marketing campaign", "A design competition"], "A"],
      ["What is the man concerned about?", ["The cost of a move", "Noise in a work area", "A missed deadline", "The size of a team"], "B"],
      ["What does the woman say she will do this afternoon?", ["Install some panels", "Visit the third floor", "Contact another department", "Revise a schedule"], "C"],
    ]),
  ],
};

const part3b: ImportPassage = {
  title: "Part 3 · Conversation 2 (with a graphic)",
  body: [
    "Man: Excuse me, I'm here for the product safety workshop. Is it still in Room 204?",
    "Woman: Actually, it was moved because more people signed up. Let me check the schedule. Yes, it's in the auditorium now.",
    "Man: Great. And it starts at ten, right?",
    "Woman: Right. You'll also need a visitor badge. You can pick one up at the front desk on your way.",
  ].join("\n\n"),
  groups: [
    mcq(
      9,
      [
        ["Why was the workshop moved?", ["A room was being repaired.", "More people registered than expected.", "The speaker requested a larger space.", "The time of the event changed."], "B"],
        ["Look at the graphic. Which workshop will the man attend?", ["Customer Service Basics", "Product Safety", "Budget Planning", "Leadership Skills"], "B"],
        ["What does the woman tell the man to do?", ["Sign a form", "Return later", "Get a badge", "Call a manager"], "C"],
      ],
      "Graphic — Workshop Schedule:\n9:00 Customer Service Basics — Room 101\n10:00 Product Safety — Auditorium\n11:00 Budget Planning — Room 204\n1:00 Leadership Skills — Room 305",
    ),
  ],
};

const part4: ImportPassage = {
  title: "Part 4 · Talk (voicemail)",
  body:
    "Speaker: Hello, this is Priya Shah from Greenfield Office Supplies, returning your call about the order of printer paper and ink. Unfortunately, the ink cartridges you requested are out of stock until next Tuesday. We can send the paper today, and the cartridges as soon as they arrive, at no extra shipping cost. If you'd prefer a different brand that we have in stock now, please call me back at 555-0187 before three o'clock so we can include it in today's shipment.",
  groups: [
    mcq(12, [
      ["Who most likely is the speaker?", ["A delivery driver", "A store employee", "A printer technician", "An office manager"], "B"],
      ["What problem does the speaker mention?", ["An item is unavailable.", "A payment failed.", "An address is wrong.", "A machine is broken."], "A"],
      ["Why should the listener call before three o'clock?", ["To cancel an order", "To receive a discount", "To change a delivery date", "To add an item to a shipment"], "D"],
    ]),
  ],
};

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
    { title: "샘플 · Listening (Part 2–4)", kind: "listening", passages: [part2Passage, part3a, part3b, part4] },
    { title: "샘플 · Reading (Part 5–7)", kind: "reading", passages: [part5Passage, part6Passage, part7Passage] },
  ];
}
