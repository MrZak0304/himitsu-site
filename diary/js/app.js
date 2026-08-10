// UI配線のみ。ロジックは js/core/(ピュア)と js/store/(永続化)に置く(CLAUDE.md)。

import { BUILD, applyDevOverrides } from './build-flags.js';
import { injectIcons, HABIT_ICONS } from './icons.js';
import { initAds } from './ads.js';
import { todayKey } from './core/dates.js';
import { createEntriesStore } from './store/entries.js';
import { createTagsStore } from './store/tags.js';
import { createHabitsStore } from './store/habits.js';
import { createHabitLogsStore } from './store/habit-logs.js';
import { createSettingsStore } from './store/settings.js';
import { createImagePipeline } from './images.js';
import { createBackupIO } from './backup-io.js';
import { applyTheme } from './ui/theme.js';
import { initToday } from './ui/today.js';
import { initCalendar } from './ui/calendar.js';
import { initHabits } from './ui/habits.js';
import { initSettings } from './ui/settings.js';
import { createLockGuard } from './ui/lock-screen.js';

// --- グローバルエラー赤帯(最初に仕込む。実機報告のスクショにエラー文が写るように) ---
const errEl = document.getElementById('global-error');
function showGlobalError(message) {
  errEl.textContent = `エラーが発生しました: ${message}`;
  errEl.hidden = false;
}
window.addEventListener('error', (e) => showGlobalError(e.message));
window.addEventListener('unhandledrejection', (e) => showGlobalError(e.reason?.message ?? String(e.reason)));

const dev = applyDevOverrides(window.location);

async function main() {
  const pipeline = createImagePipeline();

  // 開発用リセットフック(localhost限定。build-flags.js 側でガード済み)
  if (dev.reset) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('diary-')) localStorage.removeItem(key);
    }
    await pipeline.store.clear().catch(() => {});
    // ワンショット化: reload で再リセットされないよう ?reset=1 をURLから除去(variant等は残す)
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    history.replaceState(null, '', url);
  }

  injectIcons();

  const stores = {
    entries: createEntriesStore(),
    tags: createTagsStore(),
    habits: createHabitsStore(),
    habitLogs: createHabitLogsStore(),
    settings: createSettingsStore(),
  };
  const backupIO = createBackupIO();

  // --- 画面内ポップアップ(window.confirm/alert は使わない) ---
  const popup = document.getElementById('confirm-popup');
  const popupMsg = document.getElementById('confirm-message');
  const popupOk = document.getElementById('confirm-ok');
  const popupCancel = document.getElementById('confirm-cancel');
  function confirmPopup(message, { okLabel = '実行する', cancelLabel = 'やめる' } = {}) {
    return new Promise((resolve) => {
      popupMsg.textContent = message;
      popupOk.textContent = okLabel;
      popupCancel.textContent = cancelLabel;
      popup.hidden = false;
      popupOk.onclick = () => {
        popup.hidden = true;
        resolve(true);
      };
      popupCancel.onclick = () => {
        popup.hidden = true;
        resolve(false);
      };
    });
  }

  // --- 処理中オーバーレイ(position:fixed 全画面。教訓 scroll-miByouga) ---
  const overlay = document.getElementById('loading-overlay');
  const overlayText = document.getElementById('loading-text');
  function showLoading(text) {
    overlayText.textContent = text ?? '処理中…';
    overlay.hidden = false;
  }
  function hideLoading() {
    overlay.hidden = true;
  }

  // 日課アイコンの描画(内蔵SVG / 絵文字 / ユーザー画像)
  function renderHabitIcon(el, icon) {
    if (icon.type === 'emoji') {
      el.textContent = icon.value;
    } else if (icon.type === 'image') {
      el.textContent = '';
      pipeline.store.get(icon.value).then((rec) => {
        if (!rec?.thumbBlob) return;
        const url = URL.createObjectURL(rec.thumbBlob);
        const img = document.createElement('img');
        img.alt = '';
        img.onload = () => URL.revokeObjectURL(url);
        img.src = url;
        el.replaceChildren(img);
      });
    } else {
      el.innerHTML = HABIT_ICONS[icon.value] ?? HABIT_ICONS.star;
    }
  }

  const ctx = {
    stores,
    pipeline,
    backupIO,
    variant: BUILD.variant,
    todayKey: () => todayKey(),
    confirm: confirmPopup,
    showLoading,
    hideLoading,
    renderHabitIcon,
  };

  const lock = createLockGuard(ctx);
  ctx.lock = lock;

  const habitsUI = initHabits(ctx);
  ctx.renderCharacter = habitsUI.renderCharacter;
  ctx.reactCharacter = habitsUI.reactCharacter;
  ctx.reactAllDone = habitsUI.reactAllDone;

  // 保存確認(2026-08-10 PD FB): トースト+キャラの一言で「記録できた」を明示する
  const saveToast = document.getElementById('save-toast');
  let saveToastTimer = null;
  ctx.notifySaved = async () => {
    saveToast.classList.add('show');
    clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(() => saveToast.classList.remove('show'), 1500);
    const s = await stores.settings.get();
    const lines = s.characterLines.saved ?? [];
    if (lines.length > 0) habitsUI.sayLine(lines[Math.floor(Math.random() * lines.length)]);
  };
  ctx.refreshHabits = habitsUI.refresh;
  const todayUI = initToday(ctx);
  ctx.refreshToday = todayUI.refresh;
  const calendarUI = initCalendar(ctx);
  const settingsUI = initSettings(ctx);

  applyTheme(await stores.settings.get(), BUILD.variant);
  initAds();

  // --- タブ切替(hidden属性で統一: KTD1)。ふりかえりは進入ガード(R10) ---
  const panels = {
    today: document.getElementById('panel-today'),
    habits: document.getElementById('panel-habits'),
    calendar: document.getElementById('panel-calendar'),
    settings: document.getElementById('panel-settings'),
  };
  const navButtons = [...document.querySelectorAll('.nav-item')];
  const charLayer = document.getElementById('character-layer');
  let currentTab = 'today';

  async function selectTab(name) {
    if (name === 'calendar') {
      // 初回のふりかえり進入時に一度だけロック設定を確認する(2026-08-09 PD FB)
      const s = await stores.settings.get();
      if (!s.lock.enabled && !s.lock.prompted) {
        await stores.settings.merge({ lock: { ...s.lock, prompted: true } });
        const wants = await confirmPopup(
          'ふりかえり(過去の記録)を開くときにロックをかけますか?あとから設定タブでいつでも変更できます。',
          { okLabel: 'ロックを設定する', cancelLabel: '今はしない' },
        );
        if (wants) {
          await selectTab('settings');
          settingsUI.openLockSetup();
          return;
        }
      }
      if (!(await lock.requestUnlock())) {
        return selectTab('today');
      }
    }
    currentTab = name;
    for (const btn of navButtons) btn.classList.toggle('active', btn.dataset.tab === name);
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
    charLayer.hidden = !(name === 'today' || name === 'habits');
    window.scrollTo(0, 0);
    if (name === 'today') await todayUI.refresh();
    else if (name === 'habits') await habitsUI.refresh();
    else if (name === 'calendar') await calendarUI.refresh();
    else await settingsUI.refresh();
  }

  for (const btn of navButtons) {
    btn.onclick = () => selectTab(btn.dataset.tab);
  }

  ctx.refreshAll = async () => {
    await selectTab(currentTab);
    await habitsUI.renderCharacter();
  };

  // --- 再ロックと日跨ぎ(KTD7・R10) ---
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lock.relock();
    } else {
      const nowDay = todayKey();
      if (nowDay !== lastDay) {
        lastDay = nowDay;
        if (currentTab === 'today' || currentTab === 'habits') selectTab(currentTab);
      }
      if (currentTab === 'calendar') selectTab('calendar'); // 再ロック後は解除を要求
    }
  });
  window.addEventListener('pagehide', () => lock.relock());

  await selectTab('today');

  // スモークテスト用フック
  window.appState = {
    BUILD,
    stores,
    pipeline,
    ctx,
    selectTab,
    get currentTab() {
      return currentTab;
    },
  };
}

main().catch((e) => showGlobalError(e?.message ?? String(e)));
