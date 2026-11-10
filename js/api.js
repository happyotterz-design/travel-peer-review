// Apps Script API 호출 도우미
// 기존 google.script.run 문법을 그대로 쓸 수 있게 흉내 냅니다.
(function () {
  async function apiCall(action, args) {
    if (!window.API_URL || window.API_URL.indexOf('script.google.com') === -1) {
      throw new Error('js/config.js에 Apps Script 주소(API_URL)를 넣어주세요');
    }
    const res = await fetch(window.API_URL, {
      method: 'POST',
      // text/plain으로 보내야 브라우저가 사전 요청(preflight)을 하지 않아요
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, args: args || [] }),
    });
    if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '서버 오류');
    return json.data;
  }

  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (h) { return runner(h, onFailure); };
        if (prop === 'withFailureHandler') return function (h) { return runner(onSuccess, h); };
        return function () {
          const args = Array.prototype.slice.call(arguments);
          apiCall(prop, args)
            .then(function (r) { if (onSuccess) onSuccess(r); })
            .catch(function (e) { if (onFailure) onFailure(e); else console.error(e); });
        };
      },
    });
  }

  window.apiCall = apiCall;
  window.google = { script: { get run() { return runner(null, null); } } };
})();
