import type { AppCreds } from "../api.js";
import { setDisplayName } from "./header.js";

export const DEFAULT_BRAND_NAME = "Daily Command Center";

export function applyBrand(brand: AppCreds["brand"]): void {
  const name     = (brand?.name     || DEFAULT_BRAND_NAME).trim() || DEFAULT_BRAND_NAME;
  const subtitle = (brand?.subtitle || "").trim();

  document.title = name;

  const h1 = document.getElementById("brand-name");
  if (h1) h1.textContent = name;

  const footerName = document.getElementById("footer-brand-name");
  if (footerName) footerName.textContent = name;

  const subEl = document.getElementById("brand-subtitle");
  const sepEl = document.getElementById("brand-subtitle-sep");
  if (subEl && sepEl) {
    if (subtitle) {
      subEl.textContent = subtitle;
      subEl.hidden = false;
      sepEl.hidden = false;
    } else {
      subEl.textContent = "";
      subEl.hidden = true;
      sepEl.hidden = true;
    }
  }

  // Subtitle doubles as the greeting name — "Good morning, {subtitle}."
  setDisplayName(subtitle);
}
