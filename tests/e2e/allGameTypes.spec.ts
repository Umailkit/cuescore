import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * PHASE 3 —— 五套引擎全部落地后的跨玩法 E2E。
 *
 * 这里验的不是「引擎跑得对不对」（那是 tests/rules 的事），
 * 而是 **用户在 UI 上真的够得着这些规则**：
 *   九球：记分制，+1/+4/+8/+10 快捷档位
 *   六球：计分制，进一颗得一分
 *   四球：追分，五种得分类型由上家/下家赔付
 *   斯诺克：红球 → 彩球 → 结束单杆换手
 *   排名：每局比分累计进总分排名
 */
const OUT = path.resolve('screenshots');

async function createMatch(page: Page, label: string, template: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.getByText(label, { exact: true }).first().click();
  await page.getByText(template).click();
  await page.getByPlaceholder('临时球员 1').fill('张三');
  await page.getByPlaceholder('临时球员 2').fill('李四');
  await page.getByRole('button', { name: /创建并进入比赛/ }).click();
  await expect(page.getByText('张三').first()).toBeVisible();
  await page.getByRole('button', { name: /^开始比赛$/ }).click();
  await expect(page.getByText('进行中')).toBeVisible();
  await page.getByRole('button', { name: /精细记录/ }).click();
}

test('nine-ball: score by adding and deducting points', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '九球', '标准九球 · 2 人 · Race To 7');

  // 九球走记分制：没有球台面板，只有加减分
  await expect(page.locator('[data-ball]')).toHaveCount(0);

  // 快捷档位是台球厅的常用值：1 / 4 / 8 / 10
  for (const label of ['+1', '+4', '+8', '+10', '-1', '-4', '-8', '-10']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: '+4', exact: true }).click();
  await expect(page.getByText(/本局 4 : 0/).first()).toBeVisible();

  // 扣分：记错能改回来
  await page.getByRole('button', { name: '-1', exact: true }).click();
  await expect(page.getByText(/本局 3 : 0/).first()).toBeVisible();

  // 自定义分值：加 2 → 5 分（不越过 7 分目标）
  await page.getByPlaceholder('自定义分值').fill('2');
  await page.getByRole('button', { name: '加分' }).click();
  await expect(page.getByText(/本局 5 : 0/).first()).toBeVisible();

  // 扣分不能扣成负数：尝试扣 10，比分仍是 5
  await page.getByPlaceholder('自定义分值').fill('10');
  await page.getByRole('button', { name: '扣分' }).click();
  await page.waitForTimeout(300);
  await expect(page.getByText(/本局 5 : 0/).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/p3-nine-scored.png`, fullPage: true });
});

test('six-ball: potting scores points and shows them on the scoreboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '六球', '标准六球 · 2 人 · 7 分');

  await page.locator('[data-ball="1"]').click();
  await page.locator('[data-ball="2"]').click();
  await expect(page.getByText(/本局 2 : 0/).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-six-scored.png`, fullPage: true });
});

test('nine-ball: chase mode settles the same five outcomes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '九球', '九球追分 · 不限局数');

  // 追分不靠球台，五个得分类型就是主操作
  await expect(page.locator('[data-ball]')).toHaveCount(0);
  for (const [label, hint] of [
    ['普胜', '+4'],
    ['小金', '+7'],
    ['大金', '+20'],
    ['黄金九', '+8'],
    ['黑金', '-20'],
  ] as const) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`) });
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(hint);
  }

  // 两人局大金：对手一人赔 20
  await page.getByRole('button', { name: /^大金/ }).click();
  await expect(page.getByText(/总分 20 : -20/).first()).toBeVisible();

  // 黑金本家倒赔，回到零和原点
  await page.getByRole('button', { name: /^黑金/ }).click();
  await expect(page.getByText(/总分 0 : 0/).first()).toBeVisible();

  // 追分没有「本局谁赢了」，底部只留一个结束比赛
  await expect(page.getByRole('button', { name: /^张三 赢/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /结束比赛/ })).toBeVisible();

  await page.screenshot({ path: `${OUT}/p3-nine-chase.png`, fullPage: true });
});

test('four-ball: five chase outcomes settle between neighbours', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '四球', '四球追分 · 不限局数');

  // 五个得分类型都在，且带净得分提示
  for (const [label, hint] of [
    ['普胜', '+4'],
    ['小金', '+7'],
    ['大金', '+20'],
    ['黄金九', '+8'],
    ['黑金', '-20'],
  ] as const) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`) });
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(hint);
  }

  // 两人局：普胜 = 上家（对手）赔 4 分，本家 +4
  await page.getByRole('button', { name: /^普胜/ }).click();
  await expect(page.getByText(/总分 4 : -4/).first()).toBeVisible();

  await page.getByRole('button', { name: /^小金/ }).click();
  await expect(page.getByText(/总分 11 : -11/).first()).toBeVisible();

  // 黑金：本家赔给对手（两人局里上/下家是同一个人）各 10 分，净得 -20
  await page.getByRole('button', { name: /^黑金/ }).click();
  await expect(page.getByText(/总分 -9 : 9/).first()).toBeVisible();

  // 记错了能撤销
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/总分 11 : -11/).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/p3-chase-scored.png`, fullPage: true });
});

test('four-ball: the outcome can be credited to a chosen player', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '四球', '四球追分 · 不限局数');

  // 先选人，再点得分类型 —— 结算围绕被选中的人做
  await page.getByRole('button', { name: '李四', exact: true }).click();
  await expect(page.getByText('已选：李四')).toBeVisible();

  await page.getByRole('button', { name: /^普胜/ }).click();
  await expect(page.getByText(/总分 -4 : 4/).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/p3-chase-target-seat.png`, fullPage: true });
});

test('leaderboard: frame scores roll up into a total ranking', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  // 用六球：它按局结算，分数会随本局快照落进历史
  await createMatch(page, '六球', '标准六球 · 2 人 · 7 分');

  await page.locator('[data-ball="1"]').click();
  await page.locator('[data-ball="2"]').click();
  await expect(page.getByText(/本局 2 : 0/).first()).toBeVisible();

  // 记下这一局（分数随本局快照进入历史；应用会自动开下一局）
  await page.getByRole('button', { name: /^张三 赢/ }).click();
  await expect(page.getByText(/局数 1 : 0/).first()).toBeVisible();

  await page.goto('/leaderboard');
  const first = page.locator('[data-rank-row]').first();
  await expect(first).toContainText('张三');
  await expect(first).toHaveAttribute('data-total', '2');
  await expect(page.locator('[data-rank-row]')).toHaveCount(2);

  await page.screenshot({ path: `${OUT}/p3-leaderboard.png`, fullPage: true });
});

test('snooker: red → colour → end break hands over', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '斯诺克', '标准斯诺克 · Best Of 5');

  const legalIds = async () =>
    page.$$eval('[data-ball]', (els) =>
      els
        .filter((e) => e.getAttribute('data-legal') === 'true')
        .map((e) => e.getAttribute('data-ball')),
    );

  // 开局：只能打红球
  await expect.poll(legalIds).toEqual(['1']);

  await page.locator('[data-ball="1"]').click(); // 红 1 分
  // 打进红球后：只能打彩球
  await expect.poll(legalIds).toEqual(['2', '3', '4', '5', '6', '7']);

  await page.locator('[data-ball="7"]').click(); // 黑 7 分
  await expect(page.getByText(/本局 8 : 0/).first()).toBeVisible();
  // 彩球回位，回到只能打红球
  await expect.poll(legalIds).toEqual(['1']);
  await page.screenshot({ path: `${OUT}/p3-snooker-break.png`, fullPage: true });

  // 结束单杆 → 换手：下一颗红球记到对手名下
  await page.getByRole('button', { name: /结束单杆/ }).click();
  await page.locator('[data-ball="1"]').click();
  await expect(page.getByText(/本局 8 : 1/).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-snooker-endbreak.png`, fullPage: true });
});
