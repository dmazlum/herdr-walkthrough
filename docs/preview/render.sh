#!/bin/sh
# Renders docs/preview/index.html to preview.png (2560×1280) with a headless Chromium.
# CHROME: the browser binary; by default Playwright's chrome-headless-shell (`npx playwright install
# chromium-headless-shell`), whose page is exactly the window size.
cd "$(dirname "$0")/../.." || exit 1
chrome=${CHROME:-$(ls "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -n 1)}
[ -x "$chrome" ] || { echo "No headless Chromium; set CHROME" >&2; exit 1; }
"$chrome" --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=2560,1280 \
  --virtual-time-budget=5000 --screenshot="$PWD/preview.png" "file://$PWD/docs/preview/index.html" >/dev/null 2>&1
