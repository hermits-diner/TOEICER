# 사용법 영상 다시 만들기

`docs/media/toeicer-tour.mp4`(약 1분 7초)는 Linux의 가상 화면(Xvfb)에서 디버그 빌드를 자동으로 조작하며 녹화한 세 토막을 이어 붙인 영상입니다. 화면이 바뀌면 같은 방법으로 다시 만듭니다.

1. **무료판**(`tour.sh reader`): 빈 데이터 폴더에서 시작 → 샘플(Listening Part 2–4 · Reading Part 5–7)이 저절로 들어감 → Reading Part 5·6·7 풀기 → 제출(12/16, Reading 360점 추정) → 인쇄 → 가이드 › 앱 사용법 → 세트 파일 열기
2. **Studio 첫 실행**(`tour.sh studio`): 무료판 데이터를 그대로 둔 채 Studio를 켜면 세트와 학습 기록을 가져옴 → 만들기·가져오기(AI로 만들기, 붙여넣기·PDF). AI는 실행하지 않습니다.
3. **Studio 편집**(`tour.sh studio-edit`): `seed-mine.py`로 Reading 샘플을 복사한 '내 자료' 세트를 넣고(붙여넣기 변환에는 AI가 필요하므로) → 연필로 고치기 → 세트 파일로 내보내기 → 설정 › Studio 구독 → 홈

```bash
sudo apt-get install -y xvfb xdotool ffmpeg fonts-noto-cjk libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev bc
Xvfb :99 -screen 0 1600x1000x24 &
export DISPLAY=:99 OUT=/tmp/tour; mkdir -p $OUT ~/Documents

run() {  # run <창 이름> <tour.sh 부분>: 앱을 띄우고 녹화하며 조작한 뒤 닫음
  (cd ~/Documents && WEBKIT_DISABLE_COMPOSITING_MODE=1 "$OLDPWD/src-tauri/target/debug/toeicer-app" &) ; sleep 9
  W=$(xdotool search --name "^$1\$" | head -1); xdotool windowmove $W 0 0; xdotool windowsize $W 1600 1000
  (ffmpeg -y -f x11grab -framerate 30 -video_size 1600x1000 -i :99 -c:v libx264 -preset ultrafast -crf 18 $OUT/raw-$2.mkv &) ; sleep 1
  scripts/tour/tour.sh $2; pkill -INT -x ffmpeg; sleep 2; pkill -x toeicer-app; sleep 2
}

# 1. 무료판
rm -rf ~/.config/com.toeicer.* ~/.local/share/com.toeicer.*      # 두 판 모두 빈 상태에서 시작
npm run build && (cd src-tauri && cargo build --features tauri/custom-protocol)
run TOEICER reader

# 2–3. Studio: 같은 바이너리를 Studio 화면과 Studio 설정(식별자 com.toeicer.studio, 창 이름 TOEICER Studio)으로 다시 빌드
npm run build:studio && (cd src-tauri && TAURI_CONFIG="$(cat tauri.studio.conf.json)" cargo build --features tauri/custom-protocol)
run "TOEICER Studio" studio
python3 scripts/tour/seed-mine.py ~/.config/com.toeicer.studio/toeic.db "학원 프린트 Reading (Part 5–7)" Reading
run "TOEICER Studio" studio-edit
```

`$OUT/scenes-<부분>.tsv`에 장면별 시작 시각과 자막이 남습니다. 세 녹화를 각각 `tour.sh` 시작 시점(ffmpeg 시작 약 1.1초 뒤)부터 마지막 장면까지 잘라 이어 붙이고, 1280×800으로 줄여 자막을 ffmpeg `drawtext`(Noto Sans CJK Bold 30px, 흰 글씨, 짙은 초록 `#0b4a35` 상자 0.92)로 입혔습니다. 인쇄 장면 두 개에는 `docs/media/toeicer-print-sample.pdf`의 1–2쪽(Reading 문제지)과 3–4쪽(OMR 답안지, 정답·채점표)을 짙은 초록 바탕에 나란히 놓은 그림을 덮었습니다. 클릭 좌표는 1600×1000 창 기준입니다. Listening 세트는 Windows 음성으로 읽어 주는데, 녹화한 Linux에는 그 음성이 없어 영상에서는 Reading만 풉니다.

게시한 영상은 이렇게 만든 녹화본(약 1분 27초)을 장면마다 최대 1.45배 빠르게 돌려 약 1분 7초로 줄인 것입니다(자막은 장면마다 약 2.5초 이상 보임).
