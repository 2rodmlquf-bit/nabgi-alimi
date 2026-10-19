const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");

const root = path.join(__dirname, "..");
const { screens } = JSON.parse(fs.readFileSync(path.join(root, "docs", "screens.json"), "utf8"));
const IA = path.join(root, "..", "납기-문제정의", "IA.md");

test("screens.json: 화면 ID 형식, 중복 없음, 허용된 값", () => {
  assert.ok(screens.length > 0);
  const ids = screens.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, "화면 ID가 중복되면 안 된다");
  screens.forEach(s => {
    assert.match(s.id, /^[A-Z]{2}-\d{2}-[PMTLA]$/, s.id + ": 형식은 메뉴약자-번호-형태(P·M·T·L·A)");
    assert.ok(["유지", "변경", "신규"].includes(s.status), s.id + ": 상태 값 " + s.status);
    assert.ok(["in", "out"].includes(s.scope), s.id + ": 범위 값 " + s.scope);
  });
});

test("screens.json은 IA.md 10절 화면목록과 같다 (IA.md가 이 저장소 옆에 있을 때만 확인)", { skip: !fs.existsSync(IA) && "../납기-문제정의/IA.md가 없어서 건너뜀" }, () => {
  const md = fs.readFileSync(IA, "utf8");
  const sec = md.slice(md.indexOf("## 10. 화면목록"), md.indexOf("## 검증 결과"));
  const fromIA = [];
  sec.split("\n").forEach(l => {
    const m = l.match(/^\| ([A-Z]{2}-\d{2}-[PMTLA]) \|/);
    if (!m) return;
    const c = l.trim().replace(/^\||\|$/g, "").split("|").map(x => x.trim());
    fromIA.push({ id: c[0], status: c[6].replace(/\*/g, ""), scope: /범위 밖/.test(c[7]) ? "out" : "in" });
  });
  const mine = screens.map(s => ({ id: s.id, status: s.status, scope: s.scope }));
  assert.deepEqual(mine, fromIA, "IA.md를 바꿨다면 docs/screens.json도 같이 고쳐야 한다");
});
