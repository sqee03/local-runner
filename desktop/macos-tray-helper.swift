import Cocoa
import Darwin
import Foundation

struct LaunchConfiguration {
  let appURL: URL
  let runnerURL: URL
  let launcherPID: pid_t
  let shellPID: pid_t?
  let terminalProgram: String?
  let terminalTTY: String?
}

func parseArguments() -> LaunchConfiguration? {
  var appURL: URL?
  var runnerURL: URL?
  var launcherPID: pid_t?
  var shellPID: pid_t?
  var terminalProgram: String?
  var terminalTTY: String?

  let arguments = CommandLine.arguments
  var index = 1

  while index < arguments.count {
    let argument = arguments[index]

    switch argument {
    case "--app-url":
      guard index + 1 < arguments.count else { return nil }
      appURL = URL(string: arguments[index + 1])
      index += 2
    case "--runner-url":
      guard index + 1 < arguments.count else { return nil }
      runnerURL = URL(string: arguments[index + 1])
      index += 2
    case "--launcher-pid":
      guard index + 1 < arguments.count, let value = Int32(arguments[index + 1]) else {
        return nil
      }
      launcherPID = value
      index += 2
    case "--shell-pid":
      guard index + 1 < arguments.count, let value = Int32(arguments[index + 1]) else {
        return nil
      }
      shellPID = value
      index += 2
    case "--terminal-program":
      guard index + 1 < arguments.count else { return nil }
      terminalProgram = arguments[index + 1]
      index += 2
    case "--terminal-tty":
      guard index + 1 < arguments.count else { return nil }
      terminalTTY = arguments[index + 1]
      index += 2
    default:
      index += 1
    }
  }

  guard let appURL, let runnerURL, let launcherPID else {
    return nil
  }

  return LaunchConfiguration(
    appURL: appURL,
    runnerURL: runnerURL,
    launcherPID: launcherPID,
    shellPID: shellPID,
    terminalProgram: terminalProgram,
    terminalTTY: terminalTTY
  )
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private let configuration: LaunchConfiguration
  private var statusItem: NSStatusItem?
  private var launcherMonitor: Timer?

  init(configuration: LaunchConfiguration) {
    self.configuration = configuration
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)

    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    self.statusItem = statusItem

    if let button = statusItem.button {
      button.image = makeStatusIcon()
      button.imagePosition = .imageOnly
      button.toolTip = "runner"
    }

    let menu = NSMenu()
    menu.addItem(withTitle: "Open Simulator", action: #selector(openApp), keyEquivalent: "")
    menu.addItem(withTitle: "Open config", action: #selector(openRunner), keyEquivalent: "")
    menu.addItem(NSMenuItem.separator())
    menu.addItem(withTitle: "Quit", action: #selector(quitRunner), keyEquivalent: "q")

    for item in menu.items {
      item.target = self
    }

    statusItem.menu = menu

    launcherMonitor = Timer.scheduledTimer(
      timeInterval: 2,
      target: self,
      selector: #selector(checkLauncher),
      userInfo: nil,
      repeats: true
    )
  }

  @objc private func openApp() {
    NSWorkspace.shared.open(configuration.appURL)
  }

  @objc private func openRunner() {
    NSWorkspace.shared.open(configuration.runnerURL)
  }

  @objc private func quitRunner() {
    kill(configuration.launcherPID, SIGTERM)
    if let shellPID = configuration.shellPID {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
        kill(shellPID, SIGHUP)
      }
    }
    let delayedTermination = closeOwningTerminalIfPossible()

    if delayedTermination {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        NSApp.terminate(nil)
      }
      return
    }

    NSApp.terminate(nil)
  }

  @objc private func checkLauncher() {
    if kill(configuration.launcherPID, 0) != 0 {
      NSApp.terminate(nil)
    }
  }

  private func makeStatusIcon() -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let image = NSImage(size: size)

    image.lockFocus()

    NSColor.black.setFill()
    NSBezierPath(ovalIn: NSRect(x: 1, y: 1, width: 16, height: 16)).fill()

    let style = NSMutableParagraphStyle()
    style.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: 11, weight: .bold),
      .foregroundColor: NSColor.white,
      .paragraphStyle: style
    ]

    let textRect = NSRect(x: 1, y: 2.5, width: 16, height: 12)
    NSString(string: "S").draw(in: textRect, withAttributes: attributes)

    image.unlockFocus()
    image.isTemplate = false
    return image
  }

  private func closeOwningTerminalIfPossible() -> Bool {
    guard let terminalProgram = configuration.terminalProgram, let terminalTTY = configuration.terminalTTY else {
      return false
    }

    let script: String?

    switch terminalProgram {
    case "Apple_Terminal":
      script = """
      tell application "Terminal"
        repeat with w in windows
          repeat with t in tabs of w
            if tty of t is "\(terminalTTY)" then
              do script "exit" in t
              delay 0.8
              close w saving no
              return
            end if
          end repeat
        end repeat
      end tell
      """
    case "iTerm.app", "iTerm2":
      script = """
      tell application "iTerm"
        repeat with currentWindow in windows
          repeat with currentTab in tabs of currentWindow
            repeat with currentSession in sessions of currentTab
              if tty of currentSession is "\(terminalTTY)" then
                tell currentSession to write text "exit"
                delay 0.8
                close currentWindow
                return
              end if
            end repeat
          end repeat
        end repeat
      end tell
      """
    default:
      script = nil
    }

    guard let script else {
      return false
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
      process.arguments = ["-e", script]
      try? process.run()
    }

    return true
  }
}

guard let configuration = parseArguments() else {
  fputs("Missing required tray helper arguments.\n", stderr)
  exit(1)
}

let app = NSApplication.shared
let delegate = AppDelegate(configuration: configuration)
app.delegate = delegate
app.run()
