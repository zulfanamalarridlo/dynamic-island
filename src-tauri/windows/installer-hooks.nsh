!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\.env" env_exists
    CreateDirectory "$INSTDIR\resources"
    FileOpen $0 "$INSTDIR\resources\.env" w
    FileWrite $0 "CLICKUP_API_KEY=$\r$\n"
    FileWrite $0 "CLICKUP_LIST_IDS=901613807168$\r$\n"
    FileClose $0
  env_exists:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DynamicIsland"
!macroend
