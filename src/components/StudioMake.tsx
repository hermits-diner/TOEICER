import PasteImport from "./PasteImport";
import StudioGate from "./StudioGate";
import ToeicGeneratePanel from "./ToeicGeneratePanel";

/** Studio's making tools on the import page: a test written by the AI, or the user's own material converted. */
export default function StudioMake({ tab, onCreated }: { tab: "ai" | "paste"; onCreated: (testId: number) => void }) {
  return <StudioGate>{tab === "ai" ? <ToeicGeneratePanel onCreated={onCreated} /> : <PasteImport onSaved={onCreated} />}</StudioGate>;
}
