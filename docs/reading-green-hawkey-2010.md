# Reading 출제 지침의 근거: Green & Hawkey (2010)

Green, A. & Hawkey, R. (2010). *An empirical investigation of the process of writing Academic Reading test items for the International English Language Testing System.* IELTS Research Reports, Vol. 11, pp. 273–328. (ielts.org에서 공개)

IELTS의 공식 출제위원 지침(Item Writer Guidelines)은 비공개다. 이 보고서는 훈련받은 IELTS 출제위원 4명과 미훈련 교사 3명이 Academic Reading 지문을 고르고 다듬고 문항을 만드는 과정을 인터뷰·관찰·편집회의로 비교한 연구로, 지침의 내용을 간접적으로 가장 자세히 보여 준다. 아래는 `src/lib/generate.ts`의 프롬프트(`TEXT_SHAPING`, `TASK_MIX`, `ITEM_WRITING`, `TYPE_RULES`, `REVIEW_SYSTEM`)에 반영한 관행과 그 출처 쪽수(보고서 쪽 번호)다.

## 지문 고르기와 다듬기

| 관행 | 출처 | 반영한 곳 |
|---|---|---|
| 대중적 관심사를 격식 있는 보고체로, 학술적 어조이되 비전문가가 읽을 수 있게 | p. 291, 표 6 | 지문 설명 전체 |
| 원문은 필요 길이의 3–4배이며 목표+100–200단어로 잘라 낸 뒤 다듬음(최종 664–946단어) | pp. 294–295, 306–309 | 750–900단어 목표와 길이 측정 |
| 잡지식 "낚시" 도입부(일화·놀라운 사례)를 지우고 일반 진술에서 구체 사례로 전개 | p. 296, 318 | `TEXT_SHAPING` 1–2항 |
| 'amazing', 'surprising' 같은 선정적 표현, 구어('trotted out', 'shut eye'), 축약형, 'we in the west' 같은 위치 지우기 | pp. 296, 308–310, 317–318 | `TEXT_SHAPING` 1항 |
| 핵심 생각 하나를 여러 연구·사례로 뒷받침하는 글이 좋은 지문; 같은 말을 되풀이하는 글은 문항이 안 나옴 | pp. 292–293 | `TEXT_SHAPING` 3항 |
| 문단마다 제목으로 잡을 수 있는 한 주제; 문단이 겹치면 제목 매칭이 안 됨 | p. 296 | `TEXT_SHAPING` 2항, heading 규칙 |
| 전문 용어 삭제 또는 일상어로 교체('thorax'→'chest'), 남긴 용어는 풀이('GPS'), 약어 풀어쓰기, 인용·소제목·참고문헌 제거 | pp. 306–309, 314 | `TEXT_SHAPING` 4항 |
| 특정 작품·작가를 아는 것을 전제하는 문학·예술 글은 피함("they always assume you have read the work") | pp. 316–318, 323 | `TEXT_SHAPING` 4항 |
| 종교('original sin', 'church'), 전쟁, 문화 특정 소재 제거 | pp. 306, 316 | `ITEM_WRITING` 공정성 규칙, 검수 항목 |
| 이름·수치의 일관성, 문장 간 모순 제거(편집회의에서 잡힌 사례) | pp. 314–315 | `TEXT_SHAPING` 5항, 검수 항목 |
| 사실 위주 글은 Section 1, 여러 의견이 담긴 글은 Section 3 | p. 296 | Passage 1–3 규격 |

## 문항 쓰기

| 관행 | 출처 | 반영한 곳 |
|---|---|---|
| 모든 문단을 검사하고("every paragraph is tested"), 한 문장을 두 문항이 겨누지 않으며, 미검사 구간을 남기지 않음 | pp. 296–297, 324 | `ITEM_WRITING` |
| 문항은 지문 순서를 따름(미훈련자의 흔한 위반) | p. 324 | `ITEM_WRITING`, 유형 규칙 |
| 과제 둘은 특정 정보, 하나는 전체 개관(제목·문단 찾기); 지문 전체를 세 번 훑게 하지 않음 | p. 297 | `TASK_MIX` |
| T/F/NG: 위치를 찾을 단서 한두 단어('tickling machine')를 두고 나머지는 동의어·어형 변화·구조 바꿈으로 바꿔 씀 | pp. 320–321 | `ITEM_WRITING` 바꿔쓰기 규칙 |
| FALSE는 반의어나 세부 하나(범위·시기·원인·수량)의 변경으로 | pp. 320–321 | tfng 규칙 |
| NOT GIVEN은 지문이 전혀 다루지 않은 사항; 참인 진술의 한 구를 바꿔 만든 NG는 추론 가능하면 기각됨 | pp. 315, 320–322 | tfng 규칙, 검수 항목 |
| 'entirely' 같은 절대어는 시험 요령 있는 응시자의 단서가 됨 | p. 315 | tfng 규칙, 검수 항목 |
| 지시 대상이 열려 있는 진술('wildlife experiments')은 기각; 'a particular type of' 같은 모호한 표현 수정 | pp. 315, 318 | `ITEM_WRITING` 정밀성 규칙 |
| 부정 구문('underestimating how little')은 긍정 구문으로 | p. 318 | `ITEM_WRITING` |
| 객관식: 사소한 세부가 아니라 중요한 정보·의견·기능을 물음; 그럴듯한 오답 넷을 만들기 어렵다는 점 때문에 사소한 것을 묻게 되는 위험 | p. 296 | mcq 규칙 |
| 객관식 오답 둘이 같은 뜻이면 정답 확률이 올라감 | p. 310 | mcq 규칙, 검수 항목 |
| 정답 위치를 섞어 균형을 맞춤(정답이 마지막에 오지 않게 재배열) | pp. 317–318 | mcq 규칙, 검수 항목 |
| 배경지식으로 오답이 제거되지 않게 | pp. 300, 327 | mcq 규칙 |
| 요약 완성의 빈칸은 명사; 앞 단어의 관사·전치사가 답을 알려 주면 안 됨('a'가 'match'를 단서) ; 전치사 'in'이 시간·장소 둘 다 가리키는 모호함 수정 | pp. 299, 316 | fill 규칙, 검수 항목 |
| 단답형은 문법이 아니라 내용을 검사 | p. 310 | short 규칙 |
| 이웃 문항이 단서 단어를 공유하면 독립성이 깨짐('species') | p. 320 | `ITEM_WRITING`, 검수 항목 |
| 출제자가 응시자처럼 직접 풀어 봄("working the task"); 편집회의의 '새 눈'이 필수 | pp. 300, 323 | 정답 대조 풀이 단계, 검수 단계 |

## 반영하지 않은 것

- 보고서는 **어떤 읽기 기술을 어떤 비율로 재야 하는지** 지침이 불명확하다고 지적한다(pp. 325–326). 앱은 이를 정하지 않았고, 유형 혼합과 난이도 안내로 대신한다.
- 사전 시험(pretest)으로 문항 통계를 보고 걸러 내는 단계는 응시자 데이터가 없어 흉내 낼 수 없다. 문항 난이도는 여전히 "추정"이다.
- 보고서의 대상은 Academic Reading이다. General Training Section 1·2의 문서형 텍스트 규칙은 공식 시험 형식 설명과 수집 샘플에서 가져왔다.
