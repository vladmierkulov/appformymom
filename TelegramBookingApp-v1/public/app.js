// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand(); // Разворачиваем окно на всю высоту
}

// Элементы UI
const serviceSelect = document.getElementById('service-select');
const bookingDate = document.getElementById('booking-date');
const bookingTime = document.getElementById('booking-time');
const openModalBtn = document.getElementById('open-modal-btn');

const bookingModal = document.getElementById('booking-modal');
const cancelBtn = document.getElementById('cancel-btn');
const confirmBtn = document.getElementById('confirm-btn');

const clientPhone = document.getElementById('client-phone');
const phoneError = document.getElementById('phone-error');

// Открытие модального окна (проверяем параметры записи)
openModalBtn.addEventListener('click', () => {
  if (!serviceSelect.value || !bookingDate.value || !bookingTime.value) {
    alert('Пожалуйста, выберите услугу, дату и время.');
    return;
  }
  
  // Сбрасываем ошибки и открываем окно
  hideError();
  bookingModal.classList.remove('hidden');
});

// Кнопка ОТМЕНА — закрывает окно БЕЗ проверок
cancelBtn.addEventListener('click', (e) => {
  e.preventDefault(); // Предотвращаем любые стандартные действия
  closeModal();
});

// Закрытие модального окна при клике на фон вне карточки
bookingModal.addEventListener('click', (e) => {
  if (e.target === bookingModal) {
    closeModal();
  }
});

// Функция закрытия окна и сброса формы
function closeModal() {
  bookingModal.classList.add('hidden');
  hideError();
}

function hideError() {
  phoneError.classList.add('hidden');
  clientPhone.style.borderColor = 'rgba(0, 0, 0, 0.1)';
}

function showError() {
  phoneError.classList.remove('hidden');
  clientPhone.style.borderColor = 'var(--danger-color)';
}

// Валидация телефона (только цифры и плюс, не менее 10 символов)
function isValidPhone(phone) {
  const cleanPhone = phone.replace(/\D/g, '');
  return cleanPhone.length >= 10;
}

// Кнопка ПОДТВЕРДИТЬ — здесь выполняется проверка
confirmBtn.addEventListener('click', () => {
  const phoneValue = clientPhone.value.trim();

  // Проверка телефона ТОЛЬКО при отправке
  if (!isValidPhone(phoneValue)) {
    showError();
    return;
  }

  hideError();

  const bookingData = {
    service: serviceSelect.value,
    date: bookingDate.value,
    time: bookingTime.value,
    phone: phoneValue
  };

  // Отправляем данные в Telegram-бот и закрываем Mini App
  if (tg && tg.sendData) {
    tg.sendData(JSON.stringify(bookingData));
  } else {
    alert('Запись успешно создана!\n' + JSON.stringify(bookingData, null, 2));
    closeModal();
  }
});
