# 윈도우 exe 만들기 · 사용하기

`doll_menu_maker.exe` 는 **로컬 서버를 켜고 기본 브라우저를 자동으로 여는** 실행 파일입니다.
파이썬이 설치돼 있지 않은 윈도우 PC에서도 그냥 더블클릭으로 쓸 수 있습니다.

---

## 1) exe 얻는 방법

### 방법 A. GitHub Actions 로 자동 빌드 (추천 · 윈도우 PC 불필요)

1. GitHub 저장소 → **Actions** 탭
2. 왼쪽에서 **Build Windows EXE** 선택 → **Run workflow** 클릭
3. 1~2분 뒤 완료되면, 그 실행 결과 페이지 아래 **Artifacts** 에서
   `doll_menu_maker-windows` 를 내려받습니다. (압축 안에 `doll_menu_maker.exe`)

> `v1.0.0` 같은 **태그를 push** 하면 Release 에 exe 가 자동 첨부됩니다.

### 방법 B. 윈도우에서 직접 빌드

1. [파이썬 3](https://www.python.org/downloads/) 설치 (설치 화면에서 **Add python.exe to PATH** 체크)
2. 이 폴더의 **`build_windows.bat`** 를 더블클릭
3. 끝나면 **`dist\doll_menu_maker.exe`** 가 생깁니다

---

## 2) 실행

`dist\doll_menu_maker.exe` 를 더블클릭하면

* 작은 검은 콘솔 창에 주소가 표시되고
* **기본 브라우저가 자동으로 열립니다** (`http://localhost:8899/`)

**끄는 방법:** 콘솔 창을 닫거나, 창에서 `Ctrl + C`.

* 저장 데이터(버전/그림)는 **exe 옆의 `save\` 폴더**에 쌓입니다.
* 그래서 exe 를 **`바탕화면`이나 `문서` 처럼 쓰기 가능한 폴더**에 두세요.
  (`C:\Program Files` 처럼 권한이 막힌 곳에 두면 저장이 안 될 수 있습니다.)
* exe 한 개만 다른 폴더로 복사해도 `save\` 는 그 exe 옆에 새로 만들어집니다.

### 명령줄 옵션 (선택)

```
doll_menu_maker.exe                 포트 8899, 브라우저 자동 열기
doll_menu_maker.exe 9000            9000 포트로 실행
doll_menu_maker.exe --port 9000     포트 지정
doll_menu_maker.exe --no-browser    브라우저를 열지 않음
```

지정한 포트가 이미 쓰이면 **자동으로 다음 빈 포트**로 넘어갑니다
(이때는 콘솔에 표시된 주소를 여세요).

---

## 3) 참고 사항

* **인터넷:** 엽서 글꼴(나눔명조 등)을 구글 폰트에서 받아옵니다.
  인터넷이 없으면 글꼴만 기본 글꼴로 보이고, 나머지 기능은 그대로 동작합니다.
* **방화벽:** 서버는 `127.0.0.1`(내 PC 안에서만) 으로만 열리므로
  보통 윈도우 방화벽 경고가 뜨지 않습니다. 외부에 공개되지 않습니다.
* **SmartScreen:** 서명되지 않은 exe 라서 첫 실행 때 "Windows의 PC 보호" 경고가
  뜰 수 있습니다. → **추가 정보 → 실행** 을 누르면 됩니다.
* **콘솔 창이 싫다면:** 빌드 명령의 `--console` 을 `--windowed` 로 바꾸면
  창 없이 실행되지만, 그때는 **작업 관리자에서 종료**해야 합니다.

---

## 4) 어떻게 동작하나요?

* `server.py` 는 파이썬 표준 라이브러리만 씁니다(추가 패키지 불필요).
* exe 로 묶이면 정적 자원(`postcard-cards.html/css/js`, `themes/`, `assets/`)은
  exe 안(임시 번들)에서 읽고, **저장(`save/`)만 exe 옆 폴더에 씁니다.**
  → 다시 실행해도 저장 내용이 유지됩니다.
* 빌드에 함께 묶이는 파일 목록은 `build_windows.bat` 과
  `.github/workflows/build-windows-exe.yml` 의 `--add-data` 항목입니다.
  (새 테마 파일을 추가하면 `themes` 폴더째로 묶이므로 그대로 포함됩니다.)
