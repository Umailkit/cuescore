import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { registerSW } from 'virtual:pwa-register';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

/**
 * Service Worker 更新策略。
 *
 * 背景：`navigateFallback: 'index.html'` 让任意导航（含深链接）在离线时也能
 * 打开应用，代价是导航请求返回的是**预缓存里的那个 index.html**。
 * 新版本上线后，只要旧 SW 还活着，用户手动刷新拿到的仍是旧壳 ——
 * 表现就是「代码早发了，页面上还是老界面，刷新也没用」。
 *
 * 这里补两件事：
 * 1. 页面本来就由旧 SW 控制时，新 SW 接管（controllerchange）后立刻重载一次；
 *    `hadController` 为 false 表示首次安装，此时不重载，避免打断首次访问。
 * 2. 每分钟主动 `update()` 一次，长时间停留的页面也能拿到新版本。
 *
 * sessionStorage 标记用来防重载循环：万一新 SW 反复 claim，只重载一次。
 */
const RELOAD_FLAG = 'cuescore:sw-reloaded';
const hadController = Boolean(navigator.serviceWorker?.controller);

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!hadController) return;
  if (sessionStorage.getItem(RELOAD_FLAG) === '1') return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
});

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    window.setInterval(() => {
      void registration.update();
    }, 60_000);
  },
});

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
