// swift-tools-version: 5.9
import PackageDescription

let package = Package(name: "BotHQ", platforms: [.macOS(.v13)], products: [.executable(name: "BotHQ", targets: ["BotHQ"]), .executable(name: "NativeFilePicker", targets: ["NativeFilePicker"])], targets: [.target(name: "NativePanelFactory", publicHeadersPath: "include"), .executableTarget(name: "BotHQ", dependencies: ["NativePanelFactory"]), .executableTarget(name: "NativeFilePicker", dependencies: ["NativePanelFactory"]) ])
