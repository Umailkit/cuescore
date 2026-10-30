import { test, expect, type Page } from '@playwright/test';

/**
 * PHASE 2 E2E baseline.
 *
 * Covers the full product skeleton the spec asks for:
 *   home → new match → pick 8-ball → template → players → create
 *   → current match → refresh page → recover → continue
 *
 * NOTE: assertions use role/scoped locators rather than bare text, because the
 * same label can legitimately appear in both the status badge and a banner
 * (Playwright strict mode rejects ambiguous text locators).
 */

async function createEightBallMatch(page: Page, nameA: string, nameB: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始比赛' }).click();

  // Game type card for 中式八球
  await page.getByText('中式八球').first().click();

  // First recommended template
  await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();

  // Two temporary players
  await page.getByPlaceholder('临时球员 1').fill(nameA);
  await page.getByPlaceholder('临时球员 2').fill(nameB);

  await page.getByRole('button', { name: /创建并进入比赛/ }).click();
  // Land on the match workspace: player names must be shown
  await expect(page.getByText(nameA).first()).toBeVisible();
}

test('shell renders, dark theme, PWA manifest present', async ({ page }) => {
  await page.goto('/');
  // The hero heading (not the header copy) identifies the product.
  await expect(page.getByRole('heading', { name: 'CueScore' })).toBeVisible();
  await expect(page.getByText('台球比赛记录')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});

/** 五种游戏类型 × 各自的一键模板（PHASE 3 门控解除后的完整矩阵）。 */
const PLAYABLE: { label: string; template: string; mode: 'frame' | 'chase' }[] = [
  { label: '中式八球', template: '标准娱乐赛 · 2 人 · Race To 7', mode: 'frame' },
  { label: '九球', template: '标准九球 · 2 人 · Race To 7', mode: 'frame' },
  { label: '六球', template: '标准六球 · 2 人 · 7 分', mode: 'frame' },
  // 四球是追分：没有「本局谁赢了」，得分类型才是主操作
  { label: '四球', template: '四球追分 · 不限局数', mode: 'chase' },
  { label: '斯诺克', template: '标准斯诺克 · Best Of 5', mode: 'frame' },
];

test('no game type is gated behind PHASE 3 any more', async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByText(/Coming in PHASE 3/)).toHaveCount(0);
  await expect(page.getByText(/PHASE 3/)).toHaveCount(0);
});

for (const g of PLAYABLE) {
  test(`${g.label}：创建 → 开始 → 记一局（真实引擎驱动）`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '开始比赛' }).click();

    await page.getByText(g.label, { exact: true }).first().click();
    await page.getByText(g.template).click();

    await page.getByPlaceholder('临时球员 1').fill('Ann');
    await page.getByPlaceholder('临时球员 2').fill('Bob');
    await page.getByRole('button', { name: /创建并进入比赛/ }).click();
    await expect(page.getByText('Ann').first()).toBeVisible();

    await page.getByRole('button', { name: /^开始比赛$/ }).click();
    await expect(page.getByText('进行中')).toBeVisible();

    // 追分：点「普胜」，上家赔 4 分给本家
    if (g.mode === 'chase') {
      await page.getByRole('button', { name: /精细记录/ }).click();
      await page.getByRole('button', { name: /^普胜/ }).click();
      await expect(page.getByText(/总分 4 : -4/).first()).toBeVisible();
      return;
    }

    // 主操作：本局谁赢了 → 点一下就记一局并自动开下一局
    await page.getByRole('button', { name: 'Ann 赢' }).click();
    await expect(page.getByText('进行中')).toBeVisible();
    // 自动续局：局号推进到第 2 局，比分 1 : 0
    await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ann 赢' })).toBeVisible();
  });
}

test('create an 8-ball match, start it, then pause', async ({ page }) => {
  await createEightBallMatch(page, 'Alice', 'Bob');

  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText('进行中')).toBeVisible();

  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByText('已暂停')).toBeVisible();
});

test('end a frame records the frame and advances the frame number', async ({ page }) => {
  await createEightBallMatch(page, 'Alice', 'Bob');
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText('进行中')).toBeVisible();

  // 「结束当前局」是裁判声明，收在「精细记录 → 裁判裁定」里
  //（主界面只留「谁赢了」这一个主操作）。
  await page.getByRole('button', { name: /精细记录/ }).click();
  await page.getByRole('button', { name: '裁判裁定' }).click();
  await page.getByRole('button', { name: /结束当前局/ }).click();

  // The banner (a div) is distinct from the status badge (a span).
  await expect(page.locator('div').filter({ hasText: /^本局结束$/ })).toBeVisible();

  // 本局已定胜负时，主操作换成「开始下一局」，不能再摆两个「谁赢了」
  // （那会把分记到下一局去，而且 FRAME_END → FRAME_END 会被状态机拒绝）。
  const nextFrame = page.getByRole('button', { name: '开始下一局' });
  await expect(nextFrame).toBeVisible();
  await expect(page.getByRole('button', { name: /赢/ })).toHaveCount(0);

  // Frame advanced from 1 → 2 after starting the next frame.
  await nextFrame.click();
  await expect(page.getByText('进行中')).toBeVisible();
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();
});

test('refresh recovers the match from persistence (IndexedDB)', async ({ page }) => {
  await createEightBallMatch(page, 'Alice', 'Bob');
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText('进行中')).toBeVisible();

  // Hard refresh — state must be rebuilt from persisted data, not memory.
  await page.reload();

  await expect(page.getByText('Alice').first()).toBeVisible();
  await expect(page.getByText('进行中')).toBeVisible();
});

test('home shows "继续上一场比赛" for an unfinished match', async ({ page }) => {
  await createEightBallMatch(page, 'Alice', 'Bob');
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  // Wait for the command to land (and be persisted) before a full reload:
  // a hard navigation aborts in-flight writes, which is a test race, not a bug.
  await expect(page.getByText('进行中')).toBeVisible();

  await page.goto('/');
  const resume = page.getByRole('button', { name: /继续上一场比赛/ });
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('Alice vs Bob');

  // Clicking it must resume the same match.
  await resume.click();
  await expect(page.getByText('进行中')).toBeVisible();
});
