# WORKLOG

## 2026-10-31

### 마이그레이션 SQL 줄바꿈을 CRLF로 고정 (TOEFLER `8fbac1f`와 같은 수정)

- **무엇을 발견했는가**: TOEFLER에서 생긴 일이다. sqlx(tauri-plugin-sql)는 적용한 마이그레이션 SQL 바이트 전체의 SHA-384를 DB에 남기고, 다음 실행 때 같은 바이트인지 비교한다. `include_str!`로 넣는 SQL 파일은 저장소에 LF로 있지만 Windows에서 git으로 받으면 CRLF, 복사·압축 파일·리눅스 빌드로 옮기면 LF가 된다. 그래서 CRLF 빌드로 만든 DB를 LF 빌드가 "migration 1 was previously applied but has been modified"로 거절했다. 이 앱도 같은 코드라 같은 위험이 있었다. 이 PC에는 이 앱이 설치돼 있지 않고 `release.yml`(windows-latest) 실행 기록도 없다. 설치본이 있다면 Windows에서 git으로 받아 빌드한 것이라 CRLF로 기록돼 있다(같은 방식으로 빌드한 TOEFLER·IELTS 설치 DB가 모두 CRLF임을 확인).
- **무엇을 했는가**: `migrations()`가 SQL 줄바꿈을 CRLF로 맞추게 하고, 1번 마이그레이션 체크섬을 고정하는 테스트를 넣었다. 고정값은 저장소 SQL을 CRLF로 바꾼 바이트의 SHA-384다.
- **왜 CRLF인가**: 설치본을 만드는 두 경로(Windows git 체크아웃, `windows-latest` 릴리스)가 모두 CRLF를 만든다. LF로 고정하면 지금 설치된 DB가 열리지 않는다. 앞으로는 어떤 경로로 빌드해도 같은 바이트가 들어간다.
- **어떻게 확인했는가**: `cargo test` — 30 passed, 2 ignored, 새 체크섬 고정 테스트 통과.
- **하지 않기로 한 것**: `.gitattributes`로 SQL 줄바꿈을 정하는 방법은 쓰지 않았다. 압축 파일 다운로드나 복사처럼 git을 거치지 않는 경로는 막지 못한다.

### 생성한 문제는 설정에서 고른 CLI로만 검증

- **무엇을 발견했는가**: AI 출제기는 검증자를 `ai.ts`의 `pickVerifier`로 골랐다. PC에 다른 구독 CLI(Codex·Antigravity)가 로그인돼 있으면 그 CLI가 교정과 블라인드 풀이를 맡고, 없을 때만 출제한 CLI의 새 대화를 썼다. 사용자 PC에서는 Codex가 로그인은 돼 있지만 답을 하지 못했다. 같은 구조인 TOEFLER에서 재현하니 설정된 모델로는 `400 model_not_found`(ChatGPT 계정에서 쓸 수 없는 모델)가, 그다음에는 `You've hit your usage limit ... try again at Nov 20th, 2026`(무료 사용 한도 소진)이 돌아왔다. 검증 호출이 실패하면 생성 전체가 멈추므로, Claude로는 쓸 수 있는데도 세트가 하나도 만들어지지 않았다. '로그인됨'만으로는 그 CLI가 실제로 답할 수 있는지 알 수 없다.
- **왜 이렇게 고쳤는가**: 사용자가 "검증은 항상 사용자가 고른 CLI의 새 대화로 하고, 다른 CLI는 부르지 않는다"를 골랐다. 함께 검토한 선택지는 둘이었다. (1) 다른 CLI 검증이 실패하면 출제 CLI로 자동으로 넘어가기: 한도가 소진된 CLI에 매번 실패할 호출을 먼저 보내고 기다리게 되고, 어느 CLI가 검증했는지가 실행마다 달라진다. (2) 설정에 '검증 CLI' 항목 두기: 설정이 하나 늘고, 쓸 수 없는 CLI를 골라 두면 같은 멈춤이 되풀이된다. 다른 모델로 교차 풀이하는 이점은 잃지만, 검증은 출제 대화와 맥락을 나누지 않는 새 호출이라 정답을 가린 풀이와 편집 단계(유지·정답 수정·제외, 다시 쓰고 재검증)는 그대로다.
- **무엇을 했는가**: `ai.ts`에서 `Verifier`와 `pickVerifier`를 지웠다(`cliStatus`는 설정 화면이 계속 쓴다). `toeicGen.ts`의 `generateToeic`은 교정(`proofUnit`)·풀이(`verify`)·다시 쓴 문항의 재검증(`refill`)에 출제와 같은 `settings`를 넘긴다. 보고서의 `checker`는 출제 CLI 이름, `cross`는 항상 `false`다. 두 필드는 저장된 기록과 예전 세트 파일이 쓰므로 타입에 남기고 주석만 고쳤다. 생성 화면에서 "다른 구독 CLI를 하나 더 로그인해 두면 교차 검증합니다." 문장과 교차 검증 분기를 뺐고, 가이드(`guideContent.ts`)·README·`docs/toeic-sources.md`의 설명을 "설정에서 고른 AI가 새 대화에서 검증, 다른 CLI는 쓰지 않음"으로 고쳤다. TOEFLER에 먼저 넣은 같은 변경을 따랐다.
- **어떻게 확인했는가**: `npx vitest run` 24개 파일 84개 통과(전에 85개였고, 지운 `pickVerifier` 테스트 1개만큼 줄었다). `npx tsc --noEmit` 오류 없음. 생성 테스트는 가짜 AI로 200문항 흐름과 뺀 문항을 다시 쓰는 흐름을 돌려, 모든 AI 호출이 `claude-cli`로만 가는지와 보고서가 `checker: "claude-cli", cross: false`인지 확인한다. `pickVerifier`와 "다른 구독 CLI"가 저장소에 남지 않았음을 검색으로 확인했다. 실제 구독 CLI로 생성해 보거나 앱을 띄우지는 않았다.
- **하지 않기로 한 것**: `PackageImport.tsx`의 "교차 검증 (…)" 표시는 그대로 두었다. 예전에 다른 CLI로 검증해 만든 세트 파일의 기록(`cross: true`)을 보여 주는 곳이라서다. 새로 만드는 세트는 `cross: false`라 "독립 검증"으로 보인다.

## 2026-10-30 (밤)

### 인쇄물을 한 단으로

- **무엇을 발견했는가**: 문제지 인쇄에서 Part 5는 두 단(`.tk-cols`)에 보기까지 2×2로 넣어, 좁은 단 안에서 보기가 "(B) / submits"처럼 끊겼다. Part 3·4·6·7 문항도 두 칸 격자(`.tk-qs`)로 나란히 놓였다. 사용자가 다단 배치가 보기 좋지 않다고 했다.
- **무엇을 했는가**: 문항은 모두 한 단으로 위에서 아래로 흐르게 했다. 짧은 보기의 2×2 배치(`.tk-choices.two`)는 그대로 두고, 'Mark your answer' 줄뿐인 Part 2만 두 단으로 남겼다.
- **어떻게 확인했는가**: 샘플 Reading·Listening 문제지를 그려 앱 CSS로 Edge(headless) PDF를 만들어 쪽마다 확인했다. `tsc --noEmit`, `npm test`(85개).

### 샘플 Listening을 Part 1–4 전체로 채우고 Gemini 음성·사진 넣기

- **무엇을 발견했는가**: 내장 Listening 샘플은 Part 2–4뿐이라 Part 1(사진 묘사)이 없었고, 음성 파일이 없어 Windows 음성이 대본을 읽으면서 `Woman:`/`Man:`을 성별이 아니라 등장 순서로 목소리에 나눴다. Part 3 그래픽은 `Graphic — …` 평문이라 생성기 형식(`Graphic\n…`)과 달라 인쇄물의 그래픽 상자에도 안 들어갔다. 문항 수는 Part 2 5·Part 3 6·Part 4 3이었다.
- **구성 판단**: 생성기(`toeicGen.ts`의 `BLUEPRINT`)의 한 세트는 실제 시험 100문항(Part 1 6·Part 2 25·Part 3 13세트·Part 4 10세트) 그대로라, 샘플은 그 약 3분의 1인 31문항으로 모든 파트를 보여 주도록 잡았다. Part 1 사진 3장(혼자 일하는 사람·회의·카페, 정답 C·A·D), Part 2 10문항(생성기처럼 5문항씩 지문 둘 `Part 2 · 4–8`, `9–13`, 간접 응답 3개), Part 3 대화 3개(그래픽 1·화자 의도 문항 1), Part 4 담화 3개(음성 메시지·회의 발췌+그래픽·견학 안내). 모든 대화는 여자와 남자 둘이다(Gemini TTS는 두 목소리까지).
- **무엇을 했는가**: 샘플을 생성기 초안 형식(`P12`·`P3`·`P4`)으로 쓰고, `listeningTest`와 같은 방식으로 지문을 만든다: 제목, 1부터 이어지는 번호, Part 1 내레이터(남)의 "Number n. Look at the picture. (A)…", Part 2 질문(여)·응답(남), 화자 성별, `Graphic\n…` 지시문, 사진 프롬프트까지 같다. 다만 정답 위치는 생성기의 `balance`(세트마다 A, B, C… 순서로 옮김)를 쓰지 않고 적은 대로 둔다. Reader 판에 생성기 코드가 들어가지 않도록 `toeicGen.ts`에서는 타입만 가져온다. 음성은 `scripts/sample-audio.mjs`(TOEFLER 0ca6d8a에서 옮김)가 `gemini-3.8-flash-tts`로 화자 성별에 맞는 목소리(지문마다 돌려 가며)로 읽혀 64 kbps MP3로 `public/sample-audio`에, 사진은 새 `scripts/sample-photos.mjs`가 `gemini-3-pro-image`(생성기와 같은 요청·프롬프트)로 그려 960px WebP로 `public/sample-photos`에 보관 이름(`aud-`/`img-<sha256>`)으로 넣는다. 설치 때 새 명령 `archive_sample_audio`·`archive_sample_image`로 보관함에 넣고 지문·사진 칸에 연결한다. 샘플 버전(`SAMPLES_VERSION` 2)이 오르면 기록(시도·메모)이 없는 예전 샘플은 새것으로 바꾸고, 설치에 실패하면 다음 실행 때 다시 시도한다. Reading 샘플은 그대로다.
- **검수**: 음성 11개 모두 `gemini-3.5-flash` 받아쓰기로 대본 단어의 99–100%가 순서대로 들렸다(90% 미만이나 말 빠르기가 이상하면 다시 만든다). Part 1·2가 읽는 `(A)` 글자는 받아쓰기에서 글자로 적게 하고, 대본의 숫자(`Number 4`, `250`)는 비교할 때 말로 바꾼다. 따로 받아써서 보기 글자가 모두 읽히는지, 대화의 화자 성별이 대본과 맞는지 확인했다. 사진 3장은 직접 보고 정답 문장과 맞고 오답 문장(사다리, 커피 따르기, 쌓는 중인 컵 등)과는 맞지 않음을 확인했다. 크기는 MP3 11개 2.8 MB, WebP 3장 131 KB.
- **어떻게 확인했는가**: `tsc --noEmit`, `npm test`(24개 파일, 85개), `cargo check`. 샘플이 파트별로 3·10·9·9문항(그래픽 Part 3·4 각 1)인지, 같은 초안을 생성기 `listeningTest`에 넣은 결과와 보기 순서를 빼고 같은지, 모든 Listening 지문의 MP3와 Part 1 사진이 들어 있는지 테스트로 확인한다. 앱을 띄워 설치·재생을 보지는 않았다.
- **다시 만들 때**: 대본·사진 설명을 고치면 그 작업의 키가 바뀌어 파일이 빠진다. `GEMINI_API_KEY=... node scripts/sample-audio.mjs`, `node scripts/sample-photos.mjs`(잘못 그려진 사진은 `--redo q2`)를 돌리면 빠진 것만 만들고 쓰지 않는 파일은 지운다(ffmpeg 필요).
- **주의**: Studio에서 고쳤지만 풀지 않은 예전 샘플도 버전이 오르면 바뀐다(TOEFLER와 같은 규칙). 생성기는 Part 3–7 세트마다 정답을 A, B, C… 순서로 놓는데(`mcqGroup`의 `balance`), 이번에는 고치지 않았다.

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
