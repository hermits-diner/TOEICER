import { useEffect, useState } from "react";
import { CATALOG_EVENT, loadCatalog, type Catalog } from "../lib/modelCatalog";

/** The stored model catalog, re-read whenever a background refresh or a status check updates it. */
export function useCatalog(): Catalog {
  const [catalog, setCatalog] = useState<Catalog>(loadCatalog);
  useEffect(() => {
    const onChange = () => setCatalog(loadCatalog());
    window.addEventListener(CATALOG_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_EVENT, onChange);
  }, []);
  return catalog;
}
