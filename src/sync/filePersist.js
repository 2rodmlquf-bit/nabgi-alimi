// 클라우드 저장의 "이 컴퓨터에만 있는 것"을 파일로 보관한다 (docs/erd.md의 LOCAL_CLOUD_LINK 일부, LOCAL_SESSION).
//   cloud.json           연결 설정(프로젝트 주소·공개 키)과 올린 기록 장부(ledger). 비밀번호는 없다.
//   cloud-session.bin    로그인 정보(토큰). OS 보안 저장소(Electron safeStorage)로 암호화한다. 암호화를 쓸 수 없으면 파일에 쓰지 않고 이번 실행 동안만 기억한다.
//   state.pre-cloud-<시각>.bak.json   처음 옮기기 직전에 만드는 로컬 파일 백업
// 비밀번호는 어디에도 저장하지 않는다. 로그인 한 번으로 받은 토큰만 쓰고, 만료되면 갱신 토큰으로 새로 받는다.
const fs = require("fs/promises");
const path = require("path");

const stamp = d => d.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");

// crypto = { available(): boolean, encrypt(text) -> Buffer, decrypt(Buffer) -> text } (Electron safeStorage를 감싸서 넘긴다)
function createFilePersist({ dir, crypto, now = () => new Date() }) {
  const metaFile = path.join(dir, "cloud.json"), sessFile = path.join(dir, "cloud-session.bin"), stateFile = path.join(dir, "state.json");
  let memSession = null;

  async function writeAtomic(file, data) {
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  return {
    async loadMeta() {
      try { const j = JSON.parse(await fs.readFile(metaFile, "utf8")); return j && typeof j === "object" ? j : null; } catch (e) { return null; }     // 없거나 깨졌으면 새로 시작 (장부가 없으면 전부 다시 보내지만 중복은 생기지 않는다)
    },
    async saveMeta(meta) { await writeAtomic(metaFile, JSON.stringify(meta)); },
    async loadSession() {
      if (memSession) return memSession;
      try { return JSON.parse(crypto.decrypt(await fs.readFile(sessFile))); } catch (e) { return null; }
    },
    async saveSession(s) {
      if (!s) { memSession = null; try { await fs.unlink(sessFile); } catch (e) { /* 없으면 그만 */ } return; }
      if (crypto && crypto.available()) { await writeAtomic(sessFile, crypto.encrypt(JSON.stringify(s))); memSession = null; }
      else memSession = s;
    },
    async backup() {
      let text;
      try { text = await fs.readFile(stateFile, "utf8"); } catch (e) { if (e.code === "ENOENT") return "(아직 저장 파일이 없어서 만들지 않았어요)"; throw e; }
      const name = "state.pre-cloud-" + stamp(now()) + ".bak.json";
      await fs.writeFile(path.join(dir, name), text, "utf8");
      return name;
    },
  };
}

module.exports = { createFilePersist };
