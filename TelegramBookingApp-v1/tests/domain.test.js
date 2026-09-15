import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, parseDate, addDays, weekDates, monthCells, suggestedTimes, nextTime, groupClients, initials, formatMessage, validateBooking, money } from '../public/domain.js';

const valid = { name: 'Анна', date: '2028-02-29', time: '09:30', phone: '', price: 0 };

test('local dates use local fields including both sides of midnight', () => {
  const date = new Date(2026, 8, 15, 0, 0, 0);
  assert.equal(localDate(date), '2026-09-15');
  assert.equal(localDate(new Date(2026, 8, 14, 23, 59, 59)), '2026-09-14');
  assert.equal(localDate(new Date(NaN)), '');
  assert.equal(parseDate('2026-09-15').getHours(), 12);
  assert.equal(localDate(parseDate('0099-01-02')), '0099-01-02');
});

test('real-date validation handles leap centuries and malformed input', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-12-31']) assert.equal(localDate(parseDate(date)), date);
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '2026-9-01', '', null]) assert.ok(Number.isNaN(parseDate(date).getTime()), `${date} should be rejected`);
});

test('day arithmetic and Monday-first weeks cross month and year boundaries', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.deepEqual(weekDates('2027-01-01'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepEqual(weekDates('2027-01-03'), weekDates('2027-01-01'));
});

test('month cells have only leading blank cells and every real day', () => {
  const february = monthCells('2028-02-20');
  assert.equal(february[0], null);
  assert.equal(february[1], '2028-02-01');
  assert.equal(february.at(-1), '2028-02-29');
  assert.equal(february.length, 30);
  const february2027 = monthCells('2027-02-01');
  assert.equal(february2027[0], '2027-02-01');
  assert.equal(february2027.length, 28);
  assert.deepEqual(monthCells('invalid'), []);
});

test('suggestions include half hours, skip conflicts, and allow excluded booking', () => {
  const bookings = [
    { id: 'a', date: '2026-09-16', time: '09:30' },
    { id: 'b', date: '2026-09-16', time: '10:00' },
    { id: 'c', date: '2026-09-15', time: '09:00' },
  ];
  const now = new Date(2026, 8, 15, 8, 0);
  assert.deepEqual(suggestedTimes(bookings, '2026-09-16', null, now), ['09:00', '10:30', '11:00', '11:30']);
  assert.deepEqual(suggestedTimes(bookings, '2026-09-16', 'a', now), ['09:00', '09:30', '10:30', '11:00']);
  assert.equal(nextTime(bookings, '2026-09-16', now), '09:00');
});

test('today suggestions do not offer elapsed starts, including seconds', () => {
  assert.deepEqual(suggestedTimes([], '2026-09-15', null, new Date(2026, 8, 15, 9, 30)), ['09:30', '10:00', '10:30', '11:00']);
  assert.deepEqual(suggestedTimes([], '2026-09-15', null, new Date(2026, 8, 15, 9, 30, 1)), ['10:00', '10:30', '11:00', '11:30']);
  assert.deepEqual(suggestedTimes([], '2026-09-15', null, new Date(2026, 8, 15, 18, 59)), ['19:00']);
  assert.deepEqual(suggestedTimes([], '2026-09-15', null, new Date(2026, 8, 15, 19, 1)), []);
  assert.equal(nextTime([], '2026-09-15', new Date(2026, 8, 15, 20)), '09:00');
});

test('fully booked days offer no suggestion and do not hide non-hour bookings', () => {
  const bookings = Array.from({ length: 21 }, (_, index) => ({ id: String(index), date: '2026-09-16', time: `${String(9 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}` }));
  assert.deepEqual(suggestedTimes(bookings, '2026-09-16'), []);
  assert.equal(bookings[1].time, '09:30');
});

test('clients group by normalized phone or name, with latest contact details', () => {
  const bookings = [
    { id: 'old', name: 'Анна', phone: '+370 (000) 00 000', date: '2026-08-01', time: '09:00', price: 30 },
    { id: 'new', name: 'Анна К.', phone: '+37000000000', date: '2026-09-01', time: '12:30', price: 45 },
    { id: 'other', name: 'Анна', phone: '', date: '2026-09-02', time: '10:00', price: 20 },
    { id: 'n1', name: ' Елена  Морозова ', phone: '', date: '2026-09-03', time: '13:00', price: 40 },
    { id: 'n2', name: 'елена морозова', phone: '', date: '2026-09-03', time: '09:00', price: 20 },
  ];
  const before = JSON.stringify(bookings);
  const clients = groupClients(bookings);
  assert.equal(clients.length, 3);
  assert.equal(clients[0].key, 'name:елена морозова');
  assert.deepEqual(clients[0].records.map(item => item.id), ['n1', 'n2']);
  assert.equal(clients[0].count, 2);
  assert.equal(clients[0].total, 60);
  const anna = clients.find(client => client.key === 'phone:37000000000');
  assert.equal(anna.name, 'Анна К.');
  assert.equal(anna.phone, '+37000000000');
  assert.deepEqual(anna.records.map(item => item.id), ['new', 'old']);
  assert.equal(anna.latest.id, 'new');
  assert.equal(JSON.stringify(bookings), before, 'input records are not mutated');
});

test('initials are at most two Unicode letters', () => {
  assert.equal(initials('  Анна   Ковалёва Петровна '), 'АК');
  assert.equal(initials('елена'), 'Е');
  assert.equal(initials(''), '');
});

test('message substitutions are one-pass and preserve unknown placeholders', () => {
  const message = formatMessage('{name}, {date}, {time}; {name}; {other}', { name: '{time} $&', date: '2028-02-29', time: '10:30' });
  assert.equal(message, '{time} $&, 29 февраля 2028 г., 10:30; {time} $&; {other}');
});

test('booking validation accepts valid optional values and exact limits', () => {
  assert.equal(validateBooking(valid), '');
  assert.equal(validateBooking({ ...valid, price: '999999999.99', name: 'a'.repeat(120), phone: '1'.repeat(40), time: '23:59' }), '');
  assert.equal(validateBooking({ ...valid, price: '', phone: undefined }), '');
  assert.equal(validateBooking({ ...valid, time: '00:00' }), '');
});

test('booking validation rejects malformed and unsafe values', () => {
  for (const fields of [
    null, { ...valid, name: '   ' }, { ...valid, name: 'a'.repeat(121) },
    { ...valid, date: '2027-02-29' }, { ...valid, time: '24:00' }, { ...valid, time: '09:60' }, { ...valid, time: '9:30' },
    { ...valid, phone: '1'.repeat(41) }, { ...valid, phone: {} },
    { ...valid, price: -1 }, { ...valid, price: Infinity }, { ...valid, price: NaN }, { ...valid, price: 'not a number' }, { ...valid, price: 1000000000 }, { ...valid, price: true },
  ]) assert.notEqual(validateBooking(fields), '', JSON.stringify(fields));
});

test('money formats Russian currency with whole and fractional amounts', () => {
  assert.match(money(1200), /1\s200\s₽/);
  assert.match(money(12.5), /12,50\s₽/);
  assert.match(money(45, 'EUR'), /45\s€/);
});
