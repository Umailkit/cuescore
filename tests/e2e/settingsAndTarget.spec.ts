import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * 本轮三项产品需求的 E2E：
 *   1. 比赛目标：预设 / 自定义局数 / 不限局数
 *   2. 外观：浅色 / 深色切换真的生效
 *   3. 署名：芜湖职业技术大学
 */
const OUT = path.resolve('screenshots');

async function pickGame(page: Page, label: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.getByText(label, { exact: true }).first().click();
}

test('theme toggle actually changes the palette', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/settings');

  // 默认深色
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: `${OUT}/p3-theme-dark.png`, fullPage: true });

  await page.getByRole('button', { name: /切换到浅色/ }).click();

  // 浅色必须真的落到 <html class="light">，且深色类被摘掉
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  // 背景真的变浅：读 CSS 变量比看截图可靠
  const bg = await page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--c-bg');
    return v.trim();
  });
  expect(bg).toBe('244 247 245');
  await page.screenshot({ path: `${OUT}/p3-theme-light.png`, fullPage: true });

  // 刷新后仍是浅色（localStorage 记住了）
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);

  // 还能切回深色
  await page.getByRole('button', { name: /切换到深色/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('race to target: preset, custom and unlimited', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });

  // ---- 自定义局数 ----
  await pickGame(page, '中式八球');
  await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();
  await page.getByPlaceholder('临时球员 1').fill('张三');
  await page.getByPlaceholder('临时球员 2').fill('李四');
  await page.getByPlaceholder('自定义局数').fill('4');
  await expect(page.getByText('当前目标：先赢 4 局者获胜。')).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-target-custom.png`, fullPage: true });

  await page.getByRole('button', { name: /创建并进入比赛/ }).click();
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText(/Race To 4/).first()).toBeVisible();

  // ---- 不限局数 ----
  await pickGame(page, '中式八球');
  await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();
  await page.getByPlaceholder('临时球员 1').fill('张三');
  await page.getByPlaceholder('临时球员 2').fill('李四');
  await page.getByRole('button', { name: '不限' }).click();
  await expect(
    page.getByText('不限局数：不会自动结束比赛，需要收场时用「更多 → 结束比赛」。'),
  ).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-target-unlimited.png`, fullPage: true });

  await page.getByRole('button', { name: /创建并进入比赛/ }).click();
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText(/不限局数/).first()).toBeVisible();

  // 连赢 5 局也不该自动收场
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: '张三 赢' }).click();
    await page.waitForTimeout(120);
  }
  await expect(page.getByText('进行中')).toBeVisible();
  await expect(page.getByText('本局结束')).toHaveCount(0);

  // 人工出口：更多 → 结束比赛
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '结束比赛' }).click();
  await page.getByRole('button', { name: '确认结束' }).click();
  await expect(page.getByText('比赛结束').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-target-unlimited-ended.png`, fullPage: true });
});

test('signature is shown on home and settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await expect(page.getByText('芜湖职业技术大学').first()).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('芜湖职业技术大学')).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-signature.png`, fullPage: true });
});
