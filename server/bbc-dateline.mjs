// Lightweight BBC article dateline validator.
// Fetches a BBC page once and compares its canonical datePublished/dateModified
// against the expected ISO timestamp provided by the caller.

const DEFAULT_TOLERANCE_SECONDS = 1;

/**
 * Validate BBC article dateline fields.
 *
 * @param {object} opts
 * @param {string} opts.url - Full BBC article URL.
 * @param {string} opts.expectedIso - ISO timestamp to compare against.
 * @param {number} [opts.toleranceSeconds=1] - Allowed difference in seconds.
 * @param {AbortSignal} [opts.signal] - Optional abort signal for fetch.
 * @returns {Promise<{ok:boolean, datePublished?:string, dateModified?:string, reason?:string}>}
 */
export async function validateBbcDateline({
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
    reason: matches ? undefined : "expectedIso did not match BBC dateline",
  };
}

function withinTolerance(targetMs, candidateMs, toleranceSeconds) {
  if (Number.isNaN(candidateMs)) return false;
  const delta = Math.abs(candidateMs - targetMs) / 1000;
  return delta <= toleranceSeconds;
}

function extractDates(html) {
  const jsonLdMatch = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]);
      if (parsed && (parsed.datePublished || parsed.dateModified)) {
        return {
          datePublished: parsed.datePublished,
          dateModified: parsed.dateModified,
        };
      }
    } catch {
      // fall through to meta extraction
    }
  }

  const meta = (property) => {
    const reg = new RegExp(
      `<meta[^>]+(?:property|itemprop)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    );
    const m = html.match(reg);
    return m ? m[1] : undefined;
  };

  return {
    datePublished:
      meta("article:published_time") || meta("datePublished") || meta("datePublished"),
    dateModified:
      meta("article:modified_time") || meta("dateModified") || meta("dateModified"),
  };
}

export default validateBbcDateline;
