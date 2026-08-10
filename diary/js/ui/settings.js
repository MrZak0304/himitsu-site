// 設定タブ(R19)。タグ管理・リマインダー・ロック設定・キャラ選択・テーマ・バックアップ・有料版案内。

import { hashValue, hashAnswer, makeSalt } from '../core/lock.js';
import { availableThemes, canUseCustomTheme, CUSTOM_THEME_ID } from '../core/themes.js';
import { applyTheme } from './theme.js';
import { CHARACTERS, EXPRESSION_LABELS } from '../characters.js';
import { UI_ICONS } from '../icons.js';
import { buildLabel } from '../ads.js';
import { deliverBackup } from '../backup-io.js';
import { syncReminder } from '../notifications.js';
import { todayKey } from '../core/dates.js';

export function initSettings(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    tagList: $('tag-manage-list'),
    tagNote: $('tag-manage-note'),
    reminderEnabled: $('reminder-enabled'),
    reminderTime: $('reminder-time'),
    reminderNote: $('reminder-note'),
    lockEnabled: $('lock-enabled'),
    lockSetupBtn: $('lock-setup-btn'),
    lockSetup: $('lock-setup'),
    lockPass1: $('lock-pass1'),
    lockPass2: $('lock-pass2'),
    lockQuestion: $('lock-question'),
    lockAnswer: $('lock-answer'),
    lockSetupNote: $('lock-setup-note'),
    lockSaveBtn: $('lock-save-btn'),
    charGrid: $('character-grid'),
    charAddBtn: $('character-add-btn'),
    charImageInput: $('character-image-input'),
    exprImageInput: $('expression-image-input'),
    charNote: $('character-note'),
    themeGrid: $('theme-grid'),
    customEditor: $('custom-theme-editor'),
    customBg: $('custom-bg'),
    customAccent: $('custom-accent'),
    customSave: $('custom-theme-save'),
    themeNote: $('theme-note'),
    exportBtn: $('backup-export-btn'),
    importBtn: $('backup-import-btn'),
    importInput: $('backup-import-input'),
    backupNote: $('backup-note'),
    purchaseGroup: $('purchase-group'),
    aboutBuild: $('about-build'),
  };
  let charUrls = [];

  function note(el, message, ok = false) {
    el.hidden = !message;
    el.textContent = message ?? '';
    el.style.color = ok ? 'var(--ok)' : '';
  }

  // --- タグ管理 ---
  async function usedTagIds() {
    const entries = await ctx.stores.entries.all();
    const used = new Set();
    for (const entry of Object.values(entries)) for (const id of entry.tags) used.add(id);
    return used;
  }

  async function refreshTags() {
    const tags = await ctx.stores.tags.list();
    els.tagList.replaceChildren(
      ...tags.map((tag, i) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = tag.name;
        li.append(name);
        if (tag.builtin) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = '定番';
          li.append(badge);
        }
        const rename = document.createElement('button');
        rename.className = 'mini-btn';
        rename.textContent = '改名';
        rename.onclick = () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = tag.name;
          input.maxLength = 30;
          const save = async () => {
            let v = input.value.trim();
            if (v) {
              if (!v.startsWith('#')) v = `#${v}`;
              try {
                await ctx.stores.tags.rename(tag.id, v);
                note(els.tagNote, null);
              } catch (err) {
                note(els.tagNote, err.message);
              }
            }
            refreshTags();
            ctx.refreshToday?.();
          };
          input.onkeydown = (e) => {
            if (e.key === 'Enter') input.blur();
          };
          input.onblur = save;
          name.replaceWith(input);
          input.focus();
        };
        // 並べ替えは上下ボタン(ドラッグ化はPD確認後の磨き込み候補)
        const up = document.createElement('button');
        up.className = 'mini-btn';
        up.innerHTML = UI_ICONS.up;
        up.disabled = i === 0;
        up.onclick = async () => {
          const ids = tags.map((t) => t.id);
          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
          await ctx.stores.tags.reorder(ids);
          refreshTags();
          ctx.refreshToday?.();
        };
        const down = document.createElement('button');
        down.className = 'mini-btn';
        down.innerHTML = UI_ICONS.down;
        down.disabled = i === tags.length - 1;
        down.onclick = async () => {
          const ids = tags.map((t) => t.id);
          [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
          await ctx.stores.tags.reorder(ids);
          refreshTags();
          ctx.refreshToday?.();
        };
        const del = document.createElement('button');
        del.className = 'mini-btn danger';
        del.textContent = '削除';
        del.onclick = async () => {
          try {
            // 過去の記録で使用中のタグは削除不可(未使用のみ削除可。扱いはPD確認で再検討)
            await ctx.stores.tags.remove(tag.id, await usedTagIds());
            note(els.tagNote, null);
            refreshTags();
            ctx.refreshToday?.();
          } catch (err) {
            note(els.tagNote, err.message);
          }
        };
        li.append(rename, up, down, del);
        return li;
      }),
    );
  }

  // --- リマインダー(保存+ネイティブでは実通知のスケジュール同期) ---
  async function saveReminder() {
    const next = await ctx.stores.settings.merge({
      reminder: { enabled: els.reminderEnabled.checked, time: els.reminderTime.value || '21:00' },
    });
    const r = await syncReminder(next.reminder);
    note(els.reminderNote, r.ok ? null : r.reason);
  }
  els.reminderEnabled.onchange = saveReminder;
  els.reminderTime.onchange = saveReminder;
  // ネイティブでは通知が実際に届くため、Web向けの注記は隠す
  if (window.Capacitor?.isNativePlatform?.()) {
    document.getElementById('reminder-web-note')?.setAttribute('hidden', '');
  }

  // --- ロック設定 ---
  async function refreshLock() {
    const s = await ctx.stores.settings.get();
    els.lockEnabled.checked = s.lock.enabled;
    els.lockSetupBtn.hidden = !s.lock.enabled || !s.lock.passcodeHash;
    els.lockSetupBtn.textContent = 'パスコードと合言葉を変更';
    if (!s.lock.enabled) els.lockSetup.hidden = true;
  }

  els.lockEnabled.onchange = async () => {
    const s = await ctx.stores.settings.get();
    if (els.lockEnabled.checked) {
      if (!s.lock.passcodeHash) {
        // 初回はパスコード設定が必要(保存時に有効化)。refreshLock で閉じないよう早期return
        els.lockEnabled.checked = false;
        els.lockSetup.hidden = false;
        return;
      }
      await ctx.stores.settings.merge({ lock: { ...s.lock, enabled: true } });
    } else {
      const okGo = await ctx.lock.requestUnlock();
      if (!okGo) {
        els.lockEnabled.checked = true;
        return;
      }
      await ctx.stores.settings.merge({ lock: { ...s.lock, enabled: false } });
    }
    refreshLock();
  };

  // パスコード変更(2026-08-09 PD FB): 現在のパスコードで解除してから新しい値を設定する
  els.lockSetupBtn.onclick = async () => {
    if (!(await ctx.lock.requestUnlock())) return;
    els.lockSetup.hidden = false;
  };

  els.lockSaveBtn.onclick = async () => {
    const p1 = els.lockPass1.value;
    const p2 = els.lockPass2.value;
    const q = els.lockQuestion.value.trim();
    const a = els.lockAnswer.value.trim();
    if (p1.length < 4 || p1 !== p2) {
      note(els.lockSetupNote, 'パスコードは4文字以上で、2回同じものを入力してください。');
      return;
    }
    if (!q || !a) {
      note(els.lockSetupNote, '秘密の合言葉の質問と答えを入力してください(パスコードを忘れたときの再設定に使います)。');
      return;
    }
    const salt = makeSalt();
    const answerSalt = makeSalt();
    await ctx.stores.settings.merge({
      lock: {
        enabled: true,
        prompted: true,
        passcodeHash: await hashValue(p1, salt),
        salt,
        secretQuestion: q,
        secretAnswerHash: await hashAnswer(a, answerSalt),
        answerSalt,
      },
    });
    els.lockPass1.value = '';
    els.lockPass2.value = '';
    els.lockAnswer.value = '';
    els.lockSetup.hidden = true;
    note(els.lockSetupNote, null);
    refreshLock();
  };

  // --- キャラクター(初期5種+ユーザー保存キャラの一覧) ---
  async function refreshCharacters() {
    const s = await ctx.stores.settings.get();
    for (const u of charUrls) URL.revokeObjectURL(u);
    charUrls = [];
    const items = [];

    for (const [id, c] of Object.entries(CHARACTERS)) {
      const b = document.createElement('button');
      const on = s.character.type === 'builtin' && s.character.value === id;
      b.className = `choice-item${on ? ' on' : ''}`;
      b.innerHTML = `<span class="char-thumb">${c.svg()}</span><span>${c.name}</span>`;
      b.onclick = async () => {
        await ctx.stores.settings.merge({ character: { ...s.character, type: 'builtin', value: id } });
        refreshCharacters();
        ctx.renderCharacter?.();
      };
      items.push(b);
    }

    for (const char of s.customCharacters) {
      const rec = await ctx.pipeline.store.get(char.id);
      const item = document.createElement('div');
      item.className = 'char-item';
      const b = document.createElement('button');
      const on = s.character.type === 'custom' && s.character.value === char.id;
      b.className = `choice-item${on ? ' on' : ''}`;
      const thumb = document.createElement('span');
      thumb.className = 'char-thumb';
      if (rec?.thumbBlob) {
        const url = URL.createObjectURL(rec.thumbBlob);
        charUrls.push(url);
        thumb.innerHTML = `<img src="${url}" alt="">`;
      }
      const label = document.createElement('span');
      label.textContent = 'マイキャラ';
      b.append(thumb, label);
      b.onclick = async () => {
        await ctx.stores.settings.merge({ character: { ...s.character, type: 'custom', value: char.id } });
        refreshCharacters();
        ctx.renderCharacter?.();
      };

      // 表情差分スロット(喜怒哀楽。登録は任意。ふだんはニュートラル=基準画像)
      const exprRow = document.createElement('div');
      exprRow.className = 'expr-row';
      for (const [key, exprLabel] of Object.entries(EXPRESSION_LABELS)) {
        const slot = document.createElement('button');
        slot.className = `expr-slot${char.expressions[key] ? ' set' : ''}`;
        slot.dataset.expr = key;
        slot.dataset.charId = char.id;
        slot.title = `表情「${exprLabel}」の画像を登録`;
        if (char.expressions[key]) {
          const exprRec = await ctx.pipeline.store.get(char.expressions[key]);
          if (exprRec?.thumbBlob) {
            const url = URL.createObjectURL(exprRec.thumbBlob);
            charUrls.push(url);
            slot.innerHTML = `<img src="${url}" alt="${exprLabel}">`;
          } else {
            slot.textContent = exprLabel;
          }
        } else {
          slot.textContent = exprLabel;
        }
        slot.onclick = () => {
          pendingExpr = { charId: char.id, key };
          els.exprImageInput.click();
        };
        exprRow.append(slot);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn danger';
      delBtn.textContent = '削除';
      delBtn.onclick = async () => {
        if (!(await ctx.confirm('このキャラクターを削除しますか?(表情差分も削除されます)'))) return;
        const cur = await ctx.stores.settings.get();
        const target = cur.customCharacters.find((c) => c.id === char.id);
        const rest = cur.customCharacters.filter((c) => c.id !== char.id);
        const character =
          cur.character.type === 'custom' && cur.character.value === char.id
            ? { ...cur.character, type: 'builtin', value: 'cat' }
            : cur.character;
        await ctx.stores.settings.merge({ customCharacters: rest, character });
        for (const imgId of [char.id, ...Object.values(target?.expressions ?? {})]) {
          await ctx.pipeline.store.remove(imgId).catch(() => {});
        }
        refreshCharacters();
        ctx.renderCharacter?.();
      };

      item.append(b, exprRow, delBtn);
      items.push(item);
    }
    els.charGrid.replaceChildren(...items);

    for (const radio of document.querySelectorAll('input[name="char-pos"]')) {
      radio.checked = radio.value === s.character.position;
      radio.onchange = async () => {
        const cur = await ctx.stores.settings.get();
        await ctx.stores.settings.merge({ character: { ...cur.character, position: radio.value } });
        ctx.renderCharacter?.();
      };
    }
  }

  let pendingExpr = null;
  els.exprImageInput.onchange = async () => {
    const file = els.exprImageInput.files[0];
    els.exprImageInput.value = '';
    if (!file || !pendingExpr) return;
    const { charId, key } = pendingExpr;
    pendingExpr = null;
    ctx.showLoading('画像を保存中…');
    try {
      const { id } = await ctx.pipeline.saveImage(file, 'character');
      const cur = await ctx.stores.settings.get();
      const old = cur.customCharacters.find((c) => c.id === charId)?.expressions?.[key];
      const list = cur.customCharacters.map((c) =>
        c.id === charId ? { ...c, expressions: { ...c.expressions, [key]: id } } : c,
      );
      await ctx.stores.settings.merge({ customCharacters: list });
      if (old) await ctx.pipeline.store.remove(old).catch(() => {});
      note(els.charNote, null);
      refreshCharacters();
    } catch (err) {
      note(els.charNote, err.message);
    } finally {
      ctx.hideLoading();
    }
  };

  // セリフの編集(1行1セリフ。空にすると normalize が既定セリフへ戻す)
  const LINE_FIELDS = { joy: 'line-joy', anger: 'line-anger', sorrow: 'line-sorrow', fun: 'line-fun', allDone: 'line-alldone', saved: 'line-saved' };
  async function refreshLines() {
    const s = await ctx.stores.settings.get();
    for (const [key, id] of Object.entries(LINE_FIELDS)) {
      const el = $(id);
      if (document.activeElement !== el) el.value = s.characterLines[key].join('\n');
    }
  }
  for (const id of Object.values(LINE_FIELDS)) {
    $(id).onchange = async () => {
      const characterLines = {};
      for (const [key, fieldId] of Object.entries(LINE_FIELDS)) {
        characterLines[key] = $(fieldId).value.split('\n').map((t) => t.trim()).filter(Boolean);
      }
      await ctx.stores.settings.merge({ characterLines });
      refreshLines();
    };
  }

  els.charAddBtn.onclick = () => els.charImageInput.click();
  els.charImageInput.onchange = async () => {
    const file = els.charImageInput.files[0];
    els.charImageInput.value = '';
    if (!file) return;
    ctx.showLoading('画像を保存中…');
    try {
      const { id } = await ctx.pipeline.saveImage(file, 'character');
      const s = await ctx.stores.settings.get();
      await ctx.stores.settings.merge({
        customCharacters: [...s.customCharacters, { id, expressions: {} }],
        character: { ...s.character, type: 'custom', value: id },
      });
      note(els.charNote, null);
      refreshCharacters();
      ctx.renderCharacter?.();
    } catch (err) {
      note(els.charNote, err.message);
    } finally {
      ctx.hideLoading();
    }
  };

  // --- テーマ ---
  async function refreshThemes() {
    const s = await ctx.stores.settings.get();
    const items = availableThemes(ctx.variant).map((t) => {
      const b = document.createElement('button');
      b.className = `choice-item${s.theme === t.id ? ' on' : ''}`;
      b.dataset.themeChoice = t.id;
      const sw = document.createElement('span');
      sw.className = 'theme-swatch';
      sw.dataset.theme = t.id; // [data-theme] の変数セットをスウォッチにも適用
      sw.innerHTML = '<span class="sw-bg" style="background:var(--bg)"></span><span class="sw-accent" style="background:var(--accent)"></span>';
      const label = document.createElement('span');
      label.textContent = t.name;
      b.append(sw, label);
      b.onclick = async () => {
        const next = await ctx.stores.settings.merge({ theme: t.id });
        applyTheme(next, ctx.variant);
        refreshThemes();
      };
      return b;
    });
    els.themeGrid.replaceChildren(...items);
    els.customEditor.hidden = !canUseCustomTheme(ctx.variant);
    if (ctx.variant === 'free') {
      note(els.themeNote, '有料版ではさらに15種のテーマとカスタムテーマが使えます。', true);
    }
    if (s.customTheme) {
      els.customBg.value = s.customTheme.bg;
      els.customAccent.value = s.customTheme.accent;
    }
  }

  els.customSave.onclick = async () => {
    try {
      const next = await ctx.stores.settings.merge({
        theme: CUSTOM_THEME_ID,
        customTheme: { bg: els.customBg.value, accent: els.customAccent.value },
      });
      applyTheme(next, ctx.variant);
      note(els.themeNote, 'カスタムテーマを適用しました。', true);
      refreshThemes();
    } catch (err) {
      note(els.themeNote, err.message);
    }
  };

  // --- バックアップ(書き出し・取り込みともロック解除の内側: R13) ---
  els.exportBtn.onclick = async () => {
    if (!(await ctx.lock.requestUnlock())) return;
    ctx.showLoading('バックアップを作成中…');
    try {
      const [entries, tags, habits, habitLogs, settings, imageRecords] = await Promise.all([
        ctx.stores.entries.all(),
        ctx.stores.tags.list(),
        ctx.stores.habits.list(),
        ctx.stores.habitLogs.all(),
        ctx.stores.settings.get(),
        ctx.pipeline.store.list(),
      ]);
      const json = await ctx.backupIO.exportBackup({ entries, tags, habits, habitLogs, settings }, imageRecords);
      await deliverBackup(json, `diary-${todayKey().replaceAll('-', '')}.diarybak`);
      note(els.backupNote, '書き出しました。ファイルは大切に保管してください。', true);
    } catch (err) {
      note(els.backupNote, err.message);
    } finally {
      ctx.hideLoading();
    }
  };

  els.importBtn.onclick = async () => {
    if (!(await ctx.lock.requestUnlock())) return;
    els.importInput.click();
  };

  els.importInput.onchange = async () => {
    const file = els.importInput.files[0];
    els.importInput.value = '';
    if (!file) return;
    if (!(await ctx.confirm('取り込むと、今の記録・タグ・日課・設定はすべて置き換えられます。よろしいですか?'))) return;
    ctx.showLoading('バックアップを取り込み中…');
    try {
      const text = await file.text();
      // 検証(スキーマ含む)はWorker内の parseBackup で行い、失敗時は既存データに触れない
      const { parsed, imageRecords } = await ctx.backupIO.importBackup(text);
      await ctx.pipeline.store.clear();
      for (const rec of imageRecords) await ctx.pipeline.store.put(rec);
      await ctx.stores.entries.replaceAll(parsed.entries);
      await ctx.stores.tags.replaceAll(parsed.tags);
      await ctx.stores.habits.replaceAll(parsed.habits);
      await ctx.stores.habitLogs.replaceAll(parsed.habitLogs);
      await ctx.stores.settings.replaceAll(parsed.settings);
      const s = await ctx.stores.settings.get();
      applyTheme(s, ctx.variant);
      note(els.backupNote, '取り込みが完了しました。', true);
      ctx.refreshAll?.();
    } catch (err) {
      note(els.backupNote, err.message);
    } finally {
      ctx.hideLoading();
    }
  };

  // --- 有料版案内・このアプリについて ---
  els.purchaseGroup.hidden = ctx.variant !== 'free';
  els.aboutBuild.textContent = `ビルド: ${buildLabel()}`;

  async function refresh() {
    const s = await ctx.stores.settings.get();
    els.reminderEnabled.checked = s.reminder.enabled;
    els.reminderTime.value = s.reminder.time;
    await Promise.all([refreshTags(), refreshLock(), refreshCharacters(), refreshThemes(), refreshLines()]);
  }

  // 初回ふりかえり時の「ロックを設定する」誘導から呼ばれる
  function openLockSetup() {
    document.getElementById('lock-group').open = true;
    els.lockSetup.hidden = false;
    els.lockSetup.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return { refresh, openLockSetup };
}
