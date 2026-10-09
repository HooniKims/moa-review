; MoaReview's document-desk artwork and Korean installation flow.
; Keep electron-builder's installation, upgrade and elevation logic intact.
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "24312C"
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH "FitControl"
!define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!define MUI_DIRECTORYPAGE_TEXT_TOP "그대로 설치하거나 다른 폴더를 선택하세요."
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
!ifndef BUILD_UNINSTALLER
  Var MoaTitleFont
  Var MoaLeadFont
  Var MoaBodyFont
  Var MoaSmallFont
!endif

!macro MoaLabel Y HEIGHT TEXT FONT COLOR
  ${NSD_CreateLabel} 120u ${Y}u 195u ${HEIGHT}u "${TEXT}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} ${FONT} 1
  SetCtlColors $0 "${COLOR}" "FFFFFF"
!macroend

!macro customInit
  ; Process-private fonts; nothing is installed into Windows.
  InitPluginsDir
  File /oname=$PLUGINSDIR\Pretendard-Regular.otf "${BUILD_RESOURCES_DIR}\installer\Pretendard-Regular.otf"
  File /oname=$PLUGINSDIR\Pretendard-SemiBold.otf "${BUILD_RESOURCES_DIR}\installer\Pretendard-SemiBold.otf"
  System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\Pretendard-Regular.otf", i 16, p 0) i .r0'
  System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\Pretendard-SemiBold.otf", i 16, p 0) i .r0'
  CreateFont $MoaTitleFont "Pretendard" 26 600
  CreateFont $MoaLeadFont "Pretendard" 14 400
  CreateFont $MoaBodyFont "Pretendard" 12 400
  CreateFont $MoaSmallFont "Pretendard" 10 400
!macroend

!macro customHeader
  SetFont "Pretendard" 11
  BrandingText "쎈Pick · 문서 대조"
!macroend

!macro customUnInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\Pretendard-Regular.otf "${BUILD_RESOURCES_DIR}\installer\Pretendard-Regular.otf"
  System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\Pretendard-Regular.otf", i 16, p 0) i .r0'
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "쎈Pick 설치"
  !define MUI_WELCOMEPAGE_TEXT ""
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoaWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
  Function MoaWelcomeShow
    ShowWindow $mui.WelcomePage.Title ${SW_HIDE}
    ShowWindow $mui.WelcomePage.Text ${SW_HIDE}
    !insertmacro MoaLabel 18 12 "학교 문서 검토" $MoaSmallFont "5A7A6C"
    !insertmacro MoaLabel 39 36 "쎈Pick 설치" $MoaTitleFont "173D33"
    !insertmacro MoaLabel 86 50 "학교의 여러 문서에서$\r$\n날짜·인원·장소·금액의$\r$\n차이를 찾아드립니다." $MoaLeadFont "24312C"
    !insertmacro MoaLabel 148 28 "HWPX · XLSX 지원$\r$\n문서 검사는 내 PC에서 진행됩니다." $MoaSmallFont "52675D"
    !insertmacro MoaLabel 182 12 "다음을 눌러 설치를 시작하세요." $MoaSmallFont "52675D"
  FunctionEnd
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "쎈Pick을 설치하고 있습니다"
  !define MUI_PAGE_HEADER_SUBTEXT "프로그램 파일을 복사하고 있습니다. 잠시만 기다려 주세요."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoaProgressShow
  Function MoaProgressShow
    CreateFont $0 "Pretendard" 12 600
    SendMessage $mui.Header.Text ${WM_SETFONT} $0 1
    SetCtlColors $mui.Header.Text "236959" "FFFFFF"
    FindWindow $1 "#32770" "" $HWNDPARENT
    GetDlgItem $1 $1 1004
    SendMessage $1 0x409 0 0x596923
  FunctionEnd
!macroend

!macro customFinishPage
  Function MoaStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "설치가 끝났습니다"
  !define MUI_FINISHPAGE_TEXT ""
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION MoaStartApp
  !define MUI_FINISHPAGE_RUN_TEXT "지금 쎈Pick 열기"
  !define MUI_FINISHPAGE_BUTTON "쎈Pick 열기"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW MoaFinishShow
  !insertmacro MUI_PAGE_FINISH
  Function MoaFinishShow
    ShowWindow $mui.FinishPage.Title ${SW_HIDE}
    ShowWindow $mui.FinishPage.Text ${SW_HIDE}
    ShowWindow $mui.FinishPage.Run ${SW_HIDE}
    !insertmacro MoaLabel 18 12 "설치 완료" $MoaSmallFont "5A7A6C"
    !insertmacro MoaLabel 39 36 "준비가 끝났습니다" $MoaTitleFont "173D33"
    !insertmacro MoaLabel 86 36 "문서를 불러와$\r$\n서로 다른 값을 확인하세요." $MoaLeadFont "24312C"
    !insertmacro MoaLabel 134 30 "앱의 ‘예제 불러오기’로$\r$\n바로 체험할 수 있습니다." $MoaBodyFont "52675D"
    ${NSD_CreateCheckbox} 120u 181u 195u 15u "지금 쎈Pick 열기"
    Pop $mui.FinishPage.Run
    SendMessage $mui.FinishPage.Run ${WM_SETFONT} $MoaBodyFont 1
    SetCtlColors $mui.FinishPage.Run "24312C" "FFFFFF"
    SendMessage $mui.FinishPage.Run ${BM_SETCHECK} ${BST_CHECKED} 0
    ${NSD_OnClick} $mui.FinishPage.Run MoaRunChanged
  FunctionEnd
  Function MoaRunChanged
    Pop $0
    ${NSD_GetState} $mui.FinishPage.Run $0
    ${If} $0 == ${BST_CHECKED}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:쎈Pick 열기"
    ${Else}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:닫기"
    ${EndIf}
  FunctionEnd
!macroend
