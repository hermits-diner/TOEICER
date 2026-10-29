# TOEIC 출제 사양과 지침의 근거

TOEICER의 AI 출제(`src/lib/toeicGen.ts`), 형식 사양(`src/lib/toeicSpec.ts`), 문항 작성 지침(`src/lib/itemGuidelines.ts`), 점수 추정(`src/lib/bandTable.ts`)이 무엇에 근거했는지 정리한다.

## 출제위원 지침에 대해

ETS의 TOEIC 내부 출제 지침은 공개되지 않는다. 앱은 공개 자료에서 확인할 수 있는 원칙만 반영했다.

| 출처 | 반영한 내용 | 반영한 곳 |
|---|---|---|
| ETS의 TOEIC Listening and Reading 시험 구성 안내 | Part 1–7의 과제와 문항 수(6·25·39·30·30·16·54), Listening 약 45분·Reading 75분, 영역별 5–495·총점 10–990 | `TOEIC_PARTS`, `BLUEPRINT`, 가이드 |
| ETS의 CEFR 대응표 | 영역별 CEFR 최소 점수(Listening 490/400/275/110/60, Reading 455/385/275/115/60) | 가이드 '점수 해석' |
| *ETS Guidelines for Fair Tests and Communications*, *ETS Standards for Quality and Fairness* | 배경지식에 기대지 않기, 민감한 소재 피하기, 고정관념 금지, 실제 회사·인물 쓰지 않기 | `FAIRNESS_GUIDELINES` |
| 일반적인 선다형 문항 작성 원칙 | 정답 하나, 그럴듯한 오답, 선택지 형식 균형, 정답 위치 분산(Part 2는 3지선다) | `ITEM_WRITING_GUIDELINES`, `optionProblems`, `balance` |

## 근사치와 앱의 선택

- 지문·대화 길이(Part 3 약 100–140단어, Part 4 80–130단어, Part 6 100–150단어, Part 7 50–250단어)와 Part 7 단일 지문 세트 구성(2·2·2·3·3·3·4·4·4·2문항)은 공개 샘플과 준비 자료가 일치하는 범위로 정했다.
- Part 3의 3인 대화는 실제 시험에 나오지만, 음성 엔진(Gemini TTS 다화자 모드)이 두 목소리까지만 지원해 생성 문제는 모두 2인 대화로 쓴다.
- 점수는 ETS가 회차별 동등화를 거쳐 내며 고정 환산표를 공개하지 않는다. 앱은 흔히 인용되는 환산 곡선에 가까운 정답률→점수 곡선으로 추정하고 '추정'으로 표시한다.

## 기출과 공식 자료

기출문제는 ETS 저작물이고 시험 보안 규정의 대상이라 앱에 넣거나 배포하지 않는다. 사용자가 가진 공식 자료는 '공식 자료 추가'로 그 PC의 데이터베이스(`reference_doc`)에만 저장되고, 출제 프롬프트에 형식·난이도 기준으로만 들어간다.
