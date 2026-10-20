// 저장소 공통 로직. 구현체(파일, 메모리, 나중에 Supabase)는 입출력 부분만 채운다.
//
// 저장소 인터페이스 (화면은 이것만 안다. 모두 Promise를 돌려준다):
//   load()      -> { view, notices, readOnly }   저장된 내용을 화면용 뷰로. 문제가 있었으면 notices에 알림이 담긴다
//   save(view)  -> { ok, error? }                뷰를 저장한다. 읽기 전용이거나 너무 크면 거부하고 기존 내용은 그대로
//   clear()     -> { ok, error? }                저장 내용을 모두 지운다
//   info()      -> { kind, notices, readOnly, ... }
//
// 구현체가 채울 것: _read() -> 글자|null, _write(글자), _remove(), _quarantine(글자, 이유) -> 보관한 이름, _backupOld(글자, 예전 버전 0|1|2) -> 백업 이름, describe()
//
// 안전 원칙: 읽을 수 없거나 새 형식으로 바꿀 수 없으면 **빈 상태로 덮어쓰지 않는다.** 읽기 전용으로 열고 이유를 알려 준다.
const { randomUUID } = require("crypto");
const Core = require("./core");

class BaseStore {
  constructor({ now, newId } = {}) {
    this._now = now || (() => new Date().toISOString());
    this._newId = newId || randomUUID;
    this._loaded = false; this._state = Core.emptyState(); this.notices = []; this.readOnly = false; this._readOnlyWhy = "";
    this._chain = Promise.resolve();                 // 같은 저장소에 대한 동작을 차례로 실행한다 (저장이 섞이지 않게)
  }

  _serial(fn) { const run = this._chain.then(fn, fn); this._chain = run.then(() => {}, () => {}); return run; }
  _notice(level, code, message) { this.notices.push({ level, code, message }); }
  _lock(why) { this.readOnly = true; this._readOnlyWhy = why; }

  async _ensureLoaded() { if (!this._loaded) await this._load(); }

  async _load() {
    this.notices = []; this.readOnly = false; this._readOnlyWhy = "";
    let raw;
    try { raw = await this._read(); }
    catch (e) { this._state = Core.emptyState(); this._loaded = true; this._lock("저장 파일을 열지 못해요"); this._notice("error", "read-failed", "저장 파일을 열지 못했어요(" + e.message + "). 내용을 지키려고 저장하지 않아요."); return; }

    if (raw == null) { this._state = Core.emptyState(); this._loaded = true; return; }
    let obj, parsed = true;
    try { obj = JSON.parse(String(raw).replace(/^﻿/, "")); } catch (e) { parsed = false; }
    const ver = parsed ? Core.detectVersion(obj) : "invalid";

    if (ver === "invalid") {
      try {
        const name = await this._quarantine(raw, "읽을 수 없는 저장 파일");
        this._notice("warn", "corrupt", "저장 파일을 읽지 못해 새로 시작했어요. 손상된 파일은 그대로 보관했어요: " + name);
      } catch (e) {
        this._lock("손상된 저장 파일을 보관하지 못해요");
        this._notice("error", "corrupt-keep-failed", "저장 파일을 읽지 못했고 보관도 못 했어요(" + e.message + "). 내용을 지키려고 저장하지 않아요.");
      }
      this._state = Core.emptyState(); this._loaded = true; return;
    }
    if (ver === "future") {
      this._state = Core.emptyState(); this._loaded = true; this._lock("더 새로운 버전의 저장 파일이에요");
      this._notice("warn", "future-version", "이 앱보다 새로운 버전에서 만든 저장 파일이에요. 내용을 지키려고 저장하지 않고 읽기만 해요.");
      return;
    }
    if (ver === Core.SCHEMA_VERSION) { this._state = Core.normalizeState(obj); this._loaded = true; return; }

    // 예전 형식 파일(버전 표시가 없는 v0, 또는 v1): 백업을 먼저 만들고 새 형식(v2)으로 바꾼다. 어느 단계든 실패하면 원본은 그대로 둔다.
    // 어느 버전이든 결과는 현재 형식(v3)이다. v0·v1은 id를 새로 만들어야 해서 now·newId가 필요하다.
    const migrated = ver === 0 ? Core.migrateV0toV2(obj, { now: this._now(), newId: this._newId }) : ver === 1 ? Core.migrateV1toV2(obj, { now: this._now(), newId: this._newId }) : Core.migrateV2toV3(obj);
    this._state = migrated; this._loaded = true;
    let backupName;
    try { backupName = await this._backupOld(raw, ver); }
    catch (e) { this._lock("백업을 만들지 못해요"); this._notice("error", "backup-failed", "예전 저장 파일의 백업을 만들지 못해 새 형식으로 바꾸지 않았어요(" + e.message + "). 내용은 읽어 왔지만 저장하지 않아요."); return; }
    try { await this._write(JSON.stringify(migrated)); }
    catch (e) { this._lock("새 형식으로 바꾸지 못해요"); this._notice("error", "migrate-failed", "저장 파일을 새 형식으로 바꾸지 못했어요(" + e.message + "). 내용은 읽어 왔지만 저장하지 않아요. 예전 파일은 그대로예요."); return; }
    this._notice("info", "migrated", "저장 파일을 새 형식(v" + Core.SCHEMA_VERSION + ")으로 바꿨어요. 예전 파일은 " + backupName + "으로 보관했어요.");
  }

  load() { return this._serial(async () => { await this._ensureLoaded(); return { view: Core.toView(this._state), notices: this.notices.slice(), readOnly: this.readOnly }; }); }

  save(view) {
    return this._serial(async () => {
      await this._ensureLoaded();
      if (this.readOnly) return { ok: false, error: "저장하지 않았어요: " + this._readOnlyWhy + "." };
      const next = Core.fromView(view, this._state, { now: this._now(), newId: this._newId });
      const text = JSON.stringify(next);
      if (text.length > Core.MAX_CHARS) return { ok: false, error: "저장할 내용이 너무 큽니다. 오래된 안내 기록·메모를 줄이거나 저장 내용 지우기를 해 주세요." };
      try { await this._write(text); } catch (e) { return { ok: false, error: "저장하지 못했습니다: " + e.message }; }
      this._state = next;
      // 상한(2MB)에 가까워지면 거부되기 전에 미리 알린다 (80%부터)
      const used = text.length / Core.MAX_CHARS;
      return used >= Core.WARN_RATIO ? { ok: true, warning: "저장 공간을 " + Math.round(used * 100) + "% 썼어요. 가득 차면 더 저장되지 않으니 오래된 기록을 정리해 주세요." } : { ok: true };
    });
  }

  // ---- 클라우드 저장(올리기·복원)이 쓰는 입구. 화면은 쓰지 않는다 ----
  snapshot() { return this._serial(async () => { await this._ensureLoaded(); return { state: JSON.parse(JSON.stringify(this._state)), readOnly: this.readOnly }; }); }

  // 클라우드 연결 정보(cloudLink)만 바꾼다. 기록은 건드리지 않는다.
  setCloudLink(patch) {
    return this._serial(async () => {
      await this._ensureLoaded();
      if (this.readOnly) return { ok: false, error: "저장하지 않았어요: " + this._readOnlyWhy + "." };
      const next = { ...this._state, cloudLink: { ...this._state.cloudLink, ...patch } };
      try { await this._write(JSON.stringify(Core.normalizeState(next))); } catch (e) { return { ok: false, error: "저장하지 못했습니다: " + e.message }; }
      this._state = Core.normalizeState(next);
      return { ok: true, cloudLink: { ...this._state.cloudLink } };
    });
  }

  // DB에서 받은 상태를 합쳐 저장한다 (규칙: Core.mergeRestored). 읽기 전용이면 거부.
  restore(remoteState) {
    return this._serial(async () => {
      await this._ensureLoaded();
      if (this.readOnly) return { ok: false, error: "저장하지 않았어요: " + this._readOnlyWhy + "." };
      const r = Core.mergeRestored(this._state, remoteState, { now: this._now() });
      const text = JSON.stringify(r.state);
      if (text.length > Core.MAX_CHARS) return { ok: false, error: "받아 온 기록을 합치면 저장 공간(2MB)을 넘어서 합치지 않았어요." };
      try { await this._write(text); } catch (e) { return { ok: false, error: "저장하지 못했습니다: " + e.message }; }
      this._state = r.state;
      return { ok: true, added: r.added, updated: r.updated };
    });
  }

  clear() {
    return this._serial(async () => {
      await this._ensureLoaded();
      if (this._readOnlyWhy === "더 새로운 버전의 저장 파일이에요") return { ok: false, error: "더 새로운 버전에서 만든 저장 파일이라 지우지 않았어요." };
      try { await this._remove(); } catch (e) { return { ok: false, error: "지우지 못했습니다: " + e.message }; }
      this._state = Core.emptyState(); this.readOnly = false; this._readOnlyWhy = ""; this.notices = [];
      return { ok: true };
    });
  }

  info() { return { ...this.describe(), notices: this.notices.slice(), readOnly: this.readOnly }; }
}

module.exports = { BaseStore };
