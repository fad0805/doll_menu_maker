@echo off
rem =====================================================================
rem  윈도우용 exe 빌드 스크립트
rem  - 이 파일을 윈도우에서 더블클릭하면 dist\doll_menu_maker.exe 가 만들어집니다.
rem  - 준비물: 파이썬 3 (https://www.python.org/downloads/ , "Add to PATH" 체크)
rem =====================================================================
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [오류] 파이썬(python)을 찾지 못했습니다.
  echo        https://www.python.org/downloads/ 에서 설치하고
  echo        설치 화면에서 "Add python.exe to PATH" 를 체크하세요.
  echo.
  pause
  exit /b 1
)

echo [1/2] PyInstaller 설치 중...
rem 다운로드가 가끔 끊겨(IncompleteRead) 실패하므로 몇 번 다시 시도합니다.
set PIP_TRY=0
:install
set /a PIP_TRY+=1
python -m pip install --upgrade pip pyinstaller --timeout 60 --retries 10
if errorlevel 1 (
  if %PIP_TRY% lss 5 (
    echo   설치가 끊겼습니다. 다시 시도합니다... (%PIP_TRY%/5)
    timeout /t 5 >nul
    goto install
  )
  echo [오류] PyInstaller 설치 실패 & pause & exit /b 1
)

echo.
echo [2/2] exe 빌드 중... (1~2분 걸립니다)
rem 아이콘을 쓰고 싶으면 assets\icon.ico 를 넣고 아래 줄 끝에  --icon "assets\icon.ico"  를 추가하세요.
python -m PyInstaller --noconfirm --clean --onefile --name doll_menu_maker --windowed ^
  --add-data "postcard-cards.html;." ^
  --add-data "postcard-cards.css;." ^
  --add-data "postcard-cards.js;." ^
  --add-data "themes;themes" ^
  --add-data "assets;assets" ^
  server.py
if errorlevel 1 ( echo [오류] 빌드 실패 & pause & exit /b 1 )

echo.
echo ============================================================
echo  완료!  dist\doll_menu_maker.exe 를 실행하면
echo  서버가 켜지고 기본 브라우저에서 바로 열립니다.
echo  (저장 데이터는 exe 옆의 save\ 폴더에 쌓입니다)
echo ============================================================
pause
