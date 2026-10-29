import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Option } from "../lib/types";

interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Shows only each option's text; the key is an id, not a letter to display. */
  plain?: boolean;
  /** Hides the "선택 해제" row: something must stay chosen. */
  required?: boolean;
}

/** Themed replacement for a native <select>, whose popup list cannot follow the app's colours. */
export default function Dropdown({ options, value, onChange, disabled, placeholder = "선택…", plain, required }: Props) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.key === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      // Open upwards when the list would not fit below.
      const r = ref.current.getBoundingClientRect();
      const need = Math.min(options.length + 1, 9) * 32 + 16;
      setUp(window.innerHeight - r.bottom < need && r.top > need);
      setActive(options.findIndex((o) => o.key === value));
    }
    setOpen((o) => !o);
  };

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if ((e.key === "Enter" || e.key === " ") && active >= 0) {
      e.preventDefault();
      choose(options[active].key);
    }
  };

  return (
    <div className={`dropdown${open ? " open" : ""}`} ref={ref} onKeyDown={onKey}>
      <button
        type="button"
        className="dropdown-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        {selected ? (
          <span className="dropdown-value">
            {!plain && <b>{selected.key}</b>}
            {selected.text}
          </span>
        ) : (
          <span className="dropdown-value placeholder">{placeholder}</span>
        )}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className={`dropdown-menu${up ? " up" : ""}`} role="listbox">
          {options.map((o, i) => (
            <button
              type="button"
              key={o.key}
              role="option"
              aria-selected={o.key === value}
              className={`dropdown-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o.key)}
            >
              {!plain && <b>{o.key}</b>}
              <span>{o.text}</span>
              {o.key === value && <Check size={14} />}
            </button>
          ))}
          {value && !required && (
            <button type="button" className="dropdown-item clear" onMouseEnter={() => setActive(-1)} onClick={() => choose("")}>
              선택 해제
            </button>
          )}
        </div>
      )}
    </div>
  );
}
