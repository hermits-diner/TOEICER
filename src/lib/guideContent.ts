/* TOEIC Listening and Reading orientation content. Stable format facts only; fees, dates and policies change, so
   those point to the official sites. */

export interface GuideBlock {
  title: string;
  items: string[];
}

export interface GuideSection {
  id: string;
  label: string;
  lead: string;
  facts?: [string, string][];
  blocks: GuideBlock[];
}

export const OFFICIAL_URL = "https://www.ets.org/toeic.html";
export const OFFICIAL_LABEL = "ets.org/toeic";

/**
 * ETS maps TOEIC Listening and Reading scores to CEFR levels; `band` is the total of the two section minimums,
 * shown as a pill, and the description names the section minimums.
 */
export const BAND_MEANINGS: { band: number; name: string; desc: string }[] = [
  { band: 945, name: "CEFR C1 · Listening 490 · Reading 455 이상", desc: "복잡한 회의·보고서·계약 문서를 세부까지 이해하고, 함축된 의미와 어조를 파악합니다." },
  { band: 785, name: "CEFR B2 · Listening 400 · Reading 385 이상", desc: "업무 대화와 공지, 일반 비즈니스 문서를 무리 없이 이해합니다. 낯선 주제나 빠른 말에서 가끔 놓칩니다." },
  { band: 550, name: "CEFR B1 · Listening 275 · Reading 275 이상", desc: "익숙한 업무·일상 상황의 분명한 말과 짧은 글의 요지와 주요 정보를 이해합니다." },
  { band: 225, name: "CEFR A2 · Listening 110 · Reading 115 이상", desc: "자주 쓰는 표현과 짧고 간단한 안내문·메시지를 이해합니다." },
  { band: 120, name: "CEFR A1 · Listening 60 · Reading 60 이상", desc: "아주 기본적인 단어와 표현만 이해합니다." },
];

export const SECTIONS: GuideSection[] = [
  {
    id: "app",
    label: "앱 사용법",
    lead: "TOEICER는 두 가지 판이 있습니다. 무료인 TOEICER는 문제 세트 파일을 열어 실제처럼 듣고 풀고, 채점하고, 복습하고, TOEIC 시험지처럼 인쇄합니다. 월 구독인 TOEICER Studio는 여기에 AI 출제와 내 자료 변환, 세트 편집, 세트 파일 내보내기를 더합니다. 모든 데이터는 이 PC에만 저장됩니다.",
    blocks: [
      {
        title: "문제 세트 열기 (두 판 공통)",
        items: [
          "마켓에서 산 세트나 선생님·친구가 보낸 세트 파일(.toic)을 두 번 누르거나, '세트 파일 열기'에서 고르면 라이브러리에 들어옵니다. Listening 음성과 Part 1 사진도 함께 들어옵니다. 예전 .toeicset 파일도 열립니다.",
          "처음 실행하면 샘플 세트(Listening Part 2–4, Reading Part 5–7)가 들어 있어 바로 풀어 볼 수 있습니다.",
          "세트마다 영역(Listening·Reading)과 출처(샘플 · AI 생성 · 내 자료 · 공유 파일 · 마켓 구매)가 표시됩니다.",
        ],
      },
      {
        title: "풀기, 채점, 인쇄 (두 판 공통)",
        items: [
          "Part 1·2는 실제 시험처럼 선택지 문장이 화면에 나오지 않고 A·B·C(·D) 단추만 보입니다. 채점 후에 문장과 스크립트를 볼 수 있습니다. 음성이 없는 세트는 스크립트를 Windows 영어 음성으로 읽습니다.",
          "Reading은 문항당 45초(100문항 75분) 기준으로 시간이 줄어듭니다. 제출하면 정답 수와 영역별 예상 점수(5–495)를 보여 주고, 틀린 문항은 오답 노트에 모입니다. AI 구독 CLI가 있으면 오답 해설도 받을 수 있습니다(선택).",
          "풀이 화면의 인쇄 버튼으로 TOEIC 문제지처럼 편집된 시험지와 답안지, 정답·채점표를 인쇄하거나 PDF로 저장합니다. 백업은 설정 › 데이터에서 합니다.",
        ],
      },
      {
        title: "Studio: AI로 만들기",
        items: [
          "PC에 설치해 구독 계정으로 로그인해 둔 Claude Code(Claude Pro·Max), Codex CLI(ChatGPT Plus·Pro), Antigravity CLI(Google 계정) 중 하나를 앱이 대신 실행합니다. API 과금 대신 구독 한도를 씁니다.",
          "Listening 음성과 Part 1 사진은 CLI로 만들 수 없어 Gemini API 키를 씁니다(설정 › AI › 음성·사진). 키가 없으면 Part 1은 사진 대신 장면 설명으로, 음성은 Windows 영어 음성으로 대신합니다.",
          "파트를 골라 만들거나, 모든 파트를 골라 200문항 한 회분을 Listening(1–100)과 Reading(101–200) 두 세트로 만듭니다. 목표 점수(600+ · 750+ · 900+)에 따라 문항 난이도 구성이 달라집니다.",
          "만들기 전에 한국 TOEIC 위원회와 ETS 공식 사이트를 읽어 현재 시험 구성과 공고된 변경을 요약하고(일주일마다 다시 확인), 그 내용을 출제 지시에 넣습니다. 공식 사이트 내용이 앱의 시험 형식(2016년 개정 200문항 구성)과 다르면 경고합니다.",
          "만든 문제는 파트별 문항 수·선택지 수·빈칸 표시·지문 길이를 기계로 재고, 정답만 유난히 긴 선택지 같은 단서도 잡아 어긋나면 다시 씁니다. Part 2는 최근 시험처럼 간접·우회 응답이 30% 이상 나오게 씁니다.",
          "사람 검수 대신 독립 검증을 거칩니다. 다른 구독 CLI가 로그인돼 있으면 그 AI가 스크립트와 지문의 문법·사실 오류를 교정하고, 정답을 가린 채(Listening은 스크립트로) 풀며 애매한 문항을 표시합니다. 풀이가 엇갈리거나 애매한 문항은 정답을 고치거나 빼고, 뺀 문항은 한 번 더 새로 써서 다시 검증합니다. 검증 기록은 세트와 세트 파일에 함께 남습니다.",
        ],
      },
      {
        title: "Studio: 내 자료 넣기와 편집",
        items: [
          "'붙여넣기·PDF'에 학원 프린트나 교재의 TOEIC 문제를 붙여넣거나 PDF를 열면, AI가 내용을 고치지 않고 파트·지문·문항·선택지(A–D)·정답으로 나눕니다. 정답표가 없으면 AI가 풀어 정하고 표시하니 확인 후 저장하세요.",
          "Listening 문항은 스크립트가 함께 있을 때만 들어옵니다. 편집기에서 Gemini로 음성을 만들거나, 스크립트를 Windows 음성으로 들으며 풀 수 있습니다.",
          "AI 생성 세트와 내 자료는 문구·정답을 고칠 수 있고, 세트 파일로 내보내 공유할 수 있습니다. 내 자료는 마켓에 올릴 수 없고, 마켓에서 산 세트는 고치거나 내보낼 수 없습니다.",
          "Studio는 처음 14일 무료 체험 뒤 월 구독입니다. 설정 › Studio 구독에서 마켓의 구독 키를 등록합니다.",
        ],
      },
    ],
  },
  {
    id: "overview",
    label: "TOEIC 소개",
    lead: "TOEIC Listening and Reading은 ETS가 만드는 업무·일상 영어 시험입니다. 약 2시간 동안 200문항을 풀고, 영역별 5–495점, 총점 10–990점으로 성적이 나옵니다.",
    facts: [
      ["Listening", "약 45분 · 100문항 · Part 1–4"],
      ["Reading", "75분 · 100문항 · Part 5–7"],
      ["점수", "Listening 5–495 · Reading 5–495 · 총점 10–990 (5점 단위)"],
    ],
    blocks: [
      {
        title: "시험의 특징",
        items: [
          "회의, 출장, 채용, 주문, 시설 관리, 고객 응대처럼 직장과 일상의 영어가 나옵니다. 전문 지식은 필요 없습니다.",
          "Listening은 음성이 한 번만 나오고, Part 1·2는 선택지가 시험지에 인쇄되지 않습니다.",
          "Reading은 시간이 빠듯해 Part 5·6을 빨리 끝내고 Part 7에 시간을 남기는 전략이 중요합니다.",
          "오답 감점이 없으므로 모든 문항에 답합니다.",
        ],
      },
      {
        title: "알아 둘 점",
        items: [
          "회차마다 난이도가 달라 같은 정답 수라도 환산 점수가 조금씩 다릅니다.",
          "기업·학교마다 요구 점수와 성적 인정 기간이 다릅니다. 제출처 기준을 확인하십시오.",
          "응시료, 시험 일정, 접수 방법은 바뀔 수 있습니다. 공식 사이트에서 최신 정보를 확인하십시오.",
        ],
      },
    ],
  },
  {
    id: "bands",
    label: "점수 해석",
    lead: "Listening과 Reading을 각각 5–495점으로 환산해 더한 것이 총점입니다. ETS는 점수를 CEFR 수준과 대응시켜 두었습니다.",
    blocks: [
      {
        title: "환산 점수",
        items: [
          "ETS는 회차마다 난이도를 맞추는 동등화(equating)를 거쳐 점수를 냅니다. 고정된 원점수 환산표는 공개하지 않습니다.",
          "이 앱의 점수는 정답률로 추정한 값이며 '추정'으로 표시합니다. 실제 점수와 수십 점 차이가 날 수 있습니다. Listening은 Reading보다 조금 후하게 환산되는 경향을 반영했습니다.",
        ],
      },
      {
        title: "목표 점수를 정할 때",
        items: [
          "흔히 쓰이는 기준: 서류 지원 700–800, 해외 영업·통번역 등 영어 비중이 큰 직무 850–900 이상. 정확한 요구 점수는 지원처를 확인하십시오.",
          "Listening이 Reading보다 먼저 오르는 경우가 많습니다. Reading은 Part 5 문법과 Part 7 시간 관리가 점수를 가릅니다.",
        ],
      },
    ],
  },
  {
    id: "listening",
    label: "Listening",
    lead: "약 45분, 100문항. 음성은 한 번만 나옵니다. Part 3·4는 음성이 나오기 전에 문제와 선택지를 먼저 읽어 두는 것이 핵심입니다.",
    facts: [
      ["Part 1 사진 묘사", "6문항 · 사진을 보고 들려주는 4문장 중 맞는 것 고르기"],
      ["Part 2 질의응답", "25문항 · 질문이나 말에 이어지는 3개 응답 중 고르기"],
      ["Part 3 짧은 대화", "39문항 · 대화 13개 × 3문항, 일부는 시각 자료"],
      ["Part 4 짧은 담화", "30문항 · 담화 10개 × 3문항, 일부는 시각 자료"],
    ],
    blocks: [
      {
        title: "실전 전략",
        items: [
          "Part 1: 사람의 동작과 사물의 상태를 구분합니다. 'is being + p.p.'는 지금 진행 중인 동작이라 사물만 있는 사진에서는 대개 오답입니다.",
          "Part 2: 첫 단어(의문사)를 놓치지 않습니다. 질문의 단어를 그대로 반복하거나 비슷한 소리를 쓰는 응답은 함정인 경우가 많고, 간접적인 답('일정을 확인해 볼게요')이 정답이 되기도 합니다.",
          "Part 3·4: 첫 문항은 대개 앞부분, 마지막 문항은 끝부분에 답이 있습니다. 'Look at the graphic' 문항은 시각 자료의 다른 열을 연결해 답합니다.",
          "놓친 문제는 바로 넘어가고 다음 세트의 문제를 미리 읽습니다.",
        ],
      },
      {
        title: "연습 방법",
        items: [
          "틀린 문제는 스크립트로 원인을 나눕니다: 소리를 못 들음 / 어휘를 모름 / 패러프레이즈를 못 알아챔.",
          "Part 2는 받아쓰기, Part 3·4는 스크립트 섀도잉이 효과적입니다.",
        ],
      },
    ],
  },
  {
    id: "reading",
    label: "Reading",
    lead: "75분, 100문항. 문항당 45초 안에 풀어야 하므로 Part 5·6을 빠르게 끝내고 Part 7에 시간을 남깁니다.",
    facts: [
      ["Part 5 단문 빈칸", "30문항 · 문법(품사, 동사 형태, 접속사, 전치사)과 어휘"],
      ["Part 6 장문 빈칸", "16문항 · 지문 4개 × 빈칸 4개, 그중 하나는 문장 넣기"],
      ["Part 7 독해", "54문항 · 단일 지문 29문항, 이중·삼중 지문 25문항"],
    ],
    blocks: [
      {
        title: "실전 전략",
        items: [
          "Part 5: 선택지를 먼저 보고 문법 문제인지 어휘 문제인지 가릅니다. 품사 문제는 빈칸 앞뒤만 보고 바로 풉니다.",
          "Part 6: 시제·지시어·연결어는 빈칸이 있는 문장만이 아니라 앞뒤 문장을 봐야 풀립니다. 문장 넣기는 앞뒤 문장과 이어지는 연결 고리를 찾습니다.",
          "Part 7: 문제를 먼저 읽고 지문에서 근거를 찾습니다. 이중·삼중 지문은 두 지문의 정보를 연결하는 문제가 꼭 나옵니다.",
          "'NOT true' 문제와 문장 위치 문제는 시간이 걸리므로 마지막에 풉니다.",
        ],
      },
      {
        title: "연습 방법",
        items: [
          "Part 5 오답을 문법 유형별로 모아 반복합니다.",
          "시간을 재고 Part 7만 따로 풀어 세트당 걸리는 시간을 줄입니다.",
          "비즈니스 어휘(계약, 견적, 배송, 환불, 일정 조정)를 주제별로 묶어 익힙니다.",
        ],
      },
    ],
  },
  {
    id: "testday",
    label: "시험 당일",
    lead: "신분증 규정과 입실 시간이 엄격합니다. 접수 안내의 준비물과 시간을 꼭 확인하십시오.",
    blocks: [
      {
        title: "준비물",
        items: [
          "규정에 맞는 신분증 원본, 수험표(필요한 경우), 연필과 지우개(시험장 안내에 따름).",
          "입실 마감 이후에는 입실할 수 없습니다. 여유 있게 도착하십시오.",
        ],
      },
      {
        title: "실수를 줄이는 습관",
        items: [
          "답안지 마킹은 문제를 풀면서 바로 합니다. 마지막에 몰아서 옮기면 시간이 모자랍니다.",
          "Listening 중에는 Part 1·2의 안내 음성 시간을 Part 3 문제 미리 읽기에 씁니다.",
          "모르는 문제도 빈칸으로 두지 않습니다.",
        ],
      },
    ],
  },
];
