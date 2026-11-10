/**
 * GitHub → Apps Script 자동 배포 (Sync.gs)
 *
 * GitHub 저장소의 apps-script/ 폴더에 있는 파일을 가져와서
 * 이 프로젝트 코드를 바꾸고, 같은 웹앱 주소에 새 버전으로 배포합니다.
 *
 * 처음 한 번만
 * 1. https://script.google.com/home/usersettings 에서 "Google Apps Script API" 사용
 * 2. 편집기에서 installAutoSync 실행 → 권한 허용
 *    (5분마다 GitHub에 새 커밋이 있는지 확인하고, 있으면 자동 배포)
 *
 * 바로 반영하고 싶으면 편집기에서 syncFromGitHub 실행
 */

const GH_OWNER = 'happyotterz-design';
const GH_REPO = 'travel-peer-review';
const GH_BRANCH = 'main';
const GH_DIR = 'apps-script';

// 웹앱 배포 ID (주소의 /s/ 와 /exec 사이)
const DEPLOYMENT_ID = 'AKfycbyrTgiwtUBpIsPBZURAZX8srQ7rp-AK4MXjVbl9mm4DQ2clfDk2vI2gtUUnl4zJvOMP';

function installAutoSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoSync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoSync').timeBased().everyMinutes(5).create();
  const r = syncFromGitHub(true);
  Logger.log('자동 배포 설치 완료. ' + r);
}

function autoSync() {
  try {
    syncFromGitHub(false);
  } catch (err) {
    console.error('자동 배포 실패: ' + err.message);
  }
}

// force가 true면 커밋이 그대로여도 다시 배포
function syncFromGitHub(force) {
  const props = PropertiesService.getScriptProperties();
  const sha = ghLatestSha_();
  if (!force && props.getProperty('SYNCED_SHA') === sha) return '변경 없음 (' + sha.slice(0, 7) + ')';

  const files = ghListFiles_(sha);
  if (!files.some(f => f.name === 'appsscript')) throw new Error('저장소에 appsscript.json이 없어요');
  if (!files.some(f => f.name === 'Code')) throw new Error('저장소에 Code.gs가 없어요');

  const scriptId = ScriptApp.getScriptId();
  scriptApi_('put', '/projects/' + scriptId + '/content', { files: files });

  const version = scriptApi_('post', '/projects/' + scriptId + '/versions', {
    description: 'GitHub ' + sha.slice(0, 7),
  });

  scriptApi_('put', '/projects/' + scriptId + '/deployments/' + DEPLOYMENT_ID, {
    deploymentConfig: {
      scriptId: scriptId,
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'GitHub ' + sha.slice(0, 7),
    },
  });

  props.setProperty('SYNCED_SHA', sha);
  props.setProperty('SYNCED_AT', new Date().toISOString());
  const msg = '배포 완료: 버전 ' + version.versionNumber + ' (커밋 ' + sha.slice(0, 7) + ')';
  Logger.log(msg);
  return msg;
}

function ghLatestSha_() {
  const res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/commits/' + GH_BRANCH,
    { headers: { Accept: 'application/vnd.github+json' }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('GitHub 커밋 확인 실패 (' + res.getResponseCode() + ')');
  return JSON.parse(res.getContentText()).sha;
}

function ghListFiles_(sha) {
  const res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_DIR + '?ref=' + sha,
    { headers: { Accept: 'application/vnd.github+json' }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('GitHub 파일 목록 실패 (' + res.getResponseCode() + ')');
  const list = JSON.parse(res.getContentText());
  const out = [];
  list.forEach(item => {
    if (item.type !== 'file') return;
    let type, name;
    if (/\.gs$/.test(item.name)) { type = 'SERVER_JS'; name = item.name.replace(/\.gs$/, ''); }
    else if (/\.html$/.test(item.name)) { type = 'HTML'; name = item.name.replace(/\.html$/, ''); }
    else if (item.name === 'appsscript.json') { type = 'JSON'; name = 'appsscript'; }
    else return;
    const raw = UrlFetchApp.fetch(item.download_url, { muteHttpExceptions: true });
    if (raw.getResponseCode() !== 200) throw new Error(item.name + ' 내려받기 실패');
    out.push({ name: name, type: type, source: raw.getContentText() });
  });
  return out;
}

function scriptApi_(method, path, body) {
  const res = UrlFetchApp.fetch('https://script.googleapis.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    if (code === 403 && /has not been used|disabled/i.test(text)) {
      throw new Error('Apps Script API가 꺼져 있어요. https://script.google.com/home/usersettings 에서 켜주세요.');
    }
    throw new Error('Apps Script API 오류 ' + code + ': ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}

// 마지막 자동 배포 상태 확인용
function syncStatus() {
  const p = PropertiesService.getScriptProperties();
  const msg = '마지막 배포 커밋: ' + (p.getProperty('SYNCED_SHA') || '-') + ' / 시각: ' + (p.getProperty('SYNCED_AT') || '-');
  Logger.log(msg);
  return msg;
}
