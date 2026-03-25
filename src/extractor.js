/**
 * DOM extraction logic — runs inside the browser page context via page.evaluate().
 * Must be self-contained (no imports, no closures over outside variables).
 */
export function extractPageData() {
  const getMeta = (name) => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`);
    return el ? el.getAttribute('content') : null;
  };

  // Title
  const title = document.title || '';

  // Meta tags
  const meta = {
    description: getMeta('description'),
    keywords: getMeta('keywords'),
    author: getMeta('author'),
    robots: getMeta('robots'),
  };

  // Open Graph
  const ogData = {
    title: getMeta('og:title'),
    description: getMeta('og:description'),
    image: getMeta('og:image'),
    url: getMeta('og:url'),
    type: getMeta('og:type'),
    siteName: getMeta('og:site_name'),
  };

  // Visible text (skip hidden elements, scripts, styles)
  const text = document.body.innerText || '';

  // Links with text
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({
      text: a.innerText.trim().slice(0, 200),
      href: a.href,
    }))
    .filter((l) => l.text && l.href);

  // JSON-LD structured data
  const jsonLd = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  )
    .map((el) => {
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Check for password fields (login wall signal)
  const hasPasswordField = document.querySelectorAll('input[type="password"]').length > 0;

  // Check for captcha iframes
  const hasCaptcha =
    document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"]'
    ).length > 0;

  return {
    title,
    meta,
    ogData,
    text,
    links: links.slice(0, 200), // cap to avoid huge output
    jsonLd,
    hasPasswordField,
    hasCaptcha,
  };
}
