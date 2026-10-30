import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Visual capture pass (not an assertion suite).
 * Produces screenshots of the key PHASE 2 screens at the three required
 * viewport sizes so the UI can be reviewed without guessing.
 */
const OUT = path.resolve('screenshots');

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'tablet-834x1112', width: 834, height: 1112 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];

test('capture PHASE 2 screens', async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // 1) Home (empty state)
    await page.goto('/');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${OUT}/01-home-${vp.name}.png`,
      fullPage: true,
    });

    // 2) New match — game type picker
    await page.getByRole('button', { name: '开始比赛' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/02-games-${vp.name}.png`,
      fullPage: true,
    });

    // 3) Gated game (snooker) template list
    await page.getByText('斯诺克').first().click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/03-gated-${vp.name}.png`,
      fullPage: true,
    });

    // 4) 8-ball templates
    await page.getByRole('button', { name: '返回' }).click();
    await page.getByText('中式八球').first().click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/04-templates-${vp.name}.png`,
      fullPage: true,
    });

    // 5) Players + target step
    await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();
    await page.getByPlaceholder('临时球员 1').fill('张三');
    await page.getByPlaceholder('临时球员 2').fill('李四');
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${OUT}/05-players-${vp.name}.png`,
      fullPage: true,
    });

    // 6) Match workspace — READY
    await page.getByRole('button', { name: /创建并进入比赛/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${OUT}/06-match-ready-${vp.name}.png`,
      fullPage: true,
    });

    // 7) Match workspace — PLAYING with a frame completed
    await page.getByRole('button', { name: /^开始比赛$/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /结束当前局/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${OUT}/07-match-frame-end-${vp.name}.png`,
      fullPage: true,
    });

    // 8) Home with "继续比赛" + recents
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${OUT}/08-home-continue-${vp.name}.png`,
      fullPage: true,
    });

    // 9) History
    await page.goto('/history');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${OUT}/09-history-${vp.name}.png`,
      fullPage: true,
    });

    // 10) Players page
    await page.goto('/players');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${OUT}/10-players-${vp.name}.png`,
      fullPage: true,
    });
  }

  expect(true).toBe(true);
});
