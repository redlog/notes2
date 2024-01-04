
# define name of installer
OutFile "localnotes_install"
 
# define installation directory
InstallDir $LOCALAPPDATA\Programs\myapp
 
# For removing Start Menu shortcut in Windows 7
RequestExecutionLevel user
 
# start default section
Section
 
    # set the installation directory as the destination for the following actions
    SetOutPath $INSTDIR
 
    # create the uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"
 
    # point the new shortcut at the program uninstaller
    CreateShortcut "$SMPROGRAMS\localnotes.lnk" "$INSTDIR\localnotes.exe"
    CreateShortcut "$SMPROGRAMS\uninstall.lnk" "$INSTDIR\uninstall.exe"

    File /r "C:\path\to\where\my\files\are\*"
    File /r "C:\path\to\where\my\files\are\*"

SectionEnd
 
# uninstaller section start
Section "uninstall"
 
    # first, delete the uninstaller
    Delete "$INSTDIR\uninstall.exe"
 
    # second, remove the link from the start menu
    Delete "$SMPROGRAMS\My App.lnk"
    Delete "$SMPROGRAMS\My App Uninstall.lnk"
 
    Delete $INSTDIR

# uninstaller section end
SectionEnd

