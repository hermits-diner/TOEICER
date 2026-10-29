/* Where to book and prepare for TOEIC. Fees, dates and test centres change, so the guide links to the official
   pages instead of copying them. */

export const AS_OF = "2026-10-29";

export interface Fee {
  name: string;
  krw: number;
}

/** Left empty on purpose: the guide sends the learner to the official site for the current fee. */
export const FEES: Fee[] = [];

export const FEE_NOTES = [
  "응시료와 시험 일정은 바뀔 수 있습니다. 접수 화면의 금액과 날짜가 최종입니다.",
  "정기 접수와 추가 접수의 응시료가 다를 수 있습니다. 연기·환불 규정은 접수처 약관을 확인하십시오.",
];

export interface Venue {
  org: string;
  city: string;
  name: string;
  address?: string;
}

/** Left empty: test centres are chosen during registration. */
export const VENUES: Venue[] = [];

export interface LinkItem {
  title: string;
  url: string;
  desc: string;
}

export const BOOKING_LINKS: LinkItem[] = [
  { title: "TOEIC 공식 사이트 (ETS)", url: "https://www.ets.org/toeic.html", desc: "시험 소개, 점수와 CEFR 대응, 공식 샘플" },
  { title: "한국 TOEIC 위원회", url: "https://exam.toeic.co.kr", desc: "한국 시험 일정, 접수, 성적 확인" },
];

export const RESOURCE_SITES: LinkItem[] = [
  { title: "ETS — TOEIC Listening and Reading", url: "https://www.ets.org/toeic.html", desc: "시험 형식과 공식 샘플 문제" },
  { title: "한국 TOEIC 위원회", url: "https://exam.toeic.co.kr", desc: "공식 일정·접수·성적 안내" },
];

const yt = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const RESOURCE_YOUTUBE: LinkItem[] = [
  { title: "TOEIC Part 2 연습", url: yt("TOEIC Part 2 practice"), desc: "질의응답 받아쓰기·풀이" },
  { title: "TOEIC Part 5 문법", url: yt("TOEIC Part 5 grammar"), desc: "단문 빈칸 유형별 풀이" },
  { title: "TOEIC Part 7 시간 관리", url: yt("TOEIC Part 7 time management"), desc: "독해 세트 전략" },
];
