const CONFIG = window.CONFIG_DATA;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let TPW = '';
let currentTab = 'upload';
let currentClass = CONFIG.classes[0];
let progressTimer = null;

// ===== 공통 =====
function run(fn, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function loadingHtml(msg) {
  return `<div class="card" style="text-align:center; padding:40px;"><span class="spinner"></span> ${msg || '불러오는 중...'}</div>`;
}
function errHtml(e) { return `<div class="alert alert-error">오류: ${esc(e && e.message ? e.message : e)}</div>`; }
function sectionOrder(s) { const i = CONFIG.sections.indexOf(s); return i === -1 ? 99 : i; }

// ===== 로그인 =====
document.getElementById('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
function doLogin() {
  const pw = document.getElementById('pwInput').value;
  run('teacherLogin', pw).then(res => {
    if (!res.success) {
      const el = document.getElementById('loginError');
      el.textContent = '비밀번호가 올바르지 않습니다'; el.style.display = 'block';
      return;
    }
    TPW = pw;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    buildClassBar();
    switchTab('upload');
  }).catch(e => alert('오류: ' + e.message));
}
function logout() {
  TPW = '';
  clearInterval(progressTimer);
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('printArea').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('pwInput').value = '';
}

function buildClassBar() {
  const bar = document.getElementById('classFilterBar');
  bar.innerHTML = CONFIG.classes.map(c => `<button class="class-tab ${c === currentClass ? 'active' : ''}" data-cls="${c}">${c}</button>`).join('');
  bar.querySelectorAll('.class-tab').forEach(b => b.addEventListener('click', () => {
    currentClass = b.dataset.cls;
    bar.querySelectorAll('.class-tab').forEach(x => x.classList.toggle('active', x === b));
    renderTab();
  }));
}

function switchTab(tab) {
  currentTab = tab;
  clearInterval(progressTimer);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('classFilterBar').style.display = ['papers', 'progress', 'feedback', 'print'].indexOf(tab) !== -1 ? 'flex' : 'none';
  const pa = document.getElementById('printArea');
  if (tab !== 'print') { pa.style.display = 'none'; pa.innerHTML = ''; }
  renderTab();
}

function renderTab() {
  const c = document.getElementById('tabContent');
  if (currentTab === 'upload') renderUploadTab(c);
  else if (currentTab === 'papers') renderPapersTab(c);
  else if (currentTab === 'progress') renderProgressTab(c);
  else if (currentTab === 'feedback') renderFeedbackTab(c);
  else if (currentTab === 'print') renderPrintTab(c);
  else if (currentTab === 'qr') renderQrTab(c);
}

// ============================================================
// ① 업로드·마스킹
// ============================================================
const up = {
  cls: CONFIG.classes[0], pps: CONFIG.pagesPerStudent,
  pdf: null, fileName: '', numPages: 0,
  roster: [], assign: [], needPages: 0,
  template: [], extra: {}, thumbK: 0, thumbToken: 0,
  existing: 0, reviewCount: 0, saving: false,
  saved: {}, addMode: false,
};

function renderUploadTab(c) {
  c.innerHTML = `
    <div class="alert alert-info">
      <strong>순서</strong> 반·쪽수 선택 → 반별 합본 PDF 선택(늦게 낸 학생은 그 학생 PDF만 → "추가 저장") → 제출자 확인 → 이름 칸 네모 그리기(한 번) → 학생별 썸네일 확인 → 저장<br>
      저장할 때 검은 박스가 이미지에 직접 칠해져서, 학생에게는 가려진 이미지만 전달돼요. 원본 PDF는 Drive에 올라가지 않아요.
    </div>

    <div class="card">
      <h3>1. 반과 PDF 선택</h3>
      <div class="row-flex">
        <div style="width:140px;">
          <label class="label">대상 반</label>
          <select id="upClass">${CONFIG.classes.map(x => `<option ${x === up.cls ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>
        <div style="width:140px;">
          <label class="label">학생당 쪽수</label>
          <input type="number" id="upPps" min="1" max="12" value="${up.pps}">
        </div>
        <div class="upload-zone" id="upZone" onclick="document.getElementById('upFile').click()">
          <strong>📄 반별 합본 PDF 클릭 또는 드래그</strong>
          <div class="muted" style="margin-top:4px;">학번 순서대로 합쳐진 PDF</div>
        </div>
        <input type="file" id="upFile" accept="application/pdf" style="display:none;">
      </div>
      <div class="row-flex" style="margin-top:12px; align-items:center;">
        <span class="muted">또는 드라이브 PDF</span>
        <input type="text" id="upDrive" placeholder="드라이브 링크 또는 파일 ID 붙여넣기" style="flex:1; min-width:240px;">
        <button class="btn-secondary" onclick="loadFromDrive()">드라이브에서 불러오기</button>
      </div>
      <div id="upInfo" style="margin-top:12px; font-size:13px;"></div>
    </div>

    <div class="card" id="upStep2" style="display:none;">
      <h3>2. 제출자와 쪽 범위 확인</h3>
      <p class="muted" style="margin-bottom:10px;">초안을 안 낸 학생은 체크를 풀고, 쪽수가 다른 학생은 숫자를 바꿔 주세요. 쪽 범위가 자동으로 다시 계산돼요.</p>
      <div id="upSummary"></div>
      <div id="rosterTable" style="max-height:420px; overflow:auto;"></div>
    </div>

    <div class="card" id="upStep3" style="display:none;">
      <h3>3. 이름 칸 가리기 (모든 학생 공통)</h3>
      <p class="muted" style="margin-bottom:12px;">한 학생의 초안 위에 이름·학번 칸을 드래그로 덮으면, 모든 학생의 같은 쪽 같은 위치에 똑같이 적용돼요.</p>
      <button class="btn-primary" onclick="openEditor('template', 0)">공통 마스킹 설정하기</button>
      <span id="tplInfo" class="muted" style="margin-left:12px;"></span>
    </div>

    <div class="card" id="upStep4" style="display:none;">
      <h3>4. 학생별 확인</h3>
      <p class="muted" style="margin-bottom:10px;">이름을 칸 밖에 쓰거나 본문에 쓴 학생은 썸네일을 눌러 박스를 더 그려 주세요. (빨간 표시 = 개별 박스 있음)</p>
      <div class="row-flex" style="margin-bottom:12px; align-items:center;">
        <span class="muted">썸네일 쪽:</span>
        <span id="thumbPageBtns" style="display:flex; gap:6px;"></span>
      </div>
      <div id="thumbGrid" class="thumb-grid"></div>
    </div>

    <div class="card" id="upStep5" style="display:none;">
      <h3>5. 저장</h3>
      <div id="saveWarn"></div>
      <button class="btn-primary" id="saveBtn" onclick="doSave()">마스킹 적용해서 저장하기</button>
      <div class="pbar"><div id="saveBar"></div></div>
      <div id="saveLog" style="font-size:13px;"></div>
    </div>`;

  document.getElementById('upClass').addEventListener('change', e => {
    up.cls = e.target.value;
    if (up.pdf) loadRoster();
  });
  document.getElementById('upPps').addEventListener('change', e => {
    up.pps = Math.max(1, parseInt(e.target.value, 10) || CONFIG.pagesPerStudent);
    up.roster.forEach(s => { s.pages = up.pps; });
    resizeTemplate();
    if (up.pdf) { computeAssign(); renderRoster(); renderThumbPageBtns(); renderThumbs(); }
  });
  const file = document.getElementById('upFile');
  const zone = document.getElementById('upZone');
  file.addEventListener('change', () => { if (file.files[0]) loadPdfFile(file.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#1c1917'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = '#d6d3d1'; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = '#d6d3d1';
    if (e.dataTransfer.files[0]) loadPdfFile(e.dataTransfer.files[0]);
  });

  if (up.pdf) { showUploadSteps(); renderUploadInfo(); renderRoster(); renderThumbPageBtns(); renderThumbs(); updateTplInfo(); }
}

function resizeTemplate() {
  const maxPages = Math.max(up.pps, ...up.roster.map(s => s.pages || 0), 1);
  while (up.template.length < maxPages) up.template.push([]);
}

async function loadPdfFile(f) {
  if (!/pdf/i.test(f.type) && !/\.pdf$/i.test(f.name)) { document.getElementById('upInfo').innerHTML = '<span style="color:#dc2626;">PDF 파일만 올릴 수 있어요</span>'; return; }
  document.getElementById('upInfo').innerHTML = `<span class="spinner"></span> ${esc(f.name)} 읽는 중...`;
  const buf = await f.arrayBuffer();
  await openPdfBytes(new Uint8Array(buf), f.name);
}

async function loadFromDrive() {
  const input = document.getElementById('upDrive').value.trim();
  const info = document.getElementById('upInfo');
  if (!input) { info.innerHTML = '<span style="color:#dc2626;">드라이브 링크를 붙여넣어 주세요</span>'; return; }
  try {
    info.innerHTML = '<span class="spinner"></span> 드라이브 파일 확인 중...';
    const meta = await run('getDrivePdfInfo', TPW, input);
    if (!/pdf/i.test(meta.mime)) { info.innerHTML = '<span style="color:#dc2626;">PDF 파일이 아니에요</span>'; return; }
    const CHUNK = 8 * 1024 * 1024;
    const bytes = new Uint8Array(meta.size);
    for (let start = 0; start < meta.size; start += CHUNK) {
      const end = Math.min(meta.size, start + CHUNK) - 1;
      info.innerHTML = `<span class="spinner"></span> ${esc(meta.name)} 내려받는 중... ${Math.round(start / meta.size * 100)}%`;
      const b64 = await run('getDrivePdfChunk', TPW, meta.id, start, end);
      const raw = atob(b64);
      for (let i = 0; i < raw.length; i++) bytes[start + i] = raw.charCodeAt(i);
    }
    info.innerHTML = `<span class="spinner"></span> ${esc(meta.name)} 여는 중...`;
    await openPdfBytes(bytes, meta.name);
  } catch (e) { info.innerHTML = errHtml(e); }
}

async function openPdfBytes(bytes, name) {
  try {
    up.pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    up.fileName = name;
    up.numPages = up.pdf.numPages;
    up.template = []; up.extra = {}; up.thumbK = 0;
    await loadRoster();
  } catch (e) {
    up.pdf = null;
    document.getElementById('upInfo').innerHTML = `<span style="color:#dc2626;">PDF를 읽지 못했어요: ${esc(e.message)}</span>`;
  }
}

async function loadRoster() {
  try {
    const res = await run('prepareUpload', TPW, up.cls);
    up.existing = res.existing; up.reviewCount = res.reviewCount;
    up.saved = {}; (res.saved || []).forEach(p => { up.saved[p.num] = p.anonId; });
    up.roster = res.roster.map(s => ({ num: s.num, name: s.name, submitted: true, pages: up.pps }));
    // 이미 저장된 반에 몇 명분짜리 짧은 PDF를 올리면 '추가 저장'으로 시작
    up.addMode = up.existing > 0 && up.numPages <= up.pps * 3;
    applyAddMode();
    up.extra = {};
    resizeTemplate();
    computeAssign();
    showUploadSteps(); renderUploadInfo(); renderRoster(); renderThumbPageBtns(); renderThumbs(); updateTplInfo();
  } catch (e) { document.getElementById('upInfo').innerHTML = errHtml(e); }
}

function showUploadSteps() { ['upStep2', 'upStep3', 'upStep4', 'upStep5'].forEach(id => document.getElementById(id).style.display = 'block'); }

function renderUploadInfo() {
  document.getElementById('upInfo').innerHTML =
    `📄 <strong>${esc(up.fileName)}</strong> · 전체 <strong>${up.numPages}쪽</strong> · ${up.cls} 명단 ${up.roster.length}명`;
  const w = document.getElementById('saveWarn');
  const modeBox = up.existing > 0 ? `
    <label style="display:flex; gap:8px; align-items:flex-start; margin-bottom:10px; cursor:pointer;">
      <input type="checkbox" ${up.addMode ? 'checked' : ''} onchange="setAddMode(this.checked)" style="width:auto; margin-top:3px;">
      <span><strong>추가 저장 (늦게 낸 학생만 더하기)</strong><br>
      <span class="muted">이미 저장된 ${up.existing}명은 그대로 두고, 체크한 학생만 새로 더해요. 이미 저장된 학생은 자동으로 체크가 풀려요. PDF에는 추가할 학생 초안만 넣으면 돼요.</span></span>
    </label>` : '';
  w.innerHTML = modeBox + (up.existing > 0
    ? (up.addMode
      ? `<div class="alert alert-info">추가 저장: 기존 평가지 ${up.existing}개와 이미 제출된 평가 ${up.reviewCount}건은 그대로 남아요.</div>`
      : `<div class="alert alert-warn">${up.cls}에 이미 저장된 평가지 ${up.existing}개가 있어요. 저장하면 평가지 이미지가 새로 바뀌어요. (이미 제출된 평가 ${up.reviewCount}건은 그대로 남아요.)</div>`)
    : '');
}

function applyAddMode() {
  up.roster.forEach(s => { s.submitted = up.addMode ? !(s.num in up.saved) : true; s.manualStart = undefined; });
}
function setAddMode(v) {
  up.addMode = v; applyAddMode(); computeAssign();
  renderUploadInfo(); renderRoster(); renderThumbs();
}

function computeAssign() {
  up.assign = [];
  const taken = new Set();
  up.roster.forEach(s => {
    if (s.submitted && s.manualStart) for (let k = 0; k < s.pages; k++) taken.add(s.manualStart + k);
  });
  const fits = (st, n) => { for (let k = 0; k < n; k++) if (taken.has(st + k)) return false; return true; };
  let p = 1;
  up.overlap = false;
  const used = new Set();
  up.roster.forEach(s => {
    if (!s.submitted) return;
    let st;
    if (s.manualStart) st = s.manualStart;
    else { while (!fits(p, s.pages)) p++; st = p; p += s.pages; }
    for (let k = 0; k < s.pages; k++) { if (used.has(st + k)) up.overlap = true; used.add(st + k); }
    up.assign.push({ num: s.num, name: s.name, startPage: st, pages: s.pages, manual: !!s.manualStart });
  });
  up.assign.sort((a, b) => a.startPage - b.startPage);
  up.needPages = up.assign.reduce((sum, a) => sum + a.pages, 0);
  up.maxPage = up.assign.reduce((m, a) => Math.max(m, a.startPage + a.pages - 1), 0);
  resizeTemplate();
}

function renderRoster() {
  const diff = up.numPages - up.needPages;
  let status;
  if (up.overlap) status = `<div class="alert alert-error">직접 지정한 시작 쪽이 다른 학생 범위와 겹쳐요. 시작 쪽을 다시 확인하세요.</div>`;
  else if (up.maxPage > up.numPages) status = `<div class="alert alert-error">PDF 범위(${up.numPages}쪽)를 넘는 학생이 있어요. 빨간 줄을 확인하세요.</div>`;
  else if (diff === 0) status = `<div class="alert alert-success">PDF ${up.numPages}쪽 = 필요한 쪽 ${up.needPages}쪽, 딱 맞아요.</div>`;
  else if (diff < 0) status = `<div class="alert alert-error">PDF가 ${-diff}쪽 모자라요. (PDF ${up.numPages}쪽 / 필요 ${up.needPages}쪽) 안 낸 학생 체크를 풀거나 쪽수를 확인하세요.</div>`;
  else status = `<div class="alert alert-warn">PDF가 ${diff}쪽 남아요. (PDF ${up.numPages}쪽 / 필요 ${up.needPages}쪽) 쓰지 않는 쪽이 있어요.</div>`;
  document.getElementById('upSummary').innerHTML = status + `<p class="muted" style="margin-bottom:8px;">제출 ${up.assign.length}명 / 명단 ${up.roster.length}명 · 순서가 다른 학생은 "시작 쪽"에 숫자를 넣으면 그 자리에 고정돼요 (비우면 자동)</p>`;

  const startOf = {};
  up.assign.forEach(a => { startOf[a.num] = a; });
  document.getElementById('rosterTable').innerHTML = `
    <table class="tbl">
      <thead><tr><th>제출</th><th>학번</th><th>이름</th><th>쪽수</th><th>시작 쪽</th><th>PDF 쪽 범위</th></tr></thead>
      <tbody>
        ${up.roster.map((s, i) => {
          const a = startOf[s.num];
          const range = a ? `${a.startPage} ~ ${a.startPage + a.pages - 1}` : '-';
          const over = a && a.startPage + a.pages - 1 > up.numPages;
          return `<tr class="${s.submitted ? '' : 'off'}">
            <td><input type="checkbox" ${s.submitted ? 'checked' : ''} onchange="toggleSubmitted(${i}, this.checked)"></td>
            <td><strong>${s.num}</strong></td><td>${esc(s.name)}</td>
            <td><input type="number" min="1" max="12" value="${s.pages}" onchange="setStudentPages(${i}, this.value)" ${s.submitted ? '' : 'disabled'}></td>
            <td><input type="number" min="1" placeholder="자동" value="${s.manualStart || ''}" onchange="setStudentStart(${i}, this.value)" ${s.submitted ? '' : 'disabled'}></td>
            <td style="${over ? 'color:#dc2626; font-weight:700;' : ''}">${range}${a && a.manual ? ' <span class="tag" style="background:#e0e7ff; color:#3730a3;">고정</span>' : ''}${over ? ' (PDF 범위 밖)' : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function toggleSubmitted(i, v) { up.roster[i].submitted = v; computeAssign(); renderRoster(); renderThumbs(); }
function setStudentPages(i, v) { up.roster[i].pages = Math.max(1, parseInt(v, 10) || up.pps); computeAssign(); renderRoster(); renderThumbPageBtns(); renderThumbs(); }
function setStudentStart(i, v) { const n = parseInt(v, 10); up.roster[i].manualStart = n > 0 ? n : null; computeAssign(); renderRoster(); renderThumbs(); }

function renderThumbPageBtns() {
  const n = Math.max(...up.template.map((_, k) => k + 1), up.pps);
  if (up.thumbK >= n) up.thumbK = 0;
  document.getElementById('thumbPageBtns').innerHTML = Array.from({ length: n }, (_, k) =>
    `<button class="btn-secondary ${k === up.thumbK ? 'on' : ''}" onclick="setThumbK(${k})">${k + 1}쪽</button>`).join('');
}
function setThumbK(k) { up.thumbK = k; renderThumbPageBtns(); renderThumbs(); }

function getExtra(num) {
  if (!up.extra[num]) up.extra[num] = [];
  return up.extra[num];
}
function extraFor(num, k) {
  const ex = getExtra(num);
  while (ex.length <= k) ex.push([]);
  return ex[k];
}
function hasExtra(num) { return (up.extra[num] || []).some(arr => arr && arr.length); }
function masksFor(i, k) {
  const a = up.assign[i];
  return (up.template[k] || []).concat((up.extra[a.num] || [])[k] || []);
}

async function renderPage(pageNo, width, masks) {
  const page = await up.pdf.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / v1.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.fillStyle = '#000';
  (masks || []).forEach(r => ctx.fillRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height));
  return c;
}

async function renderThumbs() {
  const grid = document.getElementById('thumbGrid');
  if (!grid || !up.pdf) return;
  const tok = ++up.thumbToken;
  const k = up.thumbK;
  grid.innerHTML = up.assign.map((a, i) => `
    <div class="thumb" onclick="openEditor('student', ${i})">
      <div class="tlabel"><strong>${a.num} ${esc(a.name)}</strong><span id="tg-${i}">${hasExtra(a.num) ? '<span class="tag">개별</span>' : ''} p.${a.startPage + k}</span></div>
      <div class="tcanvas" id="tc-${i}">…</div>
    </div>`).join('');
  for (let i = 0; i < up.assign.length; i++) {
    if (tok !== up.thumbToken) return;
    await renderOneThumb(i, tok);
  }
}

async function renderOneThumb(i, tok) {
  const a = up.assign[i];
  const k = up.thumbK;
  const box = document.getElementById('tc-' + i);
  if (!box) return;
  const tg = document.getElementById('tg-' + i);
  if (tg) tg.innerHTML = `${hasExtra(a.num) ? '<span class="tag">개별</span>' : ''} p.${a.startPage + k}`;
  const pageNo = a.startPage + k;
  if (k >= a.pages || pageNo > up.numPages) { box.textContent = '해당 쪽 없음'; return; }
  try {
    const c = await renderPage(pageNo, 260, masksFor(i, k));
    if (tok !== undefined && tok !== up.thumbToken) return;
    box.innerHTML = ''; box.appendChild(c);
  } catch (e) { box.textContent = '미리보기 실패'; }
}

function updateTplInfo() {
  const el = document.getElementById('tplInfo');
  if (!el) return;
  const parts = up.template.map((arr, k) => arr.length ? `${k + 1}쪽 ${arr.length}개` : '').filter(Boolean);
  el.textContent = parts.length ? '공통 박스: ' + parts.join(', ') : '아직 공통 박스가 없어요';
}

// ----- 마스킹 편집기 -----
const ed = { mode: 'template', idx: 0, k: 0, base: null, start: null, drag: null };

async function openEditor(mode, idx) {
  if (!up.assign.length) { alert('제출한 학생이 없어요'); return; }
  ed.mode = mode; ed.idx = Math.min(idx, up.assign.length - 1); ed.k = mode === 'student' ? up.thumbK : 0;
  document.getElementById('editor').style.display = 'flex';
  document.getElementById('edTitle').textContent = mode === 'template' ? '공통 마스킹' : `${up.assign[ed.idx].num} ${up.assign[ed.idx].name} 개별 마스킹`;
  document.getElementById('edSampleWrap').innerHTML = mode === 'template'
    ? `<select id="edSample" style="width:auto; padding:5px 8px; font-size:13px;" onchange="ed.idx=Number(this.value); edLoadPage();">
        ${up.assign.map((a, i) => `<option value="${i}" ${i === ed.idx ? 'selected' : ''}>견본: ${a.num} ${esc(a.name)}</option>`).join('')}
       </select>` : '';
  document.getElementById('edHint').innerHTML = mode === 'template'
    ? '드래그해서 이름·학번 칸을 덮으세요. 여기서 그린 박스는 <strong>모든 학생의 같은 쪽</strong>에 적용돼요. 다른 학생을 견본으로 골라서 위치가 맞는지 확인할 수 있어요.'
    : '이 학생에게만 필요한 박스를 그리세요. <span style="color:#dc2626;">빨간 테두리</span>가 개별 박스, 테두리 없는 검은 박스는 공통 박스예요.';
  await edLoadPage();
}

function edPageCount() { return ed.mode === 'template' ? Math.max(up.pps, up.template.length) : up.assign[ed.idx].pages; }

async function edLoadPage() {
  const a = up.assign[ed.idx];
  const n = edPageCount();
  if (ed.k >= n) ed.k = 0;
  document.getElementById('edPages').innerHTML = Array.from({ length: n }, (_, k) =>
    `<button class="btn-secondary ${k === ed.k ? 'on' : ''}" onclick="ed.k=${k}; edLoadPage();">${k + 1}쪽</button>`).join('');
  const cv = document.getElementById('edCanvas');
  const pageNo = a.startPage + ed.k;
  if (ed.k >= a.pages || pageNo > up.numPages) {
    cv.width = 800; cv.height = 200;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 200);
    ctx.fillStyle = '#78716c'; ctx.font = '20px sans-serif'; ctx.fillText('이 학생은 해당 쪽이 없어요. 다른 견본을 고르세요.', 40, 100);
    ed.base = null; return;
  }
  ed.base = await renderPage(pageNo, 1000, []);
  cv.width = ed.base.width; cv.height = ed.base.height;
  edDraw();
}

function edList() {
  if (ed.mode === 'template') { while (up.template.length <= ed.k) up.template.push([]); return up.template[ed.k]; }
  return extraFor(up.assign[ed.idx].num, ed.k);
}

function edDraw() {
  if (!ed.base) return;
  const cv = document.getElementById('edCanvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.drawImage(ed.base, 0, 0);
  ctx.fillStyle = '#000';
  (up.template[ed.k] || []).forEach(r => ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H));
  if (ed.mode === 'student') {
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3;
    edList().forEach(r => { ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H); ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H); });
  }
  if (ed.drag) {
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
    ctx.strokeRect(ed.drag.x * W, ed.drag.y * H, ed.drag.w * W, ed.drag.h * H);
    ctx.setLineDash([]);
  }
}

function edPos(e) {
  const r = document.getElementById('edCanvas').getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}
(function initEditorEvents() {
  const cv = document.getElementById('edCanvas');
  cv.addEventListener('pointerdown', e => {
    if (!ed.base) return;
    ed.start = edPos(e); ed.drag = { x: ed.start.x, y: ed.start.y, w: 0, h: 0 };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!ed.start) return;
    const p = edPos(e);
    ed.drag = { x: Math.min(p.x, ed.start.x), y: Math.min(p.y, ed.start.y), w: Math.abs(p.x - ed.start.x), h: Math.abs(p.y - ed.start.y) };
    edDraw();
  });
  const end = () => {
    if (!ed.start) return;
    if (ed.drag && ed.drag.w > 0.008 && ed.drag.h > 0.004) edList().push(ed.drag);
    ed.start = null; ed.drag = null;
    edDraw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
})();

function edUndo() { const l = edList(); l.pop(); edDraw(); }
function edClear() { const l = edList(); if (l.length && confirm('이 쪽의 박스를 모두 지울까요?')) { l.length = 0; edDraw(); } }
function closeEditor() {
  document.getElementById('editor').style.display = 'none';
  if (ed.mode === 'template') { updateTplInfo(); renderThumbPageBtns(); renderThumbs(); }
  else renderOneThumb(ed.idx);
}

// ----- 저장 -----
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

async function doSave() {
  if (up.saving || !up.pdf) return;
  if (!up.assign.length) { alert('제출한 학생이 없어요'); return; }
  if ((up.overlap || up.maxPage > up.numPages) && !confirm('쪽 범위에 문제가 있어요. 겹치거나 범위 밖인 학생은 잘못 저장될 수 있어요. 그래도 저장할까요?')) return;
  if (!up.template.some(a => a.length) && !confirm('공통 마스킹 박스가 없어요. 이름이 그대로 보일 수 있어요. 그래도 저장할까요?')) return;
  if (!confirm(up.addMode
    ? `${up.cls}에 ${up.assign.map(a => a.name).join(', ')} 평가지를 추가할까요? (기존 ${up.existing}개는 그대로)`
    : `${up.cls} ${up.assign.length}명의 평가지를 저장할까요?`)) return;

  up.saving = true;
  const btn = document.getElementById('saveBtn');
  const bar = document.getElementById('saveBar');
  const log = document.getElementById('saveLog');
  btn.disabled = true;
  try {
    const letter = up.cls.replace('반', '');
    let startNo = 1;
    if (up.addMode) {
      // 기존 익명번호 다음 번호부터 이어서 붙임
      startNo = Object.values(up.saved).reduce((m, id) => Math.max(m, parseInt(String(id).split('-')[1], 10) || 0), 0) + 1;
    } else {
      log.innerHTML = '<span class="spinner"></span> 기존 평가지 정리 중...';
      await run('resetClassPapers', TPW, up.cls);
    }
    const order = shuffle(up.assign.map((_, i) => i));
    const anon = {};
    order.forEach((i, n) => { anon[i] = `${letter}-${String(startNo + n).padStart(2, '0')}`; });

    for (let i = 0; i < up.assign.length; i++) {
      const a = up.assign[i];
      log.innerHTML = `<span class="spinner"></span> ${i + 1} / ${up.assign.length} · ${a.num} ${esc(a.name)} 변환·저장 중...`;
      const imgs = [];
      for (let k = 0; k < a.pages; k++) {
        const pg = a.startPage + k;
        if (pg > up.numPages) break;
        const c = await renderPage(pg, 1240, masksFor(i, k));
        imgs.push(c.toDataURL('image/jpeg', 0.75).split(',')[1]);
      }
      if (imgs.length) await run('saveStudentPaper', TPW, up.cls, a.num, a.name, anon[i], imgs);
      bar.style.width = ((i + 1) / up.assign.length * 100) + '%';
    }
    log.innerHTML = `<div class="alert alert-success">${up.cls} ${up.assign.length}명 ${up.addMode ? '추가 ' : ''}저장 완료! "② 평가지 확인" 탭에서 학생에게 보이는 화면을 확인할 수 있어요.</div>`;
    if (up.addMode) { up.assign.forEach((a, i) => { up.saved[a.num] = anon[i]; }); up.existing = Object.keys(up.saved).length; applyAddMode(); computeAssign(); renderRoster(); renderThumbs(); }
    else { up.existing = up.assign.length; up.saved = {}; up.assign.forEach((a, i) => { up.saved[a.num] = anon[i]; }); }
    renderUploadInfo();
  } catch (e) {
    log.innerHTML = errHtml(e) + '<div class="muted">중간에 멈췄다면 다시 저장을 누르면 처음부터 새로 저장돼요.</div>';
  } finally {
    up.saving = false; btn.disabled = false;
  }
}

// ============================================================
// ② 평가지 확인
// ============================================================
function renderPapersTab(c) {
  c.innerHTML = loadingHtml();
  run('getPapersT', TPW, currentClass).then(list => {
    if (!list.length) { c.innerHTML = `<div class="card"><p class="muted">${currentClass}에 저장된 평가지가 없어요. ① 탭에서 올려 주세요.</p></div>`; return; }
    c.innerHTML = `
      <div class="card">
        <h3>${currentClass} 평가지 ${list.length}개</h3>
        <p class="muted" style="margin-bottom:10px;">"보기"는 학생 화면에 보이는 그대로예요. 문제가 있는 글은 비활성으로 바꾸면 배정되지 않아요.</p>
        <table class="tbl">
          <thead><tr><th>학번</th><th>이름</th><th>익명ID</th><th>쪽수</th><th>상태</th><th></th></tr></thead>
          <tbody>${list.map(p => `
            <tr class="${p.active ? '' : 'off'}">
              <td><strong>${p.num}</strong></td><td>${esc(p.name)}</td><td>${esc(p.anonId)}</td><td>${p.pages}</td>
              <td><select style="width:auto; padding:4px 8px;" onchange="setActive(${p.row}, this.value==='1', this)">
                <option value="1" ${p.active ? 'selected' : ''}>활성</option><option value="0" ${!p.active ? 'selected' : ''}>비활성</option></select></td>
              <td><button class="btn-secondary" onclick="viewPaper(${p.row}, '${esc(p.anonId)}')">보기</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }).catch(e => { c.innerHTML = errHtml(e); });
}
function setActive(row, v, el) {
  run('setPaperActive', TPW, row, v).then(() => { el.closest('tr').classList.toggle('off', !v); }).catch(e => alert(e.message));
}
function viewPaper(row, anonId) {
  const m = document.getElementById('viewModal');
  const box = document.getElementById('viewContent');
  m.style.display = 'flex';
  box.innerHTML = `<div style="padding:30px; text-align:center;"><span class="spinner"></span> 불러오는 중...</div>`;
  run('getPaperImagesByRow', TPW, row).then(res => {
    box.innerHTML = `<div style="padding:4px 0 10px; font-weight:700;">익명 ${esc(anonId)}</div>` +
      res.images.map(b => `<img src="data:image/jpeg;base64,${b}">`).join('');
  }).catch(e => { box.innerHTML = errHtml(e); });
}
function closeView() { document.getElementById('viewModal').style.display = 'none'; }

// ============================================================
// ③ 진행 현황
// ============================================================
function renderProgressTab(c) {
  c.innerHTML = loadingHtml();
  const load = () => run('getProgressT', TPW, currentClass).then(d => {
    if (currentTab !== 'progress') return;
    const counts = d.papers.map(p => p.received);
    const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    const zero = counts.filter(x => x === 0).length;
    const maxC = Math.max(CONFIG.targetReviews, ...counts, 1);
    const started = d.reviewers.filter(r => r.count > 0).length;
    const auto = document.getElementById('autoRefresh');
    const autoOn = auto ? auto.checked : true;
    c.innerHTML = `
      <div class="row-flex" style="justify-content:space-between; margin-bottom:12px; align-items:center;">
        <span class="muted">마지막 갱신 ${new Date().toLocaleTimeString('ko-KR')}</span>
        <span><label class="muted"><input type="checkbox" id="autoRefresh" ${autoOn ? 'checked' : ''}> 30초마다 자동 새로고침</label>
        <button class="btn-secondary" style="margin-left:8px;" onclick="renderTab()">새로고침</button></span>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="small">제출된 평가</div><div class="value">${d.total}<span class="unit">건</span></div></div>
        <div class="stat-card"><div class="small">글당 평균 받은 수</div><div class="value">${avg.toFixed(1)}<span class="unit">건</span></div></div>
        <div class="stat-card"><div class="small">아직 0건인 글</div><div class="value" style="${zero ? 'color:#dc2626' : ''}">${zero}<span class="unit">편</span></div></div>
        <div class="stat-card"><div class="small">평가 시작한 학생</div><div class="value">${started}<span class="unit">/ ${d.reviewers.length}명</span></div></div>
      </div>
      <div class="card">
        <h3>글별 받은 피드백</h3>
        ${d.papers.map(p => `
          <div class="bar-row">
            <div class="name">${p.num} ${esc(p.name)}</div>
            <div class="bar"><div class="fill ${p.received >= CONFIG.targetReviews ? 'good' : p.received === 0 ? 'zero' : ''}" style="width:${p.received / maxC * 100}%"></div></div>
            <div class="count">${p.received}건</div>
          </div>`).join('') || '<p class="muted">평가지가 없어요</p>'}
      </div>
      <div class="card">
        <h3>학생별 작성 수</h3>
        <div class="chip-grid">
          ${d.reviewers.map(r => `<div class="chip ${r.count === 0 ? 'zero' : r.count >= CONFIG.targetReviews ? 'done' : ''}"><span>${r.num} ${esc(r.name)}</span><strong>${r.count}</strong></div>`).join('')}
        </div>
      </div>`;
  }).catch(e => { c.innerHTML = errHtml(e); });
  load();
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    const a = document.getElementById('autoRefresh');
    if (currentTab === 'progress' && a && a.checked) load();
  }, 30000);
}

// ============================================================
// ④ 피드백 검토
// ============================================================
let feedbackCache = [];
function renderFeedbackTab(c) {
  c.innerHTML = loadingHtml();
  run('getFeedbackT', TPW, currentClass).then(list => {
    feedbackCache = list;
    if (!list.length) { c.innerHTML = `<div class="card"><p class="muted">평가지가 없어요</p></div>`; return; }
    c.innerHTML = `
      <div class="alert alert-info">
        숨김을 누른 평가는 출력물에서 빠져요. (체크 결과와 글 모두) 표현만 다듬고 싶으면 스프레드시트 "평가결과" 시트에서 글을 직접 고쳐도 돼요.<br>
        선생님 한마디는 출력물 4번 칸에 들어가요. 비워두면 손으로 쓸 수 있는 빈칸으로 출력돼요.
      </div>
      <div class="card">
        <h3>${currentClass} 피드백 (${list.length}편)</h3>
        ${list.map((p, pi) => `
          <details class="fb">
            <summary>
              <span><strong>${p.num} ${esc(p.name)}</strong> <span class="muted">· 익명 ${esc(p.anonId)} · 받은 피드백 ${p.reviews.length}건${p.reviews.some(r => r.hidden) ? ' · 숨김 ' + p.reviews.filter(r => r.hidden).length : ''}${p.comment ? ' · 코멘트 있음' : ''}</span></span>
              <span class="muted">▼</span>
            </summary>
            ${p.reviews.map(r => reviewHtml(r)).join('') || '<p class="muted" style="margin-top:8px;">아직 받은 피드백이 없어요</p>'}
            <div style="margin-top:12px;">
              <label class="label">선생님 한마디</label>
              <textarea id="cm-${pi}" rows="3">${esc(p.comment)}</textarea>
              <div style="text-align:right; margin-top:6px;"><button class="btn-secondary" onclick="saveComment(${pi}, this)">저장</button></div>
            </div>
          </details>`).join('')}
      </div>`;
  }).catch(e => { c.innerHTML = errHtml(e); });
}

function reviewHtml(r) {
  const L = CONFIG.answerLabels;
  return `
    <div class="rv ${r.hidden ? 'hidden' : ''}" id="rv-${r.row}">
      <div class="rv-head">
        <span><strong>평가자 ${r.reviewerNum} ${esc(r.reviewerName)}</strong> <span class="muted">${esc(r.time)}</span></span>
        <button class="btn-secondary" onclick="toggleHidden(${r.row}, ${!r.hidden}, this)">${r.hidden ? '숨김 해제' : '숨기기'}</button>
      </div>
      <div>${CONFIG.checkItems.map(it => `<span class="ans ${r.answers[it.key]}" title="${esc(it.text)}">${it.code} ${L[r.answers[it.key]] || '-'}</span>`).join('')}</div>
      <div class="rv-text"><b>👍 [${esc(r.goodSection)}]</b> ${esc(r.good)}</div>
      <div class="rv-text"><b>✏️ [${esc(r.fixSection)}]</b> ${esc(r.fix)}</div>
    </div>`;
}

function toggleHidden(row, hidden, btn) {
  btn.disabled = true;
  run('setReviewHidden', TPW, row, hidden).then(() => {
    feedbackCache.forEach(p => p.reviews.forEach(r => { if (r.row === row) r.hidden = hidden; }));
    const el = document.getElementById('rv-' + row);
    const rv = feedbackCache.flatMap(p => p.reviews).find(r => r.row === row);
    if (el && rv) el.outerHTML = reviewHtml(rv);
  }).catch(e => { btn.disabled = false; alert(e.message); });
}

function saveComment(pi, btn) {
  const p = feedbackCache[pi];
  const val = document.getElementById('cm-' + pi).value.trim();
  btn.disabled = true; btn.textContent = '저장 중...';
  run('saveTeacherComment', TPW, currentClass, p.num, p.name, val).then(() => {
    p.comment = val; btn.disabled = false; btn.textContent = '✓ 저장됨';
    setTimeout(() => { btn.textContent = '저장'; }, 1500);
  }).catch(e => { btn.disabled = false; btn.textContent = '저장'; alert(e.message); });
}

// ============================================================
// ⑤ 출력 (학생 1명당 A4 1장)
// ============================================================
let printCache = [];
function renderPrintTab(c) {
  c.innerHTML = loadingHtml('출력 데이터를 불러오는 중...');
  run('getFeedbackT', TPW, currentClass).then(list => {
    printCache = list;
    c.innerHTML = `
      <div class="card">
        <h3>${currentClass} 피드백 출력</h3>
        <p class="muted" style="margin-bottom:12px;">학생 1명당 A4 1장이에요. 내용이 많으면 글자 크기가 자동으로 줄어서 한 장에 맞춰져요. 숨김 처리한 평가는 빠지고, 평가자 이름은 나오지 않아요.</p>
        <div class="row-flex" style="align-items:center;">
          <div style="width:220px;">
            <label class="label">출력 대상</label>
            <select id="prTarget" onchange="buildPrint()">
              <option value="all">전체 (${list.length}명)</option>
              ${list.map((p, i) => `<option value="${i}">${p.num} ${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <label class="muted"><input type="checkbox" id="prSkipZero" onchange="buildPrint()"> 피드백 0건 학생 빼기</label>
          <label class="muted"><input type="checkbox" id="prPlan" checked onchange="buildPrint()"> "나의 수정 계획" 칸 넣기</label>
          <button class="btn-primary" onclick="window.print()">🖨️ 인쇄하기</button>
        </div>
        <p class="muted" style="margin-top:10px;">인쇄 창에서 "배경 그래픽"을 켜면 점검 필요 줄이 색으로 표시돼요. (꺼도 ▲ 표시는 나와요)</p>
      </div>`;
    buildPrint();
  }).catch(e => { c.innerHTML = errHtml(e); });
}

function buildPrint() {
  const area = document.getElementById('printArea');
  const t = document.getElementById('prTarget').value;
  const skipZero = document.getElementById('prSkipZero').checked;
  const plan = document.getElementById('prPlan').checked;
  let list = t === 'all' ? printCache : [printCache[Number(t)]];
  if (skipZero) list = list.filter(p => p.reviews.some(r => !r.hidden));
  area.style.display = 'block';
  area.innerHTML = list.length ? list.map(p => printPageHtml(p, plan)).join('') : '<p class="muted" style="text-align:center;">출력할 학생이 없어요</p>';
  fitPages();
}

function printPageHtml(p, plan) {
  const revs = p.reviews.filter(r => !r.hidden);
  const n = revs.length;
  const L = CONFIG.answerLabels;

  const rows = [];
  let lastSec = '';
  const secCount = {};
  CONFIG.checkItems.forEach(it => { secCount[it.section] = (secCount[it.section] || 0) + 1; });
  CONFIG.checkItems.forEach(it => {
    const cnt = { O: 0, M: 0, X: 0 };
    revs.forEach(r => { if (cnt.hasOwnProperty(r.answers[it.key])) cnt[r.answers[it.key]]++; });
    const need = n > 0 && (cnt.M + cnt.X) > cnt.O;
    const secCell = it.section !== lastSec ? `<td class="sec" rowspan="${secCount[it.section]}">${esc(it.section)}</td>` : '';
    lastSec = it.section;
    rows.push(`<tr class="${need ? 'need' : ''}">${secCell}
      <td>${esc(it.text)} <span style="color:#78716c; font-size:0.85em;">(${esc(it.code)})</span></td>
      <td class="n">${n ? cnt.O : ''}</td><td class="n">${n ? cnt.M : ''}</td><td class="n">${n ? cnt.X : ''}</td>
      <td class="flag">${need ? '▲' : ''}</td></tr>`);
  });

  const sortBySec = (arr, key) => arr.slice().sort((a, b) => sectionOrder(a[key]) - sectionOrder(b[key]));
  const goods = sortBySec(revs, 'goodSection').map(r => `<li><span class="s">[${esc(r.goodSection)}]</span> ${esc(r.good)}</li>`).join('');
  const fixes = sortBySec(revs, 'fixSection').map(r => `<li><span class="s">[${esc(r.fixSection)}]</span> ${esc(r.fix)}</li>`).join('');

  return `
    <div class="pp">
      <div class="pp-top">
        <div>
          <div class="sub">여행지리 · 미래 전문가의 시선으로 읽는 여행지리 딜레마</div>
          <div class="ttl">초안 동료 피드백</div>
        </div>
        <div class="who">${esc(currentClass)} ${p.num} ${esc(p.name)}<span>익명 친구 ${n}명의 피드백</span></div>
      </div>

      <h4>1. 채점 기준 확인 결과</h4>
      <table>
        <thead><tr><th>영역</th><th>확인 항목</th><th>${L.O}</th><th>${L.M}</th><th>${L.X}</th><th>점검</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div style="font-size:0.78em; color:#57534e; margin-top:1mm;">숫자는 그렇게 답한 친구 수예요. ▲는 "애매함+없음"이 "있음"보다 많은 항목이니 먼저 점검해 보세요.</div>

      <h4>2. 친구들이 꼽은 잘된 점</h4>
      ${goods ? `<ul>${goods}</ul>` : '<div class="empty">아직 받은 피드백이 없어요</div>'}

      <h4>3. 고치면 좋을 점</h4>
      ${fixes ? `<ul>${fixes}</ul>` : '<div class="empty">아직 받은 피드백이 없어요</div>'}

      <h4>4. 선생님 한마디</h4>
      <div class="tbox">${esc(p.comment)}</div>

      ${plan ? `
      <h4>5. 나의 수정 계획</h4>
      <table class="plan">
        <tr><td class="k">가장 먼저 고칠 부분</td><td class="v"></td></tr>
        <tr><td class="k">어떻게 고칠까</td><td class="v"></td></tr>
        <tr><td class="k">다시 찾을 자료</td><td class="v"></td></tr>
      </table>` : ''}
      <div class="foot">이 피드백은 다음 차시 초안 수정(과정 참여 및 성찰 D3)에 사용해요.</div>
    </div>`;
}

function fitPages() {
  document.querySelectorAll('#printArea .pp').forEach(pg => {
    let fs = 10.5;
    pg.style.fontSize = fs + 'pt';
    while (pg.scrollHeight > pg.clientHeight + 1 && fs > 6.5) {
      fs -= 0.25;
      pg.style.fontSize = fs + 'pt';
    }
  });
}

// ============================================================
// QR
// ============================================================
function renderQrTab(c) {
  c.innerHTML = loadingHtml('주소를 가져오는 중...');
  Promise.resolve({ success: true, url: new URL('./', location.href).href }).then(res => {
    if (!res.success) { c.innerHTML = `<div class="alert alert-error">${esc(res.message)}</div>`; return; }
    const studentUrl = res.url;
    const teacherUrl = res.url + 'teacher.html';
    c.innerHTML = `
      <div class="card" style="text-align:center;">
        <div class="muted" style="letter-spacing:0.2em; font-size:11px;">FOR STUDENTS</div>
        <h3 style="margin:6px 0 16px; font-size:24px;">여행지리 초안 동료 피드백</h3>
        <div id="qrStudent" style="display:inline-block; padding:16px; background:white; border:1px solid #e7e5e4;"></div>
        <p style="margin-top:14px; font-size:15px;">📱 디벗으로 QR을 찍고 <strong>반 · 학번 · 이름</strong>을 입력하세요</p>
        <div class="muted" style="margin-top:10px; word-break:break-all;">${esc(studentUrl)}</div>
        <button class="btn-secondary" style="margin-top:8px;" onclick="copyText('${esc(studentUrl)}', this)">학생 주소 복사</button>
        <button class="btn-secondary" style="margin-top:8px;" onclick="copyText('${esc(teacherUrl)}', this)">교사 주소 복사</button>
      </div>`;
    new QRCode(document.getElementById('qrStudent'), { text: studentUrl, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.M });
  }).catch(e => { c.innerHTML = errHtml(e); });
}

function copyText(text, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = '✓ 복사됨'; setTimeout(() => { btn.textContent = o; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
  }
}
