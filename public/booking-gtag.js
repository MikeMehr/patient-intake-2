// Google tag bootstrap for the public booking flow only (loaded by
// src/app/booking/layout.tsx). Served from our own origin so the strict
// nonce-based CSP needs no inline-script exception.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
window.gtag = gtag;
gtag("js", new Date());
// Health-care surface: never feed ad-personalization/remarketing signals.
gtag("set", "allow_ad_personalization_signals", false);
// accept_incoming lets a Google Ads click that landed on mymdonline.ca keep
// its attribution when the patient follows the Book link over to this domain
// (requires the mymdonline.ca tag to decorate outbound links with the linker).
gtag("config", "AW-644041535", { linker: { accept_incoming: true } });
gtag("config", "G-YN209C7M82", { linker: { accept_incoming: true } });
