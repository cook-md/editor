; Custom NSIS steps, included by electron-builder (see `nsis.include` in electron-builder.yml).

!macro customInstall
  ; Electron 44 refuses to start (fatal log in install_dir_access.cc, Sentry EDITOR-1M) when its
  ; sandboxed processes cannot read the install folder. That happens when the folder's ACL has an
  ; entry for an AppContainer package SID but none for ALL APPLICATION PACKAGES (S-1-15-2-1),
  ; e.g. after security software rewrote it. Grant that group read/execute so a (re)install repairs
  ; the folder. A failure here is logged and ignored: on a normal ACL the grant is a no-op.
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX)'
  Pop $0
!macroend
