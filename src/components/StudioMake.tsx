import PasteImport from "./PasteImport";
import StudioGate from "./StudioGate";
import ToeicGeneratePanel from "./ToeicGeneratePanel";

interface Props {
  tab: "ai" | "paste";
  /** Tabs the user has opened: each stays mounted (hidden when not shown), so its work in progress survives. */
  shown: string[];
  onCreated: (testId: number) => void;
}

/** Studio's making tools on the import page: a test written by the AI, or the user's own material converted. */
export default function StudioMake({ tab, shown, onCreated }: Props) {
  return (
    <StudioGate>
      {shown.includes("ai") && (
        <div hidden={tab !== "ai"}>
          <ToeicGeneratePanel onCreated={onCreated} />
        </div>
      )}
      {shown.includes("paste") && (
        <div hidden={tab !== "paste"}>
          <PasteImport onSaved={onCreated} />
        </div>
      )}
    </StudioGate>
  );
}
