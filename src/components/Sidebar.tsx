import {
  BookOpen,
  Compass,
  Download,
  Headphones,
  House,
  Library,
  LineChart,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { BRAND } from "../lib/brand";

export type PageId =
  | "home"
  | "library"
  | "ai"
  | "reading"
  | "listening"
  | "writing"
  | "speaking"
  | "review"
  | "import"
  | "guide"
  | "settings";

interface Item {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

const groups: { heading: string; items: Item[] }[] = [
  {
    heading: "라이브러리",
    items: [
      { id: "home", label: "홈", icon: House },
      { id: "library", label: "전체 시험", icon: Library },
      { id: "ai", label: "AI 생성 세트", icon: Sparkles },
    ],
  },
  {
    heading: "연습",
    items: [
      // TOEIC Listening and Reading: listening comes first, as on the test.
      { id: "listening", label: "Listening (LC)", icon: Headphones },
      { id: "reading", label: "Reading (RC)", icon: BookOpen },
    ],
  },
  {
    heading: "학습",
    items: [
      { id: "review", label: "학습 기록", icon: LineChart },
      { id: "import", label: "가져오기", icon: Download },
      { id: "guide", label: BRAND.guideLabel, icon: Compass },
    ],
  },
];

export const pageLabels: Record<PageId, string> = {
  ...(Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<PageId, string>),
  settings: "설정",
};

export default function Sidebar({
  active,
  onSelect,
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar-scroll">
        {groups.map((g) => (
          <div key={g.heading}>
            <h6>{g.heading}</h6>
            {g.items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item${active === id ? " active" : ""}`}
                onClick={() => onSelect(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <button
          className={`icon-btn${active === "settings" ? " on" : ""}`}
          title="설정"
          aria-label="설정"
          onClick={() => onSelect("settings")}
        >
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
