; The app was called TOEICER Studio before. Tauri installs by product name, so an update under the new name lands in a
; new folder and would leave the old copy and its shortcuts behind. The old one goes first: uninstalling it afterwards
; would undo the new install's link to the app's set files. A silent uninstall keeps the app's data, whose folder goes by
; the identifier, which did not change. It runs from its own folder (_?=) so that this installer waits for it to finish.
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TOEICER Studio" "InstallLocation"
  StrCmp $R1 "" oldAppGone
    StrCpy $R2 $R1 1
    StrCmp $R2 '"' 0 +2
      StrCpy $R1 $R1 -1 1
    IfFileExists "$R1\uninstall.exe" 0 oldAppGone
      ExecWait '"$R1\uninstall.exe" /S _?=$R1'
      Delete "$R1\uninstall.exe"
      RMDir "$R1"
  oldAppGone:
!macroend
