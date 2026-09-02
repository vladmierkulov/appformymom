# BookingApp for iOS

Native SwiftUI port of the Android BookingApp. It supports calendar-based appointment management, client name/phone/price, daily income, JSON backup/import, and daily local reminders.

## Open in Zed

Open this folder in Zed. The project is generated from `project.yml`, so the source remains simple and reviewable.

## Build locally on macOS

```sh
brew install xcodegen
xcodegen generate
open BookingApp.xcodeproj
```

Select your Apple development team in Xcode before installing on a physical device.

## GitHub Actions

The included workflow builds the app for the iOS Simulator on GitHub's macOS runner. Push the folder to a repository and it runs automatically. A signed IPA is deliberately not produced: it needs your Apple Developer certificate, provisioning profile, and App Store Connect settings.

## iOS difference

iOS forbids apps from silently sending SMS messages. The Android app's automatic SMS worker has been replaced with a scheduled local notification and a system Share action containing the rendered reminder text.

