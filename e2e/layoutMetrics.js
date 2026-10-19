// 화면 배치 측정 (PRD FR-17). "스크롤 없이 닿는가"를 숫자로 잰다. 같은 환경에서 개선 전·후를 비교하는 데 쓴다.
// 상세 패널은 오른쪽에 붙어 있고 자체 스크롤이 있다. 그래서 "상세 안에서 몇 px 내려야 하나"를 잰다.
// 단위는 px. 폰트·배율에 따라 달라지므로 같은 PC·같은 크기에서 전후만 비교한다.
const q = JSON.stringify;

// 주문 하나를 열어 둔 상태에서 측정한다. app은 E2E 하네스의 앱, orderNo는 연 주문.
async function measure(app) {
  return app.eval(`(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const d = document.getElementById('detail');
    const dr = d.getBoundingClientRect();
    const visibleBottom = Math.min(vh, dr.bottom);                     // 상세 안에서 눈에 보이는 아래쪽 끝
    const find = (scope, text) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
    const rel = el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top - dr.top + d.scrollTop), h: Math.round(r.height) }; };
    const out = { viewport: vw + 'x' + vh, detailScrollable: d.scrollHeight > d.clientHeight + 1, detailHeight: Math.round(d.scrollHeight) };
    const rec = find(d, '안내함으로 기록');
    if (rec) {
      const p = rel(rec);
      out.recordBtnTop = p.top;                                          // 상세 맨 위에서 이 버튼까지 거리
      out.recordBtnNeedsScroll = Math.max(0, Math.round(p.top + p.h + 8 - (visibleBottom - dr.top)));   // 스크롤해야 하는 양 (0이면 바로 보임)
    }
    ['LS-31-A', 'LS-32-A', 'LS-33-A'].forEach(id => { const e = d.querySelector('[data-screen-id="' + id + '"]'); out[id] = e ? rel(e).top : null; });
    const raw = d.querySelector('dl'); out.rawValuesTop = raw ? rel(raw).top : null;
    const bar = document.getElementById('informBar');
    if (bar && !bar.hidden) { const r = bar.getBoundingClientRect(); out.informBarTop = Math.round(r.top + window.scrollY); out.informBarVisible = r.top >= 0 && r.bottom <= vh; }
    const cards = document.querySelector('.cards'); if (cards) out.cardsTop = Math.round(cards.getBoundingClientRect().top + window.scrollY);
    return out;
  })()`);
}

// 샘플을 열고 첫 번째 지연 주문(PO-2026-1002 아님, 안내 안 한 것)을 눌러 측정한다.
async function measureAt(app, w, h, orderNo = "PO-2026-1001") {
  await app.viewport(w, h);
  await app.sleep(300);
  await app.eval(`(() => { const r = [...document.querySelectorAll('#tbody tr')].find(tr => tr.textContent.includes(${q(orderNo)})); r.click(); window.scrollTo(0, 0); })()`);
  await app.sleep(400);
  return measure(app);
}

module.exports = { measure, measureAt };
