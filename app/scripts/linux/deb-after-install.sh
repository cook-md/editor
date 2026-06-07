#!/bin/sh
set -e
# Locate the MIME definition shipped inside the installed app tree (under /opt).
# Using `find` avoids hard-coding a path containing the space in the product name.
SRC="$(find /opt -maxdepth 4 -name cooklang-mime.xml 2>/dev/null | head -1)"
if [ -n "$SRC" ] && command -v update-mime-database >/dev/null 2>&1; then
    install -Dm644 "$SRC" /usr/share/mime/packages/cooklang.xml
    update-mime-database /usr/share/mime || true
fi
# Refresh the desktop application database so the file association is picked up.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi
