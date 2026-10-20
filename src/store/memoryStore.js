// 메모리 저장소: 디스크 없이 같은 인터페이스를 지킨다. 테스트와 계약 시험용이다.
// text를 주면 "이미 저장된 파일 내용"으로 시작한다 (예전 형식 파일을 시험할 때).
// holder({ text })를 여러 저장소가 나눠 가지면 같은 파일을 가리키는 것과 같다 (앱을 껐다 켜는 시험: 새 저장소를 같은 holder로 연다).
const { BaseStore } = require("./baseStore");

class MemoryStore extends BaseStore {
  constructor({ text = null, holder, ...rest } = {}) { super(rest); this.holder = holder || { text }; this.backups = []; this.quarantined = []; }
  get text() { return this.holder.text; }
  set text(v) { this.holder.text = v; }
  async _read() { return this.text; }
  async _write(text) { this.text = text; }
  async _remove() { this.text = null; }
  async _quarantine(raw) { this.quarantined.push(raw); this.text = null; return "memory:corrupt#" + this.quarantined.length; }
  async _backupOld(raw, version) { this.backups.push(raw); return "memory:v" + version + "#" + this.backups.length; }
  describe() { return { kind: "memory", sizeBytes: this.text == null ? 0 : Buffer.byteLength(this.text) }; }
}

module.exports = { MemoryStore };
