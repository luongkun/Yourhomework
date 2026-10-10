/* YHW Auto Solver - content.js
 * Ho tro: Q1-Q7 (trac nghiem), F1-F7 (dien tu), M1-M2 (ghep cap)
 * tren yourhomework.net/vocab/<id>/<activity>
 * Cach giai: lay ground-truth tu API /api/v1/vocab/<publicId>/activity-data,
 * nhan dien dang prompt/option tren DOM, click/dien/keo-tha dung dap an.
 * - Trac nghiem nghe (Q5-Q7): map audio qua API tts/ensure + sessionStorage.
 * - Ghep cap (M1/M2): mo phong keo-tha HTML5 + kiem tra pill sau moi lan tha.
 */
(() => {
  'use strict';
  if (window.__yhwSolverInjected) return;
  window.__yhwSolverInjected = true;

  const DEFAULTS = { auto: true, highlight: true, autoNext: true, turbo: false, delayMin: 500, delayMax: 1400, showTable: true };
  let settings = { ...DEFAULTS };
  // che do sieu toc: delay cuc thap o moi buoc
  const TURBO_DELAY = [60, 180];
  const effDelay = () => (settings.turbo ? TURBO_DELAY : [settings.delayMin, settings.delayMax]);
  const effGap = (manualVal) => (settings.turbo ? 200 : manualVal);
  try {
    chrome.storage.local.get(DEFAULTS, (v) => { settings = { ...DEFAULTS, ...v }; applyPanelState(); });
    chrome.storage.onChanged.addListener((chg, area) => {
      if (area !== 'local') return;
      for (const k of Object.keys(DEFAULTS)) if (chg[k]) settings[k] = chg[k].newValue;
      applyPanelState();
    });
  } catch (e) { /* non-chrome env */ }

  let DATA = null;          // activity-data
  let publicId = null;
  let byWord = new Map();   // norm(word) -> item
  let byMeaning = new Map();// norm(meaning) -> item
  let byImage = new Map();  // basename -> item
  let audioMap = new Map(); // audioBasename -> word (tu sessionStorage + ensure API)
  let solving = false;
  let lastPromptKey = '';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const base = (url) => { try { const u = (url || '').split('?')[0]; return u.slice(u.lastIndexOf('/') + 1); } catch { return url || ''; } };
  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('%c[YHW Solver]', 'color:#fff;background:#e91e63;padding:1px 6px;border-radius:4px', ...a);

  function getPublicId() {
    const m = location.pathname.match(/\/vocab\/(\d+)/);
    return m ? m[1] : null;
  }

  async function loadData() {
    publicId = getPublicId();
    if (!publicId) return false;
    if (DATA && DATA.publicId === publicId) return true;
    try {
      const r = await fetch(`/api/v1/vocab/${publicId}/activity-data`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      DATA = await r.json();
      DATA.publicId = publicId;
      byWord = new Map(); byMeaning = new Map(); byImage = new Map();
      for (const it of (DATA.items || [])) {
        byWord.set(norm(it.word), it);
        byMeaning.set(norm(it.meaning), it);
        if (it.imageUrl) byImage.set(base(it.imageUrl), it);
      }
      log('Da tai', DATA.items.length, 'tu:', DATA.vocabTitle);
      seedAudioMapFromSession();
      audioPreloaded = false;
      preloadAudioMap(); // chay nen, khong block
      renderTable();
      setStatus(`Đã tải ${DATA.items.length} từ: ${DATA.vocabTitle || ''}`);
      return true;
    } catch (e) {
      log('Khong tai duoc activity-data:', e);
      setStatus('Không tải được dữ liệu bài (activity-data). Thử tải lại trang.');
      return false;
    }
  }

  function seedAudioMapFromSession() {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k || !k.startsWith('yhw:tts:ensure')) continue;
        const word = k.slice(k.lastIndexOf('|') + 1);
        const url = sessionStorage.getItem(k) || '';
        if (word && url.includes('/tts/')) audioMap.set(base(url), word);
      }
    } catch (e) { /* ignore */ }
  }

  function currentSpeed() {
    const h = $('.ant-slider-handle');
    if (h && h.getAttribute('aria-valuenow')) {
      const v = parseFloat(h.getAttribute('aria-valuenow'));
      if (v >= 50 && v <= 300) return (v / 100).toFixed(2).replace(/0$/, '');
    }
    return '1';
  }

  async function ensureAudioPath(word) {
    // tra cache truoc
    for (const [file, w] of audioMap) if (norm(w) === norm(word)) return file;
    try {
      const sp = currentSpeed();
      const r = await fetch(`/api/v1/tts/ensure?lang=en&text=${encodeURIComponent(word)}&speed=${sp}`);
      const j = await r.json();
      const f = base(j.path || j.url || '');
      if (f) { audioMap.set(f, word); try { sessionStorage.setItem(`yhw:tts:ensure:v1:en|${sp}|${word}`, j.url || j.path); } catch {} }
      return f;
    } catch { return null; }
  }

  async function identifyAudioWord(audioSrc) {
    if (!audioSrc) return null;
    seedAudioMapFromSession();
    const f = base(audioSrc);
    if (audioMap.has(f)) return audioMap.get(f);
    // cache miss: preload map cho ca bo tu roi so sanh (chi vai tu nen ok)
    await preloadAudioMap();
    if (audioMap.has(f)) return audioMap.get(f);
    for (const it of (DATA.items || [])) {
      const p = await ensureAudioPath(it.word);
      if (p === f) return it.word;
    }
    return null;
  }

  // goi ensure cho toan bo tu song song de nhan dien cau nghe ngay lap tuc
  let audioPreloaded = false;
  async function preloadAudioMap() {
    if (audioPreloaded || !DATA) return;
    audioPreloaded = true;
    try {
      await Promise.all((DATA.items || []).map((it) => ensureAudioPath(it.word).catch(() => null)));
    } catch (e) { /* ignore */ }
  }

  function getPrompt() {
    const box = $('.yhw-quiz-prompt') || $('.yhw-activity-client');
    if (!box) return {};
    const h2 = $('.yhw-quiz-prompt h2', document);
    const promptWord = h2 ? (h2.innerText || '').trim() : '';
    const pImg = $('.yhw-quiz-prompt img', document);
    const promptImg = pImg ? (pImg.currentSrc || pImg.src) : null;
    // audio tts: loai true.mp3/false.mp3
    const audios = $$('audio[src]', document).filter(a => (a.src || '').includes('/tts/'));
    const promptAudio = audios.length ? audios[audios.length - 1].src : null;
    return { promptWord, promptImg, promptAudio };
  }

  function getOptions() {
    return $$('.yhw-quiz-option').map((el) => {
      const t = $('.yhw-quiz-option-text', el);
      const img = $('img', el);
      return { el, text: t ? (t.innerText || '').trim() : '', img: img ? (img.currentSrc || img.src) : null };
    });
  }

  function clearMarks() {
    $$('.yhw-quiz-option').forEach((o) => {
      o.style.outline = ''; o.style.boxShadow = '';
      const b = o.querySelector('.yhw-solver-badge');
      if (b) b.remove();
    });
  }

  function mark(el, label = 'ĐÁP ÁN') {
    if (!settings.highlight) return;
    el.style.outline = '3px solid #22c55e';
    el.style.boxShadow = '0 0 0 4px rgba(34,197,94,.25)';
    if (!el.querySelector('.yhw-solver-badge')) {
      const s = document.createElement('div');
      s.className = 'yhw-solver-badge';
      s.textContent = '✔ ' + label;
      s.style.cssText = 'position:absolute;top:4px;right:4px;background:#22c55e;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;z-index:5;';
      el.style.position = 'relative';
      el.appendChild(s);
    }
  }

  function findNextButton() {
    const btns = $$('button');
    const keys = ['câu tiếp theo', 'cau tiep theo', 'tiếp theo', 'tiếp tục', 'kiểm tra xong', 'tiếp', 'next', 'continue'];
    for (const b of btns) {
      const t = norm(b.innerText || '');
      if (!t) continue;
      if (keys.some((k) => t.includes(k))) {
        if (b.disabled) continue;
        const card = b.closest('.ant-card');
        if (card || t.includes('tiếp') || t === 'next' || t.includes('continue')) return b;
      }
    }
    // fallback: nut primary trong feedback
    return $('.yhw-quiz-feedback button:not([disabled])');
  }

  // doi nut "Cau tiep theo" hien ra roi bam ngay (poll nhanh hon sleep co dinh)
  async function waitNext(tag) {
    const FAST = settings.turbo;
    for (let i = 0; i < (FAST ? 40 : 25); i++) {
      await sleep(FAST ? 120 : 300);
      const nb = findNextButton();
      if (nb && nb.offsetParent !== null) {
        await sleep(FAST ? 80 : rand(350, 900));
        nb.click(); log('Next' + (tag ? ':' + tag : ''));
        return true;
      }
      if (/hoàn thành|kết quả|tổng điểm|xuất sắc/i.test(document.body.innerText)) return true;
    }
    return false;
  }

  // key nhe de poll phat hien cau/round moi (khong can async)
  function currentKey() {
    if ($('.yhw-match-page')) {
      const r = ($('.yhw-match-header') || {}).innerText || '';
      const placed = $$('.yhw-match-top-card').map((t) => {
        const w = (t.querySelector('.yhw-match-top-word-text') || {}).innerText || '';
        const img = t.querySelector('.yhw-match-top-word img, .yhw-match-top-main img');
        const a = (t.querySelector('.yhw-match-top-answer') || {}).innerText || '';
        return (w || (img ? base(img.currentSrc || img.src) : '')) + '>' + a;
      }).join(';');
      return 'match|' + r + '|' + placed;
    }
    if ($('.yhw-fillin-input')) {
      const p = getPrompt();
      return 'fill|' + (p.promptWord || '') + '|' + base(p.promptImg || '') + '|' + base(p.promptAudio || '');
    }
    if ($('.yhw-quiz-option')) {
      const p = getPrompt();
      const os = getOptions().map((o) => o.text + base(o.img || '')).join(';');
      return 'quiz|' + (p.promptWord || '') + '|' + base(p.promptImg || '') + '|' + base(p.promptAudio || '') + '|' + os;
    }
    return '';
  }

  async function solveOnce(manual = false) {
    if (solving) return;
    if (!DATA && !(await loadData())) return;
    if ($('.yhw-match-page')) { await solveMatch(manual); return; }
    const input = $('.yhw-fillin-input');
    if (input) { await solveFillin(input, manual); return; }
    let opts = getOptions();
    if (!opts.length) { if (manual) setStatus('Chưa thấy câu hỏi (chưa load xong?).'); return; }
    solving = true;
    try {
      // cau nghe: audio co the load cham hon cau hoi -> doi toi da ~4s
      let { promptWord, promptImg, promptAudio } = getPrompt();
      if (!manual && !promptWord && !promptImg && !promptAudio) {
        for (let i = 0; i < 8 && !promptAudio && !promptWord && !promptImg; i++) {
          await sleep(500);
          ({ promptWord, promptImg, promptAudio } = getPrompt());
        }
        opts = getOptions();
      }
      const key = currentKey() || (promptWord + '|' + base(promptImg || '') + '|' + base(promptAudio || ''));
      if (!manual && key === lastPromptKey) { solving = false; return; }
      lastPromptKey = key;
      clearMarks();

      let target = null; // {kind:'text'|'img', value}
      const pw = norm(promptWord);
      if (promptWord && opts[0].text && !opts[0].img) {
        if (byWord.has(pw)) target = { kind: 'text', value: byWord.get(pw).meaning };       // Q3 Tu -> Nghia
        else if (byMeaning.has(pw)) target = { kind: 'text', value: byMeaning.get(pw).word }; // Q4 Nghia -> Tu
      } else if (promptWord && opts[0].img) {
        const it = byWord.get(pw);                                                            // Q1 Tu -> Hinh
        if (it) target = { kind: 'img', value: base(it.imageUrl) };
      } else if (promptImg && opts[0].text) {                                                 // Q2 Hinh -> Tu
        const it = byImage.get(base(promptImg));
        if (it) target = { kind: 'text', value: it.word };
      } else if (!promptWord && !promptImg && promptAudio && opts[0].text) {                   // Q5/Q7 Nghe -> Tu/Nghia
        const w = await identifyAudioWord(promptAudio);
        if (w) {
          const sample = norm(opts[0].text);
          if (byWord.has(sample) || byWord.has(norm(opts.length > 1 ? opts[1].text : ''))) {
            target = { kind: 'text', value: w };                                              // Q5
          } else {
            const it = byWord.get(norm(w));                                                   // Q7
            if (it) target = { kind: 'text', value: it.meaning };
          }
        }
      } else if (!promptWord && !promptImg && promptAudio && opts[0].img) {                    // Q6 Nghe -> Hinh
        const w = await identifyAudioWord(promptAudio);
        const it = w && byWord.get(norm(w));
        if (it) target = { kind: 'img', value: base(it.imageUrl) };
      }

      if (!target) {
        // fallback: doan theo tap options (Q4/Q3 lan lon khi site hien thi khac)
        if (manual) setStatus('Không nhận diện được dạng câu. Xem bảng từ bên dưới để tự chọn.');
        log('Khong xac dinh duoc target', { promptWord, promptImg: base(promptImg || ''), promptAudio: base(promptAudio || ''), opts: opts.map((o) => ({ t: o.text, i: base(o.img || '') })) });
        solving = false; return;
      }

      let hit = null;
      if (target.kind === 'text') {
        hit = opts.find((o) => norm(o.text) === norm(target.value));
        if (!hit) hit = opts.find((o) => norm(o.text).includes(norm(target.value)) || norm(target.value).includes(norm(o.text)));
      } else {
        hit = opts.find((o) => base(o.img || '') === target.value);
      }
      if (!hit) { if (manual) setStatus('Không tìm thấy đáp án trong 4 lựa chọn (dữ liệu: ' + target.value + ')'); solving = false; return; }

      mark(hit.el);
      setStatus(`Đáp án: ${target.value} — ${settings.auto || manual ? 'đang chọn…' : 'đã highlight'}`);
      if (settings.auto || manual) {
        await sleep(manual ? 120 : rand(...effDelay()));
        hit.el.click();
        log('Clicked:', target.value);
        if (settings.autoNext) await waitNext('quiz');
      }
    } finally { solving = false; }
  }

  async function solveFillin(input, manual = false) {
    solving = true;
    try {
      const { promptWord, promptImg, promptAudio } = getPrompt();
      let answer = null;
      const pw = norm(promptWord);
      if (promptWord && byMeaning.has(pw)) answer = byMeaning.get(pw).word;          // F2/F5 Nghia -> Tu
      else if (promptWord && byWord.has(pw)) answer = byWord.get(pw).word;            // hiem: hien san tu
      else if (promptImg) { const it = byImage.get(base(promptImg)); if (it) answer = it.word; } // F1/F4 Hinh -> Tu
      else if (promptAudio) answer = await identifyAudioWord(promptAudio);            // F3/F6 Nghe -> Tu
      // F7 doan tu: prompt co the la dinh nghia + so ky tu -> van la meaning
      if (!answer && promptWord) {
        for (const [m, it] of byMeaning) if (pw.includes(m) || m.includes(pw)) { answer = it.word; break; }
      }
      if (!answer) { if (manual) setStatus('Không đoán được từ cần điền. Xem bảng từ bên dưới.'); return; }
      setStatus(`Từ cần điền: ${answer}`);
      // highlight input
      input.style.outline = '3px solid #22c55e';
      if (settings.auto || manual) {
        await sleep(manual ? 120 : rand(...effDelay()));
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(input, answer); else input.value = answer;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        await sleep(settings.turbo ? 80 : 300);
        const check = $$('button').find((b) => norm(b.innerText).includes('kiểm tra') && !b.disabled)
          || $$('button').find((b) => norm(b.innerText).includes('kiem tra') && !b.disabled);
        if (check) { check.click(); log('Kiem tra:', answer); }
        if (settings.autoNext) await waitNext('fill');
      }
    } finally { solving = false; lastPromptKey = 'fill:' + Date.now(); }
  }

  /* ---------- M1/M2: ghep cap (keo-tha / bam-chon) ---------- */
  function matchTopKey(t) {
    const wt = t.querySelector('.yhw-match-top-word-text');
    if (wt && norm(wt.innerText)) return { kind: 'word', value: norm(wt.innerText) };
    const img = t.querySelector('img');
    if (img) return { kind: 'img', value: base(img.currentSrc || img.src) };
    const any = t.querySelector('.yhw-match-top-word');
    if (any && norm(any.innerText)) return { kind: 'word', value: norm(any.innerText) };
    return null;
  }
  function matchBottomKey(b) {
    const img = b.querySelector('img');
    const t = norm(b.innerText);
    if (img && !t) return { kind: 'img', value: base(img.currentSrc || img.src) };
    if (t && byWord.has(t)) return { kind: 'word', value: t };
    if (t && byMeaning.has(t)) return { kind: 'meaning', value: t };
    if (img) return { kind: 'img', value: base(img.currentSrc || img.src) };
    return t ? { kind: 'text', value: t } : null;
  }
  // dap an bottom mong doi cho 1 top card; tra ve {kind, value} de so voi matchBottomKey
  function expectedBottom(top) {
    if (!top) return null;
    if (top.kind === 'word') {
      const it = byWord.get(top.value) || byMeaning.get(top.value);
      if (!it) return null;
      if (top.value === norm(it.word)) return { kind: 'meaning', value: norm(it.meaning) }; // M1: Tu -> Nghia
      return { kind: 'word', value: norm(it.word) };
    }
    if (top.kind === 'img') { // M2: Hinh -> Tu (hoac Hinh -> Hinh)
      const it = byImage.get(top.value);
      if (!it) return null;
      return { kind: 'either-word-img', value: norm(it.word), img: base(it.imageUrl) };
    }
    return null;
  }
  function bottomMatches(bk, exp) {
    if (!bk || !exp) return false;
    if (exp.kind === 'either-word-img') {
      return (bk.kind === 'word' && bk.value === exp.value) || (bk.kind === 'img' && bk.value === exp.img);
    }
    return bk.kind === exp.kind && bk.value === exp.value;
  }

  async function solveMatch(manual = false) {
    if (solving) return;
    solving = true;
    try {
      const key = currentKey();
      if (!manual && key === lastPromptKey) { solving = false; return; }
      lastPromptKey = key;
      if (!$$('.yhw-match-top-card').length || !$$('.yhw-match-bottom-card').length) { if (manual) setStatus('Chưa thấy bàn ghép (chưa load xong?).'); solving = false; return; }
      const GAP = manual ? 250 : effGap(650);
      // keo-tha HTML5 mo phong (dang tin cay nhat: khong phu thuoc state chon-bam,
      // ke ca the dang ket --used van tha duoc). Click chi la du phong.
      function dndPlace(b, slot) {
        try {
          const dt = new DataTransfer();
          b.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          slot.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
          slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          slot.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
          b.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
          return true;
        } catch (e) { return false; }
      }
      // kiem tra pill da dat co dung khong
      function pillOk(t, exp) {
        const p = t && t.querySelector('.yhw-match-top-answer-pill');
        if (!p) return false;
        if (norm(p.innerText) === exp.value) return true;
        const img = p.querySelector('img');
        if (img && exp.img && base(img.currentSrc || img.src) === exp.img) return true;
        return false;
      }
      // ghep tung o + KIEM TRA pill sau moi lan bam (chong lech do React render tre)
      async function placeOne(topEl) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const t = curTop(topEl);
          if (!t) return false;
          const pill = t.querySelector('.yhw-match-top-answer-pill');
          const top = matchTopKey(t);
          const exp = expectedBottom(top);
          if (!exp) return false;
          const curText = pill ? norm(pill.innerText) : '';
          if (pillOk(t, exp)) return true;
          if (pill) { // o dang chua dap an sai -> go ra
            const rm = t.querySelector('.yhw-match-top-answer-remove');
            if (rm) { rm.click(); await sleep(350); continue; }
          }
          if (!(settings.auto || manual)) return false;
          const b = $$('.yhw-match-bottom-card').find((x) => {
            if (!document.contains(x)) return false;
            // the ket --used van tha duoc bang DnD nen khong loai tru
            return bottomMatches(matchBottomKey(x), exp);
          });
          if (!b) { log('Khong tim thay manh ghep cho', top, exp); return false; }
          if (settings.highlight) { b.style.outline = '3px solid #22c55e'; }
          await sleep(manual ? 150 : rand(...(settings.turbo ? [40, 120] : [150, 350])));
          const slot = freshSlot(t);
          if (attempt % 3 < 2) { dndPlace(freshBottom(b), slot); await sleep(GAP); }
          else { b.click(); await sleep(GAP); freshSlot(t).click(); await sleep(GAP); }
          const t2 = curTop(topEl);
          if (pillOk(t2, exp)) return true;
          // chua dung -> go pill sai (neu co) roi thu lai
          const wrong = t2 && t2.querySelector('.yhw-match-top-answer-pill');
          if (wrong) { const rm = t2.querySelector('.yhw-match-top-answer-remove'); if (rm) { rm.click(); await sleep(350); } }
        }
        return false;
      }
      // dinh danh o top on dinh theo noi dung (React co the re-render doi node)
      function topId(t) {
        const k = matchTopKey(t);
        return (k ? k.kind + ':' + k.value : '') ;
      }
      function curTop(ref) {
        const id = topId(ref);
        return $$('.yhw-match-top-card').find((x) => topId(x) === id) || null;
      }
      function freshSlot(t) { const c = curTop(t) || t; return c.querySelector('.yhw-match-top-answer'); }
      function freshBottom(b) {
        const k = matchBottomKey(b);
        return $$('.yhw-match-bottom-card').find((x) => {
          const kk = matchBottomKey(x);
          return kk && kk.kind === k.kind && kk.value === k.value;
        }) || b;
      }
      const allTops = $$('.yhw-match-top-card');
      for (const t of allTops) { await placeOne(t); }
      const total = $$('.yhw-match-top-card').length;
      const filled = $$('.yhw-match-top-answer-pill').length;
      setStatus(`Đã ghép ${filled}/${total} cặp. ${settings.auto || manual ? '' : 'Bật "Tự động làm" để máy tự ghép.'}`);
      if ((settings.auto || manual) && filled > 0 && filled >= total) {
        await sleep(manual ? 150 : rand(...effDelay()));
        const check = $$('button').find((b) => norm(b.innerText) === 'kiểm tra' && !b.disabled)
          || $$('button').find((b) => norm(b.innerText).includes('kiểm tra') && !b.disabled);
        if (check) {
          check.click(); log('Match: Kiem tra');
          lastPromptKey = ''; // round moi se co key moi
          if (settings.autoNext) { await waitNext('match'); lastPromptKey = ''; }
        } else {
          lastPromptKey = ''; // cho phep thu lai khi nut Kiểm tra hien ra
        }
      }
    } finally { solving = false; }
  }

  /* ---------- Floating panel ---------- */
  function panelHTML() {
    return `
    <div id="yhw-sv-head">
      <span>⚡ YHW Auto Solver</span>
      <span><button id="yhw-sv-min" title="Thu gọn">–</button></span>
    </div>
    <div id="yhw-sv-body">
      <div id="yhw-sv-status">Đang khởi động…</div>
      <label><input type="checkbox" id="yhw-sv-auto"> Tự động làm</label>
      <label><input type="checkbox" id="yhw-sv-turbo"> 🚀 Siêu tốc (delay ~0.1s)</label>
      <label><input type="checkbox" id="yhw-sv-hl"> Highlight đáp án</label>
      <label><input type="checkbox" id="yhw-sv-next"> Tự qua câu tiếp theo</label>
      <div id="yhw-sv-row">
        <span>Delay (ms)</span>
        <input id="yhw-sv-dmin" type="number" min="0" max="5000" step="50">
        <span>–</span>
        <input id="yhw-sv-dmax" type="number" min="0" max="5000" step="50">
      </div>
      <div id="yhw-sv-btns">
        <button id="yhw-sv-once">Giải câu này</button>
        <button id="yhw-sv-table">Từ vựng</button>
      </div>
      <div id="yhw-sv-words"></div>
    </div>`;
  }

  function injectPanel() {
    if ($('#yhw-solver-panel')) return;
    const d = document.createElement('div');
    d.id = 'yhw-solver-panel';
    d.innerHTML = panelHTML();
    const css = document.createElement('style');
    css.textContent = `
    #yhw-solver-panel{position:fixed;right:14px;bottom:14px;width:248px;z-index:999999;background:#fff;border:2px solid #e91e63;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:system-ui,sans-serif;font-size:13px;color:#222;overflow:hidden}
    #yhw-sv-head{display:flex;justify-content:space-between;align-items:center;background:#e91e63;color:#fff;font-weight:700;padding:7px 10px;cursor:move}
    #yhw-sv-min{background:rgba(255,255,255,.25);border:0;color:#fff;width:22px;height:22px;border-radius:6px;cursor:pointer}
    #yhw-sv-body{padding:9px 10px;display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow:auto}
    #yhw-solver-panel.min #yhw-sv-body{display:none}
    #yhw-sv-status{background:#fdf2f8;border:1px dashed #e91e63;border-radius:8px;padding:6px 8px;min-height:30px}
    #yhw-sv-body label{display:flex;gap:6px;align-items:center;cursor:pointer}
    #yhw-sv-row{display:flex;gap:5px;align-items:center}
    #yhw-sv-row input{width:62px;padding:3px 5px;border:1px solid #ccc;border-radius:6px}
    #yhw-sv-btns{display:flex;gap:6px}
    #yhw-sv-btns button{flex:1;background:#e91e63;color:#fff;border:0;border-radius:8px;padding:6px 4px;font-weight:700;cursor:pointer}
    #yhw-sv-btns button:last-child{background:#334155}
    #yhw-sv-words table{width:100%;border-collapse:collapse;font-size:12px}
    #yhw-sv-words td,#yhw-sv-words th{border:1px solid #eee;padding:3px 5px;text-align:left}
    #yhw-sv-words img{width:42px;height:42px;object-fit:cover;border-radius:6px}`;
    document.head.appendChild(css);
    document.body.appendChild(d);
    // drag
    const head = $('#yhw-sv-head');
    let sx, sy, ox, oy, drag = false;
    head.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; const r = d.getBoundingClientRect(); ox = r.left; oy = r.top; d.style.right = 'auto'; d.style.bottom = 'auto'; d.style.left = ox + 'px'; d.style.top = oy + 'px'; });
    window.addEventListener('mousemove', (e) => { if (!drag) return; d.style.left = (ox + e.clientX - sx) + 'px'; d.style.top = (oy + e.clientY - sy) + 'px'; });
    window.addEventListener('mouseup', () => (drag = false));

    $('#yhw-sv-min').onclick = () => d.classList.toggle('min');
    $('#yhw-sv-once').onclick = () => solveOnce(true);
    $('#yhw-sv-table').onclick = () => { const w = $('#yhw-sv-words'); w.style.display = w.style.display === 'none' ? 'block' : 'none'; };
    $('#yhw-sv-auto').onchange = (e) => save({ auto: e.target.checked });
    $('#yhw-sv-turbo').onchange = (e) => save({ turbo: e.target.checked });
    $('#yhw-sv-hl').onchange = (e) => save({ highlight: e.target.checked });
    $('#yhw-sv-next').onchange = (e) => save({ autoNext: e.target.checked });
    $('#yhw-sv-dmin').onchange = (e) => save({ delayMin: +e.target.value || 0 });
    $('#yhw-sv-dmax').onchange = (e) => save({ delayMax: +e.target.value || 800 });
    applyPanelState();
  }
  function save(p) { settings = { ...settings, ...p }; try { chrome.storage.local.set(settings); } catch {} }
  function applyPanelState() {
    const g = (id) => document.getElementById(id);
    if (!g('yhw-sv-auto')) return;
    g('yhw-sv-auto').checked = !!settings.auto;
    g('yhw-sv-turbo').checked = !!settings.turbo;
    g('yhw-sv-hl').checked = !!settings.highlight;
    g('yhw-sv-next').checked = !!settings.autoNext;
    g('yhw-sv-dmin').value = settings.delayMin;
    g('yhw-sv-dmax').value = settings.delayMax;
    if (settings.showTable === false) { const w = g('yhw-sv-words'); if (w) w.style.display = 'none'; }
  }
  function setStatus(t) { const s = $('#yhw-sv-status'); if (s) s.textContent = t; }
  function renderTable() {
    const w = $('#yhw-sv-words'); if (!w || !DATA) return;
    w.innerHTML = `<table><tr><th>Từ</th><th>Nghĩa</th><th>Hình</th></tr>${DATA.items.map((it) =>
      `<tr><td><b>${it.word}</b></td><td>${it.meaning}</td><td>${it.imageUrl ? `<img loading="lazy" src="/yhw/f/yhw-voca/${it.imageUrl}">` : ''}</td></tr>`).join('')}</table>`;
  }

  /* ---------- observers ---------- */
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; DATA = null; lastPromptKey = ''; loadData().then(() => solveOnce(false)); }
  }, 800);

  // poll: React thuong chi doi text/src tai cho (khong them node moi) sau khi
  // bam "Cau tiep theo" -> MutationObserver childList khong thay -> poll moi 2s
  // de phat hien cau/round moi qua currentKey().
  setInterval(() => {
    if (!settings.auto || solving || !DATA) return;
    try {
      const k = currentKey();
      if (k && k !== lastPromptKey) solveOnce(false);
    } catch (e) { /* ignore */ }
  }, 1200);

  function observe() {
    const target = document.body;
    let t = null;
    new MutationObserver(() => {
      if (document.getElementById('yhw-solver-panel') && !document.getElementById('yhw-sv-auto')) return;
      clearTimeout(t);
      t = setTimeout(() => { if (settings.auto) solveOnce(false); else { highlightOnly(); } }, 600);
    }).observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
  }
  async function highlightOnly() {
    // khi tat auto: van highlight neu da co DATA (khong click)
    const keep = settings.auto; settings.auto = false;
    await solveOnce(false); settings.auto = keep;
  }

  (async function init() {
    injectPanel();
    setStatus('Đang tải dữ liệu bài…');
    await loadData();
    observe();
    setTimeout(() => solveOnce(false), 1500);
    setTimeout(() => solveOnce(false), 3500);
  })();
})();
