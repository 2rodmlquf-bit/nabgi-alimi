// 저장소를 만드는 한 곳. 저장 방식(mode)을 바꿀 자리다. 지금은 로컬 파일뿐이고, 나중에 'supabase'를 여기에 끼운다.
const { LocalFileStore } = require("./localFileStore");
const { MemoryStore } = require("./memoryStore");

const MODES = ["local", "memory"];

function createStore({ mode = "local", ...opts } = {}) {
  if (mode === "local") return new LocalFileStore(opts);
  if (mode === "memory") return new MemoryStore(opts);
  throw new Error("알 수 없는 저장 방식이에요: " + mode + " (가능: " + MODES.join(", ") + ")");
}

module.exports = { createStore, MODES, LocalFileStore, MemoryStore };
