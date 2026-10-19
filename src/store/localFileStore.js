// 로컬 파일 저장소: 이 컴퓨터의 앱 데이터 폴더에 state.json 한 개로 저장한다 (암호화하지 않는다).
// 파일 입출력은 모두 여기서만 한다. 메인 프로세스에서 쓴다.
//
//  state.json                       현재 저장 파일 (v1)
//  state.v0.bak.json                예전(v0) 형식 파일을 새 형식으로 바꾸기 직전의 원본 사본. 이미 있고 내용이 다르면 state.v0.bak-<시각>.json
//  state.corrupt-<시각>.json        읽을 수 없어서 치워 둔 파일 (지우지 않고 보관한다)
//  state.json.tmp                   저장 중에만 있는 임시 파일. 다 쓴 뒤 이름을 바꿔 교체하므로, 저장 도중 꺼져도 기존 파일이 남는다
const fsp = require("fs/promises");
const path = require("path");
const { BaseStore } = require("./baseStore");

const stamp = iso => iso.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");

class LocalFileStore extends BaseStore {
  constructor({ dir, ...rest }) {
    super(rest);
    if (!dir) throw new Error("저장 폴더(dir)가 필요해요");
    this.dir = dir; this.file = path.join(dir, "state.json");
  }

  async _read() {
    try { return await fsp.readFile(this.file, "utf8"); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }

  async _write(text) {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    await fsp.writeFile(tmp, text, "utf8");
    await fsp.rename(tmp, this.file);               // 임시 파일을 다 쓴 뒤에 교체한다
  }

  async _remove() { try { await fsp.unlink(this.file); } catch (e) { if (e.code !== "ENOENT") throw e; } }

  async _quarantine() {
    const name = "state.corrupt-" + stamp(this._now()) + ".json";
    await fsp.rename(this.file, path.join(this.dir, name));   // 내용을 그대로 옮긴다 (다시 쓰지 않는다)
    return name;
  }

  async _backupV0() {
    const same = async f => { try { return (await fsp.readFile(f)).equals(await fsp.readFile(this.file)); } catch (e) { return false; } };
    const first = path.join(this.dir, "state.v0.bak.json");
    const exists = await fsp.access(first).then(() => true, () => false);
    if (!exists) { await fsp.copyFile(this.file, first); return "state.v0.bak.json"; }
    if (await same(first)) return "state.v0.bak.json";         // 같은 내용이면 이미 백업된 것
    const name = "state.v0.bak-" + stamp(this._now()) + ".json"; // 다른 내용이면 덮어쓰지 않고 새 이름으로
    await fsp.copyFile(this.file, path.join(this.dir, name));
    return name;
  }

  describe() {
    let sizeBytes = 0;
    try { sizeBytes = require("fs").statSync(this.file).size; } catch (e) { /* 아직 없음 */ }
    return { kind: "local-file", path: this.file, sizeBytes };
  }
}

module.exports = { LocalFileStore };
