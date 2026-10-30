import { test, expect, type Page } from '@playwright/test';

/**
 * 记分牌形态 E2E。
 *
 * 产品主张变了：主界面是「记分牌」，不是「球台」。
 *   - 主操作是「谁赢了」，点一下即记一局并自动开下一局
 *   - 球号面板收进「精细记录」，默认不展开
 *   - 规则仍全部由引擎判定（展开后点球号，合法性由引擎回答）
 *   - Race To 达标自动收场，不用再点「结束比赛」
 */

function ball(page: Page, n: number) {
  return page.locator(`[data-ball="${n}"]`);
}

async function createAndStart(page: Page, a = '张三', b = '李四') {
  await page.goto('/');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.getByText('中式八球').first().click();
  await page.getByText('标准娱乐赛 · 2 人 · Race To 7').click();
  await page.getByPlaceholder('临时球员 1').fill(a);
  await page.getByPlaceholder('临时球员 2').fill(b);
  await page.getByRole('button', { name: /创建并进入比赛/ }).click();
  await expect(page.getByText(a).first()).toBeVisible();
}

async function startMatch(page: Page) {
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText('进行中')).toBeVisible();
}

test('scoreboard is the hero: names, Race To progress, two win buttons', async ({ page }) => {
  await createAndStart(page);
  await expect(page.getByText('张三').first()).toBeVisible();
  await expect(page.getByText('李四').first()).toBeVisible();
  await expect(page.getByText(/Race To 7/).first()).toBeVisible();
  // 两个「谁赢了」主按钮一开始就存在，记分员不需要先学一套流程
  await expect(page.getByRole('button', { name: /张三 赢/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /李四 赢/ })).toBeVisible();
});

test('the ball board is collapsed by default', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);
  // 精细记录收起 → 15 颗球不该出现在屏幕上
  await expect(page.locator('[data-ball]')).toHaveCount(0);
  await page.getByRole('button', { name: /精细记录/ }).click();
  await expect(page.locator('[data-ball]')).toHaveCount(15);
});

test('one tap records a frame and immediately opens the next', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);

  await page.getByRole('button', { name: /张三 赢/ }).click();

  // 自动进入第 2 局，不需要再点「下一局」
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();
  await expect(page.getByText('进行中')).toBeVisible();
  await expect(page.getByText(/局记录/)).toBeVisible();
});

test('scoreboard counts frames for the right player', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);

  await page.getByRole('button', { name: /李四 赢/ }).click();
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();

  await page.getByRole('button', { name: /李四 赢/ }).click();
  await expect(page.getByText(/第\s*3\s*局/).first()).toBeVisible();

  await expect(page.getByText('0 : 2').first()).toBeVisible();
});

test('undo rolls back a recorded frame', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);

  await page.getByRole('button', { name: /张三 赢/ }).click();
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/第\s*1\s*局/).first()).toBeVisible();
  await expect(page.getByText('0 : 0').first()).toBeVisible();
});

test('engine still decides legality: the 8 is never a legal target before clearance', async ({
  page,
}) => {
  await createAndStart(page);
  // 开球是隐式的：点「开始比赛」时已经把开球标记完成，球台随即开放。
  await startMatch(page);
  await page.getByRole('button', { name: /精细记录/ }).click();

  await expect(ball(page, 1)).toBeEnabled();
  await expect(ball(page, 9)).toBeEnabled();
  // 黑八在清台前永远不是合法目标 —— 这条判断来自引擎，不是 UI
  await expect(ball(page, 8)).toBeDisabled();
  await expect(ball(page, 8)).toHaveAttribute('data-legal', 'false');
});

test('potting through the engine assigns groups', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);
  await page.getByRole('button', { name: /精细记录/ }).click();

  // 开球这一杆进球不认组
  await ball(page, 2).click();
  await expect(ball(page, 2)).toHaveAttribute('data-status', 'POCKETED');
  await expect(page.getByText('全色 1–7')).toHaveCount(0);

  // 开球之后的第一颗合法进球才认组
  await ball(page, 3).click();
  await expect(page.getByText('全色 1–7').first()).toBeVisible();
  await expect(ball(page, 9)).toBeDisabled();
});

test('clearing the group turns the 8 into the only target', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);
  await page.getByRole('button', { name: /精细记录/ }).click();

  await ball(page, 2).click(); // 开球杆，不认组
  await ball(page, 3).click(); // 认组 SOLIDS
  for (const n of [1, 4, 5, 6, 7]) {
    await ball(page, n).click();
    await expect(ball(page, n)).toHaveAttribute('data-status', 'POCKETED');
  }

  await expect(page.getByText(/黑八阶段/).first()).toBeVisible();
  await expect(ball(page, 8)).toBeEnabled();
  await expect(ball(page, 9)).toBeDisabled();
});

test('race to target ends the match automatically', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);

  for (let i = 0; i < 7; i += 1) {
    await page.getByRole('button', { name: /张三 赢/ }).click();
  }

  await expect(page.locator('div').filter({ hasText: /^比赛结束$/ })).toBeVisible();
  await expect(page.getByText('7 : 0').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /张三 赢/ })).toHaveCount(0);
});

test('scoreboard survives a hard refresh', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);
  await page.getByRole('button', { name: /张三 赢/ }).click();
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();

  await page.reload();

  await expect(page.getByText('张三').first()).toBeVisible();
  await expect(page.getByText(/第\s*2\s*局/).first()).toBeVisible();
  await expect(page.getByText('1 : 0').first()).toBeVisible();
});

test('fine-grained record still records fouls through the engine', async ({ page }) => {
  await createAndStart(page);
  await startMatch(page);
  await page.getByRole('button', { name: /精细记录/ }).click();
  await page.getByRole('button', { name: '记录犯规' }).click();
  await page.getByRole('button', { name: /母球落袋/ }).click();

  await expect(page.getByText(/犯规 · 母球落袋/)).toBeVisible();
});
