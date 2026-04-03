// CNN article dateline validator.
// Mirrors the BBC helper: fetch once, pull canonical datePublished/dateModified,
// and compare to an expected ISO timestamp within a tolerance.

const DEFAULT_TOLERANCE_SECONDS = 1;

/**
 * Validate CNN article dateline fields.
 *
 * @param {object} opts
 * @param {string} opts.url - Full CNN article URL.
 * @param {string} opts.expectedIso - ISO timestamp to compare against.
 * @param {number} [opts.toleranceSeconds=1] - Allowed difference in seconds.
 * @param {AbortSignal} [opts.signal] - Optional abort signal for fetch.
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
    return { ok: false, reason: `fetch error: ${err.message}` };
  }

  const { datePublished, dateModified } = extractDates(html);
  if (!datePublished && !dateModified) {
    return { ok: false, reason: "no datePublished/dateModified found" };
  }

  const target = new Date(expectedIso).getTime();
  if (Number.isNaN(target)) {
    return { ok: false, reason: "expectedIso is not a valid ISO timestamp" };
  }

  const matches = [datePublished, dateModified].filter(Boolean).some((iso) =>
    withinTolerance(target, new Date(iso).getTime(), toleranceSeconds),
  );

  return {
    ok: matches,
    datePublished,
    dateModified,
    reason: matches ? undefined : "expectedIso did not match CNN dateline",
  };
}

function withinTolerance(targetMs, candidateMs, toleranceSeconds) {
  if (Number.isNaN(candidateMs)) return false;
  const delta = Math.abs(candidateMs - targetMs) / 1000;
  return delta <= toleranceSeconds;
}

function extractDates(html) {
  const jsonDates = findJsonLdDates(html);
  if (jsonDates.datePublished || jsonDates.dateModified) {
    return jsonDates;
  }

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
      meta("article:published_time") ||
      meta("pubdate") ||
      meta("datePublished"),
    dateModified:
      meta("article:modified_time") ||
      meta("lastmod") ||
      meta("dateModified"),
  };
}

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
