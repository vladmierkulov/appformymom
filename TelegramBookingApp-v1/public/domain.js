/** Pure booking/calendar helpers shared by the interface and unit tests. */

export function localDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local noon avoids crossing the calendar date around timezone/DST changes. */
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN);
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return new Date(NaN);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : new Date(NaN);
}

export function addDays(value, amount) {
  const date = parseDate(value);
  date.setDate(date.getDate() + Number(amount));
  return localDate(date);
}

export function weekDates(value) {
  const date = parseDate(value);
  if (!Number.isFinite(date.getTime())) return [];
  const monday = addDays(value, -((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function monthCells(value) {
  const date = parseDate(value);
  if (!Number.isFinite(date.getTime())) return [];
  date.setDate(1);
  const first = localDate(date);
  const prefix = (date.getDay() + 6) % 7;
  date.setMonth(date.getMonth() + 1, 0);
  return [...Array(prefix).fill(null), ...Array.from({ length: date.getDate() }, (_, index) => addDays(first, index))];
}

export function suggestedTimes(bookings, date, excludeId = null, now = new Date()) {
  const day = parseDate(date);
  if (!Number.isFinite(day.getTime())) return [];
  const occupied = new Set((bookings || []).filter(booking => booking.date === date && (excludeId === null || booking.id !== excludeId)).map(booking => booking.time));
  const today = date === localDate(now);
  const result = [];
  for (let minutes = 9 * 60; minutes <= 19 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const start = new Date(day);
    start.setHours(hour, minute, 0, 0);
    if (occupied.has(time) || (today && start.getTime() < now.getTime())) continue;
    result.push(time);
    if (result.length === 4) break;
  }
  return result;
}

export function nextTime(bookings, date, now = new Date()) {
  return suggestedTimes(bookings, date, null, now)[0] || '09:00';
}

function chronologicalDescending(a, b) {
  return `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`) || String(a.id || '').localeCompare(String(b.id || ''));
}

export function groupClients(bookings) {
  const groups = new Map();
  for (const booking of bookings || []) {
    const name = String(booking.name || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const phone = String(booking.phone || '').replace(/\D/g, '');
    const key = phone ? `phone:${phone}` : `name:${name.toLocaleLowerCase('ru-RU')}`;
    if (!groups.has(key)) groups.set(key, { key, records: [] });
    groups.get(key).records.push(booking);
  }
  return [...groups.values()].map(group => {
    const records = group.records.sort(chronologicalDescending);
    const latest = records[0];
    return {
      key: group.key,
      name: String(latest.name || '').trim(),
      phone: String(latest.phone || '').trim(),
      records,
      count: records.length,
      total: records.reduce((sum, record) => sum + (Number.isFinite(Number(record.price)) ? Number(record.price) : 0), 0),
      latest,
    };
  }).sort((a, b) => chronologicalDescending(a.latest, b.latest));
}

export function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('ru-RU');
}

export function formatMessage(template, booking) {
  const date = parseDate(booking.date);
  const values = {
    name: String(booking.name || ''),
    date: Number.isFinite(date.getTime()) ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : String(booking.date || ''),
    time: String(booking.time || ''),
  };
  // One replacement pass: placeholders present inside a client's name stay literal.
  return String(template || '').replace(/\{(name|date|time)\}/g, (_, field) => values[field]);
}

export function validateBooking(fields) {
  if (!fields || typeof fields.name !== 'string' || !fields.name.trim()) return 'Введите имя клиента.';
  if (fields.name.trim().length > 120) return 'Имя не должно быть длиннее 120 символов.';
  if (!Number.isFinite(parseDate(fields.date).getTime())) return 'Выберите существующую дату.';
  if (typeof fields.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) return 'Укажите время в формате ЧЧ:ММ.';
  if (fields.phone != null && (typeof fields.phone !== 'string' || fields.phone.length > 40)) return 'Телефон не должен быть длиннее 40 символов.';
  const price = fields.price === '' || fields.price == null ? 0 : Number(fields.price);
  if (typeof fields.price === 'boolean' || !Number.isFinite(price) || price < 0 || price > 999999999.99) return 'Укажите стоимость от 0 до 999 999 999,99.';
  return '';
}

export function money(amount, currency = 'RUB') {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
