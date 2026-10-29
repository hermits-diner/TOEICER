# WORKLOG

## 2026-10-29

### TOEFLER 코드로 TOEICER 시작

- **무엇을 했는가**: 빈 저장소에 TOEFLER(IELTS_Practice 기반 Tauri 앱)의 소스를 옮기고 정체성(이름, com.toeicer.app, .toeicset, 백업 폴더)을 바꿨다. TOEFL 전용 모듈(생성기, 샘플, 사양)은 지우고 TOEIC Listening and Reading용으로 새로 썼다.
- **TOEIC 고유 기능**: 들려주는 선택지 유형 `lmcq`(Part 1·2, 채점 전에는 글자만), Part 1 사진을 만드는 Rust 명령 `ai_image`(Gemini 그림 모델), 파트별 생성기 `toeicGen.ts`(측정·다시 쓰기·블라인드 풀이·편집자 판단·사진·음성), 영역별 5–495 점수 추정, Reading 문항당 45초, Part 번호로 된 탭.
- **개성**: '오피스' 테마(먹색·에메랄드·오렌지), 서류가방 아이콘, TOEIC 가이드. 내비게이션은 Listening·Reading만.
- **왜**: 사용자가 시험별로 따로 만든 앱을 요청했고, 디자인 언어는 맞추되 앱마다 개성을 살리라고 했다.
- **확인**: `tsc --noEmit`, vitest 237개(가짜 AI로 200문항 생성 흐름 포함), `cargo test`(그림 요청 본문), Xvfb에서 홈·생성 화면·Part 2 풀이 화면 스크린샷.
- **하지 않은 것 / 주의**: 실제 구독 CLI와 Gemini 그림·음성 모델로 라이브 생성은 이 환경에서 돌리지 못했다. 그림 모델 기본값(`gemini-2.5-flash-image`)은 키로 볼 수 있는 목록에 맞게 설정에서 바꿔야 할 수 있다. Part 3의 3인 대화는 음성 엔진 제약으로 만들지 않는다. TOEIC Speaking & Writing은 이번 범위에서 뺐다.
