import SwiftUI
import UserNotifications
import UniformTypeIdentifiers

@main
struct BookingApp: App {
    @StateObject private var store = BookingStore()

    var body: some Scene {
        WindowGroup {
            BookingRootView()
                .environmentObject(store)
        }
    }
}

struct Booking: Codable, Identifiable, Equatable {
    var id = UUID()
    var date: Date
    var time: String
    var name: String
    var phone: String
    var price: Double
}

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

@MainActor
final class BookingStore: ObservableObject {
    @Published private(set) var bookings: [Booking] = [] { didSet { save() } }
    @Published var financeEnabled = true { didSet { defaults.set(financeEnabled, forKey: "financeEnabled") } }
    @Published var remindersEnabled = false { didSet { defaults.set(remindersEnabled, forKey: "remindersEnabled") } }
    @Published var reminderTemplate = "Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}." { didSet { defaults.set(reminderTemplate, forKey: "reminderTemplate") } }
    @Published var firstWeekdayMonday = true { didSet { defaults.set(firstWeekdayMonday, forKey: "firstWeekdayMonday") } }

    private let defaults = UserDefaults.standard
    private let bookingsKey = "bookings.v1"

    init() {
        financeEnabled = defaults.object(forKey: "financeEnabled") as? Bool ?? true
        remindersEnabled = defaults.bool(forKey: "remindersEnabled")
        firstWeekdayMonday = defaults.object(forKey: "firstWeekdayMonday") as? Bool ?? true
        reminderTemplate = defaults.string(forKey: "reminderTemplate") ?? reminderTemplate
        guard let data = defaults.data(forKey: bookingsKey),
              let loaded = try? JSONDecoder().decode([Booking].self, from: data) else { return }
        bookings = loaded
    }

    func bookings(on date: Date) -> [Booking] { bookings.filter { Calendar.current.isDate($0.date, inSameDayAs: date) }.sorted { $0.time < $1.time } }
    func count(on date: Date) -> Int { bookings(on: date).count }
    func income(on date: Date) -> Double { bookings(on: date).reduce(0) { $0 + $1.price } }
    func save(_ booking: Booking) {
        if let index = bookings.firstIndex(where: { $0.id == booking.id }) { bookings[index] = booking } else { bookings.append(booking) }
    }
    func delete(_ booking: Booking) { bookings.removeAll { $0.id == booking.id } }
    func exportData() -> Data { (try? JSONEncoder().encode(bookings)) ?? Data() }
    func importData(_ data: Data) throws { bookings = try JSONDecoder().decode([Booking].self, from: data) }

    func scheduleReminder() async throws {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else { return }
        await center.removePendingNotificationRequests(withIdentifiers: ["booking-reminder"])
        guard remindersEnabled else { return }
        var components = DateComponents(); components.hour = 10; components.minute = 0
        let content = UNMutableNotificationContent()
        content.title = "Напоминания о записях"
        content.body = "Проверьте завтрашние записи и отправьте клиентам напоминания."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "booking-reminder", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true))
        try await center.add(request)
    }

    func reminderMessage(for booking: Booking) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale.current; formatter.dateStyle = .long
        return reminderTemplate.replacingOccurrences(of: "{name}", with: booking.name)
            .replacingOccurrences(of: "{date}", with: formatter.string(from: booking.date))
            .replacingOccurrences(of: "{time}", with: booking.time)
    }

    private func save() { defaults.set(try? JSONEncoder().encode(bookings), forKey: bookingsKey) }
}

struct BookingRootView: View {
    @EnvironmentObject private var store: BookingStore
    @State private var month = Date()
    @State private var selectedDate = Date()
    @State private var showSettings = false
    @State private var exportDocument: BackupDocument?
    @State private var showImporter = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    CalendarGrid(month: $month, selectedDate: $selectedDate)
                    AgendaView(date: selectedDate)
                }.padding()
            }
            .navigationTitle("BookingApp")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Сегодня") { month = Date(); selectedDate = Date() } }
                ToolbarItem(placement: .topBarTrailing) { Button { showSettings = true } label: { Image(systemName: "gearshape") } }
            }
            .sheet(isPresented: $showSettings) { SettingsView(exportDocument: $exportDocument, showImporter: $showImporter) }
            .fileExporter(isPresented: Binding(get: { exportDocument != nil }, set: { if !$0 { exportDocument = nil } }), document: exportDocument, contentType: .json, defaultFilename: "bookings-backup") { result in
                if case .failure(let error) = result { errorMessage = error.localizedDescription }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                do { try store.importData(try Data(contentsOf: result.get())) } catch { errorMessage = "Не удалось импортировать резервную копию: \(error.localizedDescription)" }
            }
            .alert("Ошибка", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
        }
    }
}

struct CalendarGrid: View {
    @EnvironmentObject private var store: BookingStore
    @Binding var month: Date
    @Binding var selectedDate: Date
    private let calendar = Calendar.current
    private var days: [Date] {
        let interval = calendar.dateInterval(of: .month, for: month)!
        let first = interval.start
        let weekday = calendar.component(.weekday, from: first)
        let offset = store.firstWeekdayMonday ? (weekday + 5) % 7 : weekday - 1
        return (-offset..<(42 - offset)).compactMap { calendar.date(byAdding: .day, value: $0, to: first) }
    }
    private var title: String { let f = DateFormatter(); f.locale = Locale.current; f.dateFormat = "LLLL yyyy"; return f.string(from: month).capitalized }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button { month = calendar.date(byAdding: .month, value: -1, to: month)! } label: { Image(systemName: "chevron.left") }
                Spacer(); Text(title).font(.title3.bold()); Spacer()
                Button { month = calendar.date(byAdding: .month, value: 1, to: month)! } label: { Image(systemName: "chevron.right") }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 8) {
                ForEach(store.firstWeekdayMonday ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"], id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                ForEach(days, id: \.self) { day in
                    Button { selectedDate = day } label: {
                        VStack(spacing: 2) {
                            Text("\(calendar.component(.day, from: day))").fontWeight(calendar.isDate(day, inSameDayAs: selectedDate) ? .bold : .regular)
                            Circle().fill(store.count(on: day) > 0 ? Color.accentColor : .clear).frame(width: 5, height: 5)
                        }.frame(maxWidth: .infinity, minHeight: 38).background(calendar.isDate(day, inSameDayAs: selectedDate) ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    }.tint(calendar.isDate(day, equalTo: month, toGranularity: .month) ? .primary : .secondary)
                }
            }
        }.padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct AgendaView: View {
    @EnvironmentObject private var store: BookingStore
    let date: Date
    @State private var editing: Booking?
    private let hours = Array(9...20).map { String(format: "%02d:00", $0) }
    private var bookings: [Booking] { store.bookings(on: date) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(date.formatted(.dateTime.weekday(.wide).day().month(.wide))).font(.title3.bold())
            if store.financeEnabled { Text("Доход за день: \(store.income(on: date), format: .currency(code: "EUR"))").foregroundStyle(.secondary) }
            ForEach(hours, id: \.self) { time in
                let booking = bookings.first { $0.time == time }
                Button { editing = booking ?? Booking(date: date, time: time, name: "", phone: "", price: 0) } label: {
                    HStack { Text(time).monospacedDigit().foregroundStyle(.secondary); Divider(); Text(booking?.name.isEmpty == false ? booking!.name : "Свободно").foregroundStyle(booking == nil ? .secondary : .primary); Spacer(); if let booking, store.financeEnabled { Text(booking.price, format: .currency(code: "EUR")) } }
                        .padding(12).background(booking == nil ? Color.clear : Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
            ForEach(bookings.filter { !hours.contains($0.time) }) { booking in
                Button { editing = booking } label: { HStack { Text(booking.time); Text(booking.name); Spacer() } }.buttonStyle(.plain)
            }
        }
        .sheet(item: $editing) { BookingEditor(booking: $0) }
    }
}

struct BookingEditor: View {
    @EnvironmentObject private var store: BookingStore
    @Environment(\.dismiss) private var dismiss
    @State var booking: Booking
    var body: some View {
        NavigationStack {
            Form {
                Section("Запись") { Text("\(booking.date.formatted(date: .long, time: .omitted)), \(booking.time)"); TextField("Имя клиента", text: $booking.name); TextField("Телефон", text: $booking.phone).keyboardType(.phonePad); if store.financeEnabled { TextField("Цена", value: $booking.price, format: .number).keyboardType(.decimalPad) } }
                if !booking.phone.isEmpty && !booking.name.isEmpty { Section { ShareLink(item: store.reminderMessage(for: booking)) { Label("Поделиться напоминанием", systemImage: "message") } } footer: { Text("iOS не позволяет приложению автоматически отправлять SMS. Эта кнопка откроет системное меню, где вы выберете способ отправки.") } }
                if store.bookings.contains(where: { $0.id == booking.id }) { Section { Button("Удалить запись", role: .destructive) { store.delete(booking); dismiss() } } }
            }
            .navigationTitle("Запись").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Сохранить") { if booking.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { store.delete(booking) } else { store.save(booking) }; dismiss() } } }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: BookingStore
    @Environment(\.dismiss) private var dismiss
    @Binding var exportDocument: BackupDocument?
    @Binding var showImporter: Bool
    @State private var reminderError: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Отображение") { Toggle("Показывать финансы", isOn: $store.financeEnabled); Toggle("Неделя начинается с понедельника", isOn: $store.firstWeekdayMonday) }
                Section("Напоминания") { Toggle("Ежедневное напоминание в 10:00", isOn: $store.remindersEnabled).onChange(of: store.remindersEnabled) { _, _ in Task { do { try await store.scheduleReminder() } catch { reminderError = error.localizedDescription } } }; TextField("Шаблон", text: $store.reminderTemplate, axis: .vertical); Text("Можно использовать {name}, {date} и {time}. iOS покажет локальное уведомление; автоматическая отправка SMS запрещена системой.").font(.footnote).foregroundStyle(.secondary) }
                Section("Данные") { Button("Экспортировать JSON") { exportDocument = BackupDocument(data: store.exportData()) }; Button("Импортировать JSON") { showImporter = true } }
            }.navigationTitle("Настройки").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
            .alert("Не удалось настроить напоминание", isPresented: Binding(get: { reminderError != nil }, set: { if !$0 { reminderError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(reminderError ?? "") }
        }
    }
}

