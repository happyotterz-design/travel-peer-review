# 여행지리 딜레마 초안 익명 동료평가

수도여고 여행지리(B반·D반) 「미래 전문가의 시선으로 읽는 여행지리 딜레마」 초안 동료평가 도구입니다.

- **학생용**: https://happyotterz-design.github.io/travel-peer-review/
- **교사용**: https://happyotterz-design.github.io/travel-peer-review/teacher.html

## 구조

| 위치 | 하는 일 |
|---|---|
| `index.html`, `js/student.js` | 학생 화면 (반·학번·이름 로그인 → 익명 초안 3편 평가) |
| `teacher.html`, `js/teacher.js` | 교사 화면 (PDF 불러오기·마스킹·진행 현황·피드백 검토·A4 출력·QR) |
| `js/api.js` | Apps Script API 호출 도우미 |
| `js/config.js` | Apps Script 웹앱 주소 |
| `apps-script/Code.gs` | 서버 코드 (시트·드라이브 처리) |
| `apps-script/Sync.gs` | GitHub → Apps Script 자동 배포 (5분마다 확인) |
| `apps-script/appsscript.json` | Apps Script 설정 (권한·웹앱 배포 설정) |

학생 명단, 평가 결과, 교사 비밀번호, 평가지 이미지는 모두 선생님 구글 시트와 드라이브에만 있고, 이 저장소에는 들어가지 않습니다.

## 수정하는 법

- **화면만 고칠 때**: `index.html`, `teacher.html`, `js/` 파일을 고쳐서 커밋하면 1~2분 뒤 Pages에 반영됩니다. 학생 기기에 옛날 화면이 남아 있으면 `js/config.js`의 `APP_VERSION` 숫자를 올리세요.
- **서버를 고칠 때**: `apps-script/` 폴더 파일을 고쳐서 커밋하면, Apps Script가 5분 안에 가져가서 같은 웹앱 주소에 새 버전으로 배포합니다 (`apps-script/Sync.gs`). 바로 반영하려면 편집기에서 `syncFromGitHub` 실행, 상태 확인은 `syncStatus`.
- **체크 항목·목표 편수 바꾸기**: `apps-script/Code.gs` 맨 위 설정(`CHECK_ITEMS`, `TARGET_REVIEWS` 등).

## Apps Script 배포 설정

- 다음 사용자 인증 정보로 실행: **나**
- 액세스 권한: **모든 사용자** (GitHub Pages에서 호출하려면 필요)
- 모든 학생 기능은 반·학번·이름 확인, 교사 기능은 비밀번호 확인을 거칩니다.
