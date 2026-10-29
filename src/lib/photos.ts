import classroom from "../assets/photos/classroom.webp";
import libraryShelves from "../assets/photos/library-shelves.webp";
import listening from "../assets/photos/listening.webp";
import readingRoom from "../assets/photos/reading-room.webp";
import speaking from "../assets/photos/speaking.webp";
import writing from "../assets/photos/writing.webp";

/** Bundled photos, all free under the Unsplash License (checked 2026-10-02); credited in Settings.
    TOEICER uses the campus-neutral ones and tints them navy-to-teal in its own theme (see App.css, 캠퍼스). */
export interface Photo {
  src: string;
  caption: string;
  author: string;
  url: string;
}

const u = (id: string) => `https://unsplash.com/photos/${id}`;

export const PHOTOS = {
  home: { src: libraryShelves, caption: "Library", author: "Gérard Griffay", url: u("YsBdqVgCDVI") },
  overview: { src: classroom, caption: "Lecture hall", author: "Allen Y", url: u("eDLsRfSnrC0") },
  bands: { src: readingRoom, caption: "Reading room", author: "Lilian Do Khac", url: u("8CASOM38lQc") },
  listening: { src: listening, caption: "Listening", author: "Vitaly Gariev", url: u("N1z42XgkOiU") },
  reading: { src: readingRoom, caption: "Reading room", author: "Lilian Do Khac", url: u("8CASOM38lQc") },
  writing: { src: writing, caption: "Writing", author: "Kawê Rodrigues", url: u("jKmdjT7aQJA") },
  speaking: { src: speaking, caption: "Speaking", author: "Vitaly Gariev", url: u("eg9NIbDRxD0") },
  testday: { src: classroom, caption: "Test day", author: "Allen Y", url: u("eDLsRfSnrC0") },
  exam: { src: classroom, caption: "Test day", author: "Allen Y", url: u("eDLsRfSnrC0") },
  resources: { src: libraryShelves, caption: "Library", author: "Gérard Griffay", url: u("YsBdqVgCDVI") },
  app: { src: readingRoom, caption: "Reading room", author: "Lilian Do Khac", url: u("8CASOM38lQc") },
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;
