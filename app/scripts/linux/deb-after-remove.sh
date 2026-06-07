#!/bin/sh
set -e
if [ -f /usr/share/mime/packages/cooklang.xml ]; then
    rm -f /usr/share/mime/packages/cooklang.xml
    if command -v update-mime-database >/dev/null 2>&1; then
        update-mime-database /usr/share/mime || true
    fi
fi
