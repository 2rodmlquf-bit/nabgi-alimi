const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { buildPayload, buildPrompt, parseMapping } = require("./src/mapping");
const { MAX_CHARS, buildEmailPrompt, parseEmailResult } = require("./src/email");
const { createStore } = require("./src/store");
const { parseEml } = require("./src/eml");
const { readXlsx } = require("./src/xlsx");
const { parseCsv } = require("./src/csv");
const OrdersFile = require("./src/ordersFile");
const { safeFileName } = require("./src/report");
const runtimeEnv = require("./src/runtimeEnv");

// 개발·E2E 테스트용 환경변수 (src/runtimeEnv.js). 환경변수가 없는 일반 실행에는 영향이 없다.
// 저장 경로(state.json, 키 파일)는 모두 app.getPath("userData")를 거치므로 여기서 바꾸면 한꺼번에 분리된다.
if (!runtimeEnv.e2eIsSafe(process.env)) {
  console.error("NABGI_E2E=1 에는 NABGI_USER_DATA(절대 경로)가 꼭 필요해요. 실제 사용자 데이터를 지키려고 시작하지 않습니다.");
  process.exit(1);
}
const userDataOverride = runtimeEnv.userDataOverride(process.env);
if (userDataOverride) app.setPath("userData", userDataOverride);

const MODEL = "claude-haiku-5-5"; // 열 매핑은 가벼운 모델로 충분하다 (바꿀 때는 이 한 줄만)
const keyFile = () => path.join(app.getPath("userData"), "claude-key.bin");
let memoryKey = null; // 보안 저장소를 쓸 수 없을 때 이번 실행 동안만 보관

// API 키는 이 프로세스 안에서만 다룬다. 화면(렌더러)에는 키 값을 절대 넘기지 않는다.
function readKey() {
  if (memoryKey) return memoryKey;
  try { return safeStorage.decryptString(fs.readFileSync(keyFile())); } catch (e) { return null; }
}

// 한국어 엑셀 CSV는 UTF-8이 아니라 CP949(EUC-KR)인 경우가 많아서 깨지면 한 번 더 시도한다.
function decode(buf) {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("euc-kr").decode(buf);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, title: "납기 알리미",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("open-csv", async () => {
  const forced = runtimeEnv.e2eOpenFile(process.env); // E2E 모드에서만: 대화상자 대신 지정한 파일을 연다
  if (forced) return { name: path.basename(forced), text: decode(fs.readFileSync(forced)) };
  const r = await dialog.showOpenDialog({ title: "주문 목록 CSV 선택", properties: ["openFile"], filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: path.basename(r.filePaths[0]), text: decode(fs.readFileSync(r.filePaths[0])) };
});

// 주문 목록 열기: CSV와 엑셀(.xlsx). CSV는 예전처럼 { name, text }, 엑셀은 읽어서 { name, columns, rows, notes }로 돌려준다.
// 읽을 수 없으면 { name, error }. 파일은 읽기만 한다.
function readOrderFile(file) {
  const buf = fs.readFileSync(file), name = path.basename(file);
  if (/\.csv$/i.test(name) && buf.length <= OrdersFile.MAX_FILE) return { name, text: decode(buf) };
  const r = OrdersFile.readOrders(name, buf, { decode });
  return r.ok ? r : { name, error: r.error };
}
ipcMain.handle("open-orders", async () => {
  const forced = runtimeEnv.e2eOpenFile(process.env);
  if (forced) return readOrderFile(forced);
  const r = await dialog.showOpenDialog({ title: "주문 목록 선택", properties: ["openFile"], filters: [{ name: "엑셀·CSV", extensions: ["xlsx", "csv"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readOrderFile(r.filePaths[0]);
});

ipcMain.handle("load-sample", () => {
  const file = path.join(__dirname, "샘플주문.csv");
  return { name: "샘플주문.csv", text: decode(fs.readFileSync(file)), sampleDate: "2026-10-12" };
});

ipcMain.handle("key-status", () => ({ has: !!readKey(), persistent: safeStorage.isEncryptionAvailable() }));

ipcMain.handle("key-save", (e, key) => {
  const k = String(key || "").trim();
  if (!k.startsWith("sk-ant-") || k.length < 20) return { ok: false, error: "API 키 형식이 아닙니다. sk-ant- 로 시작하는 키를 넣어 주세요." };
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyFile(), safeStorage.encryptString(k));
    memoryKey = null;
    return { ok: true, persistent: true };
  }
  memoryKey = k;
  return { ok: true, persistent: false };
});

ipcMain.handle("key-clear", () => { memoryKey = null; try { fs.unlinkSync(keyFile()); } catch (e) {} return { ok: true }; });

// Claude 호출 한 곳. 성공하면 { ok: true, text }, 실패하면 한국어 안내문이 든 { ok: false, error }.
async function callClaude(prompt, maxTokens) {
  const key = readKey();
  if (!key) return { ok: false, error: "API 키를 먼저 저장해 주세요." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) {
      const why = { 401: "API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.", 403: "이 키로는 사용할 수 없습니다.", 429: "요청이 너무 많거나 사용 한도에 걸렸습니다. 잠시 뒤에 다시 해 주세요.", 529: "Claude 서버가 바쁩니다. 잠시 뒤에 다시 해 주세요." }[res.status];
      return { ok: false, error: why || "Claude 호출에 실패했습니다 (코드 " + res.status + ")." };
    }
    const data = await res.json();
    return { ok: true, text: (data.content || []).filter(b => b.type === "text").map(b => b.text).join("") };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "시간이 너무 오래 걸렸습니다. 다시 시도해 주세요." : "Claude에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요." };
  } finally { clearTimeout(timer); }
}

ipcMain.handle("map-columns", async (e, { columns, rows }) => {
  const payload = buildPayload(columns, rows);
  const r = await callClaude(buildPrompt(payload), 1500);
  if (!r.ok) return r;
  try { return { ok: true, mapping: parseMapping(r.text, columns), sent: payload }; }
  catch (err) { return { ok: false, error: "Claude 응답을 해석하지 못했습니다. 다시 시도하거나 직접 연결해 주세요." }; }
});

ipcMain.handle("extract-email", async (e, { text, today }) => {
  const mail = String(text || "").trim();
  if (!mail) return { ok: false, error: "이메일 내용을 붙여 넣어 주세요." };
  const r = await callClaude(buildEmailPrompt(mail, String(today || "")), 2500);
  if (!r.ok) return r;
  try { return { ok: true, items: parseEmailResult(r.text, mail), truncated: mail.length > MAX_CHARS }; }
  catch (err) { return { ok: false, error: "Claude 응답을 해석하지 못했습니다. 다시 시도해 주세요." }; }
});

// 메일 폴더(.eml) 읽기. 파일은 읽기만 하고 수정·삭제하지 않는다. 한 폴더 안의 .eml만 보고(하위 폴더는 보지 않음) 최대 2000통, 파일당 8MB까지.
function readMailFolder(dir) {
  let names;
  try { names = fs.readdirSync(dir).filter(f => /\.eml$/i.test(f)); } catch (e) { return { ok: false, error: "폴더를 읽지 못했어요." }; }
  const truncated = names.length > 2000;
  names = names.slice(0, 2000);
  const mails = [];
  let skipped = 0;
  for (const f of names) {
    try {
      const full = path.join(dir, f);
      if (fs.statSync(full).size > 8 * 1024 * 1024) { skipped++; continue; }
      const m = parseEml(fs.readFileSync(full));
      mails.push({ file: f, subject: m.subject, from: m.from, date: m.date, body: m.body.slice(0, 20000), attachments: m.attachments.map(a => a.filename) });
    } catch (e) { skipped++; }
  }
  mails.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  lastMailDir = dir; // 첨부를 다시 열 때 쓴다
  return { ok: true, mails, skipped, truncated, folder: path.basename(dir) };
}
let lastMailDir = null;

// 공급사가 보낸 표(.xlsx / .csv)를 읽어 시트별 2차원 배열로 돌려준다. 파일은 읽기만 한다.
function readSupplierTable(name, buf) {
  if (buf.length > 20 * 1024 * 1024) return { ok: false, error: "파일이 너무 커요 (20MB 이하만 읽어요)." };
  try {
    if (/\.csv$/i.test(name)) return { ok: true, name, sheets: [{ name: "CSV", rows: parseCsv(decode(buf)).slice(0, 5000).map(r => r.map(c => String(c).trim())) }] };
    return { ok: true, name, sheets: readXlsx(buf) };
  } catch (e) {
    return { ok: false, error: e.constructor && e.constructor.name === "XlsxError" ? e.message : "파일을 읽지 못했어요. 엑셀(.xlsx)이나 CSV가 맞는지 확인해 주세요." };
  }
}

ipcMain.handle("pick-supplier-file", async () => {
  const r = await dialog.showOpenDialog({ title: "공급사 엑셀·CSV 선택", properties: ["openFile"], filters: [{ name: "엑셀·CSV", extensions: ["xlsx", "csv"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readSupplierTable(path.basename(r.filePaths[0]), fs.readFileSync(r.filePaths[0]));
});

ipcMain.handle("load-sample-supplier", (e, which) => {
  const names = ["가온산업_납기회신.xlsx", "나래테크_회신.xlsx"];
  const name = names[which] || names[0];
  return readSupplierTable(name, fs.readFileSync(path.join(__dirname, "샘플공급사", name)));
});

// 메일(.eml)에 붙어 있던 엑셀·CSV 첨부를 연다. 같은 폴더의 파일만, 이름은 화면에서 받은 것을 그대로 비교해서 찾는다.
ipcMain.handle("open-mail-attachment", (e, { file, name }) => {
  if (!lastMailDir || /[\\/]/.test(String(file)) || !/\.eml$/i.test(String(file))) return { ok: false, error: "메일 폴더를 먼저 열어 주세요." };
  try {
    const m = parseEml(fs.readFileSync(path.join(lastMailDir, file)));
    const a = m.attachments.find(x => x.filename === name);
    return a ? readSupplierTable(a.filename, a.data) : { ok: false, error: "첨부 파일을 찾지 못했어요." };
  } catch (err) { return { ok: false, error: "메일을 읽지 못했어요." }; }
});

ipcMain.handle("pick-mail-folder", async () => {
  const r = await dialog.showOpenDialog({ title: "메일(.eml) 폴더 선택", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readMailFolder(r.filePaths[0]);
});
ipcMain.handle("load-sample-mails", () => readMailFolder(path.join(__dirname, "샘플메일")));

// 보고서·CSV 저장. 저장 위치는 사용자가 저장 창에서 직접 고르고, 앱은 csv·txt만 쓴다.
ipcMain.handle("save-file", async (e, { name, text, ext }) => {
  const kind = ext === "csv" ? "csv" : "txt";
  const body = String(text == null ? "" : text);
  if (body.length > 20 * 1000 * 1000) return { ok: false, error: "저장할 내용이 너무 커요." };
  const r = await dialog.showSaveDialog({ title: "저장", defaultPath: path.join(app.getPath("documents"), safeFileName(name, kind)), filters: [{ name: kind === "csv" ? "CSV (엑셀)" : "텍스트", extensions: [kind] }] });
  if (r.canceled || !r.filePath) return null;
  try { fs.writeFileSync(r.filePath, kind === "csv" && !body.startsWith("﻿") ? "﻿" + body : body, "utf8"); return { ok: true, path: r.filePath }; }
  catch (err) { return { ok: false, error: "저장하지 못했어요: " + err.message }; }
});

// 직접 고친 값(납기 변경, 사유, 원인 지정, 안내 기록, 안내문 선택 …) 저장. 이 컴퓨터의 앱 데이터 폴더에 JSON으로 둔다 (암호화하지 않음).
// 파일을 다루는 일(읽기, 백업, 예전 형식 이전, 손상 파일 보관, 임시 파일 후 교체)은 모두 src/store가 한다.
// 여기서는 화면(IPC)과 저장소를 잇기만 한다. 저장 방식을 바꿀 때는 createStore의 mode만 바꾼다 (docs/DATA_MODEL.md).
let store = null;
const getStore = () => store || (store = createStore({ mode: "local", dir: app.getPath("userData") }));

ipcMain.handle("state-load", async () => (await getStore().load()).view);
ipcMain.handle("state-info", async () => { await getStore().load(); return getStore().info(); });   // 알림(이전·손상·읽기 전용)을 화면에 알리려고
ipcMain.handle("state-save", (e, data) => getStore().save(data));
ipcMain.handle("state-clear", () => getStore().clear());

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
