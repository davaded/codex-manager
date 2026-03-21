!searchreplace CLIBINARYSRCPATH "${MAINBINARYSRCPATH}" "codex-manager.exe" "codex-manager-cli.exe"

Function AddCodexManagerCliToPath
  ExecWait '"$INSTDIR\codex-manager-cli.exe" internal add-to-path "$INSTDIR\bin"' $0
FunctionEnd

Function un.RemoveCodexManagerCliFromPath
  ExecWait '"$INSTDIR\codex-manager-cli.exe" internal remove-from-path "$INSTDIR\bin"' $0
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\bin"
  File "/oname=codex-manager-cli.exe" "${CLIBINARYSRCPATH}"
  FileOpen $0 "$INSTDIR\bin\codex-manager.cmd" "w"
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "$\"%~dp0..\codex-manager-cli.exe$\" %*$\r$\n"
  FileClose $0
  Call AddCodexManagerCliToPath
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Call un.RemoveCodexManagerCliFromPath
  Delete "$INSTDIR\codex-manager-cli.exe"
  Delete "$INSTDIR\bin\codex-manager.cmd"
  RMDir "$INSTDIR\bin"
!macroend
