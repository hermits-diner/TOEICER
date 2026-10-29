import { BookOpen, Compass, FolderOpen, House, LineChart, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { BRAND } from "../lib/brand";
import { STUDIO } from "../lib/edition";

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

export default function Sidebar({ active, onSelect }: { active: PageId; onSelect: (id: PageId) => void }) {
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
      <div className="sidebar-foot">
        <button className={`icon-btn${active === "settings" ? " on" : ""}`} title="설정" aria-label="설정" onClick={() => onSelect("settings")}>
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
