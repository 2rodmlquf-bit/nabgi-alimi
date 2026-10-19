const { contextBridge, ipcRenderer } = require("electron");

// 화면(렌더러)에는 꼭 필요한 기능만 열어 준다. API 키를 읽어 오는 기능은 일부러 없다.
contextBridge.exposeInMainWorld("app", {
  openCsv: () => ipcRenderer.invoke("open-csv"),
  loadSample: () => ipcRenderer.invoke("load-sample"),
  keyStatus: () => ipcRenderer.invoke("key-status"),
  saveKey: key => ipcRenderer.invoke("key-save", key),
  clearKey: () => ipcRenderer.invoke("key-clear"),
  mapColumns: data => ipcRenderer.invoke("map-columns", data),
  extractEmail: data => ipcRenderer.invoke("extract-email", data),
  saveFile: data => ipcRenderer.invoke("save-file", data),
  pickSupplierFile: () => ipcRenderer.invoke("pick-supplier-file"),
  openMailAttachment: data => ipcRenderer.invoke("open-mail-attachment", data),
  loadSampleSupplier: which => ipcRenderer.invoke("load-sample-supplier", which),
  pickMailFolder: () => ipcRenderer.invoke("pick-mail-folder"),
  loadSampleMails: () => ipcRenderer.invoke("load-sample-mails"),
  loadState: () => ipcRenderer.invoke("state-load"),
  saveState: data => ipcRenderer.invoke("state-save", data),
  clearState: () => ipcRenderer.invoke("state-clear"),
});
