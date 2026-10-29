# TOEICER

TOEIC Listening and Reading을 대비하는 Windows 데스크톱 앱입니다. 문제를 모으고, AI가 200문항 한 회분을 새로 쓰고, 풀고 채점하고 복습하고, 인쇄해서 종이로도 공부하는 과정이 모두 내 컴퓨터의 로컬 SQLite에 쌓입니다.

[IELTS_Practice](https://github.com/hermits-diner/IELTS_Practice), [TOEFLER](https://github.com/hermits-diner/TOEFLER)와 같은 기반(Tauri 2 + React 19 + TypeScript)에서 출발했고, 디자인 언어는 같되 TOEICER만의 '오피스' 테마(먹색 글씨·에메랄드 포인트·오렌지 강조)와 서류가방 아이콘을 씁니다.

**사용법 영상**: [docs/media/toeicer-tour.mp4](docs/media/toeicer-tour.mp4) (약 1분 · 샘플 가져오기 → AI 출제 → Listening Part 2 풀이와 채점 → Reading Part 5 → 인쇄 → 가이드). 다시 만드는 방법은 [scripts/tour](scripts/tour/README.md).

## 무엇을 할 수 있나

### 실제 시험 형식 그대로 풀기
- **Listening (Part 1–4)**: Part 1 사진 묘사와 Part 2 질의응답은 실제 시험처럼 선택지 문장이 보이지 않고 A·B·C(·D) 단추만 나옵니다. 채점 후 문장과 스크립트를 봅니다. Part 3·4는 시각 자료(표·일정·지도) 문항도 지원합니다.
- **Reading (Part 5–7)**: 단문 빈칸, 장문 빈칸(문장 넣기 포함), 단일·이중·삼중 지문. 문항당 45초(100문항 75분) 제한.
- 점수는 영역별 5–495점으로 추정합니다(ETS가 고정 환산표를 공개하지 않아 '추정'으로 표시).

### AI로 200문항 한 회분 만들기
- PC에 구독 계정으로 로그인한 **Claude Code**(Claude Pro·Max), **Codex CLI**(ChatGPT Plus·Pro), **Antigravity CLI**(Google 계정·Gemini)를 앱이 실행합니다.
- 파트별로 쓰기 → 실제 시험의 문항 수·선택지 수·빈칸 표시·길이로 측정 → 어긋나면 다시 쓰기 → 정답을 가린 블라인드 풀이 → 엇갈린 문항은 정답 수정 또는 제외 → **Gemini로 Part 1 사진과 Listening 음성** → Listening(1–100)·Reading(101–200) 한 부로 저장
- 목표 점수 600+ · 750+ · 900+로 난이도 구성 조절, 상황·업종 지정
- 가지고 있는 공식 자료(PDF·텍스트)를 참고자료로 넣으면 이 PC에만 저장하고 형식·난이도 기준으로만 씁니다.
- 근거와 근사치는 [docs/toeic-sources.md](docs/toeic-sources.md).

### 복습과 출력
- 오답 노트(간격 반복), AI 오답 해설, 학습 기록, 단어장, 영한 사전 팝업
- 문제지 / 문제지 + 정답 인쇄(Part 1·2는 문제지에 선택지 없이, 정답지에 문장과 스크립트). Windows 인쇄 대화상자에서 PDF 저장.
- `.toeicset` 세트 파일 공유, 백업(문서 › TOEICER 백업, OneDrive, USB)

## AI 연결

| 구독 | 실행 파일 | 설치 | 로그인 |
|---|---|---|---|
| Claude Pro / Max | `claude` | `npm install -g @anthropic-ai/claude-code` | `claude` 실행 후 `/login` |
| ChatGPT Plus / Pro | `codex` | `npm install -g @openai/codex` | `codex login` |
| Google 계정 (Gemini) | `agy` | Antigravity 설치 | `agy` 실행 후 Google 로그인 |

Listening 음성과 Part 1 사진은 **Gemini API 키**로 만듭니다(설정 › AI › 음성에서 읽기 모델과 그림 모델 선택). 키가 없으면 Part 1은 장면 설명으로, 음성은 Windows 영어 음성으로 대신합니다.

## 설치와 빌드

`v*` 태그를 올리면 GitHub Actions가 Windows 설치 프로그램과 단일 `toeicer-app.exe`를 Releases에 올립니다.

```powershell
git clone https://github.com/hermits-diner/TOEICER.git
cd TOEICER
npm install
npm run tauri dev        # 개발 실행
npm run build:exe        # src-tauri\target\release\toeicer-app.exe
npm test
```

필요한 것: Node.js 20 이상, Rust 1.77 이상, WebView2 런타임, Visual Studio Build Tools(C++).

## 데이터 위치
- 데이터베이스: `%APPDATA%\com.toeicer.app\toeicer.db`
- 사진·음성·녹음: 같은 폴더 아래 / API 키: Windows 자격 증명 관리자

## 가져오기 형식

TOEFLER와 같은 JSON 형식입니다. TOEIC Part 1·2는 `lmcq`(들려주는 선택지: 채점 전에는 글자만 보임), 나머지는 `mcq`를 씁니다. Part 1 사진은 그룹의 `image`에 넣습니다.

## 라이선스와 출처
- TOEIC은 ETS의 등록 상표입니다. 이 앱은 ETS와 관련 없는 개인 학습 도구입니다.
- 내장 샘플과 AI 문제는 모두 새로 쓴 것이며 ETS 기출·공식 문제는 포함하지 않습니다.
- 오프라인 영한 사전은 한국어 위키낱말사전(kaikki.org 추출본) 가공본, CC BY-SA 4.0. 사진은 Unsplash License.
