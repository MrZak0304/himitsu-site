// ロック画面(R10, R11)。生体認証は biometricAuth() のスタブ境界のみ用意し、
// Webでは常に「未対応」→パスコードへフォールバック。Capacitor段階でプラグイン実装に差し替える。
// 解除状態は visibilitychange/pagehide で即時に破棄する(再ロック)。

import { verifyValue, verifyAnswer, hashValue, makeSalt } from '../core/lock.js';

export const MESSAGES = {
  wrongPasscode: 'パスコードが違います。',
  wrongAnswer: '合言葉の答えが違います。',
  badNewPasscode: '新しいパスコードは4文字以上で、2回同じものを入力してください。',
};

// 差し替えポイント(フェーズ3): Capacitor の生体認証プラグインを呼ぶ
async function biometricAuth() {
  return { supported: false };
}

export function createLockGuard(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    screen: $('lock-screen'),
    enter: $('lock-enter'),
    input: $('lock-input'),
    error: $('lock-error'),
    unlockBtn: $('lock-unlock-btn'),
    forgotBtn: $('lock-forgot-btn'),
    recover: $('lock-recover'),
    question: $('lock-recover-question'),
    answer: $('lock-recover-answer'),
    pass1: $('lock-recover-pass1'),
    pass2: $('lock-recover-pass2'),
    recoverError: $('lock-recover-error'),
    recoverBtn: $('lock-recover-btn'),
    recoverBack: $('lock-recover-back'),
    cancelBtn: $('lock-cancel-btn'),
  };
  let unlocked = false;
  let resolveCurrent = null;

  function note(el, message) {
    el.hidden = !message;
    el.textContent = message ?? '';
  }

  // 連打防止の待ち時間(閲覧ガードとしての抑止。詳細は SPEC §2.4)
  function throttle(btn) {
    btn.disabled = true;
    setTimeout(() => {
      btn.disabled = false;
    }, 1500);
  }

  function close(result) {
    els.screen.hidden = true;
    const r = resolveCurrent;
    resolveCurrent = null;
    r?.(result);
  }

  async function requestUnlock() {
    const settings = await ctx.stores.settings.get();
    if (!settings.lock.enabled || !settings.lock.passcodeHash) return true;
    if (unlocked) return true;
    const bio = await biometricAuth();
    if (bio.supported && bio.ok) {
      unlocked = true;
      return true;
    }
    els.input.value = '';
    note(els.error, null);
    note(els.recoverError, null);
    els.enter.hidden = false;
    els.recover.hidden = true;
    els.screen.hidden = false;
    els.input.focus();
    return new Promise((resolve) => {
      resolveCurrent = resolve;
    });
  }

  els.unlockBtn.onclick = async () => {
    const settings = await ctx.stores.settings.get();
    if (await verifyValue(els.input.value, settings.lock.salt, settings.lock.passcodeHash)) {
      unlocked = true;
      close(true);
    } else {
      note(els.error, MESSAGES.wrongPasscode);
      throttle(els.unlockBtn);
    }
  };
  els.input.onkeydown = (e) => {
    if (e.key === 'Enter' && !els.unlockBtn.disabled) els.unlockBtn.click();
  };

  els.forgotBtn.onclick = async () => {
    const settings = await ctx.stores.settings.get();
    els.question.textContent = settings.lock.secretQuestion || '秘密の合言葉';
    els.answer.value = '';
    els.pass1.value = '';
    els.pass2.value = '';
    els.enter.hidden = true;
    els.recover.hidden = false;
  };

  els.recoverBack.onclick = () => {
    els.enter.hidden = false;
    els.recover.hidden = true;
  };

  // 合言葉に正答したらパスコードを再設定して解除
  els.recoverBtn.onclick = async () => {
    const settings = await ctx.stores.settings.get();
    const ok = await verifyAnswer(els.answer.value, settings.lock.answerSalt, settings.lock.secretAnswerHash);
    if (!ok) {
      note(els.recoverError, MESSAGES.wrongAnswer);
      throttle(els.recoverBtn);
      return;
    }
    if (els.pass1.value.length < 4 || els.pass1.value !== els.pass2.value) {
      note(els.recoverError, MESSAGES.badNewPasscode);
      return;
    }
    const salt = makeSalt();
    await ctx.stores.settings.merge({
      lock: { ...settings.lock, salt, passcodeHash: await hashValue(els.pass1.value, salt) },
    });
    unlocked = true;
    close(true);
  };

  els.cancelBtn.onclick = () => close(false);

  return {
    requestUnlock,
    isUnlocked: () => unlocked,
    relock() {
      unlocked = false;
      // ロック画面を開いたまま離れた場合も含め、掲示中の解除待ちは失敗として閉じる
      if (resolveCurrent) close(false);
    },
  };
}
