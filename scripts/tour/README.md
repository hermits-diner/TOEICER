# 사용법 영상 다시 만들기

`docs/media/toeicer-tour.mp4`는 Linux의 가상 화면(Xvfb)에서 디버그 빌드를 자동으로 조작하며 녹화한 영상입니다. 화면이 바뀌면 같은 방법으로 다시 만듭니다.

```bash
sudo apt-get install -y xvfb xdotool ffmpeg fonts-noto-cjk libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev bc
npm run build && (cd src-tauri && cargo build --features tauri/custom-protocol)
Xvfb :99 -screen 0 1600x1000x24 &
export DISPLAY=:99 OUT=/tmp/tour
rm -rf ~/.config/com.toeicer.app ~/.local/share/com.toeicer.app   # 빈 상태에서 시작
(cd src-tauri && WEBKIT_DISABLE_COMPOSITING_MODE=1 ./target/debug/toeicer-app &) ; sleep 8
W=$(xdotool search --name '^TOEICER$' | head -1); xdotool windowmove $W 0 0; xdotool windowsize $W 1600 1000
mkdir -p $OUT && (ffmpeg -y -f x11grab -framerate 30 -video_size 1600x1000 -i :99 -c:v libx264 -preset ultrafast -crf 18 $OUT/raw.mkv &) ; sleep 1
scripts/tour/tour.sh; pkill -INT -x ffmpeg
```

`$OUT/scenes.tsv`에 장면별 시작 시각과 자막이 남습니다. 자막은 ffmpeg `drawtext`(Noto Sans CJK Bold, 남색 상자)로 녹화 시작과의 차이 약 1.1초를 더해 입혔습니다. 클릭 좌표는 1600×1000 창 기준입니다.
