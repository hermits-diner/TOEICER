import { BookOpen, Compass, FolderOpen, House, LineChart, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { BRAND } from "../lib/brand";
import { STUDIO } from "../lib/edition";

// Studio's AI generation job on every page; a Reader build leaves it (and the generator behind it) out.
const GenJobBadge = __STUDIO__ ? lazy(() => import("./GenJobBadge")) : null;

export type PageId = "home" | "library" | "ai" | "review" | "import" | "guide" | "settings";

interface Item {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

/** Reader opens set files; Studio also makes them, so its "가져오기" is where the AI and the converter live. */
const groups: { heading: string; items: Item[] }[] = [
  {
    heading: "문제",
    items: [
      { id: "home", label: "홈", icon: House },
      { id: "library", label: "문제 세트", icon: BookOpen },
      ...(STUDIO ? [{ id: "ai" as const, label: "AI 생성 세트", icon: Sparkles }] : []),
      { id: "import", label: STUDIO ? "만들기·가져오기" : "세트 파일 열기", icon: STUDIO ? Sparkles : FolderOpen },
    ],
  },
  {
    heading: "학습",
    items: [
      { id: "review", label: "학습 기록", icon: LineChart },
      { id: "guide", label: BRAND.guideLabel, icon: Compass },
    ],
  },
];

export default function Sidebar({
  active,
  onSelect,
  onOpenGeneration,
  onOpenTest,
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
  /** Studio: the AI generation page, from the job indicator. */
  onOpenGeneration?: () => void;
  /** Studio: a set a finished generation job made. */
  onOpenTest?: (testId: number) => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar-scroll">
        {groups.map((g) => (
          <div key={g.heading}>
            <h6>{g.heading}</h6>
            {g.items.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-item${active === id ? " active" : ""}`} onClick={() => onSelect(id)}>
                <Icon />
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>
      {GenJobBadge && onOpenGeneration && onOpenTest && (
        <Suspense fallback={null}>
          <GenJobBadge onOpenPage={onOpenGeneration} onOpenTest={onOpenTest} />
        </Suspense>
      )}
      <div className="sidebar-foot">
        <button className={`icon-btn${active === "settings" ? " on" : ""}`} title="설정" aria-label="설정" onClick={() => onSelect("settings")}>
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
