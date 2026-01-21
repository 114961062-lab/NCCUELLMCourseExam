import { load, migrateState, mergeLegacyListsIntoCourses, rebuildViews, save } from "./store.js";
import { initAllCourses, initExternalDeptDropdownFromCsv } from "./services.js";
import { renderAll } from "./view.js";
import { bind } from "./ui.js";

(async () => {
  // 1) 讀本機資料 + 遷移
  load();
  migrateState();
  mergeLegacyListsIntoCourses();
  rebuildViews();

  // 2) 載入課程庫/外院系所（需要 await）
  await initAllCourses();
  await initExternalDeptDropdownFromCsv();

  // 3) 首次渲染 + 綁事件
  renderAll();
  bind();

  // 4) 存一次（讓缺漏欄位被補齊）
  save();
})();
