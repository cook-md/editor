#!/bin/bash

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# Cooklang: remove the MIME definition installed by the after-install script,
# then refresh the MIME database.
if [ -f /usr/share/mime/packages/cooklang.xml ]; then
    rm -f /usr/share/mime/packages/cooklang.xml
    if hash update-mime-database 2>/dev/null; then
        update-mime-database /usr/share/mime || true
    fi
fi
