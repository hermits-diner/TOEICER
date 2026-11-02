// What makes this app TOEICER rather than its siblings built on the same code: the names shown to the user and
// how scores read.

export const BRAND = {
  appName: "TOEICER",
  examName: "TOEIC",
  guideLabel: "TOEIC 가이드",
  /** What a section result is called on screen. */
  scoreName: "점수",
  /** Sections this app practises; TOEIC Listening and Reading. */
  sections: ["listening", "reading"] as const,
  /** Reading time per question: TOEIC Reading allows 75 minutes for 100. */
  secondsPerItem: 45,
  /** Goal choices on the home screen (a section score). */
  goals: ["250", "300", "350", "400", "450", "495"],

  // Read by the files shared with the sibling apps (core.json); src-tauri/src/brand.rs is the Rust side.
  /** Prefix of the app's local storage keys (theme.ts keeps `<prefix>.prefs`). */
  prefix: "toeicer",
  /** This app on the market: the subscribe page is /studio/<marketSlug>/subscribe. */
  marketSlug: "toeic",
  /** Listed first in 설정 › 테마 and used until the user picks another; its colours are in App.css. A light theme. */
  theme: { id: "office", label: "오피스", desc: "TOEICER 기본: 먹색 글씨와 에메랄드 포인트, 오렌지 강조. 깔끔한 업무용 느낌", preview: ["#eef1ef", "#fbfcfb", "#1f2a2e"] },
  /** Accent of the voice that reads a word aloud (단어장, 단어 찾기). */
  speechLang: "en-GB",
  /** Wording of the shared screens where the exams differ. */
  copy: {
    /** 설정 › 본문 글꼴: "<fontUse> 본문에 쓰입니다." and "<fontSample> 이 글꼴로." */
    fontUse: "지문·문항·가이드",
    fontSample: "지문과 문항은",
    /** What keeps working without a Studio subscription (LicensePanel, then StudioGate's shorter form). */
    freeUse: "풀이와 채점, 인쇄는",
    freeUseShort: "풀이·채점·인쇄는",
    /** 단어장: where words are double-clicked from, and the button that reopens a set. */
    wordSource: "지문·스크립트·과제에서",
    reopenSet: "이 세트를 다시 풀기",
  },
  /** The word helper's prompt (vocab.ts) where the exams differ. */
  vocabPrompt: {
    synonyms: "TOEIC questions might use to paraphrase it in this sense",
    /** The sense to explain when there is no sentence. */
    sense: "academic",
  },
} as const;

/** A section score as the app shows it. */
export const formatScore = (n: number) => String(Math.round(n));
