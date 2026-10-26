export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>E-APS | 시스템 오류 안내</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; border: 1px solid #1e293b; border-radius: 0.75rem; background: #1e293b40; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #94a3b8; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #2563eb; color: #fff; }
      .secondary { background: transparent; color: #f8fafc; border-color: #334155; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>화면을 불러오는 중 오류가 발생했습니다</h1>
      <p>잠시 후 새로고침하거나 대시보드 홈으로 이동해 주세요.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">새로고침</button>
        <a class="secondary" href="/">대시보드 홈</a>
      </div>
    </div>
  </body>
</html>`;
}
