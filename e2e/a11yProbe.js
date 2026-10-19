// 화면 점검 도구 (용어·접근성·대비). 화면 안에서 실행할 코드를 문자열로 돌려준다. E2E 시나리오와 tools/a11y-audit.js가 같이 쓴다.
// 읽기만 한다 (화면을 바꾸지 않는다).

// 화면에 보이는 모든 글: 본문 + title/placeholder/aria-label 속성 + 입력 칸의 값(안내문, 보고 문구) + 선택 칸의 항목
const VISIBLE_TEXT = `(() => {
  const out = [];
  const shown = el => { for (let e = el; e; e = e.parentElement) { if (e.hidden) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  document.querySelectorAll('body *').forEach(e => {
    if (!shown(e) || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)) return;
    [...e.childNodes].forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) out.push(n.textContent.trim()); });
    ['title', 'placeholder', 'aria-label'].forEach(a => { const v = e.getAttribute(a); if (v) out.push(v); });
    if ((e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && e.type === 'text')) && e.value) out.push(e.value);
  });
  document.querySelectorAll('option').forEach(o => { if (shown(o.parentElement)) out.push(o.textContent.trim()); });
  return out.join('\\n');
})()`;

// 이름 없는 조작 요소: 버튼·입력·선택·체크박스·탭 중 글자, aria-label, 연결된 label, title이 모두 없는 것 (placeholder는 이름으로 치지 않는다)
const UNNAMED = `(() => {
  const shown = el => { for (let e = el; e; e = e.parentElement) { if (e.hidden) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const name = e => {
    if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
    const lb = e.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if (t) return t; }
    if (e.labels && e.labels.length) { const t = [...e.labels].map(l => l.textContent).join(' ').trim(); if (t) return t; }
    if (e.closest('label') && e.closest('label').textContent.trim()) return e.closest('label').textContent.trim();
    if (['BUTTON', 'A'].includes(e.tagName) || e.getAttribute('role') === 'tab' || e.getAttribute('role') === 'button') { const t = e.textContent.trim(); if (t) return t; }
    return e.getAttribute('title') || '';
  };
  return [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href], [role=tab], [role=button], [tabindex]')]
    .filter(e => shown(e) && !['TR', 'TH', 'TD'].includes(e.tagName) && !name(e))      // 표 줄·머리글은 안의 글이 이름이다
    .map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.type ? '[' + e.type + ']' : '') + (e.closest('[data-screen-id]') ? ' in ' + e.closest('[data-screen-id]').getAttribute('data-screen-id') : ''));
})()`;

// 키보드로 닿지 않는 표 행 수: 눌러서 상세를 여는데 tabindex 자체가 없는 tr (화살표로 옮기는 줄은 -1, 탭 정지 지점은 0)
const CLICKABLE_NOT_FOCUSABLE = `[...document.querySelectorAll('#tbody tr')].filter(r => !r.hasAttribute('tabindex')).length`;

// 글자 대비: 보이는 글 요소의 색과 배경(가장 가까운 불투명 배경)의 대비. 4.5 미만(큰 글씨는 3 미만)을 모은다.
const CONTRAST = `(() => {
  const parse = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const rootBg = () => { const bc = parse(getComputedStyle(document.body).backgroundColor); if (bc && bc.a > 0) return { ...bc, a: 1 }; return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; };
  const bgOf = el => { const layers = []; let opaque = false; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) { opaque = true; break; } } } const base = opaque ? { r: 0, g: 0, b: 0, a: 1 } : rootBg(); return layers.reduceRight((acc, l) => blend(l, acc), base); };
  const shown = el => { for (let e = el; e; e = e.parentElement) { if (e.hidden) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const seen = new Map();
  document.querySelectorAll('body *').forEach(e => {
    if (!shown(e)) return;
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) return;
    const st = getComputedStyle(e), fg = parse(st.color); if (!fg) return;
    if (st.backgroundImage !== 'none') return;                                       // 그라데이션 배경(주 버튼)은 이 방법으로 못 재서 따로 계산한다
    const bg = bgOf(e), f = blend(fg, bg);
    const ratio = (Math.max(lum(f), lum(bg)) + 0.05) / (Math.min(lum(f), lum(bg)) + 0.05);
    const size = parseFloat(st.fontSize), bold = parseInt(st.fontWeight, 10) >= 700, large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) { const key = e.tagName.toLowerCase() + '.' + String(e.className || '') + '|' + st.color + '|' + st.backgroundColor; if (!seen.has(key)) seen.set(key, { el: e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''), text: (e.textContent || '').trim().slice(0, 24), ratio: Math.round(ratio * 100) / 100, need, color: st.color }); }
  });
  return [...seen.values()];
})()`;

module.exports = { VISIBLE_TEXT, UNNAMED, CLICKABLE_NOT_FOCUSABLE, CONTRAST };
