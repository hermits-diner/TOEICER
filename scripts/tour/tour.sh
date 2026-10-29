#!/bin/bash
# Drives TOEICER on the virtual display while ffmpeg records it; writes scene start times for the captions.
#   tour.sh reader       free edition, from an empty data folder (the sample installs on first run)
#   tour.sh studio       Studio's first start on the same computer (it takes the free edition's sets and records)
#   tour.sh studio-edit  Studio again, after seed-mine.py added a "내 자료" set to edit and export
# The "인쇄" scenes leave the app still: the render step lays the printed pages (docs/media/toeicer-print-sample.pdf) over it.
PART=${1:-reader}
OUT=${OUT:-/tmp/tour}
export DISPLAY=:99
LOG=$OUT/scenes-$PART.tsv; : > $LOG
T0=$(date +%s.%N)
scene() { echo -e "$(echo "$(date +%s.%N) - $T0" | bc)\t$1" >> $LOG; }
click() { xdotool mousemove $1 $2; sleep ${3:-0.35}; xdotool click 1; }
hover() { xdotool mousemove $1 $2; }
# pick <y>: choose the option at that height in the question pane.
pick() { click 1100 $1 0.1; sleep 0.25; }

case $PART in
reader)
  scene "TOEICER · TOEIC Listening & Reading 대비 Windows 앱"; sleep 3
  scene "1. 무료판: 처음 실행하면 샘플(Listening·Reading)이 라이브러리에 (출처 표시)"; click 66 125; sleep 0.6; hover 700 188; sleep 2.6
  scene "2. Reading · Part 5 단문 빈칸: A–D 4지선다 · 시계"; click 700 188; sleep 1.8; pick 167; sleep 0.4; pick 373; sleep 0.4; pick 616; pick 785; sleep 0.3
  click 533 979 0.1; sleep 1.5; pick 359; pick 565; pick 845; sleep 0.4
  hover 1200 500; xdotool click --repeat 40 --delay 3 4; sleep 0.5   # the pane keeps its scroll across parts
  scene "Part 6 장문 빈칸(문장 넣기) · Part 7 독해"; click 1149 61; sleep 1; pick 215; pick 458; pick 627; pick 870; sleep 0.4; click 1203 61; sleep 1; pick 167; pick 467; sleep 0.6
  scene "3. 제출: 정답·오답 표시 · Reading 점수(5–495) 추정"; click 1560 61; sleep 1.2; click 1537 108; sleep 3.5
  scene "4. 인쇄: 시험지처럼 PART 머리와 2단 편집"; click 1390 61; sleep 1.3; click 1000 125; sleep 3.2
  scene "OMR 답안지와 정답·채점표도 함께"; sleep 3
  scene "5. TOEIC 가이드와 앱 사용법(두 판 비교)"; click 82 246; sleep 1.2; click 740 130; sleep 2.8
  scene "6. 세트 파일 열기: 마켓·선생님이 보낸 세트"; click 84 154; sleep 0.6; hover 341 121; sleep 2.8
  ;;
studio)
  scene "TOEICER Studio(월 구독): 첫 실행에 무료판의 세트·학습 기록을 가져옴"; click 66 125; sleep 0.6; hover 700 188; sleep 3.2
  scene "Studio 1. AI로 만들기: 파트 · 목표 점수 · 상황·업종"; click 88 183; sleep 2.8
  scene "구독 중인 AI CLI가 새 문제를 씀 · 검증 기록과 함께 저장"; hover 371 198; sleep 3.2
  scene "만들기 전에 공식 사이트를 읽어 최신 출제 동향을 반영"; hover 330 469; sleep 2.8
  scene "Studio 2. 붙여넣기·PDF: 학원 프린트·교재 문제를 AI가 세트로"; click 422 130; sleep 3.2
  ;;
studio-edit)
  scene "Studio 3. 내 자료·AI 세트는 연필로 고치기: 문구 · 정답"; click 66 125; sleep 0.6; hover 900 188; sleep 1; click 1427 189; sleep 2
  for i in $(seq 1 8); do xdotool click 5; sleep 0.12; done; sleep 1
  xdotool click --repeat 150 --delay 2 5; sleep 0.8; click 1456 949; sleep 0.6
  scene "Studio 4. 세트 파일로 내보내기 · 내 자료는 마켓 판매 불가"; hover 900 188; sleep 0.4; click 1467 189; sleep 1.8; click 1046 798; sleep 3
  scene "Studio 5. 설정 › Studio 구독: 14일 체험 남은 일수"; click 26 978; sleep 0.6; click 448 130; sleep 3
  scene "TOEICER · 무료판으로 풀고 인쇄, Studio로 만들고 공유"; click 47 96; sleep 3.2
  ;;
esac
scene "END"
