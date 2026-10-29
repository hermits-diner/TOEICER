import { Info } from "lucide-react";

/** A small ⓘ whose tooltip carries an explanation the screen no longer spells out. */
export default function Hint({ text }: { text: string }) {
  return (
    <span className="hint" title={text} aria-label={text} role="img">
      <Info size={13} />
    </span>
  );
}
