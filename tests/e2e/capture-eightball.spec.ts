import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * PHASE 3A visual capture — 真实八球对局在三种视口下的样子。
 *
 * 重点看两件事（第二十条：移动端操作体验）：
 *   1. 15 颗球在 390px 宽的手机上是否还够大、不拥挤
 *   2. 底部主操作区是否一屏可达，不用滚动
 */
const OUT = path.resolve('screenshots');

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'tablet-834x1112', width: 834, height: 1112 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];

test('capture PHASE 3A eight-ball board', async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // 建一场八球比赛
    await page.goto('/');
    await page.getByRole('button', { name: '开始比赛' }).click();
    await page.getByText('中式八球').first().click();
    await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();
    await page.getByPlaceholder('临时球员 1').fill('张三');
    await page.getByPlaceholder('临时球员 2').fill('李四');
    await page.getByRole('button', { name: /创建并进入比赛/ }).click();
    await expect(page.getByText('张三').first()).toBeVisible();

    // 1) READY：开球前，所有球都不可点
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p3a-01-ready-${vp.name}.png`, fullPage: true });

    // 2) PLAYING：记分牌主界面（开球已隐式完成）
    await page.getByRole('button', { name: /^开始比赛$/ }).click();
    await expect(page.getByText('进行中')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p3a-02-open-${vp.name}.png`, fullPage: true });

    // 3) 精细记录展开：球台 OPEN，14 颗可点
    await page.getByRole('button', { name: /精细记录/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/p3a-03-groups-${vp.name}.png`, fullPage: true });

    // 4) 犯规面板
    // 用精确匹配：'犯规' 是 '本方回合结束（不判犯规，直接换手）' 的子串。
    await page.getByRole('button', { name: /^记录犯规$/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/p3a-04-foul-${vp.name}.png`, fullPage: true });
    await page.getByRole('button', { name: /^收起$/ }).click();

    // 5) 清台 → 黑八阶段（必须打光本方 7 颗，8 号才会成为唯一目标）
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await page.locator(`[data-ball="${n}"]`).click();
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/p3a-05-eight-${vp.name}.png`, fullPage: true });

    // 6) 黑八进袋 → 本局结束
    await page.locator('[data-ball="8"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/p3a-06-frame-end-${vp.name}.png`, fullPage: true });
  }

  expect(true).toBe(true);
});
