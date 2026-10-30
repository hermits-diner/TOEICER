# WORKLOG

## 2026-10-30 (밤)

### 인쇄물에서 tauri.localhost와 출력 일시 빼기

- **무엇을 발견했는가**: 인쇄(`window.print()`)하면 WebView2가 페이지 여백에 출력 일시·제목(위)과 주소 `tauri.localhost`·쪽 번호(아래)를 찍었다. 인쇄 창의 '머리글 및 바닥글'이 기본으로 켜져 있기 때문이다. `@page`의 여백 상자(`@bottom-center`)를 써도 이 머리글은 꺼지지 않았다.
- **무엇을 했는가**: `@page` 여백을 0으로 두어 머리글·바닥글이 들어갈 자리를 없애고, 여백은 `.print-sheet`의 padding으로 옮겨 `box-decoration-break: clone`으로 쪽마다 되풀이되게 했다.
- **어떻게 확인했는가**: 같은 엔진(Edge 156, WebView2와 같은 판)의 headless 인쇄로 수정 전후 PDF를 비교했다. 수정 전에는 `26. 10. 30. 오후 8:18 <제목>`과 주소가 찍혔고, 수정 후에는 둘 다 없고 2쪽부터도 본문이 위에서 같은 간격으로 시작했다. 실제 앱 인쇄 창으로는 아직 확인하지 않았다.

## 2026-10-30

### 지문을 바꿀 때 지문이 겹쳐 쌓이는 문제 수정

- **무엇을 발견했는가**: TOEFLER에서 지문을 바꾸면 이전 지문이 지워지지 않고 옆으로 쌓여 한 번 더 보였다. 원인은 `ReadingPractice.tsx`에서 지문 칸 `<article>`과 문항 칸 `<div>`가 같은 부모 아래 같은 key(`passage.id`)를 쓴 것으로, 이 앱에도 같은 코드가 있었다.
- **무엇을 했는가**: 두 칸의 key를 `text-${id}`, `questions-${id}`로 나눴다. 지문마다 맨 위에서 열리게 하려는 원래 의도는 그대로다. TOEFLER(476fb18)와 같은 수정이다.
- **어떻게 확인했는가**: `tsc --noEmit`, `npm test`(24개 파일, 82개 통과). 앱을 띄워 화면에서 재현·확인하지는 않았다.
- **하지 않기로 한 것**: 이 증상을 잡는 화면 테스트는 아직 넣지 않았다.

## 2026-10-29

### Reader / Studio로 나누고 TOEIC에 없는 것 정리

- **무엇을 했는가**: 한 코드에서 두 판을 빌드한다(`__STUDIO__`, `--mode studio`). TOEICER(무료)는 세트 파일 열기·풀기·채점·인쇄·기록·단어장·AI 오답 해설, TOEICER Studio(월 구독, 14일 체험)는 AI 출제·붙여넣기/PDF 변환·세트 편집(Gemini 음성 입히기 포함)·세트 파일 내보내기를 더한다. 세트 파일은 `.toic`(형식 3, manifest의 출처·영역·검증 기록 + test.json + media/), 예전 `.toeicset`도 열린다. 두 번 눌러 열기(single-instance). 세트마다 출처(샘플·AI 생성·내 자료·공유 파일·마켓 구매).
- **지운 것**: Writing/Speaking 연습과 첨삭·녹음, IELTS/TOEFL 문항 유형(tfng, ynng, heading, matching, fill, short, cword, build), IELTS 수집기·검토 큐·시드 소스, JSON 가져오기 탭, IELTS용 PrintSheet(ToeicPrintSheet가 모든 TOEIC 세트를 인쇄), 시험 한 부 묶음(ExamView·exam 테이블), 모의고사 묶기(MockPanel), AI 받아쓰기, Gemini 듣기·평가 모델, WAV→MP3 일괄 변환과 녹음 백업.
- **판단**: 200문항 한 회분은 Listening(1–100)·Reading(101–200) 두 세트로 저장한다. 두 영역은 점수(5–495)도 따로 매겨지고, 세트 파일 하나에 세트 하나라는 규칙과 맞는다. 묶음 화면은 IELTS 6세트용이라 지웠다.
- **DB**: 출시 전이라 `toeic.db`의 깨끗한 001_schema.sql 하나에서 다시 시작한다(지문 `audio`, 묶음 `image` 열 포함).
- **확인**: `tsc --noEmit`, vitest, `cargo test`, `vite build`(무료판 번들에 Studio 프롬프트 문자열이 없는지 확인).

### TOEFLER 코드로 TOEICER 시작

- **무엇을 했는가**: 빈 저장소에 TOEFLER(IELTS_Practice 기반 Tauri 앱)의 소스를 옮기고 정체성(이름, com.toeicer.app, .toeicset, 백업 폴더)을 바꿨다. TOEFL 전용 모듈(생성기, 샘플, 사양)은 지우고 TOEIC Listening and Reading용으로 새로 썼다.
- **TOEIC 고유 기능**: 들려주는 선택지 유형 `lmcq`(Part 1·2, 채점 전에는 글자만), Part 1 사진을 만드는 Rust 명령 `ai_image`(Gemini 그림 모델), 파트별 생성기 `toeicGen.ts`(측정·다시 쓰기·블라인드 풀이·편집자 판단·사진·음성), 영역별 5–495 점수 추정, Reading 문항당 45초, Part 번호로 된 탭.
- **개성**: '오피스' 테마(먹색·에메랄드·오렌지), 서류가방 아이콘, TOEIC 가이드. 내비게이션은 Listening·Reading만.
- **왜**: 사용자가 시험별로 따로 만든 앱을 요청했고, 디자인 언어는 맞추되 앱마다 개성을 살리라고 했다.
- **확인**: `tsc --noEmit`, vitest 237개(가짜 AI로 200문항 생성 흐름 포함), `cargo test`(그림 요청 본문), Xvfb에서 홈·생성 화면·Part 2 풀이 화면 스크린샷.
- **하지 않은 것 / 주의**: 실제 구독 CLI와 Gemini 그림·음성 모델로 라이브 생성은 이 환경에서 돌리지 못했다. 그림 모델 기본값(`gemini-2.5-flash-image`)은 키로 볼 수 있는 목록에 맞게 설정에서 바꿔야 할 수 있다. Part 3의 3인 대화는 음성 엔진 제약으로 만들지 않는다. TOEIC Speaking & Writing은 이번 범위에서 뺐다.
