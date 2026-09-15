import { localDate, parseDate, addDays, weekDates, monthCells, suggestedTimes, nextTime, groupClients, initials, formatMessage, validateBooking, money } from './domain.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name, cls = '') => '<svg aria-hidden="true" class="' + cls + '"><use href="#i-' + name + '"/></svg>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap = value => value[0].toUpperCase() + value.slice(1);
const dateLabel = (value, options = { day:'numeric', month:'long' }) => parseDate(value).toLocaleDateString('ru-RU', options);
const defaultTemplate = 'Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}.';
const tg = window.Telegram?.WebApp;
const connected = Boolean(tg?.initData);
const state = {
  date: localDate(), view: 'schedule', bookings: [], loading: true, loaded: false, error: '',
  settings: {reminders_enabled: 1, reminder_template: defaultTemplate}, settingsLoaded: false,
  busy: false, settingsDirty: false, sheetDirty: false, loadVersion: 0
};
const sheet = $('#sheet');
let toastTimer;
let returnFocus;

function safeTelegram(fn) { try { fn(); } catch { /* Older Telegram versions can lack optional APIs. */ } }
function haptic(type = 'light') {
  safeTelegram(() => type === 'success' || type === 'error'
    ? tg?.HapticFeedback?.notificationOccurred(type)
    : tg?.HapticFeedback?.impactOccurred(type));
}
function syncTheme() {
  const dark = tg?.initData ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const root = document.documentElement;
  const colors = tg?.themeParams || {};
  for (const [property, key] of [['--bg','secondary_bg_color'],['--card','bg_color'],['--text','text_color'],['--muted','hint_color'],['--accent','button_color'],['--accent-text','button_text_color'],['--danger','destructive_text_color']]) {
    if (/^#[0-9a-f]{6}$/i.test(colors[key] || '')) root.style.setProperty(property, colors[key]);
    else root.style.removeProperty(property);
  }
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  $('meta[name="theme-color"]').content = bg;
  safeTelegram(() => tg?.setHeaderColor(bg));
  safeTelegram(() => tg?.setBackgroundColor(bg));
  safeTelegram(() => tg?.isVersionAtLeast?.('7.10') && tg.setBottomBarColor(bg));
  syncInsets();
}
function syncInsets() {
  for (const [source, prefix] of [['safeAreaInset','--tg-safe-area-inset-'],['contentSafeAreaInset','--tg-content-safe-area-inset-']]) {
    for (const edge of ['top','bottom','left','right']) {
      const value = tg?.[source]?.[edge];
      if (Number.isFinite(value)) document.documentElement.style.setProperty(prefix + edge, Math.max(0,value) + 'px');
    }
  }
  if (sheet.open && window.visualViewport) sheet.style.maxHeight = Math.max(160, window.visualViewport.height - 24) + 'px';
}
function syncBack() {
  safeTelegram(() => sheet.open || state.view !== 'schedule' ? tg?.BackButton?.show() : tg?.BackButton?.hide());
  safeTelegram(() => state.sheetDirty || state.settingsDirty ? tg?.enableClosingConfirmation?.() : tg?.disableClosingConfirmation?.());
}
function notify(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      ...options, signal: controller.signal, cache: 'no-store',
      headers: {'Content-Type':'application/json','X-Telegram-Init-Data':tg?.initData || ''}
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Сессия истекла. Закройте блокнот и откройте его снова из бота.' : data?.error || 'Не удалось сохранить. Попробуйте ещё раз.');
      error.status = response.status;
      throw error;
    }
    if (data === null) throw new Error('Сервер вернул неожиданный ответ. Попробуйте обновить.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер долго не отвечает. Проверьте связь и обновите записи перед повторным сохранением.');
    if (error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    throw error;
  } finally { clearTimeout(timer); }
}

async function load() {
  if (state.busy) return;
  if (!connected) {
    state.loading = false;
    state.error = 'Откройте блокнот кнопкой в Telegram-боте. Так мы узнаем, какие записи ваши.';
    render();
    return;
  }
  const version = ++state.loadVersion;
  state.loading = true;
  state.error = '';
  render();
  const [bookings, settings] = await Promise.allSettled([api('/api/bookings'), api('/api/settings')]);
  if (version !== state.loadVersion) return;
  state.loading = false;
  if (bookings.status === 'fulfilled' && Array.isArray(bookings.value)) {
    state.bookings = bookings.value;
    state.loaded = true;
  } else state.error = bookings.reason?.message || 'Не удалось загрузить записи.';
  if (settings.status === 'fulfilled') {
    state.settings = settings.value;
    state.settingsLoaded = true;
    if (!state.settingsDirty) renderSettings();
  } else {
    $('#settings-error').textContent = 'Настройки не загрузились. Нажмите обновление вверху экрана.';
  }
  render();
}
function setView(view) {
  if (!['schedule','clients','settings'].includes(view)) return;
  state.view = view;
  for (const name of ['schedule','clients','settings']) $('#' + name + '-view').hidden = name !== view;
  $$('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    active ? button.setAttribute('aria-current','page') : button.removeAttribute('aria-current');
  });
  window.scrollTo({top:0, behavior:'instant'});
  syncBack();
  haptic();
}
function selectDate(date) {
  state.date = date;
  render();
  haptic();
}
function render() {
  renderSchedule();
  renderClients();
  $('#add-booking').disabled = !state.loaded || state.busy || state.loading || Boolean(state.error);
  $('#save-settings').disabled = !state.settingsLoaded || state.busy;
  $('#refresh').disabled = state.busy || state.loading;
  $('#refresh svg').classList.toggle('loading-indicator', state.loading);
}
function renderSchedule() {
  const day = state.bookings.filter(b => b.date === state.date).sort((a,b) => a.time.localeCompare(b.time));
  const today = localDate();
  $('#date-context').textContent = dateLabel(state.date,{day:'numeric',month:'long',year:'numeric'}).toUpperCase();
  $('#day-title').textContent = state.date === today ? 'Сегодня' : state.date === addDays(today,1) ? 'Завтра' : cap(dateLabel(state.date,{weekday:'long'}));
  $('#month-label').textContent = cap(dateLabel(state.date,{month:'long',year:'numeric'})).replace(' г.','');
  $('#week').innerHTML = weekDates(state.date).map(date => {
    const has = state.bookings.some(b => b.date === date);
    return '<button class="week-day' + (date === state.date ? ' is-selected' : '') + (date === today ? ' is-today' : '') +
      '" data-date="' + date + '" aria-pressed="' + (date === state.date) + '" aria-label="' + dateLabel(date,{weekday:'long',day:'numeric',month:'long'}) +
      (has ? ', есть записи' : '') + '"><span class="weekday">' + dateLabel(date,{weekday:'short'}) + '</span><span class="day-number">' +
      parseDate(date).getDate() + '</span>' + (has ? '<span class="day-dot"></span>' : '') + '</button>';
  }).join('');
  $$('#week button').forEach(button => button.onclick = () => selectDate(button.dataset.date));
  $('#booking-count').textContent = state.loaded ? day.length : '—';
  $('#booking-total').textContent = state.loaded ? money(day.reduce((sum,b) => sum + Number(b.price || 0),0), '') : '—';
  $('#agenda-caption').textContent = state.loaded && day.length ? day[0].time + ' — ' + day.at(-1).time : '';
  const canAdd = state.loaded && !state.loading && !state.error && !state.busy;
  const times = suggestedTimes(state.bookings,state.date);
  $('#quick-times').innerHTML = (times.length ? times : ['Другое время']).map(time =>
    '<button class="time-chip" ' + (!canAdd ? 'disabled ' : '') + 'data-time="' + (time === 'Другое время' ? '' : time) + '">' + time + '</button>').join('');
  $$('#quick-times button').forEach(button => button.onclick = () => openBookingForm({time:button.dataset.time || nextTime(state.bookings,state.date)}));
  $('#connection-status').innerHTML = state.error ? '<div class="error-state"><p>' + escape(state.error) + '</p>' +
    (connected ? '<button id="retry" class="text-button">Попробовать снова</button>' : '<a class="primary-button" href="https://t.me/calendarbookingminiappbot">Открыть бота ' + icon('arrow') + '</a>') +
    (state.loaded ? '<p class="micro">Показаны ранее загруженные записи. Обновите перед изменением.</p>' : '') + '</div>' : '';
  if ($('#retry')) $('#retry').onclick = load;
  $('#day-end').hidden = !state.loaded || !day.length;
  if (state.loading && !state.loaded) {
    $('#agenda').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    return;
  }
  if (!state.loaded) { $('#agenda').innerHTML = ''; return; }
  if (!day.length) {
    $('#agenda').innerHTML = '<div class="empty-state"><div class="empty-drawing">' + icon('book') + '<span>+</span></div><h3>День пока свободен</h3><p>Первая запись — начало хорошего дня. Добавим клиента?</p><button id="first-booking" class="text-button"' + (!canAdd ? ' disabled' : '') + '>Добавить первую запись ' + icon('arrow') + '</button></div>';
    $('#first-booking').onclick = () => openBookingForm();
    return;
  }
  const now = new Date().toTimeString().slice(0,5);
  const next = state.date === today ? day.find(b => b.time >= now) : null;
  const colors = ['#a9bb8c','#bba9c9','#c7b393','#95b7b2'];
  $('#agenda').innerHTML = day.map((b,index) =>
    '<article class="booking-row' + (b.id === next?.id ? ' next-booking' : '') + '"><div class="time-column">' + escape(b.time) +
    '</div><button class="booking-card" data-id="' + escape(b.id) + '" style="--booking-accent:' + colors[index%4] + '" aria-label="' + escape(b.time + ', ' + b.name + ', открыть запись') +
    '"><span class="booking-info">' + (b.id === next?.id ? '<span class="next-label">Следующая запись</span>' : '') +
    '<span class="booking-name">' + escape(b.name) + '</span><span class="booking-subtitle">' + escape(b.phone || 'Запись клиента') + '</span></span>' +
    (Number(b.price) > 0 ? '<span class="booking-price">' + escape(money(b.price,'')) + '</span>' : '') + icon('right','chevron') + '</button></article>'
  ).join('');
  $$('#agenda .booking-card').forEach(button => button.onclick = () => openBooking(button.dataset.id));
}
function renderClients() {
  const clients = groupClients(state.bookings);
  $('#client-count').textContent = clients.length;
  const search = $('#client-search').value.trim().toLocaleLowerCase('ru-RU');
  const digits = search.replace(/\D/g,'');
  const matches = clients.filter(client => client.name.toLocaleLowerCase('ru-RU').includes(search) || Boolean(digits && client.phone.replace(/\D/g,'').includes(digits)));
  if (!state.loaded) {
    $('#clients-list').innerHTML = '<div class="empty-state"><h3>' + (state.loading ? 'Загружаем клиентов…' : 'Нет доступа к записям') + '</h3><p>' + (state.loading ? 'Ещё немного.' : 'Вернитесь в расписание и проверьте подключение.') + '</p></div>';
    return;
  }
  $('#clients-list').innerHTML = matches.length ? matches.map(client =>
    '<button class="client-card" data-client="' + escape(client.key) + '"><span class="avatar">' + escape(initials(client.name)) +
    '</span><span class="client-meta"><strong>' + escape(client.name) + '</strong><span>' + escape(client.phone || ('Записей: ' + client.records.length)) +
    '</span></span>' + icon('right','chevron') + '</button>').join('') :
    '<div class="empty-state"><div class="empty-drawing">' + icon('users') + '</div><h3>' + (search ? 'Никого не нашли' : 'Здесь будут ваши клиенты') +
    '</h3><p>' + (search ? 'Попробуйте другое имя или часть номера.' : 'Создайте запись — имя сохранится для следующего визита.') + '</p></div>';
  $$('#clients-list [data-client]').forEach(button => button.onclick = () => openClient(button.dataset.client));
}
function renderSettings() {
  $('#message-template').value = state.settings.reminder_template || defaultTemplate;
  $('#reminders').checked = Boolean(state.settings.reminders_enabled);
  $('#settings-error').textContent = '';
}

function showSheet(title, html) {
  if (!sheet.open) returnFocus = document.activeElement;
  state.sheetDirty = false;
  $('#sheet-title').textContent = title;
  $('#sheet-content').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  document.body.classList.add('modal-open');
  $('#dock-wrap').inert = true;
  syncInsets();
  syncBack();
  haptic();
}
function closeSheet(force = false) {
  if (state.busy) return;
  if (state.sheetDirty && !force) {
    if ($('#discard-confirm')) return;
    const box = document.createElement('div');
    box.id = 'discard-confirm'; box.className = 'confirm-box';
    box.innerHTML = '<p>Закрыть без сохранения? Изменения в этой форме не сохранятся.</p><div class="action-pair"><button id="keep-editing">Продолжить</button><button id="discard">Не сохранять</button></div>';
    $('#sheet-content').prepend(box);
    $('#keep-editing').onclick = () => box.remove();
    $('#discard').onclick = () => closeSheet(true);
    $('#keep-editing').focus();
    sheet.scrollTop = 0;
    return;
  }
  state.sheetDirty = false;
  sheet.close();
  document.body.classList.remove('modal-open');
  $('#dock-wrap').inert = false;
  syncBack();
  returnFocus?.isConnected && returnFocus.focus({preventScroll:true});
}
function markDirty() { state.sheetDirty = true; syncBack(); }
function openBookingForm({id = null, time = null, client = null} = {}) {
  if (!state.loaded || state.loading || state.error || state.busy) { notify('Сначала обновите записи.'); return; }
  const existing = id ? state.bookings.find(b => b.id === id) : null;
  const b = existing || {date:state.date,time:time || nextTime(state.bookings,state.date),name:client?.name || '',phone:client?.phone || '',price:client?.latest?.price || ''};
  showSheet(existing ? 'Изменить запись' : 'Новая запись',
    '<p class="form-intro">' + (existing ? 'Измените дату или время, чтобы перенести визит.' : 'Дата и время уже выбраны. Достаточно имени.') + '</p>' +
    '<form id="booking-form" class="booking-form"><label class="field"><span>Имя клиента</span><input id="booking-name" name="name" placeholder="Как зовут клиента?" value="' + escape(b.name) + '" maxlength="120" required autocomplete="off" enterkeyhint="next"></label><div id="name-suggestions" class="inline-suggestions"></div>' +
    '<div class="field-pair"><label class="field"><span>Дата</span><input id="booking-date" name="date" type="date" required value="' + escape(b.date) + '"></label><label class="field"><span>Время</span><input id="booking-time" name="time" type="time" step="60" required value="' + escape(b.time) + '"></label></div>' +
    '<details class="optional-fields"' + (b.phone || Number(b.price) ? ' open' : '') + '><summary>Телефон и стоимость · необязательно</summary>' +
    '<label class="field"><span>Телефон</span><input id="booking-phone" name="phone" type="tel" placeholder="+7 …" value="' + escape(b.phone) + '" maxlength="40" autocomplete="tel"></label>' +
    '<label class="field"><span>Стоимость</span><input id="booking-price" name="price" type="text" inputmode="decimal" placeholder="0" value="' + escape(b.price || '') + '" maxlength="14"></label></details>' +
    '<p id="booking-error" class="form-error" role="alert"></p><div class="save-row"><button class="primary-button wide" id="save-booking" type="submit">' + icon('check') + 'Сохранить запись</button></div></form>');
  const form = $('#booking-form');
  const clients = groupClients(state.bookings);
  function nameSuggestions() {
    const q = $('#booking-name').value.trim().toLocaleLowerCase('ru-RU');
    const candidates = q ? clients.filter(c => c.name.toLocaleLowerCase('ru-RU').includes(q)).slice(0,4) : clients.slice(0,3);
    $('#name-suggestions').innerHTML = candidates.map(c => '<button type="button" class="suggestion" data-key="' + escape(c.key) + '">' + escape(c.name) + '</button>').join('');
    $$('#name-suggestions button').forEach(button => button.onclick = () => {
      const c = clients.find(item => item.key === button.dataset.key);
      $('#booking-name').value = c.name;
      $('#booking-phone').value = c.phone;
      $('#name-suggestions').innerHTML = '';
      markDirty();
    });
  }
  form.addEventListener('input', () => { markDirty(); $('#booking-error').textContent = ''; });
  $('#booking-name').addEventListener('input', nameSuggestions);
  nameSuggestions();
  form.onsubmit = async event => {
    event.preventDefault();
    if (state.busy) return;
    const rawPrice = $('#booking-price').value.trim().replace(',','.');
    const body = {name:$('#booking-name').value.trim(),date:$('#booking-date').value,time:$('#booking-time').value,phone:$('#booking-phone').value.trim(),price:rawPrice === '' ? 0 : Number(rawPrice)};
    const validation = validateBooking(body);
    const conflict = state.bookings.some(item => item.id !== id && item.date === body.date && item.time === body.time);
    if (validation || conflict) {
      $('#booking-error').textContent = validation || 'На это время уже есть запись. Выберите другое время.';
      haptic('error'); return;
    }
    state.busy = true;
    $('#save-booking').disabled = true;
    $('#save-booking').textContent = 'Сохраняем…';
    form.inert = true;
    try {
      const result = await api('/api/bookings' + (existing ? '/' + encodeURIComponent(id) : ''),{method:existing ? 'PUT' : 'POST',body:JSON.stringify(body)});
      const saved = {...existing,...body,id:existing?.id || result.id};
      state.bookings = existing ? state.bookings.map(item => item.id === id ? saved : item) : [...state.bookings,saved];
      state.date = body.date;
      ++state.loadVersion;
      state.busy = false;
      closeSheet(true);
      setView('schedule'); render();
      notify(existing ? 'Изменения сохранены' : 'Запись добавлена');
      haptic('success');
    } catch(error) {
      $('#booking-error').textContent = error.message;
      if (!$('#check-booking')) {
        const verify = document.createElement('button');
        verify.type = 'button'; verify.id = 'check-booking'; verify.className = 'text-button';
        verify.textContent = 'Проверить, сохранилась ли запись';
        $('#booking-error').after(verify);
        verify.onclick = async () => {
          if (state.busy) return;
          state.busy = true; verify.disabled = true; verify.textContent = 'Проверяем…';
          try {
            const latest = await api('/api/bookings');
            state.bookings = Array.isArray(latest) ? latest : state.bookings;
            state.loaded = true; state.loading = false; ++state.loadVersion;
            const found = state.bookings.find(item => item.date === body.date && item.time === body.time && item.name === body.name &&
              String(item.phone || '') === body.phone && Number(item.price || 0) === Number(body.price || 0));
            if (found) {
              state.date = body.date; state.sheetDirty = false; closeSheet(true); render();
              notify('Запись уже была сохранена'); haptic('success');
            } else {
              $('#booking-error').textContent = 'Записи с такими данными нет. Проверьте форму и сохраните ещё раз.';
            }
          } catch (checkError) {
            $('#booking-error').textContent = checkError.message;
          } finally {
            state.busy = false;
            if (verify.isConnected) { verify.disabled = false; verify.textContent = 'Проверить, сохранилась ли запись'; }
            render();
          }
        };
      }
      haptic('error');
    } finally {
      state.busy = false;
      if (form.isConnected) {
        form.inert = false;
        $('#save-booking').disabled = false;
        $('#save-booking').innerHTML = icon('check') + 'Сохранить запись';
      }
      render();
    }
  };
  $('#booking-name').focus({preventScroll:true});
}
function openBooking(id) {
  const b = state.bookings.find(item => item.id === id);
  if (!b) return;
  const text = formatMessage(state.settings.reminder_template || defaultTemplate,b);
  const phone = String(b.phone || '').replace(/[^\d+]/g,'');
  showSheet('Запись клиента',
    '<div class="detail-hero"><div class="avatar">' + escape(initials(b.name)) + '</div><h3>' + escape(b.name) + '</h3><p>' + escape(dateLabel(b.date,{day:'numeric',month:'long',year:'numeric'}) + ' · ' + b.time) + '</p>' +
    '<div class="detail-values">' + (b.phone ? '<span>' + escape(b.phone) + '</span>' : '') + (Number(b.price) > 0 ? '<strong>' + escape(money(b.price,'')) + '</strong>' : '') + '</div></div>' +
    '<div class="action-pair"><button id="edit-booking">' + icon('edit') + 'Изменить</button>' + (phone ? '<a href="tel:' + escape(phone) + '">' + icon('phone') + 'Позвонить</a>' : '<button id="repeat-booking">' + icon('plus') + 'Записать ещё</button>') + '</div>' +
    '<div class="message-card"><div class="section-heading"><h3>Сообщение клиенту</h3><button id="copy-message" class="icon-button copy-button" aria-label="Скопировать сообщение">' + icon('copy') + '</button></div><p id="message-text" class="message-text">' + escape(text) + '</p><p class="micro">Выберите клиента в Telegram и отправьте текст.</p><button id="share-message" class="primary-button wide">' + icon('message') + 'Отправить через Telegram</button></div>' +
    '<button id="delete-booking" class="delete-button">' + icon('trash') + 'Удалить запись</button><div id="delete-confirm"></div>');
  $('#edit-booking').onclick = () => openBookingForm({id});
  if ($('#repeat-booking')) $('#repeat-booking').onclick = () => openBookingForm({client:{...b,latest:b}});
  $('#copy-message').onclick = async () => {
    try { await navigator.clipboard.writeText(text); notify('Сообщение скопировано'); }
    catch {
      const range = document.createRange(); range.selectNodeContents($('#message-text'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      notify('Выделили текст. Нажмите «Копировать».');
    }
  };
  $('#share-message').onclick = () => {
    const link = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    try {
      if (connected && tg?.openTelegramLink) tg.openTelegramLink(link);
      else window.open(link,'_blank','noopener,noreferrer');
    } catch { notify('Скопируйте сообщение и вставьте в чат клиента.'); }
  };
  $('#delete-booking').onclick = () => {
    if (state.loading || state.error) { notify('Сначала дождитесь обновления записей.'); return; }
    $('#delete-booking').hidden = true;
    $('#delete-confirm').innerHTML = '<div class="confirm-box"><p>Удалить запись на ' + escape(dateLabel(b.date) + ' в ' + b.time) + '? Это действие нельзя отменить.</p><div class="action-pair"><button id="cancel-delete">Оставить</button><button id="confirm-delete">Удалить</button></div><p class="form-error" id="delete-error" role="alert"></p></div>';
    $('#cancel-delete').onclick = () => { $('#delete-confirm').innerHTML = ''; $('#delete-booking').hidden = false; };
    $('#confirm-delete').onclick = async () => {
      if (state.busy || state.loading || state.error) return;
      state.busy = true; $('#confirm-delete').disabled = true; $('#cancel-delete').disabled = true;
      try {
        try { await api('/api/bookings/' + encodeURIComponent(id),{method:'DELETE'}); }
        catch (error) {
          if (error.status !== 404) throw error;
          // A previous attempt may have succeeded even if its response was lost.
        }
        state.bookings = state.bookings.filter(item => item.id !== id);
        ++state.loadVersion; state.loading = false; state.busy = false; closeSheet(true); render(); notify('Запись удалена');
      } catch (error) {
        $('#delete-error').textContent = error.message;
        $('#confirm-delete').disabled = false; $('#cancel-delete').disabled = false;
      } finally { state.busy = false; }
    };
    $('#cancel-delete').focus();
  };
}
function openClient(key) {
  const client = groupClients(state.bookings).find(c => c.key === key);
  if (!client) return;
  showSheet('Клиент',
    '<div class="detail-hero"><div class="avatar">' + escape(initials(client.name)) + '</div><h3>' + escape(client.name) + '</h3><p>' + escape(client.phone || 'Телефон не указан') + '</p></div><button id="book-client" class="primary-button wide">' + icon('plus') + 'Записать клиента</button><div class="section-heading" style="margin:26px 0 12px"><h3>История записей</h3><span class="muted small">' + client.records.length + '</span></div>' +
    client.records.map(b => '<button class="history-row" data-id="' + escape(b.id) + '"><div>' + escape(dateLabel(b.date,{day:'numeric',month:'long',year:'numeric'})) + '<span>' + escape(b.time) + '</span></div><strong>' + escape(money(b.price,'')) + '</strong>' + icon('right') + '</button>').join(''));
  $('#book-client').onclick = () => openBookingForm({client});
  $$('.history-row').forEach(button => button.onclick = () => openBooking(button.dataset.id));
}
function openCalendar(month = state.date) {
  showSheet('Выбрать дату','<div class="calendar-modal-toolbar"><button id="prev-month" class="icon-button" aria-label="Предыдущий месяц">' + icon('left') + '</button><h3>' + escape(dateLabel(month,{month:'long',year:'numeric'})) + '</h3><button id="next-month" class="icon-button" aria-label="Следующий месяц">' + icon('right') + '</button></div><div class="month-grid">' +
    ['пн','вт','ср','чт','пт','сб','вс'].map(d => '<span class="weekday">' + d + '</span>').join('') +
    monthCells(month).map(date => !date ? '<span></span>' : '<button class="month-day' + (date === state.date ? ' is-selected' : '') + (date === localDate() ? ' is-today' : '') + '" data-date="' + date + '" aria-label="' + dateLabel(date,{day:'numeric',month:'long',year:'numeric'}) + '" aria-pressed="' + (date === state.date) + '">' + parseDate(date).getDate() + (state.bookings.some(b => b.date === date) ? '<span class="day-dot"></span>' : '') + '</button>').join('') +
    '</div><button id="calendar-today" class="primary-button wide calendar-today">К сегодняшнему дню</button>');
  const changeMonth = step => { const date = parseDate(month); date.setDate(1); date.setMonth(date.getMonth() + step); openCalendar(localDate(date)); };
  $('#prev-month').onclick = () => changeMonth(-1);
  $('#next-month').onclick = () => changeMonth(1);
  $$('.month-day').forEach(button => button.onclick = () => { selectDate(button.dataset.date); closeSheet(); });
  $('#calendar-today').onclick = () => { selectDate(localDate()); closeSheet(); };
}

$('#settings-form').addEventListener('input', () => { state.settingsDirty = true; $('#settings-error').textContent = ''; syncBack(); });
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  if (state.busy || !state.settingsLoaded) return;
  const template = $('#message-template').value.trim();
  if (!template) { $('#settings-error').textContent = 'Введите текст сообщения.'; return; }
  state.busy = true; render();
  const body = {reminders_enabled:$('#reminders').checked,reminder_template:template};
  const settingsForm = $('#settings-form');
  settingsForm.inert = true;
  try {
    await api('/api/settings',{method:'PUT',body:JSON.stringify(body)});
    state.settings = body;
    state.settingsDirty = false;
    notify('Настройки сохранены'); haptic('success');
  } catch(error) { $('#settings-error').textContent = error.message; }
  finally { settingsForm.inert = false; state.busy = false; syncBack(); render(); }
};
$$('.nav-item').forEach(button => button.onclick = () => setView(button.dataset.view));
$('#today').onclick = () => selectDate(localDate());
$('#prev-week').onclick = () => selectDate(addDays(state.date,-7));
$('#next-week').onclick = () => selectDate(addDays(state.date,7));
$('#open-calendar').onclick = () => openCalendar();
$('#add-booking').onclick = () => openBookingForm();
$('#client-search').oninput = renderClients;
$('#refresh').onclick = load;
$('#close-sheet').onclick = () => closeSheet();
sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
sheet.addEventListener('click', event => { if (event.target === sheet) { const r = sheet.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet(); } });
window.visualViewport?.addEventListener('resize',syncInsets);
safeTelegram(() => {
  tg?.ready(); tg?.expand();
  tg?.MainButton?.hide();
  tg?.onEvent('themeChanged',syncTheme);
  tg?.onEvent('safeAreaChanged',syncInsets);
  tg?.onEvent('contentSafeAreaChanged',syncInsets);
  tg?.onEvent('viewportChanged',syncInsets);
  tg?.BackButton?.onClick(() => sheet.open ? closeSheet() : setView('schedule'));
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',syncTheme);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !sheet.open) renderSchedule(); });
syncTheme();
renderSettings();
load();
