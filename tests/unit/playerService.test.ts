import { describe, it, expect } from 'vitest';
import { PlayerService } from '@app/services/playerService';

describe('PlayerService CRUD', () => {
  it('creates a player and exposes it via get/list', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '张三' });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('张三');
    expect(p.stats.matches).toBe(0);

    const got = await svc.get(p.id);
    expect(got?.name).toBe('张三');
    const list = await svc.list();
    expect(list.some((x) => x.id === p.id)).toBe(true);
  });

  it('trims names and rejects blank ones', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '  李四  ' });
    expect(p.name).toBe('李四');
    await expect(svc.create({ name: '   ' })).rejects.toThrow(/required/);
  });

  it('updates a player name', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '王五' });
    const updated = await svc.update(p.id, { name: '王五丰' });
    expect(updated.name).toBe('王五丰');
    expect((await svc.get(p.id))?.name).toBe('王五丰');
  });

  it('archives (soft delete) and hides from the default list', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '归档测试' });
    await svc.archive(p.id);
    expect((await svc.list()).some((x) => x.id === p.id)).toBe(false);
    expect((await svc.list({ includeArchived: true })).some((x) => x.id === p.id)).toBe(
      true,
    );
    // unarchive restores visibility
    await svc.unarchive(p.id);
    expect((await svc.list()).some((x) => x.id === p.id)).toBe(true);
  });

  it('hard-deletes a player', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '临时删除' });
    await svc.remove(p.id);
    expect(await svc.get(p.id)).toBeNull();
  });

  it('filters by query (name or nickname)', async () => {
    const svc = new PlayerService();
    await svc.create({ name: '张伟' });
    await svc.create({ name: '李雷', nickname: '小雷' });
    const byName = await svc.list({ query: '张' });
    expect(byName.every((p) => p.name.includes('张') || (p.nickname ?? '').includes('张'))).toBe(
      true,
    );
    const byNick = await svc.list({ query: '小雷' });
    expect(byNick.some((p) => p.name === '李雷')).toBe(true);
  });

  it('touch stamps lastUsedAt for the recency ordering', async () => {
    const svc = new PlayerService();
    const p = await svc.create({ name: '最近使用' });
    await svc.touch([p.id]);
    const got = await svc.get(p.id);
    expect(got?.lastUsedAt).toBeTypeOf('number');
    const recent = await svc.recent();
    expect(recent.some((x) => x.id === p.id)).toBe(true);
  });
});
