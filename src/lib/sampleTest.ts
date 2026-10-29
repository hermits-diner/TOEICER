import type { ImportTest } from "./types";

/** Original practice passage written for this app (not taken from any IELTS publication). */
export const sampleTest: ImportTest = {
  title: "샘플: Bees on the Rooftops",
  kind: "reading",
  module: "academic",
  passages: [
    {
      title: "Bees on the Rooftops",
      paragraphs: [
        {
          label: "A",
          text:
            "For most of the twentieth century, beekeeping was regarded as a rural pursuit, practised by farmers and a few dedicated enthusiasts in the countryside. In the 1990s, however, a handful of hobbyists in Paris and London began placing hives on the flat roofs of apartment blocks and office buildings. Their aim was modest: to produce honey for themselves and their neighbours. The idea spread quickly through clubs and online forums, and today estimates suggest that London alone has more than 5,000 registered hives.",
        },
        {
          label: "B",
          text:
            "Urban bees appear to benefit from unusually varied forage. Whereas farmland often consists of a single crop that flowers for only a few weeks, city parks, private gardens and street trees provide a sequence of flowers from early spring until late autumn. Researchers at a French university found that hives in Paris produced, on average, more honey per colony than those in the surrounding countryside. They attributed the difference to this diversity of plants and to the lower use of pesticides in public spaces.",
        },
        {
          label: "C",
          text:
            "The boom has nevertheless raised concerns. Ecologists point out that honeybees compete with wild pollinators, such as solitary bees and bumblebees, for the same nectar and pollen. In districts where the density of hives is high, surveys have recorded fewer wild bee species than in comparable areas with few hives. Some conservation groups now argue that cities should limit the number of new hives rather than encourage them.",
        },
        {
          label: "D",
          text:
            "Supporters of urban beekeeping respond that the hives have an educational value that is hard to measure. Schools that keep bees report that pupils become more interested in biology and more aware of where their food comes from. A compromise appears to be emerging: several city councils now require new beekeepers to plant flowering species alongside each hive they install, so that the supply of food grows with the number of bees.",
        },
      ],
      groups: [
        {
          type: "heading",
          instructions:
            "Questions 1–4. The passage has four paragraphs, A–D. Choose the correct heading for each paragraph from the list of headings below.",
          options: [
            { key: "i", text: "Rising honey prices in Europe" },
            { key: "ii", text: "The spread of a city hobby" },
            { key: "iii", text: "Reasons for higher yields in towns" },
            { key: "iv", text: "A risk to wild species" },
            { key: "v", text: "Training programmes for new beekeepers" },
            { key: "vi", text: "Balancing education and ecology" },
          ],
          questions: [
            { number: 1, prompt: "Paragraph A", answer: ["ii"] },
            { number: 2, prompt: "Paragraph B", answer: ["iii"] },
            { number: 3, prompt: "Paragraph C", answer: ["iv"] },
            { number: 4, prompt: "Paragraph D", answer: ["vi"] },
          ],
        },
        {
          type: "tfng",
          instructions:
            "Questions 5–9. Do the following statements agree with the information given in the passage? Choose TRUE, FALSE or NOT GIVEN.",
          questions: [
            { number: 5, prompt: "The first rooftop beekeepers intended to sell their honey commercially.", answer: ["FALSE"] },
            { number: 6, prompt: "London has more registered hives than Paris.", answer: ["NOT GIVEN"] },
            { number: 7, prompt: "Farmland usually offers bees flowers over a shorter period than cities do.", answer: ["TRUE"] },
            { number: 8, prompt: "The French study found that city hives produced less honey than rural ones.", answer: ["FALSE"] },
            { number: 9, prompt: "Fewer wild bee species were recorded in areas with many hives.", answer: ["TRUE"] },
          ],
        },
        {
          type: "mcq",
          instructions: "Questions 10–12. Choose the correct letter, A, B, C or D.",
          questions: [
            {
              number: 10,
              prompt: "According to paragraph B, hives in Paris produced more honey mainly because of",
              options: [
                { key: "A", text: "warmer temperatures in the city." },
                { key: "B", text: "a variety of flowers and fewer pesticides." },
                { key: "C", text: "larger colonies of bees." },
                { key: "D", text: "better-trained beekeepers." },
              ],
              answer: ["B"],
            },
            {
              number: 11,
              prompt: "What concern do ecologists raise about urban beekeeping?",
              options: [
                { key: "A", text: "Honeybees may spread disease to people." },
                { key: "B", text: "Hives may damage the roofs of buildings." },
                { key: "C", text: "Honeybees compete with wild pollinators for food." },
                { key: "D", text: "Honey may become too cheap to be worth producing." },
              ],
              answer: ["C"],
            },
            {
              number: 12,
              prompt: "What have several city councils introduced?",
              options: [
                { key: "A", text: "a requirement to plant flowers with each new hive" },
                { key: "B", text: "a ban on installing new hives" },
                { key: "C", text: "a tax on the sale of city honey" },
                { key: "D", text: "free hives for local schools" },
              ],
              answer: ["A"],
            },
          ],
        },
        {
          type: "fill",
          instructions:
            "Questions 13–15. Complete the summary below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
          questions: [
            { number: 13, prompt: "City honeybees feed on flowers in parks, private gardens and ________.", answer: ["street trees"] },
            { number: 14, prompt: "Where hives are dense, fewer ________ species have been recorded.", answer: ["wild bee", "wild bees"] },
            { number: 15, prompt: "Schools that keep bees say pupils become more interested in ________.", answer: ["biology"] },
          ],
        },
      ],
    },
  ],
};
