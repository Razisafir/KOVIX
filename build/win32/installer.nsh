; NSIS custom installer script for Construct IDE
!macro customHeader
  ; Custom header
!macroend

!macro customInit
  ; Check if Construct IDE is already running
  ${ifNot} ${isUpdated}
    nsExec::ExecToStack `"tasklist" /FI "IMAGENAME eq Construct IDE.exe"`
    ${If} ${ExecShell} "0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "Construct IDE is currently running. Please close it before installing." /SD IDOK
      Abort
    ${EndIf}
  ${endIf}
!macroend

!macro customInstall
  ; Custom install steps
!macroend

!macro customUnInstall
  ; Custom uninstall steps
!macroend

!macro customRemoveFiles
  ; Custom remove files
!macroend

!macro customInstallMode
  ; Set install mode
!macroend
