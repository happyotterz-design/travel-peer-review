/**
 * GitHub → Apps Script 자동 배포 (Sync.gs)
 *
 * GitHub 저장소의 apps-script/ 폴더 파일(GH_FILES)을 가져와서
 * 이 프로젝트 코드를 바꾸고, 같은 웹앱 주소에 새 버전으로 배포합니다.
 *
 * 처음 한 번만
 * 1. https://script.google.com/home/usersettings 에서 "Google Apps Script API" 사용
 * 2. 편집기에서 installAutoSync 실행 → 권한 허용
 *    (5분마다 GitHub 파일이 바뀌었는지 확인하고, 바뀌었으면 자동 배포)
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

// 가져올 파일 목록 (apps-script 폴더에 파일을 추가하면 여기에도 적어주세요)
const GH_FILES = ['appsscript.json', 'Code.gs', 'Sync.gs'];

// force가 true면 내용이 그대로여도 다시 배포
function syncFromGitHub(force) {
  const props = PropertiesService.getScriptProperties();
  const files = ghFetchFiles_();
  const digest = Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    files.map(f => f.name + '\n' + f.source).join('\n\u0000\n'),
    Utilities.Charset.UTF_8
  )).slice(0, 12);
  if (!force && props.getProperty('SYNCED_DIGEST') === digest) return '변경 없음 (' + digest + ')';

  const scriptId = ScriptApp.getScriptId();
  scriptApi_('put', '/projects/' + scriptId + '/content', { files: files });

  const version = scriptApi_('post', '/projects/' + scriptId + '/versions', {
    description: 'GitHub ' + digest,
  });

  scriptApi_('put', '/projects/' + scriptId + '/deployments/' + DEPLOYMENT_ID, {
    deploymentConfig: {
      scriptId: scriptId,
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'GitHub ' + digest,
    },
  });

  props.setProperty('SYNCED_DIGEST', digest);
  props.setProperty('SYNCED_AT', new Date().toISOString());
  props.setProperty('SYNCED_VERSION', String(version.versionNumber));
  const msg = '배포 완료: 버전 ' + version.versionNumber + ' (' + digest + ')';
  Logger.log(msg);
  return msg;
}

// raw.githubusercontent.com 에서 바로 읽기 (GitHub API 횟수 제한을 피함)
function ghFetchFiles_() {
  const base = 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + GH_DIR + '/';
  const t = Date.now();
  return GH_FILES.map(file => {
    const res = UrlFetchApp.fetch(base + file + '?t=' + t, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error(file + ' 내려받기 실패 (' + res.getResponseCode() + ')');
    let type, name;
    if (/\.gs$/.test(file)) { type = 'SERVER_JS'; name = file.replace(/\.gs$/, ''); }
    else if (/\.html$/.test(file)) { type = 'HTML'; name = file.replace(/\.html$/, ''); }
    else { type = 'JSON'; name = 'appsscript'; }
    return { name: name, type: type, source: res.getContentText() };
  });
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
    throw new Error('Apps Script API 오류 ' + code + ': ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}

// 마지막 자동 배포 상태 확인용
function syncStatus() {
  const p = PropertiesService.getScriptProperties();
  const msg = '마지막 배포: 버전 ' + (p.getProperty('SYNCED_VERSION') || '-') + ' (' + (p.getProperty('SYNCED_DIGEST') || '-') + ') / 시각: ' + (p.getProperty('SYNCED_AT') || '-');
  Logger.log(msg);
  return msg;
}
