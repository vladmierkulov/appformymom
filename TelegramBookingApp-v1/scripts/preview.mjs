/** Local, disposable UI preview. This file is never part of the Worker runtime. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.PREVIEW_PORT || 4173);
const defaultSettings = {
  reminders_enabled: 1,
  reminder_template: 'Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}.',
};
let settings = { ...defaultSettings };
let bookings = [];
let failNext = false;

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function bodyOf(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) throw new Error('Request too large');
  }
  return body ? JSON.parse(body) : {};
}

function sdk(url) {
  const dark = url.searchParams.get('theme') === 'dark';
  const top = Math.max(22, Math.min(100, Number(url.searchParams.get('safeTop')) || 22));
  const bottom = Math.max(0, Math.min(100, Number(url.searchParams.get('safeBottom')) || 0));
  return `<script>
(() => {
  const handlers = new Map();
  const button = () => ({ isVisible:false, isActive:true, show(){this.isVisible=true;return this;}, hide(){this.isVisible=false;return this;}, onClick(fn){this.callback=fn;return this;}, offClick(){this.callback=null;return this;}, setText(){return this;}, setParams(){return this;}, enable(){this.isActive=true;return this;}, disable(){this.isActive=false;return this;}, showProgress(){return this;}, hideProgress(){return this;} });
  const emit = (name, value) => (handlers.get(name) || []).forEach(fn => fn(value));
  const noop = () => {};
  window.Telegram = { WebApp: {
    initData: 'local-preview-only', initDataUnsafe:{user:{id:0,first_name:'Демо',language_code:'ru'}},
    version:'9.1', platform:'ios', colorScheme:${JSON.stringify(dark ? 'dark' : 'light')},
    themeParams:${JSON.stringify(dark ? { bg_color: '#151719', secondary_bg_color: '#0b0d0f', text_color: '#f7f8fa', hint_color: '#92989f', link_color: '#84aefc', button_color: '#8cacfc', button_text_color: '#111820', section_bg_color: '#212427', section_header_text_color: '#92989f', subtitle_text_color: '#92989f', destructive_text_color: '#ff7474' } : { bg_color: '#f7f8fa', secondary_bg_color: '#eef0f3', text_color: '#20252c', hint_color: '#848992', link_color: '#517dea', button_color: '#517dea', button_text_color: '#ffffff', section_bg_color: '#ffffff', section_header_text_color: '#848992', subtitle_text_color: '#848992', destructive_text_color: '#d64949' })},
    safeAreaInset:{top:${top},right:0,bottom:${bottom},left:0}, contentSafeAreaInset:{top:0,right:0,bottom:0,left:0},
    viewportHeight:innerHeight, viewportStableHeight:innerHeight, isExpanded:true, isFullscreen:false,
    requestFullscreen(){
      if (${JSON.stringify(url.searchParams.get('fullscreen') === 'unsupported')}) { emit('fullscreenFailed',{error:'UNSUPPORTED'}); return; }
      this.isFullscreen=true; this.contentSafeAreaInset.top=48; emit('fullscreenChanged'); emit('contentSafeAreaChanged');
    },
    ready:noop, expand:noop, disableVerticalSwipes:noop, enableVerticalSwipes:noop, enableClosingConfirmation:noop, disableClosingConfirmation:noop,
    setHeaderColor:noop, setBackgroundColor:noop, setBottomBarColor:noop, isVersionAtLeast:()=>true,
    BackButton:button(), MainButton:button(), SecondaryButton:button(),
    HapticFeedback:{impactOccurred:noop,selectionChanged:noop,notificationOccurred:noop},
    onEvent(name,fn){handlers.set(name,[...(handlers.get(name)||[]),fn]);},
    offEvent(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(item=>item!==fn));},
    showAlert(message,callback){alert(message);callback?.();},
    showConfirm(message,callback){callback?.(confirm(message));},
    showPopup(params,callback){alert(params.message || params.title || 'Демо');callback?.(params.buttons?.[0]?.id || 'ok');},
    openTelegramLink(){alert('Локальное демо: сообщение подготовлено. Отправка в Telegram отключена.');},
    openLink(){alert('Локальное демо: переход по внешней ссылке отключён.');},
    requestWriteAccess(callback){callback?.(false);}, close(){alert('Локальное демо: закрытие Mini App.');}
  }};
  document.documentElement.style.setProperty('--tg-safe-area-inset-top','${top}px');
  document.documentElement.style.setProperty('--tg-safe-area-inset-bottom','${bottom}px');
  for (const [name,value] of Object.entries(Telegram.WebApp.themeParams)) document.documentElement.style.setProperty('--tg-theme-'+name.replaceAll('_','-'),value);
  addEventListener('resize',()=>{Telegram.WebApp.viewportHeight=innerHeight;Telegram.WebApp.viewportStableHeight=innerHeight;emit('viewportChanged',{isStateStable:true});});
  addEventListener('DOMContentLoaded',()=>{
    const badge=document.createElement('div');
    badge.textContent='ЛОКАЛЬНОЕ ДЕМО · НЕ РЕАЛЬНЫЕ ДАННЫЕ';
    badge.style.cssText='position:fixed;top:0;left:0;right:0;height:20px;display:flex;align-items:center;justify-content:center;z-index:2147483647;pointer-events:none;background:#e8edf5;color:#36455c;font:9px/1.1 system-ui;letter-spacing:1px';
    document.body.append(badge);
  });
})();
</script>`;
}

function wrapper() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Записи — локальная проверка</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#e9eaf0;color:#252833;font:14px/1.5 system-ui;display:flex;gap:48px;justify-content:center;align-items:flex-start;padding:28px}aside{width:230px;padding-top:30px}h1{font-size:26px;letter-spacing:-1px;line-height:1.2;margin:0 0 12px}p{color:#676b77}button,a{display:block;width:100%;border:1px solid #d0d3dd;border-radius:12px;padding:10px 14px;background:#f9faff;margin:8px 0;color:#2d374a;text-decoration:none;font:inherit;text-align:left;cursor:pointer}button:hover,a:hover{background:white}small{display:block;color:#70788a;margin-top:24px}iframe{display:block;width:390px;height:844px;border:0;border-radius:34px;background:#fff;box-shadow:0 20px 80px #18243821;outline:7px solid #252b36}.phone{margin:8px 0 24px}@media(max-width:760px){body{padding:18px;display:block}aside{width:min(390px,100%);padding:0;margin:0 auto 20px}aside p,aside small{display:none}aside .controls{display:flex;gap:5px;flex-wrap:wrap}button,a{width:auto;flex:1;font-size:12px;padding:8px}.phone{width:390px;max-width:100%;margin:0 auto}iframe{max-width:100%;height:844px;border-radius:24px}}
  </style></head><body><aside><h1>Записи.<br>Локальная проверка</h1><p>Блокнот изначально пуст. Здесь появляются только записи, которые вы добавите сами. Данные демо исчезнут после остановки сервера.</p><div class="controls"><button id="light">Светлая тема</button><button id="dark">Тёмная тема</button><button id="empty">Пустой блокнот</button><button id="fail">Ошибка следующего запроса</button><a href="/" target="_blank">Открыть на всю ширину ↗</a></div><small>390 × 844 · имитация Telegram iOS<br>Внешняя отправка отключена.<br>Не подключено к Cloudflare.</small><output id="status" aria-live="polite"></output></aside><main class="phone"><iframe id="app" src="/?theme=light" title="Mini App — мобильный просмотр"></iframe></main><script>
  const frame=document.getElementById('app');
  for(const theme of ['light','dark'])document.getElementById(theme).onclick=()=>{frame.src='/?theme='+theme;};
  for(const mode of ['empty'])document.getElementById(mode).onclick=async()=>{await fetch('/__preview/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({empty:mode==='empty'})});frame.src=frame.src;document.getElementById('status').textContent='Пустой блокнот готов.';};
  document.getElementById('fail').onclick=async()=>{await fetch('/__preview/fail-next',{method:'POST'});document.getElementById('status').textContent='Следующий запрос API вернёт ошибку 503.';};
  </script></body></html>`;
}

const server = createServer(async (request, response) => {
  try {
    if (!['127.0.0.1', 'localhost'].includes((request.headers.host || '').split(':')[0])) return json(response, 403, { error: 'Local preview only' });
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) return json(response, 403, { error: 'Local preview only' });
    if (url.pathname === '/__preview') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(wrapper());
    }
    if (url.pathname === '/__preview/reset' && request.method === 'POST') {
      bookings = [];
      settings = { ...defaultSettings };
      failNext = false;
      return json(response, 200, { ok: true });
    }
    if (url.pathname === '/__preview/fail-next' && request.method === 'POST') {
      failNext = true;
      return json(response, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      if (failNext) { failNext = false; return json(response, 503, { error: 'Тестовая ошибка сети. Попробуйте ещё раз.' }); }
      if (url.pathname === '/api/settings') {
        if (request.method === 'GET') return json(response, 200, settings);
        if (request.method === 'PUT') { settings = { ...settings, ...await bodyOf(request) }; return json(response, 200, { ok: true }); }
      }
      const bookingPath = url.pathname.match(/^\/api\/bookings(?:\/([\w-]+))?$/);
      if (bookingPath) {
        const id = bookingPath[1];
        if (!id && request.method === 'GET') return json(response, 200, bookings.filter(booking => !url.searchParams.get('date') || booking.date === url.searchParams.get('date')).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
        if ((!id && request.method === 'POST') || (id && request.method === 'PUT')) {
          const body = await bodyOf(request);
          if (!body.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '')) return json(response, 400, { error: 'Укажите имя, дату и время.' });
          if (bookings.some(booking => booking.id !== id && booking.date === body.date && booking.time === body.time)) return json(response, 409, { error: 'На это время уже есть запись. Выберите другое время.' });
          if (id) {
            const index = bookings.findIndex(booking => booking.id === id);
            if (index < 0) return json(response, 404, { error: 'Запись не найдена.' });
            bookings[index] = { ...bookings[index], ...body, id };
            return json(response, 200, { ok: true });
          }
          const booking = { ...body, id: randomUUID(), owner_id: 'local-preview', phone: body.phone || '', price: Number(body.price || 0), created_at: new Date().toISOString() };
          bookings.push(booking);
          return json(response, 201, { id: booking.id });
        }
        if (id && request.method === 'DELETE') {
          const oldLength = bookings.length;
          bookings = bookings.filter(booking => booking.id !== id);
          return bookings.length < oldLength ? json(response, 200, { ok: true }) : json(response, 404, { error: 'Запись не найдена.' });
        }
      }
      return json(response, 404, { error: 'Не найдено.' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
    const pathname = decodeURIComponent(url.pathname);
    const filePath = resolve(publicDirectory, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (relative(publicDirectory, filePath).startsWith('..')) return json(response, 403, { error: 'Forbidden' });
    let content = await readFile(filePath);
    const extension = extname(filePath);
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }[extension] || 'application/octet-stream';
    if (extension === '.html') {
      content = content.toString().replace(/<script\b[^>]*src=["']https:\/\/telegram\.org\/js\/telegram-web-app\.js[^"']*["'][^>]*>\s*<\/script>/gi, '');
      content = content.replace(/<head([^>]*)>/i, match => `${match}${sdk(url)}`);
    }
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    json(response, error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? 'Файл не найден.' : error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Disposable local preview: http://127.0.0.1:${port}/__preview\nDirect app: http://127.0.0.1:${port}/?theme=light\nNo production data or Telegram messages are used.`));
