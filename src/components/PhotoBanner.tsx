import { openUrl } from "@tauri-apps/plugin-opener";
import type { Photo } from "../lib/photos";

/** A wide photo strip with its credit. Decorative: screen readers skip it. */
export default function PhotoBanner({ photo }: { photo: Photo }) {
  return (
    <figure className="photo-banner" aria-hidden="true">
      <img src={photo.src} alt="" draggable={false} />
      <button className="photo-credit" tabIndex={-1} onClick={() => openUrl(photo.url).catch(() => {})}>
        {photo.caption} · Photo by {photo.author} / Unsplash
      </button>
    </figure>
  );
}
