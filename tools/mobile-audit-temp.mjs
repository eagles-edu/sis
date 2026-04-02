import { chromium } from 'playwright';

const ORIGIN = 'http://127.0.0.1:8788';
const VIEWPORT = { width: 390, height: 844 };

const adminPages = [
  '/admin/students?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/attendance?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/assignments?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/assignments-data?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/performance-data?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/grades-data?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/reports?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/queue-hub?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/news-reports?apiOrigin=http://127.0.0.1:8788',
  '/admin/students/points-management?apiOrigin=http://127.0.0.1:8788',
  '/web-asset/admin/student-admin.html?apiOrigin=http://127.0.0.1:8788&page=news-reports',
  '/web-asset/admin/student-points.html?apiOrigin=http://127.0.0.1:8788'
];

const parentPages = [
  '/parent/portal?apiOrigin=http://127.0.0.1:8788',
  '/web-asset/parent/parent-portal.html?apiOrigin=http://127.0.0.1:8788'
];

const studentPages = [
  '/student/portal?apiOrigin=http://127.0.0.1:8788',
  '/web-asset/student/student-portal.html?apiOrigin=http://127.0.0.1:8788'
];

function abs(path) {
  return path.startsWith('http') ? path : `${ORIGIN}${path}`;
}

async function loginAdmin(page) {
  await page.goto(abs('/admin/students?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 15000 });
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', '3825u2z');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/admin/auth/login') || res.url().includes('/api/admin/login')),
    page.click('#loginBtn'),
  ]);
  await page.waitForTimeout(1000);
}

async function loginParent(page) {
  await page.goto(abs('/parent/portal?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 15000 });
  await page.fill('#parentsId', 'cmkramer001');
  await page.fill('#parentPassword', 'P1k@ch00');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/parent/auth/login')),
    page.click('#loginBtn'),
  ]);
  await page.waitForTimeout(1000);
}

async function loginStudent(page) {
  await page.goto(abs('/student/portal?apiOrigin=http://127.0.0.1:8788'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 15000 });
  await page.fill('#loginEaglesId', 'kramer001');
  await page.fill('#loginPassword', 'P1k@ch00');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/student/auth/login')),
    page.click('#loginBtn'),
  ]);
  await page.waitForTimeout(1000);
}

async function measurePage(page, url) {
  await page.goto(abs(url), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
  const result = await page.evaluate(() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const docEl = document.documentElement;
    const body = document.body;
    const rootOverflow = Math.max(docEl.scrollWidth - docEl.clientWidth, body ? body.scrollWidth - body.clientWidth : 0);

    const outside = [];
    const interactive = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]'));
    for (const el of interactive) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const parentScroller = el.closest('[style*="overflow"], .table-scroll-wrap, .portal-table-wrap, .table-container, .table-wrap, [class*="scroll"]');
      if (!parentScroller && (rect.right > window.innerWidth + 1 || rect.left < -1)) {
        outside.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: (el.className || '').toString().slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)
        });
      }
    }

    return {
      viewportMeta,
      clientWidth: docEl.clientWidth,
      scrollWidth: docEl.scrollWidth,
      rootOverflow,
      outside: outside.slice(0, 6)
    };
  });

  const pass = Boolean(result.viewportMeta) && result.rootOverflow <= 1;
  return { url: abs(url), pass, ...result };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const passes = [];
  try {
    const adminCtx = await browser.newContext({ viewport: VIEWPORT });
    const adminPage = await adminCtx.newPage();
    await loginAdmin(adminPage);
    for (const url of adminPages) {
      const r = await measurePage(adminPage, url);
      (r.pass ? passes : failures).push(r);
    }
    await adminCtx.close();

    const parentCtx = await browser.newContext({ viewport: VIEWPORT });
    const parentPage = await parentCtx.newPage();
    await loginParent(parentPage);
    for (const url of parentPages) {
      const r = await measurePage(parentPage, url);
      (r.pass ? passes : failures).push(r);
    }
    await parentCtx.close();

    const studentCtx = await browser.newContext({ viewport: VIEWPORT });
    const studentPage = await studentCtx.newPage();
    await loginStudent(studentPage);
    for (const url of studentPages) {
      const r = await measurePage(studentPage, url);
      (r.pass ? passes : failures).push(r);
    }
    await studentCtx.close();
  } finally {
    await browser.close();
  }

  const report = {
    viewport: VIEWPORT,
    total: passes.length + failures.length,
    passed: passes.length,
    failed: failures.length,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
