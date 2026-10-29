import classroom from "../assets/photos/classroom.webp";
import libraryShelves from "../assets/photos/library-shelves.webp";
import listening from "../assets/photos/listening.webp";
import readingRoom from "../assets/photos/reading-room.webp";

/** Bundled photos, all free under the Unsplash License (checked 2026-10-02); credited in Settings.
    TOEICER tints them in its own 'office' theme (see App.css). */
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
  testday: { src: classroom, caption: "Test day", author: "Allen Y", url: u("eDLsRfSnrC0") },
  exam: { src: classroom, caption: "Test day", author: "Allen Y", url: u("eDLsRfSnrC0") },
  resources: { src: libraryShelves, caption: "Library", author: "Gérard Griffay", url: u("YsBdqVgCDVI") },
  app: { src: readingRoom, caption: "Reading room", author: "Lilian Do Khac", url: u("8CASOM38lQc") },
} satisfies Record<string, Photo>;
