#!/bin/bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The DineFlow development protocol installer requires macOS." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd)"
handler_path="$script_dir/dineflow-dev-protocol-macos.sh"
application_source_path="$script_dir/DineFlowDevProtocolMain.m"

if [[ ! -f "$handler_path" ]]; then
  echo "Protocol handler was not found at $handler_path" >&2
  exit 1
fi

if [[ ! -f "$application_source_path" ]]; then
  echo "Protocol application source was not found at $application_source_path" >&2
  exit 1
fi

app_path="$HOME/Applications/DineFlow Dev Tools.app"
contents_path="$app_path/Contents"
macos_path="$contents_path/MacOS"
resources_path="$contents_path/Resources"

mkdir -p "$macos_path" "$resources_path"
cp "$handler_path" "$resources_path/dineflow-dev-protocol-macos.sh"
printf '%s\n' "$repository_root" > "$resources_path/repository-root"

cat > "$contents_path/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>DineFlow Dev Tools</string>
  <key>CFBundleExecutable</key>
  <string>dineflow-dev-tools</string>
  <key>CFBundleIdentifier</key>
  <string>com.dineflow.devtools</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>DineFlow Dev Tools</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.dineflow.devtools</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>dineflow-dev</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

xcrun clang \
  -fobjc-arc \
  "$application_source_path" \
  -o "$macos_path/dineflow-dev-tools" \
  -framework AppKit \
  -framework Carbon

chmod 755 "$resources_path/dineflow-dev-protocol-macos.sh"

/usr/bin/plutil -lint "$contents_path/Info.plist" >/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$app_path"

echo "Installed dineflow-dev:// protocol handler for the current macOS user."
echo "Application: $app_path"
