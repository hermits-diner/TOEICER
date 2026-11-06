# moduTOEIC

TOEIC Listening and Reading을 대비하는 Windows 데스크톱 앱입니다. 문제 세트를 실제 시험처럼 듣고 풀고, 채점하고 복습하고, TOEIC 시험지처럼 인쇄합니다. 모든 기록은 내 컴퓨터의 로컬 SQLite에만 쌓입니다.

두 가지 판으로 나옵니다.

| | **moduTOEIC** (무료) | **moduTOEIC Studio** (월 구독, 14일 체험) |
|---|---|---|
| 세트 파일(.toic) 열기·풀기·채점·인쇄·학습 기록 | ✓ | ✓ |
| AI 오답 해설·단어 풀이 (내 구독 CLI, 선택) | ✓ | ✓ |
| AI로 200문항 한 회분 출제 (공식 사이트 출제 동향 반영, 독립 검증, Gemini 사진·음성) | | ✓ |
| 내 자료(붙여넣기·PDF)를 세트로 변환 | | ✓ |
| 세트 고치기, Listening 스크립트에 Gemini 음성 입히기, 세트 파일로 내보내기(마켓 판매용) | | ✓ |

[IELTS_Practice](https://github.com/hermits-diner/IELTS_Practice), [TOEFLER](https://github.com/hermits-diner/TOEFLER)와 같은 기반(Tauri 2 + React 19 + TypeScript)에서 출발했고, 디자인 언어는 같되 moduTOEIC만의 '오피스' 테마(먹색 글씨·에메랄드 포인트·오렌지 강조)와 서류가방 아이콘을 씁니다.

**사용법 영상**: [docs/media/toeicer-tour.mp4](docs/media/toeicer-tour.mp4) (약 1분 7초 · 무료판: 샘플 → Reading 풀이와 채점 → 시험지 인쇄 → 가이드 · Studio: 무료판 데이터 가져오기 → AI·붙여넣기 → 세트 고치기·내보내기 → 구독) · **인쇄 견본**: [docs/media/toeicer-print-sample.pdf](docs/media/toeicer-print-sample.pdf). 영상을 다시 만드는 방법은 [scripts/tour](scripts/tour/README.md).

## 무엇을 할 수 있나

### 실제 시험 형식 그대로 풀기
- **Listening (Part 1–4)**: Part 1 사진 묘사와 Part 2 질의응답은 실제 시험처럼 선택지 문장이 보이지 않고 A·B·C(·D) 단추만 나옵니다. 채점 후 문장과 스크립트를 봅니다. Part 3·4는 시각 자료(표·일정·지도) 문항도 지원합니다. 음성이 없는 세트는 스크립트를 Windows 영어 음성으로 읽습니다.
- **Reading (Part 5–7)**: 단문 빈칸, 장문 빈칸(문장 넣기 포함), 단일·이중·삼중 지문. 문항당 45초(100문항 75분) 제한.
- 점수는 영역별 5–495점으로 추정합니다(ETS가 고정 환산표를 공개하지 않아 '추정'으로 표시). 학습 기록은 영역별 예상 점수 추이와 영역별·파트별 정답률을 보여 줍니다.
- 인쇄: TOEIC 시험지처럼 편집된 문제지(Part 1·2는 선택지 없이), 답안지, 정답·채점표. Windows 인쇄 대화상자에서 PDF 저장.

### Studio: AI로 200문항 한 회분 만들기
- PC에 구독 계정으로 로그인한 **Claude Code**(Claude Pro·Max), **Codex CLI**(ChatGPT Plus·Pro), **Antigravity CLI**(Google 계정)를 앱이 실행합니다.
- 만들기 전에 공식 사이트(한국 TOEIC 위원회, ETS)를 읽어 최신 시험 구성을 출제 지시에 넣고, 앱의 형식과 다르면 경고합니다.
- 파트별로 쓰기 → 실제 시험의 문항 수·선택지 수·빈칸 표시·길이로 측정 → 어긋나면 다시 쓰기 → 같은 AI의 새 대화로 독립 교정(다른 CLI는 쓰지 않음; 지적된 문항·대화·지문만 고쳐 쓰고 다시 교정, 그래도 남으면 제외 후 새로 씀) → 정답을 가린 블라인드 풀이 → 엇갈린 문항은 정답 수정 또는 제외 → 뺀 문항 다시 쓰고 교정·재검증 → **Gemini로 Part 1 사진과 Listening 음성** → Listening(1–100)·Reading(101–200) 두 세트로 저장. 검증 기록은 세트 파일에 함께 남습니다.
- 목표 점수 600+ · 750+ · 900+로 난이도 구성 조절, 상황·업종 지정. 가지고 있는 공식 자료(PDF·텍스트)를 참고자료로 넣으면 이 PC에만 저장하고 형식·난이도 기준으로만 씁니다.
- 근거와 근사치는 [docs/toeic-sources.md](docs/toeic-sources.md).

### Studio: 내 자료 넣기와 고치기
- 학원 프린트나 교재의 TOEIC 문제를 붙여넣거나 PDF를 열면 AI가 내용을 고치지 않고 파트·지문·문항·선택지(A–D)·정답으로 나눕니다. Listening 문항은 스크립트가 있을 때만 들어오고, 편집기에서 Gemini 음성을 입히거나 스크립트로 둡니다. 정답이 없는 문항은 AI가 풀어 표시하고, 확인한 뒤 '내 자료'로 저장합니다(마켓에는 올릴 수 없음).
- AI 생성 세트와 내 자료는 문구·정답을 고치고 `.toic` 세트 파일로 내보낼 수 있습니다. 마켓에서 산 세트는 고치거나 내보낼 수 없습니다.

### 복습
- 오답 노트(간격 반복), 단어장, 영한 사전 팝업.
- 세트 파일(.toic)은 탐색기에서 두 번 누르면 앱에서 열립니다. 백업(문서 › moduTOEIC 백업, OneDrive, USB).
- 내장 샘플(Listening Part 2–4, Reading Part 5–7)은 처음 실행할 때 라이브러리에 들어갑니다.

## AI 연결

| 구독 | 실행 파일 | 설치 | 로그인 |
|---|---|---|---|
| Claude Pro / Max | `claude` | `npm install -g @anthropic-ai/claude-code` | `claude` 실행 후 `/login` |
| ChatGPT Plus / Pro | `codex` | `npm install -g @openai/codex` | `codex login` |
| Google 계정 (Gemini) | `agy` | Antigravity 설치 | `agy` 실행 후 Google 로그인 |

Studio의 Listening 음성과 Part 1 사진은 **Gemini API 키**로 만듭니다(설정 › AI › 음성·사진에서 읽기 모델과 그림 모델 선택). 키가 없으면 Part 1은 장면 설명으로, 음성은 Windows 영어 음성으로 대신합니다.

## 설치와 빌드

`v*` 태그를 올리면 GitHub Actions가 두 판의 Windows 설치 프로그램을 Releases에 올립니다.

```powershell
git clone https://github.com/hermits-diner/moduTOEIC.git
cd moduTOEIC
npm install
npm run tauri dev                                                  # moduTOEIC(무료판) 개발 실행
npm run tauri dev -- --config src-tauri/tauri.studio.conf.json     # Studio 개발 실행
npm run build:reader:exe                                           # 무료판 설치 프로그램
npm run build:studio:exe                                           # Studio 설치 프로그램
npm test
```

필요한 것: Node.js 20 이상, Rust 1.77 이상, WebView2 런타임, Visual Studio Build Tools(C++).

### 버전과 릴리스
- 버전은 SemVer(`주.부.수`)이고 기준은 `package.json`입니다. 0.x 동안은 기능이 늘면 부 번호, 고치기만 했으면 수 번호를 올립니다.
- 올릴 때는 깨끗한 main에서 `npm version <새 버전> -m "Release v%s"` 한 번이면 됩니다. `scripts/sync-version.mjs`가 `tauri.conf.json`·`Cargo.toml`·`Cargo.lock`을 같은 번호로 고치고, npm이 커밋과 `v<새 버전>` 태그를 만듭니다.
- `git push origin main --follow-tags`로 올리면 `release.yml`이 두 판을 빌드합니다. 태그와 앱 버전이 다르면 빌드 전에 멈춥니다.
- 버전을 손으로 고치지 마십시오. 네 파일이 어긋나면 `npm test`가 실패합니다.

### 자동 업데이트
- 저장소가 비공개라 설치 파일은 GitHub가 아니라 마켓(exam-market의 R2)에서 내려받습니다. `release.yml`이 두 판을 서명해 빌드한 뒤 `scripts/publish-update.mjs`로 올립니다. 설치 파일을 먼저 올리고 판별 `latest.json`을 나중에 올립니다.
- 설치된 앱은 시작할 때 `https://exam-market.hermitsdiner.workers.dev/updates/toeic/<free|studio>/latest.json`을 확인하고, 새 버전이 있으면 오른쪽 아래에 알립니다. 설치 전에 풀던 답을 저장하고 AI CLI를 끝내며, AI 생성 중에는 설치하지 않습니다. `tauri dev`에서는 확인하지 않습니다.
- 첫 릴리스가 올라가면 마켓 `/download`의 moduTOEIC "받기" 버튼이 저절로 켜집니다.
- 필요한 GitHub 비밀값: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(업데이트 서명), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`(R2 업로드). 형제 앱 8개가 같은 키와 같은 값을 쓰지만, 비밀값은 저장소마다 따로 등록합니다.
- 서명 키(`%USERPROFILE%\.tauri\hermits-exam-apps-updater.key`)는 따로 백업하십시오. 키를 잃으면 이미 설치된 앱에 더는 업데이트를 보낼 수 없습니다. 공개키는 `tauri.conf.json`의 `plugins.updater.pubkey`에 있습니다. 키 비밀번호는 같은 폴더의 `hermits-exam-apps-updater.password.dpapi`에 이 PC의 Windows 계정으로만 풀리게 암호화해 두었습니다(PowerShell `[Security.Cryptography.ProtectedData]::Unprotect`, CurrentUser).
- 서명은 배포 빌드에서만 합니다(`--config src-tauri/tauri.release.conf.json`). 로컬 빌드(`npm run build:reader:exe`)는 키 없이 됩니다.

## 데이터 위치
- 데이터베이스: `%APPDATA%\com.toeicer.app\toeic.db` (Studio는 `com.toeicer.studio`)
- 음성·사진: 같은 폴더의 `raw` / API 키: Windows 자격 증명 관리자

## 세트 파일 형식 (.toic)

zip 안에 `manifest.json`(형식 버전 3, 영역 `kind`, 출처 `origin`, AI 세트의 검증 기록 `verification`과 동향 확인 시각 `trendCheckedAt`, 마켓 구매 정보 `market`), `test.json`(Listening 또는 Reading 세트 하나: 지문 제목은 `"Part 3 · Conversation 2"`처럼 파트로 시작, Part 1·2는 들려주는 선택지 `lmcq`, 나머지는 `mcq`, 선택지 A–D·Part 2는 A–C, 정답 한 글자)과 `media/`(음성·사진, 내용 해시 이름)가 들어 있습니다. 예전 `.toeicset` 파일도 열립니다.

## 라이선스와 출처
- TOEIC은 ETS의 등록 상표입니다. 이 앱은 ETS와 관련 없는 개인 학습 도구입니다.
- 내장 샘플과 AI 문제는 모두 새로 쓴 것이며 ETS 기출·공식 문제는 포함하지 않습니다.
- 오프라인 영한 사전은 한국어 위키낱말사전(kaikki.org 추출본) 가공본, CC BY-SA 4.0. 사진은 Unsplash License.
