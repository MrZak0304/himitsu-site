// 初回起動の3画面案内(v1.1 U5)。保存された設定が無い初回だけ出す(settings.onboarding.done)。
// 1「タグを押すだけ」 2「月カレンダーで振り返る」 3「ふりかえりはロックで守れる」→ 最後に定番タグを
// 1つ押すと当日の記録ができて「きょう」へ。スキップは常時可。図はすべてインラインSVG(不変条件7)。

const SLIDES = [
  {
    title: 'タグをポンと押すだけ',
    body: '1日のおわりに「どんな日だった?」をタグでスタンプ。書かなくても日記が続きます。',
    svg: `<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="20" y="30" width="70" height="30" rx="15" fill="var(--accent)"/><text x="55" y="50" text-anchor="middle" font-size="13" fill="var(--accent-contrast)" font-weight="700">#まったり</text><rect x="100" y="30" width="80" height="30" rx="15" fill="var(--panel)" stroke="var(--accent)" stroke-width="2"/><text x="140" y="50" text-anchor="middle" font-size="13" fill="var(--accent)" font-weight="700">#がんばった</text><rect x="40" y="70" width="90" height="30" rx="15" fill="var(--panel)" stroke="var(--accent)" stroke-width="2"/><text x="85" y="90" text-anchor="middle" font-size="13" fill="var(--accent)" font-weight="700">#おでかけ</text><g stroke="#ffd166" stroke-width="4" stroke-linecap="round"><path d="M92 22l8-10"/><path d="M100 36l12-4"/></g></svg>`,
  },
  {
    title: '月カレンダーでひと目で振り返り',
    body: '一押し写真とタグがカレンダーに並びます。タグのランキングや日課の達成も見られます。',
    svg: `<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="30" y="10" width="140" height="100" rx="10" fill="var(--panel)" stroke="var(--panel-edge)" stroke-width="2"/>${[0,1,2,3,4,5,6].map((c)=>[0,1,2].map((r)=>`<rect x="${38+c*19}" y="${26+r*26}" width="16" height="22" rx="3" fill="${(c+r)%3===0?'var(--accent)':'var(--bg)'}" opacity="${(c+r)%3===0?'0.85':'1'}"/>`).join('')).join('')}</svg>`,
  },
  {
    title: 'ふりかえりはロックで守れます',
    body: '過去の記録はパスコードや指紋・顔認証で保護できます。日記はすべてこの端末の中だけに保存されます。',
    svg: `<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="70" y="50" width="60" height="50" rx="10" fill="var(--accent)"/><path d="M82 50v-12a18 18 0 0 1 36 0v12" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/><circle cx="100" cy="75" r="7" fill="var(--accent-contrast)"/></svg>`,
  },
];

export async function initOnboarding(ctx, { onDone } = {}) {
  const s = await ctx.stores.settings.get();
  if (s.onboarding.done) return false;
  const root = document.getElementById('onboarding');
  const fig = document.getElementById('onboarding-figure');
  const title = document.getElementById('onboarding-title');
  const body = document.getElementById('onboarding-body');
  const dots = document.getElementById('onboarding-dots');
  const tagsEl = document.getElementById('onboarding-tags');
  const tagsHint = document.getElementById('onboarding-tags-hint');
  const next = document.getElementById('onboarding-next');
  const skip = document.getElementById('onboarding-skip');
  let idx = 0;

  async function finish() {
    await ctx.stores.settings.merge({ onboarding: { done: true } });
    root.hidden = true;
    await onDone?.();
  }

  async function render() {
    const slide = SLIDES[idx];
    fig.innerHTML = slide.svg;
    title.textContent = slide.title;
    body.textContent = slide.body;
    dots.replaceChildren(
      ...SLIDES.map((_, i) => {
        const d = document.createElement('span');
        d.className = `dot${i === idx ? ' on' : ''}`;
        return d;
      }),
    );
    const last = idx === SLIDES.length - 1;
    tagsEl.hidden = !last;
    tagsHint.hidden = !last;
    next.textContent = last ? 'あとで押す' : 'つぎへ';
    if (last) {
      // 定番タグから3つ。押すと当日の記録になって「きょう」へ(初日の記録を作る)
      const tags = (await ctx.stores.tags.list({ includeHidden: false })).slice(0, 3);
      tagsEl.replaceChildren(
        ...tags.map((tag) => {
          const b = document.createElement('button');
          b.className = 'tag-stamp';
          b.textContent = tag.name;
          b.onclick = async () => {
            const today = ctx.todayKey();
            const cur = (await ctx.stores.entries.get(today))?.tags ?? [];
            if (!cur.includes(tag.id)) await ctx.stores.entries.upsert(today, { tags: [...cur, tag.id] });
            await finish();
            ctx.notifySaved?.();
          };
          return b;
        }),
      );
    }
  }

  next.onclick = async () => {
    if (idx < SLIDES.length - 1) {
      idx += 1;
      await render();
    } else {
      await finish();
    }
  };
  skip.onclick = finish;
  await render();
  root.hidden = false;
  return true;
}
