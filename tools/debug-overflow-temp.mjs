import { chromium } from 'playwright';

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/debug-overflow-temp.mjs <url>');
  process.exit(1);
}
const ORIGIN = 'http://127.0.0.1:8788';
function abs(url) { return url.startsWith('http') ? url : `${ORIGIN}${url}`; }

async function loginFor(page, url) {
  if (url.includes('/admin/students') || url.includes('/web-asset/admin/student-admin.html') || url.includes('/student-points.html')) {
    await page.goto(abs('/admin/students?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginForm', { timeout: 15000 });
    await page.fill('#loginUser', 'admin');
    await page.fill('#loginPass', '3825u2z');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/admin/auth/login') || res.url().includes('/api/admin/login')),
      page.click('#loginBtn'),
    ]);
    await page.waitForTimeout(500);
    return;
  }
  if (url.includes('/parent/portal') || url.includes('/web-asset/parent/parent-portal.html')) {
    await page.goto(abs('/parent/portal?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginForm', { timeout: 15000 });
    await page.fill('#parentsId', 'cmkramer001');
    await page.fill('#parentPassword', 'P1k@ch00');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/parent/auth/login')),
      page.click('#loginForm button[type="submit"]'),
    ]);
    await page.waitForTimeout(500);
    return;
  }
  if (url.includes('/student/portal') || url.includes('/web-asset/student/student-portal.html')) {
    await page.goto(abs('/student/portal?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginForm', { timeout: 15000 });
    await page.fill('#loginEaglesId', 'kramer001');
    await page.fill('#loginPassword', 'P1k@ch00');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/student/auth/login')),
      page.click('#loginForm button[type="submit"]'),
    ]);
    await page.waitForTimeout(500);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await loginFor(page, target);
await page.goto(abs(target), { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const doc = document.documentElement;
  const body = document.body;
  const entries = [];
  const all = Array.from(document.querySelectorAll('*'));
  for (const el of all) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if ((rect.width <= 0 && rect.height <= 0) || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rightOverflow = rect.right - window.innerWidth;
    const leftOverflow = 0 - rect.left;
    if (rightOverflow > 1 || leftOverflow > 1 || el.scrollWidth > el.clientWidth + 1) {
      entries.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: (el.className || '').toString().slice(0, 120),
        right: Math.round(rect.right),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        pos: cs.position,
        transform: cs.transform !== 'none' ? cs.transform : '',
        overflowX: cs.overflowX,
      });
    }
  }
  entries.sort((a, b) => (b.right - a.right) || (b.scrollWidth - a.scrollWidth));
  return {
    viewport: window.innerWidth,
    docClient: doc.clientWidth,
    docScroll: doc.scrollWidth,
    bodyClient: body?.clientWidth || 0,
    bodyScroll: body?.scrollWidth || 0,
    top: entries.slice(0, 20),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
