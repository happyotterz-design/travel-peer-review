/**
 * 여행지리 딜레마 초안 동료평가 - Apps Script API (Code.gs)
 * 화면은 GitHub Pages(happyotterz-design/travel-peer-review)에 있고,
 * 이 스크립트는 시트·드라이브 데이터를 처리하는 API 역할만 합니다.
 *
 * 처음 설치할 때
 * 1. 스프레드시트 → 확장 프로그램 → Apps Script → 이 코드를 Code.gs에 붙여넣기
 * 2. setUp 한 번 실행, authorizeDrive 한 번 실행 (권한 허용)
 * 3. "설정" 시트에서 교사비밀번호 바꾸기, "학생명단" 시트 채우기
 * 4. 배포 → 새 배포 → 웹앱
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한: 모든 사용자   (GitHub Pages에서 호출하려면 꼭 이 설정)
 * 5. 웹앱 URL을 저장소의 js/config.js 에 넣기
 *
 * 코드를 고친 뒤에는 배포 → 배포 관리 → 수정 → 버전 "새 버전" → 배포
 */

// ===== 기본 설정 =====
const CLASSES = ['B반', 'D반'];
const PAGES_PER_STUDENT = 4;   // 초안작성지 학생당 쪽수 (업로드 화면에서 학생별로 바꿀 수 있음)
const TARGET_REVIEWS = 3;      // 1인당 목표 평가 수
const MAX_SKIPS = 2;           // 보류 가능 횟수
const MIN_COMMENT = 15;        // 잘된 점·고칠 점 최소 글자 수

const SECTIONS = ['서론', '본론1', '본론2', '본론3', '결론'];

// 채점기준표(v4) 코드에 맞춘 학생용 체크 항목
const CHECK_ITEMS = [
  { key: 'A1a', section: '서론',   code: 'A1',  text: '"○○ 전문가의 시선에서"로 시작하는 탐구 질문이 있다' },
  { key: 'A1b', section: '서론',   code: 'A1',  text: '탐구 질문이 예/아니오로 답할 수 없는 형태다' },
  { key: 'A2',  section: '서론',   code: 'A2',  text: '자료 수치로 딜레마 상황을 설명하고, 나의 주장을 한 문장으로 밝혔다' },
  { key: 'B1',  section: '자료 활용', code: 'B-b', text: '수치나 인용마다 (자료 n · ○문단) 표기가 있다' },
  { key: 'B2',  section: '자료 활용', code: 'B-c', text: '수치만 나열하지 않고, 그 자료가 무엇을 뜻하는지 해석했다' },
  { key: 'C2a', section: '본론2',  code: 'C2',  text: '본론1의 주장을 정확히 겨냥해서 반박했다' },
  { key: 'C2b', section: '본론2',  code: 'C2',  text: '내 주장의 한계를 인정하고 보완 논리를 제시했다' },
  { key: 'C3',  section: '본론3',  code: 'C3',  text: '대안에 누가(실행 주체), 어떻게(방식) 할지가 연결되어 있다' },
  { key: 'A3',  section: '결론',   code: 'A3',  text: '탐구 질문에 대한 최종 답과 전문가로서의 마무리가 있다' },
];
const ANSWER_LABELS = { O: '있음', M: '애매함', X: '없음' };

const SHEET = {
  STUDENTS: '학생명단',
  PAPERS: '평가지',
  REVIEWS: '평가결과',
  COMMENTS: '교사코멘트',
  SETTINGS: '설정',
};

// 평가결과 시트 열 위치 (0부터)
const RV_BASE = 7;
const RV_GOOD_S = RV_BASE + CHECK_ITEMS.length;
const RV_GOOD = RV_GOOD_S + 1;
const RV_FIX_S = RV_GOOD_S + 2;
const RV_FIX = RV_GOOD_S + 3;
const RV_HIDDEN = RV_GOOD_S + 4;

// ===== API 진입점 =====
function doGet() {
  return json_({ ok: true, data: 'travel-peer-review API' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = API_[req.action];
    if (!fn) throw new Error('알 수 없는 요청: ' + req.action);
    return json_({ ok: true, data: fn.apply(null, req.args || []) });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function authStudent_(cls, num, name) {
  if (!studentLogin(cls, num, name).success) throw new Error('학생 정보를 확인할 수 없어요. 다시 로그인해 주세요.');
}

// 화면에서 부를 수 있는 함수 목록 (여기 없는 함수는 호출 불가)
const API_ = {
  getConfig: function () { return getClientConfig_(); },
  // 학생
  studentLogin: studentLogin,
  getMyProgress: function (c, n, nm) { authStudent_(c, n, nm); return getMyProgress(c, n, nm); },
  getNextPaper: function (c, n, nm, skipped, ex) { authStudent_(c, n, nm); return getNextPaper(c, n, nm, skipped, ex); },
  getPaperImagesS: function (c, n, nm, pid) { authStudent_(c, n, nm); return getPaperImages(c, pid); },
  getPaperFilesS: function (c, n, nm, pid) { authStudent_(c, n, nm); return getPaperFiles(c, pid); },
  submitReview: submitReview,
  // 교사 (모두 비밀번호 확인)
  teacherLogin: teacherLogin,
  prepareUpload: prepareUpload,
  resetClassPapers: resetClassPapers,
  saveStudentPaper: saveStudentPaper,
  getPapersT: getPapersT,
  setPaperActive: setPaperActive,
  getPaperImagesByRow: getPaperImagesByRow,
  replacePaperPage: replacePaperPage,
  getProgressT: getProgressT,
  getFeedbackT: getFeedbackT,
  setReviewHidden: setReviewHidden,
  saveTeacherComment: saveTeacherComment,
  getDrivePdfInfo: getDrivePdfInfo,
  getDrivePdfChunk: getDrivePdfChunk,
};

function getClientConfig_() {
  return {
    classes: CLASSES,
    pagesPerStudent: PAGES_PER_STUDENT,
    targetReviews: TARGET_REVIEWS,
    maxSkips: MAX_SKIPS,
    minComment: MIN_COMMENT,
    sections: SECTIONS,
    checkItems: CHECK_ITEMS,
    answerLabels: ANSWER_LABELS,
  };
}

// ===== 초기 셋업 =====
function setUp() {
  const ss = ss_();

  let s = ss.getSheetByName(SHEET.STUDENTS);
  if (!s) {
    s = ss.insertSheet(SHEET.STUDENTS);
    s.appendRow(['반', '학번', '이름']);
    const rows = [];
    CLASSES.forEach(c => { for (let n = 1; n <= 25; n++) rows.push([c, n, '']); });
    s.getRange(2, 1, rows.length, 3).setValues(rows);
    styleHeader_(s, 3);
  }

  let p = ss.getSheetByName(SHEET.PAPERS);
  if (!p) {
    p = ss.insertSheet(SHEET.PAPERS);
    p.appendRow(['반', '번호', '이름', '익명ID', '이미지파일ID', '쪽수', '활성화', '저장시간']);
    styleHeader_(p, 8);
  }

  let r = ss.getSheetByName(SHEET.REVIEWS);
  if (!r) {
    r = ss.insertSheet(SHEET.REVIEWS);
    const head = ['제출시간', '반', '평가자번호', '평가자이름', '대상번호', '대상이름', '대상익명ID']
      .concat(CHECK_ITEMS.map(it => `[${it.section}] ${it.text}`))
      .concat(['잘된점_영역', '잘된점', '고칠점_영역', '고칠점', '숨김']);
    r.appendRow(head);
    styleHeader_(r, head.length);
  }

  let c = ss.getSheetByName(SHEET.COMMENTS);
  if (!c) {
    c = ss.insertSheet(SHEET.COMMENTS);
    c.appendRow(['반', '번호', '이름', '교사코멘트', '수정시간']);
    styleHeader_(c, 5);
  }

  let st = ss.getSheetByName(SHEET.SETTINGS);
  if (!st) {
    st = ss.insertSheet(SHEET.SETTINGS);
    const folder = DriveApp.createFolder('여행지리_동료평가_평가지_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'));
    st.appendRow(['항목', '값', '설명']);
    st.appendRow(['교사비밀번호', '1234', '교사 페이지 비밀번호 (꼭 바꾸세요)']);
    st.appendRow(['이미지폴더ID', folder.getId(), '마스킹된 평가지 이미지가 저장되는 Drive 폴더']);
    styleHeader_(st, 3);
  }

  try {
    SpreadsheetApp.getUi().alert(
      '셋업 완료\n\n' +
      '1. "설정" 시트에서 교사비밀번호를 바꾸세요\n' +
      '2. "학생명단" 시트에 B반·D반 학생 이름을 입력하세요\n' +
      '3. authorizeDrive도 한 번 실행한 뒤 웹앱으로 배포하세요'
    );
  } catch (e) { /* 편집기 밖에서 실행된 경우 무시 */ }
}

function styleHeader_(sheet, cols) {
  sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#f3f4f6');
  sheet.setFrozenRows(1);
}

// ===== 공통 도우미 =====
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }
function paperId_(cls, num) { return String(cls) + '-' + Number(num); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function getSetting_(key) {
  const data = sheet_(SHEET.SETTINGS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return data[i][1];
  }
  return '';
}

function checkTeacher_(pw) {
  if (String(pw) !== String(getSetting_('교사비밀번호'))) throw new Error('교사 인증이 필요합니다');
}

function getRoster_(classNum) {
  const data = sheet_(SHEET.STUDENTS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][2] || '').trim();
    if (data[i][0] === classNum && name) out.push({ num: Number(data[i][1]), name: name });
  }
  return out.sort((a, b) => a.num - b.num);
}

function readPapers_(classNum) {
  const data = sheet_(SHEET.PAPERS).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    if (classNum && r[0] !== classNum) continue;
    out.push({
      row: i + 1,
      id: paperId_(r[0], r[1]),
      classNum: r[0],
      num: Number(r[1]),
      name: String(r[2]).trim(),
      anonId: String(r[3]),
      fileIds: String(r[4] || '').split(',').filter(Boolean),
      pages: Number(r[5]) || 0,
      active: isTrue_(r[6]),
    });
  }
  return out.sort((a, b) => a.num - b.num);
}

function readReviews_(classNum) {
  const data = sheet_(SHEET.REVIEWS).getDataRange().getValues();
  const labelToKey = {};
  Object.keys(ANSWER_LABELS).forEach(k => { labelToKey[ANSWER_LABELS[k]] = k; });
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[1]) continue;
    if (classNum && r[1] !== classNum) continue;
    const answers = {};
    CHECK_ITEMS.forEach((it, k) => { answers[it.key] = labelToKey[String(r[RV_BASE + k])] || ''; });
    out.push({
      row: i + 1,
      time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Seoul', 'MM/dd HH:mm') : String(r[0]),
      classNum: r[1],
      reviewerNum: Number(r[2]),
      reviewerName: String(r[3]).trim(),
      targetNum: Number(r[4]),
      targetName: String(r[5]).trim(),
      targetId: paperId_(r[1], r[4]),
      answers: answers,
      goodSection: String(r[RV_GOOD_S] || ''),
      good: String(r[RV_GOOD] || ''),
      fixSection: String(r[RV_FIX_S] || ''),
      fix: String(r[RV_FIX] || ''),
      hidden: isTrue_(r[RV_HIDDEN]),
    });
  }
  return out;
}

function myReviews_(reviews, num, name) {
  return reviews.filter(r => r.reviewerNum === Number(num) && r.reviewerName === String(name).trim());
}

function getClassFolder_(classNum) {
  const root = DriveApp.getFolderById(String(getSetting_('이미지폴더ID')));
  const it = root.getFoldersByName(classNum);
  return it.hasNext() ? it.next() : root.createFolder(classNum);
}

// ============================================================
// ===== 학생 기능 =====
// ============================================================

function studentLogin(classNum, number, name) {
  name = String(name || '').trim();
  const ok = getRoster_(classNum).some(s => s.num === Number(number) && s.name === name);
  if (ok) return { success: true, student: { classNum: classNum, number: Number(number), name: name } };
  return { success: false, message: '학생명단에 없는 정보입니다.\n반, 학번, 이름을 다시 확인해주세요.' };
}

function getMyProgress(classNum, num, name) {
  const mine = myReviews_(readReviews_(classNum), num, name);
  return { completed: mine.length };
}

// 덜 평가받은 글부터 랜덤 배정. 보류한 글은 다른 글이 없을 때만 다시 나옴.
function getNextPaper(classNum, num, name, skippedIds, excludeId) {
  skippedIds = skippedIds || [];
  const all = readPapers_(classNum).filter(p => p.active && p.fileIds.length);
  if (all.length === 0) return { success: false, message: '아직 평가지가 준비되지 않았어요' };

  const reviews = readReviews_(classNum);
  const reviewed = myReviews_(reviews, num, name).map(r => r.targetId);
  const myId = paperId_(classNum, num);
  const available = all.filter(p => p.id !== myId && reviewed.indexOf(p.id) === -1);
  if (available.length === 0) return { success: false, allDone: true, message: '더 평가할 수 있는 글이 없어요' };

  // 학생 쪽에는 학번이 들어간 내부 ID 대신 익명 ID만 주고받음
  let pool = available.filter(p => skippedIds.indexOf(p.anonId) === -1 && p.anonId !== excludeId);
  if (pool.length === 0) pool = available.filter(p => p.anonId !== excludeId);
  if (pool.length === 0) pool = available;

  const counts = {};
  pool.forEach(p => { counts[p.id] = 0; });
  reviews.forEach(r => { if (counts.hasOwnProperty(r.targetId)) counts[r.targetId]++; });
  const min = Math.min.apply(null, pool.map(p => counts[p.id]));
  const candidates = pool.filter(p => counts[p.id] === min);
  const picked = candidates[Math.floor(Math.random() * candidates.length)];

  return {
    success: true,
    fromSkipped: skippedIds.indexOf(picked.anonId) !== -1,
    paper: { id: picked.anonId, pages: picked.fileIds.length },
  };
}

function getPaperImages(classNum, anonId) {
  const p = readPapers_(classNum).find(m => m.anonId === anonId && m.active);
  if (!p) return { success: false, message: '평가지를 찾을 수 없어요' };
  return { success: true, images: imagesToBase64_(p.fileIds) };
}

// 빠른 방식: 파일 ID만 주고, 이미지는 학생 브라우저가 드라이브에서 바로 받음
// (이미지 폴더가 '링크가 있는 사람 보기'로 공유되어 있어야 함)
function getPaperFiles(classNum, anonId) {
  const p = readPapers_(classNum).find(m => m.anonId === anonId && m.active);
  if (!p) return { success: false, message: '평가지를 찾을 수 없어요' };
  return { success: true, fileIds: p.fileIds };
}

function imagesToBase64_(ids) {
  return ids.map(id => Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()));
}

function submitReview(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cls = payload.classNum;
    const login = studentLogin(cls, payload.reviewerNum, payload.reviewerName);
    if (!login.success) return { success: false, message: '학생 정보를 확인할 수 없어요' };

    for (const it of CHECK_ITEMS) {
      if (!ANSWER_LABELS[payload.answers[it.key]]) return { success: false, message: `[${it.section}] 항목을 체크해주세요` };
    }
    if (SECTIONS.indexOf(payload.goodSection) === -1 || SECTIONS.indexOf(payload.fixSection) === -1) {
      return { success: false, message: '잘된 점·고칠 점의 영역을 골라주세요' };
    }
    const good = String(payload.good || '').trim();
    const fix = String(payload.fix || '').trim();
    if (good.length < MIN_COMMENT || fix.length < MIN_COMMENT) {
      return { success: false, message: `잘된 점과 고칠 점은 ${MIN_COMMENT}자 이상 써주세요` };
    }

    const target = readPapers_(cls).find(m => m.anonId === payload.paperId && m.active);
    if (!target) return { success: false, message: '대상 평가지를 찾을 수 없어요' };
    if (target.num === Number(payload.reviewerNum)) return { success: false, message: '자기 글은 평가할 수 없어요' };

    const dup = myReviews_(readReviews_(cls), payload.reviewerNum, payload.reviewerName)
      .some(r => r.targetId === target.id);
    if (dup) return { success: false, message: '이미 평가한 글이에요' };

    const row = [new Date(), cls, Number(payload.reviewerNum), String(payload.reviewerName).trim(),
      target.num, target.name, target.anonId]
      .concat(CHECK_ITEMS.map(it => ANSWER_LABELS[payload.answers[it.key]]))
      .concat([payload.goodSection, good, payload.fixSection, fix, false]);
    sheet_(SHEET.REVIEWS).appendRow(row);
    return { success: true };
  } catch (err) {
    return { success: false, message: '제출 중 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// ===== 교사 기능 (모든 함수에 비밀번호 확인) =====
// ============================================================

function teacherLogin(pw) {
  return { success: String(pw) === String(getSetting_('교사비밀번호')) };
}

// 업로드 준비: 명단과 기존 데이터 수
function prepareUpload(pw, classNum) {
  checkTeacher_(pw);
  const papers = readPapers_(classNum);
  return {
    roster: getRoster_(classNum),
    existing: papers.length,
    saved: papers.map(p => ({ num: p.num, anonId: p.anonId })),
    reviewCount: readReviews_(classNum).length,
  };
}

// 드라이브에 있는 PDF 정보 (링크나 ID 모두 가능)
function getDrivePdfInfo(pw, input) {
  checkTeacher_(pw);
  const m = String(input || '').match(/[-\w]{25,}/);
  if (!m) throw new Error('드라이브 링크나 파일 ID를 확인해주세요');
  const f = DriveApp.getFileById(m[0]);
  return { id: m[0], name: f.getName(), size: f.getSize(), mime: f.getMimeType() };
}

// 큰 PDF를 나눠서 전달 (Drive API 범위 요청)
function getDrivePdfChunk(pw, id, start, end) {
  checkTeacher_(pw);
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + end },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 206 && code !== 200) throw new Error('드라이브에서 읽기 실패 (' + code + ')');
  return Utilities.base64Encode(res.getContent());
}

// 권한 승인용 (편집기에서 한 번 실행)
function authorizeDrive() {
  DriveApp.getRootFolder();
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
}

// 해당 반의 기존 평가지 이미지와 목록 삭제 (평가 결과는 그대로 둠)
function resetClassPapers(pw, classNum) {
  checkTeacher_(pw);
  const papers = readPapers_(classNum).sort((a, b) => b.row - a.row);
  const sh = sheet_(SHEET.PAPERS);
  papers.forEach(p => {
    p.fileIds.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
    sh.deleteRow(p.row);
  });
  return { success: true, removed: papers.length };
}

// 학생 1명의 마스킹된 이미지 저장
function saveStudentPaper(pw, classNum, num, name, anonId, images) {
  checkTeacher_(pw);
  // 같은 학생 평가지가 이미 있으면 이미지와 줄을 지우고 새로 저장 (추가 저장 때 중복 방지)
  const sh = sheet_(SHEET.PAPERS);
  readPapers_(classNum).filter(p => p.num === Number(num)).sort((x, y) => y.row - x.row).forEach(p => {
    p.fileIds.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
    sh.deleteRow(p.row);
  });
  // 익명번호가 다른 학생과 겹치면 그 반의 다음 빈 번호로 바꿈
  const others = readPapers_(classNum).filter(p => p.num !== Number(num));
  if (others.some(p => p.anonId === anonId)) {
    const letter = String(anonId).split('-')[0];
    const maxNo = others.reduce((m, p) => Math.max(m, parseInt(String(p.anonId).split('-')[1], 10) || 0), 0);
    anonId = `${letter}-${String(maxNo + 1).padStart(2, '0')}`;
  }
  const folder = getClassFolder_(classNum);
  const ids = images.map((b64, k) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', `${anonId}_${k + 1}.jpg`);
    return folder.createFile(blob).getId();
  });
  sheet_(SHEET.PAPERS).appendRow([classNum, Number(num), name, anonId, ids.join(','), ids.length, true, new Date()]);
  return { success: true, anonId };
}

function getPapersT(pw, classNum) {
  checkTeacher_(pw);
  return readPapers_(classNum);
}

function setPaperActive(pw, row, active) {
  checkTeacher_(pw);
  sheet_(SHEET.PAPERS).getRange(row, 7).setValue(!!active);
  return { success: true };
}

function getPaperImagesByRow(pw, row) {
  checkTeacher_(pw);
  const v = sheet_(SHEET.PAPERS).getRange(row, 1, 1, 8).getValues()[0];
  const ids = String(v[4]).split(',').filter(Boolean);
  return { success: true, images: imagesToBase64_(ids), fileIds: ids };
}

// 저장된 평가지의 한 쪽을 다시 가린 이미지로 바꿈 (평가지 확인 탭의 '추가로 가리기')
// 줄 번호가 바뀌었을 수 있어서, 그 줄에 원래 파일 ID가 그대로 있는지 확인하고 바꿈
function replacePaperPage(pw, row, oldFileId, b64) {
  checkTeacher_(pw);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_(SHEET.PAPERS);
    const v = sh.getRange(row, 1, 1, 8).getValues()[0];
    const ids = String(v[4]).split(',').filter(Boolean);
    const k = ids.indexOf(oldFileId);
    if (k === -1) return { success: false, message: '평가지 목록이 바뀌었어요. 창을 닫고 다시 열어 주세요.' };
    const old = DriveApp.getFileById(oldFileId);
    const parents = old.getParents();
    const folder = parents.hasNext() ? parents.next() : getClassFolder_(String(v[0]));
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', old.getName());
    const newId = folder.createFile(blob).getId();
    ids[k] = newId;
    sh.getRange(row, 5).setValue(ids.join(','));
    try { old.setTrashed(true); } catch (e) {}
    return { success: true, fileId: newId };
  } finally {
    lock.releaseLock();
  }
}

// 진행 현황
function getProgressT(pw, classNum) {
  checkTeacher_(pw);
  const papers = readPapers_(classNum).filter(p => p.active);
  const reviews = readReviews_(classNum);
  return {
    total: reviews.length,
    papers: papers.map(p => ({
      num: p.num, name: p.name, anonId: p.anonId,
      received: reviews.filter(r => r.targetId === p.id).length,
    })),
    reviewers: getRoster_(classNum).map(s => ({
      num: s.num, name: s.name,
      count: myReviews_(reviews, s.num, s.name).length,
    })),
  };
}

// 피드백 검토·출력용 데이터
function getFeedbackT(pw, classNum) {
  checkTeacher_(pw);
  const papers = readPapers_(classNum).filter(p => p.active);
  const reviews = readReviews_(classNum);
  const comments = {};
  const cd = sheet_(SHEET.COMMENTS).getDataRange().getValues();
  for (let i = 1; i < cd.length; i++) {
    if (cd[i][0] === classNum) comments[Number(cd[i][1])] = String(cd[i][3] || '');
  }
  return papers.map(p => ({
    num: p.num, name: p.name, anonId: p.anonId,
    comment: comments[p.num] || '',
    reviews: reviews.filter(r => r.targetId === p.id),
  }));
}

function setReviewHidden(pw, row, hidden) {
  checkTeacher_(pw);
  sheet_(SHEET.REVIEWS).getRange(row, RV_HIDDEN + 1).setValue(!!hidden);
  return { success: true };
}

function saveTeacherComment(pw, classNum, num, name, comment) {
  checkTeacher_(pw);
  const sh = sheet_(SHEET.COMMENTS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classNum && Number(data[i][1]) === Number(num)) {
      sh.getRange(i + 1, 4, 1, 2).setValues([[comment, new Date()]]);
      return { success: true };
    }
  }
  sh.appendRow([classNum, Number(num), name, comment, new Date()]);
  return { success: true };
}
