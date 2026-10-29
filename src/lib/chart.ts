/**
 * Static charts for AI-written Academic Writing Task 1, drawn as SVG and stored as a PNG like an exam paper figure.
 * Palette: the validated categorical order (light mode). Slots 3-4 fall below 3:1 against white, so every chart
 * carries a legend or direct labels and never relies on colour alone.
 */

export type ChartType = "bar" | "line" | "pie" | "table";

export interface ChartSpec {
  type: ChartType;
  title: string;
  /** Unit of the values, e.g. "%", "millions", "tonnes". */
  unit: string;
  /** Bar/line: x-axis categories (years, countries…). Pie: slice names. Table: row names. */
  categories: string[];
  /** Bar/line/table: one series per group/line/column. Pie: exactly one series. */
  series: { name: string; values: number[] }[];
}

const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const INK = "#0b0b0b";
const MUTED = "#52514e";
const GRID = "#e4e3df";
const SURFACE = "#ffffff";
const W = 760;
const H = 460;
const FONT = `font-family="Segoe UI, Arial, sans-serif"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Checks and tidies a spec from the model. Throws a readable error when it cannot be drawn. */
export function validateChart(raw: unknown): ChartSpec {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const type = o.type as ChartType;
  if (!["bar", "line", "pie", "table"].includes(type)) throw new Error("그래프 종류가 올바르지 않습니다.");
  const categories = (Array.isArray(o.categories) ? o.categories : []).map((c) => String(c).trim()).filter(Boolean);
  const series = (Array.isArray(o.series) ? o.series : [])
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({ name: String(s.name ?? "").trim(), values: (Array.isArray(s.values) ? s.values : []).map(Number) }));
  if (categories.length < 2 || categories.length > 12) throw new Error("그래프 항목 수가 올바르지 않습니다(2–12개).");
  if (series.length < 1 || series.length > (type === "pie" ? 4 : 6)) throw new Error("그래프 계열 수가 올바르지 않습니다.");
  if (series.some((s) => s.values.length !== categories.length || s.values.some((v) => !Number.isFinite(v) || v < 0)))
    throw new Error("그래프 값의 개수나 형식이 맞지 않습니다.");
  if (type === "pie" && series.some((s) => s.values.reduce((a, b) => a + b, 0) <= 0)) throw new Error("원그래프 값이 비어 있습니다.");
  return { type, title: String(o.title ?? "").trim() || "Chart", unit: String(o.unit ?? "").trim(), categories, series };
}

/** A clean axis maximum and step: 0-100 by 20, 0-2500 by 500, … */
export function niceScale(max: number, ticks = 5): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.2 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-GB") : String(Math.round(v * 100) / 100));

function legend(series: ChartSpec["series"], y: number): string {
  if (series.length < 2) return "";
  const items = series.map((s) => ({ s, w: 26 + s.name.length * 7.2 }));
  const total = items.reduce((a, b) => a + b.w + 18, -18);
  let x = (W - total) / 2;
  return items
    .map(({ s, w }, i) => {
      const out = `<rect x="${x}" y="${y - 9}" width="12" height="12" rx="2" fill="${PALETTE[i]}"/><text x="${x + 18}" y="${y + 1}" font-size="13" fill="${INK}" ${FONT}>${esc(s.name)}</text>`;
      x += w + 18;
      return out;
    })
    .join("");
}

function header(spec: ChartSpec): string {
  return `<rect width="${W}" height="${H}" fill="${SURFACE}"/><text x="${W / 2}" y="30" text-anchor="middle" font-size="17" font-weight="600" fill="${INK}" ${FONT}>${esc(spec.title)}</text>`;
}

function axes(spec: ChartSpec, top: number, step: number, plot: { x: number; y: number; w: number; h: number }): string {
  const lines: string[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = plot.y + plot.h - (v / top) * plot.h;
    lines.push(`<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    lines.push(`<text x="${plot.x - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${MUTED}" ${FONT}>${fmt(v)}</text>`);
  }
  if (spec.unit) lines.push(`<text x="${plot.x - 8}" y="${plot.y - 12}" text-anchor="end" font-size="12" fill="${MUTED}" ${FONT}>${esc(spec.unit)}</text>`);
  return lines.join("");
}

function barChart(spec: ChartSpec): string {
  const plot = { x: 80, y: 80, w: W - 110, h: H - 150 };
  const { top, step } = niceScale(Math.max(...spec.series.flatMap((s) => s.values)));
  const band = plot.w / spec.categories.length;
  const n = spec.series.length;
  const bar = Math.min(24, (band * 0.7 - (n - 1) * 2) / n);
  const group = n * bar + (n - 1) * 2;
  const marks = spec.categories.map((c, ci) => {
    const x0 = plot.x + ci * band + (band - group) / 2;
    const bars = spec.series.map((s, si) => {
      const h = (s.values[ci] / top) * plot.h;
      const x = x0 + si * (bar + 2);
      const y = plot.y + plot.h - h;
      const r = Math.min(4, h, bar / 2);
      return `<path d="M${x},${plot.y + plot.h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${plot.y + plot.h} Z" fill="${PALETTE[si]}"/>`;
    });
    const label = `<text x="${plot.x + ci * band + band / 2}" y="${plot.y + plot.h + 20}" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>${esc(c)}</text>`;
    return bars.join("") + label;
  });
  return header(spec) + axes(spec, top, step, plot) + marks.join("") + legend(spec.series, H - 22);
}

function lineChart(spec: ChartSpec): string {
  const plot = { x: 80, y: 80, w: W - 140, h: H - 150 };
  const { top, step } = niceScale(Math.max(...spec.series.flatMap((s) => s.values)));
  const x = (i: number) => plot.x + (spec.categories.length === 1 ? plot.w / 2 : (i * plot.w) / (spec.categories.length - 1));
  const y = (v: number) => plot.y + plot.h - (v / top) * plot.h;
  const lines = spec.series.map((s, si) => {
    const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const dots = s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${PALETTE[si]}" stroke="${SURFACE}" stroke-width="2"/>`).join("");
    return `<path d="${d}" fill="none" stroke="${PALETTE[si]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  });
  const labels = spec.categories
    .map((c, i) => `<text x="${x(i)}" y="${plot.y + plot.h + 20}" text-anchor="middle" font-size="12" fill="${INK}" ${FONT}>${esc(c)}</text>`)
    .join("");
  return header(spec) + axes(spec, top, step, plot) + lines.join("") + labels + legend(spec.series, H - 22);
}

function pieChart(spec: ChartSpec): string {
  const pies = spec.series;
  const cols = pies.length;
  const r = Math.min(130, (W / cols) / 2 - 50);
  const parts = pies.map((s, pi) => {
    const cx = (W / cols) * (pi + 0.5);
    const cy = 245;
    const total = s.values.reduce((a, b) => a + b, 0);
    let angle = -Math.PI / 2;
    const slices = s.values.map((v, i) => {
      const a = (v / total) * Math.PI * 2;
      const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      const [x2, y2] = [cx + r * Math.cos(angle + a), cy + r * Math.sin(angle + a)];
      const mid = angle + a / 2;
      const pct = Math.round((v / total) * 100);
      const [lx, ly] = [cx + (r + 22) * Math.cos(mid), cy + (r + 22) * Math.sin(mid)];
      angle += a;
      const path = `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="${SURFACE}" stroke-width="2"/>`;
      const label = `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${Math.cos(mid) >= 0 ? "start" : "end"}" font-size="12" fill="${INK}" ${FONT}>${pct}%</text>`;
      return path + label;
    });
    const caption = cols > 1 ? `<text x="${cx}" y="${cy + r + 48}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}" ${FONT}>${esc(s.name)}</text>` : "";
    return slices.join("") + caption;
  });
  // One legend for the slice names, shared by every pie.
  const names = spec.categories.map((c) => ({ name: c, values: [] }));
  const legendBlock = legend(names.length > 1 ? names : [], H - 18);
  return header(spec) + parts.join("") + legendBlock;
}

function tableChart(spec: ChartSpec): string {
  const cols = spec.series.length + 1;
  const colW = Math.min(170, (W - 60) / cols);
  const x0 = (W - colW * cols) / 2;
  const rowH = Math.min(32, (H - 110) / (spec.categories.length + 1));
  const y0 = 60;
  const cell = (text: string, c: number, r: number, bold = false, align: "start" | "middle" = "middle") =>
    `<text x="${align === "start" ? x0 + 10 : x0 + c * colW + colW / 2}" y="${y0 + r * rowH + rowH / 2 + 5}" text-anchor="${align}" font-size="13" ${bold ? 'font-weight="600"' : ""} fill="${INK}" ${FONT}>${esc(text)}</text>`;
  const out = [header(spec)];
  out.push(`<rect x="${x0}" y="${y0}" width="${colW * cols}" height="${rowH}" fill="#f0efec"/>`);
  for (let r = 0; r <= spec.categories.length + 1; r++)
    out.push(`<line x1="${x0}" x2="${x0 + colW * cols}" y1="${y0 + r * rowH}" y2="${y0 + r * rowH}" stroke="#cfcdc7"/>`);
  out.push(cell(spec.unit ? `(${spec.unit})` : "", 0, 0, true, "start"));
  spec.series.forEach((s, i) => out.push(cell(s.name, i + 1, 0, true)));
  spec.categories.forEach((c, r) => {
    out.push(cell(c, 0, r + 1, false, "start"));
    spec.series.forEach((s, i) => out.push(cell(fmt(s.values[r]), i + 1, r + 1)));
  });
  return out.join("");
}

export function chartSvg(spec: ChartSpec): string {
  const body = spec.type === "bar" ? barChart(spec) : spec.type === "line" ? lineChart(spec) : spec.type === "pie" ? pieChart(spec) : tableChart(spec);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

/** Rasterises the SVG at 2x into PNG bytes (needs a DOM; runs in the app's webview). */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("그래프 그림을 만들지 못했습니다."))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
