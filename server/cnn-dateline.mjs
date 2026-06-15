// @ts-check
// CNN article dateline validator.
// Mirrors the BBC helper: fetch once, pull canonical datePublished/dateModified,
// and compare to an expected ISO timestamp within a tolerance.

const DEFAULT_TOLERANCE_SECONDS = 1;

/**
 * Validate CNN article dateline fields.
 *
 * @param {{
 *   url: string,
 *   expectedIso: string,
 *   toleranceSeconds?: number,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ok:boolean, datePublished?:string, dateModified?:string, reason?:string}>}
 */
export async function validateCnnDateline({
  url,
  expectedIso,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  signal,
}) {
  if (!url || !expectedIso) {
    return { ok: false, reason: "url and expectedIso are required" };
  }

  let html;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return { ok: false, reason: `fetch failed: ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `fetch error: ${message}` };
  }

  const { datePublished, dateModified } = extractDates(html);
  if (!datePublished && !dateModified) {
    return { ok: false, reason: "no datePublished/dateModified found" };
  }

  const target = new Date(expectedIso).getTime();
  if (Number.isNaN(target)) {
    return { ok: false, reason: "expectedIso is not a valid ISO timestamp" };
  }

  const datelineCandidates = /** @type {string[]} */ (
    [datePublished, dateModified].filter((iso) => typeof iso === "string" && iso.length > 0)
  );
  const matches = datelineCandidates.some((iso) =>
    withinTolerance(target, new Date(iso).getTime(), toleranceSeconds),
  );

  return {
    ok: matches,
    datePublished,
    dateModified,
    reason: matches ? undefined : "expectedIso did not match CNN dateline",
  };
}

/**
 * @param {number} targetMs
 * @param {number} candidateMs
 * @param {number} toleranceSeconds
 * @returns {boolean}
 */
function withinTolerance(targetMs, candidateMs, toleranceSeconds) {
  if (Number.isNaN(candidateMs)) return false;
  const delta = Math.abs(candidateMs - targetMs) / 1000;
  return delta <= toleranceSeconds;
}

/**
 * @param {string} html
 * @returns {{ datePublished?: string, dateModified?: string }}
 */
function extractDates(html) {
  const jsonDates = findJsonLdDates(html);
  if (jsonDates.datePublished || jsonDates.dateModified) {
    return jsonDates;
  }

  /** @param {string} property */
  const meta = (property) => {
    const reg = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    );
    const m = html.match(reg);
    return m ? m[1] : undefined;
  };

  return {
    datePublished:
      // cspell:ignore pubdate
      meta("article:published_time") ||
      meta("pubdate") ||
      meta("datePublished"),
    dateModified:
      meta("article:modified_time") ||
      meta("lastmod") ||
      meta("dateModified"),
  };
}

/**
 * @param {string} html
 * @returns {{ datePublished?: string, dateModified?: string }}
 */
function findJsonLdDates(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of scripts) {
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of candidates) {
        if (!obj || typeof obj !== "object") continue;
        const isArticle =
          obj["@type"] === "NewsArticle" ||
          obj["@type"] === "Article" ||
          (Array.isArray(obj["@type"]) && obj["@type"].includes("NewsArticle"));
        if ((obj.datePublished || obj.dateModified) && isArticle) {
          return {
            datePublished: obj.datePublished,
            dateModified: obj.dateModified,
          };
        }
      }
    } catch {
      // ignore parse errors and keep searching
    }
  }
  return { datePublished: undefined, dateModified: undefined };
}

export default validateCnnDateline;
