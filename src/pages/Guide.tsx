import { openUrl } from "@tauri-apps/plugin-opener";
import { BRAND, formatScore } from "../lib/brand";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import PhotoBanner from "../components/PhotoBanner";
import { PHOTOS } from "../lib/photos";
import { BAND_TABLES } from "../lib/bandTable";
import {
  AS_OF,
  BOOKING_LINKS,
  FEE_NOTES,
  FEES,
  RESOURCE_SITES,
  RESOURCE_YOUTUBE,
  VENUES,
  type LinkItem,
} from "../lib/examInfo";
import { BAND_MEANINGS, OFFICIAL_LABEL, OFFICIAL_URL, SECTIONS, type GuideSection } from "../lib/guideContent";

type Tab = "overview" | "bands" | "skills" | "testday" | "exam" | "resources" | "app";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "소개" },
  { id: "bands", label: "점수 해석" },
  { id: "skills", label: "영역별 대비" },
  { id: "testday", label: "시험 당일" },
  { id: "exam", label: "접수·비용" },
  { id: "resources", label: "추천 자료" },
  { id: "app", label: "앱 사용법" },
];

const SKILLS = BRAND.sections;

const open = (url: string) => {
  openUrl(url).catch(() => window.open(url, "_blank"));
};

function Links({ items }: { items: LinkItem[] }) {
  return (
    <div className="link-list">
      {items.map((l) => (
        <button key={l.url} className="link-row" onClick={() => open(l.url)}>
          <div>
            <div className="row-title">{l.title}</div>
            <div className="row-meta">{l.desc}</div>
          </div>
          <ExternalLink size={14} />
        </button>
      ))}
    </div>
  );
}

function SectionView({ s }: { s: GuideSection }) {
  return (
    <>
      <p className="guide-lead">{s.lead}</p>
      {s.facts && (
        <table className="facts">
          <tbody>
            {s.facts.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.blocks.map((b) => (
        <section key={b.title} className="guide-block">
          <h3 className="section-title">{b.title}</h3>
          <ul>
            {b.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const section = (id: string) => SECTIONS.find((s) => s.id === id)!;
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function Guide({ showPhotos }: { showPhotos: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [skill, setSkill] = useState<(typeof SKILLS)[number]>("listening");

  return (
    <div className="content guide">
      <h1>{BRAND.guideLabel}</h1>
      <div className="segmented tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {showPhotos && <PhotoBanner photo={PHOTOS[tab === "skills" ? skill : tab]} />}

      {tab === "overview" && <SectionView s={section("overview")} />}

      {tab === "bands" && (
        <>
          <SectionView s={section("bands")} />
          <h3 className="section-title">점수대와 CEFR</h3>
          <table className="facts bands">
            <tbody>
              {BAND_MEANINGS.map((b) => (
                <tr key={b.band}>
                  <th>
                    <span className="band-pill">{b.band}</span>
                  </th>
                  <td>
                    <b>{b.name}</b>
                    <div className="muted">{b.desc}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="section-title">정답률 → 점수 추정</h3>
          <p className="muted">
            ETS는 회차마다 동등화를 거쳐 점수를 내며 고정 환산표를 공개하지 않습니다. 앱은 정답률로 영역 점수를 추정하며, 실제 점수와 수십 점 차이가 날 수 있습니다.
          </p>
          <div className="band-tables">
            {BAND_TABLES.map((t) => (
              <table key={t.label} className="facts compact">
                <thead>
                  <tr>
                    <th colSpan={2}>{t.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map(([min, band], i) => {
                    const max = i === 0 ? 100 : t.rows[i - 1][0] - 1;
                    return (
                      <tr key={band}>
                        <td>{min === max ? `${min}%` : `${min}–${max}%`}</td>
                        <td>{formatScore(band)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </>
      )}

      {tab === "skills" && (
        <>
          <div className="segmented small sub-tabs">
            {SKILLS.map((s) => (
              <button key={s} className={skill === s ? "on" : ""} onClick={() => setSkill(s)}>
                {section(s).label}
              </button>
            ))}
          </div>
          <SectionView s={section(skill)} />
        </>
      )}

      {tab === "testday" && <SectionView s={section("testday")} />}
      {tab === "app" && <SectionView s={section("app")} />}

      {tab === "exam" && (
        <>
          <p className="notice">
            {AS_OF} 기준 안내입니다. 응시료·일정·시험장은 나라마다 다르고 수시로 바뀌므로, 아래 공식 링크의 접수
            화면에서 확인하십시오.
          </p>

          {FEES.length > 0 && <h3 className="section-title">응시료 (한국)</h3>}
          {FEES.length > 0 && (
          <table className="facts">
            <tbody>
              {FEES.map((f) => (
                <tr key={f.name}>
                  <th>{f.name}</th>
                  <td className="num">{won(f.krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <ul className="notes">
            {FEE_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>

          <h3 className="section-title">시험 일정 조회·접수</h3>
          <Links items={BOOKING_LINKS} />

          {VENUES.length > 0 && <h3 className="section-title">시험장</h3>}
          {VENUES.length > 0 && (
          <table className="facts">
            <thead>
              <tr>
                <th>지역</th>
                <th>시험장</th>
                <th>주소</th>
                <th>주관</th>
              </tr>
            </thead>
            <tbody>
              {VENUES.map((v) => (
                <tr key={v.name}>
                  <td>{v.city}</td>
                  <td>{v.name}</td>
                  <td className="muted">{v.address ?? "접수 페이지에서 확인"}</td>
                  <td>{v.org}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </>
      )}

      {tab === "resources" && (
        <>
          <h3 className="section-title">추천 사이트</h3>
          <Links items={RESOURCE_SITES} />
          <h3 className="section-title">유튜브 채널</h3>
          <Links items={RESOURCE_YOUTUBE} />
          <p className="muted">공식 채널 외에는 유튜브 검색 결과로 연결됩니다.</p>
        </>
      )}

      <p className="guide-foot muted">
        최신 공식 정보:{" "}
        <a href={OFFICIAL_URL} onClick={(e) => (e.preventDefault(), open(OFFICIAL_URL))}>
          {OFFICIAL_LABEL}
        </a>
      </p>
    </div>
  );
}
