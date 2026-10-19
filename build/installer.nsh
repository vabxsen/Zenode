; Extra installer steps (electron-builder includes this file).
; Zenode installs per user, so SHCTX is HKEY_CURRENT_USER.

!macro customInstall
  ; zenode:// links. "--" stops Chromium reading switches from the link.
  WriteRegStr SHCTX "Software\Classes\zenode" "" "URL:Zenode link"
  WriteRegStr SHCTX "Software\Classes\zenode" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\zenode\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\zenode\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'

  ; Explorer: right-click a folder, or inside one, "Open folder as Zenode vault".
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Zenode" "" "Open folder as Zenode vault"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Zenode" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\Zenode\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--open-folder=%V"'
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Zenode" "" "Open folder as Zenode vault"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Zenode" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Zenode\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--open-folder=%V"'

  ; electron-builder registers .md and .canvas (just before this) with the program
  ; path unquoted, which breaks or misleads on paths with spaces. Quote it.
  WriteRegStr SHCTX "Software\Classes\Zenode.Note\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Zenode.Canvas\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; An update reinstalls over the old version; keep the entries then.
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\zenode"
    DeleteRegKey SHCTX "Software\Classes\Directory\shell\Zenode"
    DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Zenode"
  ${endIf}
!macroend
