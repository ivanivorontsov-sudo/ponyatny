"use strict";
const fs = require("fs");
const path = require("path");

const SWIFT = `import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = ProgramViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class ProgramViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private var web: WKWebView!

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.scrollView.contentInsetAdjustmentBehavior = .always
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: prompt, message: nil, preferredStyle: .alert)
        alert.addTextField { field in field.text = defaultText }
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "ОК", style: .default) { _ in completionHandler(alert.textFields?.first?.text ?? "") })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "ОК", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
}
`;

const HTML = (title) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title.replace(/[<>&"]/g, "")}</title>
<style>
body{margin:0;padding:env(safe-area-inset-top) 14px 14px;font:16px -apple-system,system-ui,sans-serif;background:#0f1419;color:#e8eef5}
#log{background:#1a222c;border-radius:14px;padding:12px;white-space:pre-wrap;font:15px ui-monospace,Menlo,monospace;min-height:80px}
.err{color:#ff8a8a}.ok{color:#7CFC9A}
#screen{margin:10px 0}
</style>
</head>
<body>
<div id="screen"></div>
<div id="log"></div>
<script src="yadro.js"></script>
<script src="grafika.js"></script>
<script src="program.js"></script>
<script src="boot.js"></script>
</body>
</html>
`;

const BOOT = `(function () {
  var logEl = document.getElementById("log");
  function log(s, cls) { var d = document.createElement("span"); if (cls) d.className = cls; d.textContent = String(s) + "\\n"; logEl.appendChild(d); }
  var gfx = window.PonyatnyGrafika ? PonyatnyGrafika.create(document, { mount: document.getElementById("screen"), error: function (m) { log("Ошибка. " + m, "err"); } }) : undefined;
  var R = PonyatnyYadro.makeRuntime({
    write: function (s) { log(s); },
    writeErr: function (s) { log(s, "err"); },
    feature: function (s) { log("✔ " + s, "ok"); },
    ask: function (q) { var v = window.prompt(q || "Ввод", ""); return v === null || v === undefined ? null : v; },
    gfx: gfx,
    maxSteps: Infinity,
    args: []
  });
  try { window.__ponyatnyMain(R); }
  catch (e) {
    if (e && e.isExit) return;
    if (R.featureCatch(e)) return;
    log("Ошибка. " + (R.L ? "Строка " + R.L + ": " : "") + (e && e.isPon ? e.message : R.explain(e)), "err");
  }
})();
`;

const yamlStr = (s) => JSON.stringify(String(s));

function projectYml(name, title, bundleId, version) {
  return `name: ${name}
options:
  bundleIdPrefix: org.ponyatny
  deploymentTarget:
    iOS: "15.0"
targets:
  ${name}:
    type: application
    platform: iOS
    sources:
      - path: Sources
      - path: www
        type: folder
        buildPhase: resources
    info:
      path: Info.plist
      properties:
        CFBundleDisplayName: ${yamlStr(title)}
        CFBundleShortVersionString: ${yamlStr(version)}
        CFBundleVersion: "1"
        UILaunchScreen: {}
        ITSAppUsesNonExemptEncryption: false
        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait, UIInterfaceOrientationLandscapeLeft, UIInterfaceOrientationLandscapeRight]
        UISupportedInterfaceOrientations~ipad: [UIInterfaceOrientationPortrait, UIInterfaceOrientationPortraitUpsideDown, UIInterfaceOrientationLandscapeLeft, UIInterfaceOrientationLandscapeRight]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}
        PRODUCT_NAME: ${name}
        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1,2"
        MARKETING_VERSION: ${yamlStr(version)}
        CURRENT_PROJECT_VERSION: "1"
        CODE_SIGN_STYLE: Manual
`;
}

const BUILD_SH = (name) => `#!/bin/bash
# Сборка iOS-программы на Mac (или в GitHub Actions на macos-latest).
# Без переменных подписи собирается неподписанная сборка для симулятора — проверка, что всё компилируется.
# С подписью нужны переменные окружения (секреты CI), в коде и в папке ключей не хранится ничего:
#   IOS_TEAM_ID              — Team ID из Apple Developer (10 символов)
#   IOS_BUNDLE_ID            — идентификатор приложения, как в профиле (например, ru.vorontsov.igra)
#   IOS_CERT_P12_BASE64      — сертификат «Apple Distribution» или «Apple Development» в .p12, закодированный base64
#   IOS_CERT_PASSWORD        — пароль от .p12
#   IOS_PROFILE_BASE64       — профиль .mobileprovision, закодированный base64
#   IOS_EXPORT_METHOD        — app-store, ad-hoc или development (по умолчанию ad-hoc)
set -euo pipefail
cd "$(dirname "$0")"
NAME=${JSON.stringify(name)}
command -v xcodegen >/dev/null || brew install xcodegen
xcodegen generate --spec project.yml
mkdir -p build
if [ -z "\${IOS_CERT_P12_BASE64:-}" ]; then
  xcodebuild -project "$NAME.xcodeproj" -scheme "$NAME" -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO build
  APP=$(find build/dd -name "$NAME.app" -type d | head -1)
  (cd "$(dirname "$APP")" && zip -qry "$OLDPWD/build/$NAME-simulator.zip" "$NAME.app")
  echo "Готово (без подписи, для симулятора): build/$NAME-simulator.zip"
  exit 0
fi
: "\${IOS_TEAM_ID:?нужен IOS_TEAM_ID}" "\${IOS_CERT_PASSWORD:?нужен IOS_CERT_PASSWORD}" "\${IOS_PROFILE_BASE64:?нужен IOS_PROFILE_BASE64}"
METHOD="\${IOS_EXPORT_METHOD:-ad-hoc}"
TMP=$(mktemp -d)
trap 'security delete-keychain "$TMP/ponyatny.keychain-db" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
KC_PASS=$(uuidgen)
printf '%s' "$IOS_CERT_P12_BASE64" | base64 --decode > "$TMP/cert.p12"
printf '%s' "$IOS_PROFILE_BASE64" | base64 --decode > "$TMP/profile.mobileprovision"
security create-keychain -p "$KC_PASS" "$TMP/ponyatny.keychain-db"
security set-keychain-settings -lut 21600 "$TMP/ponyatny.keychain-db"
security unlock-keychain -p "$KC_PASS" "$TMP/ponyatny.keychain-db"
security import "$TMP/cert.p12" -P "$IOS_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$TMP/ponyatny.keychain-db"
security set-key-partition-list -S apple-tool:,apple: -k "$KC_PASS" "$TMP/ponyatny.keychain-db" >/dev/null
security list-keychain -d user -s "$TMP/ponyatny.keychain-db" $(security list-keychains -d user | tr -d '"')
security cms -D -i "$TMP/profile.mobileprovision" > "$TMP/profile.plist"
UUID=$(/usr/libexec/PlistBuddy -c "Print UUID" "$TMP/profile.plist")
PNAME=$(/usr/libexec/PlistBuddy -c "Print Name" "$TMP/profile.plist")
mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
cp "$TMP/profile.mobileprovision" "$HOME/Library/MobileDevice/Provisioning Profiles/$UUID.mobileprovision"
BID="\${IOS_BUNDLE_ID:-$(/usr/libexec/PlistBuddy -c 'Print Entitlements:application-identifier' "$TMP/profile.plist" | cut -d. -f2-)}"
IDENTITY=$( [ "$METHOD" = "development" ] && echo "Apple Development" || echo "Apple Distribution" )
xcodebuild -project "$NAME.xcodeproj" -scheme "$NAME" -configuration Release -sdk iphoneos -archivePath "build/$NAME.xcarchive" \\
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$BID" CODE_SIGN_STYLE=Manual \\
  CODE_SIGN_IDENTITY="$IDENTITY" PROVISIONING_PROFILE_SPECIFIER="$PNAME" OTHER_CODE_SIGN_FLAGS="--keychain $TMP/ponyatny.keychain-db" archive
cat > "$TMP/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>$METHOD</string>
<key>teamID</key><string>$IOS_TEAM_ID</string>
<key>signingStyle</key><string>manual</string>
<key>provisioningProfiles</key><dict><key>$BID</key><string>$PNAME</string></dict>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "build/$NAME.xcarchive" -exportOptionsPlist "$TMP/ExportOptions.plist" -exportPath build/ipa
codesign -dv --verbose=2 "build/$NAME.xcarchive/Products/Applications/$NAME.app" 2>&1 | grep -E "Authority|TeamIdentifier" || true
echo "Готово: $(ls build/ipa/*.ipa)"
`;

function asciiName(title, Y) {
  const t = Y.transliterate(String(title).replace(/[^\p{L}\p{N}]+/gu, "")).replace(/[^A-Za-z0-9]/g, "");
  return (t && /^[A-Za-z]/.test(t) ? t : "Programma" + t).slice(0, 40);
}

function makeIosProject(opts) {
  const { js, title, dir, Y } = opts;
  const name = asciiName(title, Y);
  const bundleId = opts.bundleId || "org.ponyatny." + name.toLowerCase();
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error("идентификатор приложения должен быть вида ru.imya.programma (латиница, цифры, точки, дефисы)");
  const files = {
    "project.yml": projectYml(name, title, bundleId, opts.version || "1.0"),
    "Sources/App.swift": SWIFT,
    "www/index.html": HTML(title),
    "www/boot.js": BOOT,
    "www/yadro.js": fs.readFileSync(path.join(__dirname, "yadro.js"), "utf8"),
    "www/grafika.js": fs.readFileSync(path.join(__dirname, "grafika.js"), "utf8"),
    "www/program.js": "window.__ponyatnyMain = function (__R) {\n\"use strict\";\n" + js + "\n};\n",
    "sobrat-ios.sh": BUILD_SH(name),
    "ЛИЦЕНЗИИ.txt": require("./licenzii.js"),
  };
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, "utf8");
  }
  fs.chmodSync(path.join(dir, "sobrat-ios.sh"), 0o755);
  return { name, bundleId, files: Object.keys(files) };
}

module.exports = { makeIosProject, asciiName };
