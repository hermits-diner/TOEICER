#!/bin/bash
# Drives TOEICER on the virtual display while ffmpeg records it; writes scene start times for captions.
OUT=${OUT:-/tmp/tour}
export DISPLAY=:99
LOG=$OUT/scenes.tsv; : > $LOG
T0=$(date +%s.%N)
scene() { echo -e "$(echo "$(date +%s.%N) - $T0" | bc)\t$1" >> $LOG; }
click() { xdotool mousemove --sync $1 $2; sleep 0.35; xdotool click 1; }

scene "TOEICER · TOEIC Listening & Reading 대비 Windows 앱"; sleep 3.5
scene "1. 가져오기 › JSON › 내장 TOEIC 샘플 세트 추가"; click 67 338; sleep 1.5; click 542 130; sleep 1.2; click 485 175; sleep 2.5
scene "2. AI로 200문항 한 회분: Part 1 사진과 음성은 Gemini로"; click 67 338; sleep 1.2; click 298 130; sleep 4.5
scene "3. Listening · Part 2: 실제처럼 선택지 문장 없이 A·B·C"; click 67 217; sleep 1.5; click 700 190; sleep 2
click 1011 196; sleep 0.6; click 1075 291; sleep 0.6; click 1139 386; sleep 0.6; click 1011 481; sleep 0.6; click 1075 576; sleep 1
scene "제출하면 채점 · 문장과 스크립트 확인 · 영역 점수(5–495) 추정"; click 1560 61; sleep 1.2; click 1537 108; sleep 4
scene "4. Reading · Part 5 단문 빈칸 · 문항당 45초"; click 67 246; sleep 1.5; click 700 190; sleep 2
click 1030 167; sleep 0.6; click 1030 373; sleep 0.6; click 1030 616; sleep 0.6; click 1030 785; sleep 1.2
scene "Part 6 장문 빈칸(문장 넣기) · Part 7 독해"; click 1110 61; sleep 3
scene "5. 인쇄: 문제지 / 문제지 + 정답"; click 1439 61; sleep 3; xdotool key Escape; click 700 600; sleep 0.5
scene "6. TOEIC 가이드: 파트별 전략 · 점수와 CEFR"; click 82 367; sleep 4
scene "TOEICER · 풀고, 만들고, 인쇄하고, 복습하기"; click 47 96; sleep 3.5
scene "END"
