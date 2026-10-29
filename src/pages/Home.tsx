import { openUrl } from "@tauri-apps/plugin-opener";
import { BRAND, formatScore } from "../lib/brand";
import { BookOpen, ChevronRight, Headphones, Mic, PenLine, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PageId } from "../components/Sidebar";
import { daysUntil, getSetting, setSetting } from "../lib/appSettings";
import { PHOTOS } from "../lib/photos";
import { loadOverview, loadRecentTests, loadWeekSeconds, loadWrongItems, type RecentTest } from "../lib/stats";
import { countDueWords } from "../lib/vocab";

const KIND = {
  reading: { label: "Reading", icon: BookOpen },
  listening: { label: "Listening", icon: Headphones },
  writing: { label: "Writing", icon: PenLine },
  speaking: { label: "Speaking", icon: Mic },
} as const;

/** Goal choices: a TOEIC section score. */
const BANDS = BRAND.goals;

function greeting(h: number): string {
  if (h < 5) return "늦은 시간까지 수고 많으십니다";
  if (h < 12) return "좋은 아침입니다";
  if (h < 18) return "좋은 오후입니다";
  return "좋은 저녁입니다";
}

const minutes = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};

const ago = (s: string) => {
  const d = new Date(s.replace(" ", "T") + "Z");
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  return days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
};

interface Props {
  showPhotos: boolean;
  onNavigate: (page: PageId) => void;
  onOpenTest: (id: number) => void;
  onOpenReview: (tab: "notes" | "words") => void;
}

export default function Home({ showPhotos, onNavigate, onOpenTest, onOpenReview }: Props) {
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [examDate, setExamDate] = useState("");
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState(false);
  const [recentBand, setRecentBand] = useState<number | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [dueWords, setDueWords] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentTest[]>([]);

  useEffect(() => {
    void Promise.all([getSetting("home_photo"), getSetting("exam_date"), getSetting("target_band")]).then(([p, d, t]) => {
      setUserPhoto(p);
      setExamDate(d ?? "");
      setTarget(t ?? "");
    });
    void loadOverview().then((o) => setRecentBand(o.recentBand));
    void loadWrongItems().then((w) => setDue(w.length));
    void countDueWords().then(setDueWords);
    void loadWeekSeconds().then(setWeek);
    void loadRecentTests().then(setRecent);
  }, []);

  const saveGoal = async () => {
    await setSetting("exam_date", examDate || null);
    await setSetting("target_band", target || null);
    setEditing(false);
  };

  const dday = examDate ? daysUntil(examDate) : null;
  const now = new Date();
  const photo = showPhotos ? (userPhoto ?? PHOTOS.home.src) : null;
  const gap = recentBand !== null && target ? +target - recentBand : null;

  return (
    <div className="content home">
      <section className={`hero${photo ? " with-photo" : ""}`} style={photo ? { backgroundImage: `url(${photo})` } : undefined}>
        <div className="hero-text">
          <div className="hero-date">{now.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}</div>
          <h1>{greeting(now.getHours())}</h1>
          <div className="hero-goal">
            {dday !== null && (
              <span className="hero-chip">{dday > 0 ? `시험까지 D-${dday}` : dday === 0 ? "오늘이 시험일입니다" : `시험 후 ${-dday}일`}</span>
            )}
            {target && <span className="hero-chip">목표 {BRAND.scoreName} {target}</span>}
            <button className="hero-chip ghost" onClick={() => setEditing((v) => !v)}>
              <Settings2 size={12} /> {examDate || target ? "목표 바꾸기" : "시험 날짜·목표 정하기"}
            </button>
          </div>
        </div>
        {photo && !userPhoto && (
          <button className="hero-credit" onClick={() => openUrl(PHOTOS.home.url).catch(() => {})}>
            {PHOTOS.home.caption} · Photo by {PHOTOS.home.author} / Unsplash
          </button>
        )}
      </section>

      {editing && (
        <div className="goal-form">
          <label>
            시험 날짜
            <input type="date" className="field" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </label>
          <label>
            목표 {BRAND.scoreName} (영역별)
            <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">정하지 않음</option>
              {BANDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" onClick={() => void saveGoal()}>저장</button>
          <button className="btn ghost" onClick={() => setEditing(false)}>취소</button>
        </div>
      )}

      <div className="tiles home-tiles">
        <div className="tile">
          <div className="tile-label">최근 평균 {BRAND.scoreName}</div>
          <div className="tile-value">{recentBand === null ? "—" : formatScore(recentBand)}</div>
          <div className="tile-note">
            {gap === null ? "Reading·Listening 최근 5회" : gap <= 0 ? "목표에 도달했습니다" : `목표까지 ${formatScore(gap)}`}
          </div>
        </div>
        <button className="tile tile-btn" onClick={() => onOpenReview(!due && dueWords ? "words" : "notes")}>
          <div className="tile-label">오늘 복습할 것</div>
          <div className="tile-value">{due === null || dueWords === null ? "—" : due + dueWords}</div>
          <div className="tile-note">
            {due || dueWords ? `오답 ${due ?? 0}문항 · 단어 ${dueWords ?? 0}개` : "복습할 것이 없습니다"}
          </div>
        </button>
        <div className="tile">
          <div className="tile-label">이번 주 학습 시간</div>
          <div className="tile-value">{week === null ? "—" : minutes(week)}</div>
          <div className="tile-note">최근 7일</div>
        </div>
      </div>

      <div className="home-cols">
        <section>
          <h3 className="section-title">이어서 하기</h3>
          {recent.length === 0 ? (
            <p className="muted">아직 푼 시험이 없습니다.</p>
          ) : (
            <div className="list">
              {recent.map((r) => {
                const Icon = KIND[r.kind].icon;
                return (
                  <button key={r.testId} className="list-row row-btn" onClick={() => onOpenTest(r.testId)}>
                    <span className="row-icon"><Icon /></span>
                    <div className="row-main">
                      <div className="row-title">{r.title}</div>
                      <div className="row-meta">{KIND[r.kind].label} · {ago(r.at)}</div>
                    </div>
                    <ChevronRight size={16} className="muted" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section>
          <h3 className="section-title">영역별 연습</h3>
          <div className="quick">
            {(BRAND.sections as readonly (keyof typeof KIND)[]).map((k) => {
              const Icon = KIND[k].icon;
              return (
                <button key={k} className="quick-btn" onClick={() => onNavigate(k)}>
                  <Icon size={18} />
                  {KIND[k].label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
