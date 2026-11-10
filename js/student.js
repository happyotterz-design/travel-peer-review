const CONFIG = window.CONFIG_DATA;

const S = {
  me: null, paper: null, images: [], loadToken: 0,
  answers: {}, goodSec: '', good: '', fixSec: '', fix: '',
  skipped: [], skipsUsed: 0, completed: 0, submitting: false,
};

// ===== 로그인 =====
let selectedClass = '';
(function initClassButtons() {
  const wrap = document.getElementById('classBtns');
  wrap.innerHTML = CONFIG.classes.map(c => `<button data-cls="${c}">${c}</button>`).join('');
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedClass = btn.dataset.cls;
    });
  });
})();
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogin() {
  const number = document.getElementById('numberInput').value;
  const name = document.getElementById('nameInput').value.trim();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  if (!selectedClass || !number || !name) {
    errEl.textContent = '반, 학번, 이름을 모두 입력해주세요';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 확인 중...';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.textContent = '시작하기';
      if (!res.success) { errEl.textContent = res.message; errEl.style.display = 'block'; return; }
      S.me = res.student;
      enterReview();
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.textContent = '시작하기';
      errEl.textContent = '서버 오류: ' + err.message; errEl.style.display = 'block';
    })
    .studentLogin(selectedClass, parseInt(number, 10), name);
}

function enterReview() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('reviewScreen').style.display = 'block';
  document.getElementById('userName').textContent = `${S.me.classNum} ${S.me.number} ${S.me.name}`;
  showLoading('진행 상황을 불러오는 중...');
  google.script.run
    .withSuccessHandler(res => { S.completed = res.completed; updateHeader(); showStart(); })
    .withFailureHandler(err => alert('오류: ' + err.message))
    .getMyProgress(S.me.classNum, S.me.number, S.me.name);
}

function logout() {
  if (S.paper && !confirm('작성 중인 평가가 사라져요. 로그아웃할까요?')) return;
  Object.assign(S, { me: null, paper: null, images: [], skipped: [], skipsUsed: 0, completed: 0 });
  S.loadToken++;
  document.getElementById('reviewScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

// ===== 화면 =====
function updateHeader() {
  document.getElementById('progressCount').textContent = `${S.completed} / ${CONFIG.targetReviews}`;
  document.getElementById('skipCount').textContent = `${S.skipsUsed} / ${CONFIG.maxSkips}`;
  document.getElementById('progressBar').style.width = Math.min(100, S.completed / CONFIG.targetReviews * 100) + '%';
}

function showLoading(msg) {
  document.getElementById('contentArea').innerHTML =
    `<div class="empty-card"><div class="icon">⏳</div><p>${msg}</p></div>`;
}

function showStart() {
  const area = document.getElementById('contentArea');
  if (S.completed >= CONFIG.targetReviews) {
    area.innerHTML = `
      <div class="empty-card">
        <div class="icon">✅</div>
        <h2>목표 ${CONFIG.targetReviews}편을 모두 마쳤어요</h2>
        <p>총 ${S.completed}편에 피드백을 남겼어요. 수고했어요!<br>시간이 남으면 한 편 더 해줘도 좋아요.</p>
        <button class="btn-inline" onclick="loadNext()">한 편 더 평가하기</button>
        <button class="btn-inline gray" onclick="logout()">끝내기</button>
      </div>`;
    return;
  }
  area.innerHTML = `
    <div class="empty-card">
      <div class="icon">📄</div>
      <h2>${S.completed === 0 ? '첫 번째 글을 받아보세요' : '다음 글을 받아보세요'}</h2>
      <p>지금까지 ${S.completed}편 완료 · 목표 ${CONFIG.targetReviews}편<br>한 편당 12분 정도 걸려요.</p>
      <button class="btn-inline" onclick="loadNext()">글 받기</button>
    </div>`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ===== 글 받기 =====
function loadNext(excludeId) {
  const tok = ++S.loadToken;
  showLoading('글을 가져오는 중...');
  google.script.run
    .withSuccessHandler(res => {
      if (tok !== S.loadToken) return;
      if (!res.success) {
        document.getElementById('contentArea').innerHTML = `
          <div class="empty-card">
            <div class="icon">${res.allDone ? '🎉' : '⚠️'}</div>
            <h2>${res.allDone ? '더 평가할 글이 없어요' : '글을 받을 수 없어요'}</h2>
            <p>${res.message}${res.allDone ? '' : '<br>선생님께 알려주세요.'}</p>
            <button class="btn-inline gray" onclick="logout()">끝내기</button>
          </div>`;
        return;
      }
      if (res.fromSkipped) S.skipped = S.skipped.filter(id => id !== res.paper.id);
      S.paper = res.paper;
      S.images = [];
      S.answers = {}; S.goodSec = ''; S.good = ''; S.fixSec = ''; S.fix = '';
      renderForm(res.fromSkipped);
      loadImages(tok);
    })
    .withFailureHandler(err => alert('오류: ' + err.message))
    .getNextPaper(S.me.classNum, S.me.number, S.me.name, S.skipped, excludeId || null);
}

function loadImages(tok) {
  google.script.run
    .withSuccessHandler(res => {
      if (tok !== S.loadToken) return;
      const box = document.getElementById('paperPages');
      if (!box) return;
      if (!res.success) { box.innerHTML = `<div class="loading">${res.message}</div>`; return; }
      S.images = res.images;
      box.innerHTML = res.images.map((b64, i) =>
        `<div class="pg-label">${i + 1}쪽</div><img src="data:image/jpeg;base64,${b64}" alt="${i + 1}쪽" onclick="openZoom()">`
      ).join('');
    })
    .withFailureHandler(err => {
      const box = document.getElementById('paperPages');
      if (box) box.innerHTML = `<div class="loading">불러오기 실패: ${err.message}</div>`;
    })
    .getPaperImagesS(S.me.classNum, S.me.number, S.me.name, S.paper.id);
}

// ===== 평가 폼 =====
function renderForm(fromSkipped) {
  const groups = [];
  CONFIG.checkItems.forEach(it => {
    let g = groups.find(x => x.section === it.section);
    if (!g) { g = { section: it.section, items: [] }; groups.push(g); }
    g.items.push(it);
  });
  const L = CONFIG.answerLabels;
  const secButtons = (kind) => CONFIG.sections.map(s =>
    `<button data-kind="${kind}" data-sec="${s}" onclick="pickSec('${kind}','${s}')">${s}</button>`).join('');

  document.getElementById('contentArea').innerHTML = `
    <div class="review-grid">
      <div class="paper-pane">
        <div class="paper-card">
          <div class="paper-head">
            <div><span style="color:#78716c; font-size:11px; letter-spacing:0.2em;">PAPER</span>
              <strong style="margin-left:8px;">익명 ${S.paper.anonId}</strong>
              ${fromSkipped ? '<span style="margin-left:8px; font-size:11px; background:#fef3c7; color:#92400e; padding:2px 6px;">보류했던 글</span>' : ''}
            </div>
            <button class="linkbtn" onclick="openZoom()">🔍 크게 보기</button>
          </div>
          <div class="paper-pages" id="paperPages">
            <div class="loading"><span class="spinner dark"></span><div style="margin-top:10px;">글을 불러오는 중...</div></div>
          </div>
        </div>
      </div>

      <div>
        <div class="guide">
          <strong>순서</strong> ① 글을 끝까지 먼저 읽기 → ② 기준마다 체크 → ③ 잘된 점·고칠 점 쓰기<br>
          체크는 <strong>있음 / 애매함 / 없음</strong> 중에 골라요. 애매하면 솔직하게 "애매함"을 눌러 주세요.
        </div>

        ${groups.map(g => `
          <div class="sec-card">
            <div class="sec-title">${g.section}</div>
            ${g.items.map(it => `
              <div class="ck-item" id="ck-${it.key}">
                <div class="ck-text"><span class="ck-code">${it.code}</span>${it.text}</div>
                <div class="ck-btns">
                  ${['O', 'M', 'X'].map(v => `<button data-k="${it.key}" data-v="${v}" onclick="setAns('${it.key}','${v}')">${L[v]}</button>`).join('')}
                </div>
              </div>`).join('')}
          </div>`).join('')}

        <div class="write-card">
          <h3>👍 가장 잘된 부분</h3>
          <div class="desc">어느 부분이, 왜 설득력 있었는지 써 주세요.</div>
          <div class="sec-pick">${secButtons('good')}</div>
          <textarea id="goodText" placeholder="예) 본론1에서 관광객 수와 주민 수를 같이 비교해서 문제가 얼마나 심각한지 바로 이해됐어." oninput="onText('good', this.value)"></textarea>
          <div class="counter" id="goodCounter">0 / ${CONFIG.minComment}자 이상</div>
        </div>

        <div class="write-card">
          <h3>✏️ 고치면 좋을 한 가지</h3>
          <div class="desc">어디를 <strong>어떻게</strong> 고치면 더 좋아질지 써 주세요. "더 자세히"보다 구체적인 방법을 알려 주세요.</div>
          <div class="sec-pick">${secButtons('fix')}</div>
          <textarea id="fixText" placeholder="예) 본론3에 '정부가 해야 한다'만 있어서, 어느 기관이 어떤 방식으로 할지 한 문장 넣으면 좋겠어." oninput="onText('fix', this.value)"></textarea>
          <div class="counter" id="fixCounter">0 / ${CONFIG.minComment}자 이상</div>
        </div>

        <div class="actions">
          <button class="btn-skip" onclick="handleSkip()" ${S.skipsUsed >= CONFIG.maxSkips ? 'disabled' : ''}>
            보류하기 (${CONFIG.maxSkips - S.skipsUsed}회 남음)
          </button>
          <button class="btn-primary" id="submitBtn" onclick="handleSubmit()">제출하기</button>
        </div>
      </div>
    </div>`;
  window.scrollTo(0, 0);
}

function setAns(key, v) {
  S.answers[key] = v;
  document.querySelectorAll(`[data-k="${key}"]`).forEach(b => {
    b.className = b.dataset.v === v ? 'sel-' + v : '';
  });
  document.getElementById('ck-' + key).classList.remove('missing');
}

function pickSec(kind, sec) {
  if (kind === 'good') S.goodSec = sec; else S.fixSec = sec;
  document.querySelectorAll(`.sec-pick button[data-kind="${kind}"]`).forEach(b => {
    b.classList.toggle('sel', b.dataset.sec === sec);
  });
}

function onText(kind, val) {
  S[kind] = val;
  const n = val.trim().length;
  const el = document.getElementById(kind + 'Counter');
  el.textContent = `${n} / ${CONFIG.minComment}자 이상`;
  el.classList.toggle('ok', n >= CONFIG.minComment);
}

// ===== 크게 보기 =====
let zoomLevel = 100;
function openZoom() {
  if (!S.images.length) return;
  document.getElementById('zoomModal').style.display = 'flex';
  document.getElementById('zoomContent').innerHTML =
    S.images.map(b64 => `<img src="data:image/jpeg;base64,${b64}">`).join('');
  setZoom(zoomLevel);
}
function setZoom(z) {
  zoomLevel = z;
  document.querySelectorAll('#zoomContent img').forEach(img => { img.style.width = (z === 100 ? 'min(100%, 900px)' : z + '%'); img.style.maxWidth = 'none'; });
  document.querySelectorAll('.modal-bar button[data-z]').forEach(b => b.classList.toggle('on', Number(b.dataset.z) === z));
}
function closeZoom() { document.getElementById('zoomModal').style.display = 'none'; }

// ===== 보류 / 제출 =====
function handleSkip() {
  if (S.skipsUsed >= CONFIG.maxSkips) return;
  if (!confirm(`이 글을 보류할까요? (남은 보류 ${CONFIG.maxSkips - S.skipsUsed - 1}회)\n보류한 글은 다른 글을 다 본 뒤에 다시 나올 수 있어요.`)) return;
  S.skipsUsed++;
  const id = S.paper.id;
  if (S.skipped.indexOf(id) === -1) S.skipped.push(id);
  S.paper = null;
  updateHeader();
  loadNext(id);
}

function handleSubmit() {
  if (S.submitting) return;
  const missing = CONFIG.checkItems.filter(it => !S.answers[it.key]);
  if (missing.length) {
    missing.forEach(it => document.getElementById('ck-' + it.key).classList.add('missing'));
    document.getElementById('ck-' + missing[0].key).scrollIntoView({ behavior: 'smooth', block: 'center' });
    alert(`체크하지 않은 항목이 ${missing.length}개 있어요. 빨간색으로 표시된 곳을 확인해 주세요.`);
    return;
  }
  const min = CONFIG.minComment;
  if (!S.goodSec) { alert('잘된 부분이 어느 영역인지 골라 주세요'); return; }
  if (S.good.trim().length < min) { alert(`잘된 부분을 ${min}자 이상 써 주세요`); return; }
  if (!S.fixSec) { alert('고칠 부분이 어느 영역인지 골라 주세요'); return; }
  if (S.fix.trim().length < min) { alert(`고칠 점을 ${min}자 이상 써 주세요`); return; }
  if (!confirm('제출할까요? 제출하면 고칠 수 없어요.')) return;

  S.submitting = true;
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 제출 중...';

  google.script.run
    .withSuccessHandler(res => {
      S.submitting = false;
      if (res.success) {
        S.completed++;
        S.paper = null;
        updateHeader();
        toast('제출했어요!');
        showStart();
      } else {
        btn.disabled = false; btn.textContent = '제출하기';
        alert(res.message || '제출하지 못했어요');
      }
    })
    .withFailureHandler(err => {
      S.submitting = false;
      btn.disabled = false; btn.textContent = '제출하기';
      alert('서버 오류: ' + err.message);
    })
    .submitReview({
      classNum: S.me.classNum,
      reviewerNum: S.me.number,
      reviewerName: S.me.name,
      paperId: S.paper.id,
      answers: S.answers,
      goodSection: S.goodSec, good: S.good.trim(),
      fixSection: S.fixSec, fix: S.fix.trim(),
    });
}
