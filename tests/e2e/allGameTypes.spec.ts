import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * PHASE 3 —— 五套引擎全部落地后的跨玩法 E2E。
 *
 * 这里验的不是「引擎跑得对不对」（那是 tests/rules 的事），
 * 而是 **用户在 UI 上真的够得着这些规则**：
 *   九球：记分制，+1/+4/+8/+10 快捷档位
 *   六球：计分制，进一颗得一分
 *   四球：加分制，+1/+4/+8/+10 快捷档位，记错能扣
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

test('four-ball: quick +1/+4/+8/+10 buttons add points directly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '四球', '标准四球 · 2 人');

  for (const label of ['+1', '+4', '+8', '+10', '-1', '-4', '-8', '-10']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: '+8', exact: true }).click();
  await expect(page.getByText(/本局 8 : 0/).first()).toBeVisible();

  // 扣分：记错了能扣回来
  await page.getByRole('button', { name: '-1', exact: true }).click();
  await expect(page.getByText(/本局 7 : 0/).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/p3-four-scored.png`, fullPage: true });
});

test('four-ball: the points can be given to a chosen player', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '四球', '标准四球 · 2 人');

  // 先选人，再点档位 —— 分记到被选中的人身上
  await page.getByRole('button', { name: '李四', exact: true }).click();
  await expect(page.getByText('已选：李四')).toBeVisible();

  await page.getByRole('button', { name: '+4', exact: true }).click();
  await expect(page.getByText(/本局 0 : 4/).first()).toBeVisible();

  // 换人：给张三加 1 分，两边各记各的
  await page.getByRole('button', { name: /^张三(击球中)?$/ }).click();
  await page.getByRole('button', { name: '+1', exact: true }).click();
  await expect(page.getByText(/本局 1 : 4/).first()).toBeVisible();

  await page.screenshot({ path: `${OUT}/p3-target-seat.png`, fullPage: true });
});

test('leaderboard: frame scores roll up into a total ranking', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await createMatch(page, '四球', '标准四球 · 2 人');

  await page.getByRole('button', { name: '+8', exact: true }).click();
  await expect(page.getByText(/本局 8 : 0/).first()).toBeVisible();

  // 记下这一局（分数随本局快照进入历史；应用会自动开下一局）
  await page.getByRole('button', { name: /^张三 赢/ }).click();
  await expect(page.getByText(/局数 1 : 0/).first()).toBeVisible();

  await page.goto('/leaderboard');
  const first = page.locator('[data-rank-row]').first();
  await expect(first).toContainText('张三');
  await expect(first).toHaveAttribute('data-total', '8');
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
