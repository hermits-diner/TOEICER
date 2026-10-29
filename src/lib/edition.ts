/**
 * Two builds of one app, like a reader and a pro editor. Reader (free) opens set files, solves, scores and prints.
 * Studio (monthly subscription) also writes sets with the AI, converts the user's own material, edits sets and
 * writes set files to share or sell. The build fixes the edition (`npm run build:studio`); Studio-only screens are
 * loaded behind `__STUDIO__` where they are used, so a Reader build does not carry their code.
 */
export const STUDIO: boolean = __STUDIO__;
export const EDITION: "reader" | "studio" = __STUDIO__ ? "studio" : "reader";
