#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
엽서 카드 템플릿용 로컬 서버.

저장 구조 (버전 = 폴더 한 칸)
  save/versions.csv        버전 정보 (slot,alias,file,created)
  save/slot1/
      index.html           그 버전의 화면 (기본 템플릿은 건드리지 않음)
      01.jpg, 02.png …     그 버전에서 쓰는 그림 (프로필 번호 이름, html과 함께)
  save/slot2/ …

기능
  - 정적 파일 제공
  - 그림 업로드 → 지금 슬롯(save/slotN/) 폴더에 '프로필 번호' 이름으로 저장
  - 저장 → save/slotN/index.html + 그림, CSV 갱신, 최대 5슬롯 유지
  - 슬롯 삭제 → save/slotN/ 폴더와 CSV 행을 지움
  - 접속(/) 시 '가장 최근 슬롯'을 첫 화면으로
  - 기본 html(postcard-cards.html)은 절대 덮어쓰지 않음

사용법
  python3 server.py            # http://localhost:8899/
  python3 server.py 8000       # 포트 지정
  python3 server.py --open     # 실행 후 브라우저 자동 열기
  python3 server.py --new      # 이미 켜져 있어도 새로 띄우기
  python3 server.py --no-browser
  (Windows exe 는 창 없이 뜨고 자동으로 브라우저가 열립니다.
   이미 켜져 있으면 새로 띄우지 않고 브라우저만 다시 엽니다.
   종료: 페이지 오른쪽 아래 ⏻ 버튼, 또는 Ctrl+C)
"""

import base64
import csv
import json
import os
import re
import shutil
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

# 실행 방식에 따라 '읽기 전용 자원'과 '쓰기 가능한 저장 폴더'를 나눈다.
#  - 소스로 실행  (python server.py) : 둘 다 이 파일이 있는 폴더
#  - exe 로 실행  (PyInstaller)      : 자원은 번들(_MEIPASS), 저장은 exe 옆 폴더
FROZEN = bool(getattr(sys, "frozen", False))
BUNDLE_DIR = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
DATA_DIR = (os.path.dirname(os.path.abspath(sys.executable)) if FROZEN
            else os.path.dirname(os.path.abspath(__file__)))

ROOT = BUNDLE_DIR                              # 정적 자원(html/css/js/themes/assets)
SAVE_DIR = os.path.join(DATA_DIR, "save")      # 저장 데이터(쓰기 가능)
CSV_FILE = os.path.join(SAVE_DIR, "versions.csv")
HTML_FILE = os.path.join(ROOT, "postcard-cards.html")
HTML_BASENAME = os.path.basename(HTML_FILE)
DEFAULT_PORT = 8899
MAX_VERSIONS = 5
CSV_FIELDS = ["slot", "alias", "file", "created"]

APP_ID = "doll_menu_maker"     # '우리 서버'인지 확인하는 표식 (/api/ping)
REUSE_TRIES = 20               # 이미 떠 있는 서버를 찾을 때 훑어볼 포트 수
QUIET = FROZEN                 # 창 없는 exe 에서는 요청 로그를 남기지 않는다
SERVER = None                  # 실행 중인 서버 객체 (종료 버튼용)

EXT_BY_MIME = {
    "jpeg": ".jpg", "jpg": ".jpg", "png": ".png",
    "webp": ".webp", "gif": ".gif", "bmp": ".bmp",
}

IMG_TAG_RE = re.compile(r'<img\b[^>]*>', re.I)
SRC_ATTR_RE = re.compile(r'\bsrc="([^"]*)"', re.I)
DATA_URL_RE = re.compile(r'^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$', re.S)
ART_RE = re.compile(r'\bdata-art="(\d+)"', re.I)
NUM_FILE_RE = re.compile(r'^\d+\.[A-Za-z]+$')          # 우리가 저장한 그림 이름 (01.jpg)
OLD_SLOT_IMG_RE = re.compile(r'src="(?:save/)?slot(\d+)-(\d+)\.([A-Za-z]+)"')
OLD_SLOT_HTML_RE = re.compile(r'^slot(\d+)\.html$')
OLD_SLOT_IMG_FILE_RE = re.compile(r'^slot(\d+)-(\d+)\.([A-Za-z]+)$')


def ensure_dirs():
    os.makedirs(SAVE_DIR, exist_ok=True)


def setup_streams():
    """창 없는 exe(--windowed)에서는 stdout/stderr 가 None 이 된다.
    그대로 두면 print/로그에서 오류가 나므로 파일(또는 devnull)로 돌려준다."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    stream = None
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        logpath = os.path.join(DATA_DIR, "doll_menu_maker.log")
        try:                                  # 로그가 너무 커지면 새로 시작
            if os.path.isfile(logpath) and os.path.getsize(logpath) > 1_000_000:
                os.remove(logpath)
        except OSError:
            pass
        stream = open(logpath, "a", encoding="utf-8", buffering=1)
    except OSError:
        stream = open(os.devnull, "w")
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


def now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def default_alias():
    return "저장 " + time.strftime("%m-%d %H:%M")


# ------------------------------------------------------------------ 경로 도우미
def slot_dir(slot):
    return os.path.join(SAVE_DIR, "slot%d" % slot)


def slot_index(slot):
    return os.path.join(slot_dir(slot), "index.html")


def slot_rel(slot):
    return "slot%d/index.html" % slot


def slot_url(slot):
    return "save/slot%d/" % slot


def write_text_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        fp.write(text)
    os.replace(tmp, path)


def remove_slot(slot):
    shutil.rmtree(slot_dir(slot), ignore_errors=True)


def prune_versions(vers):
    """index.html 이 없는 슬롯은 목록에서 지우고, 파일 없는 빈 슬롯 폴더도 정리한다.
       (그림만 올려 폴더가 생겼거나, 파일을 직접 지운 뒤 versions.csv 에
        유령 슬롯이 계속 남지 않게)"""
    removed = []
    for slot in list(vers):
        if not os.path.isfile(slot_index(slot)):
            vers.pop(slot, None)
            removed.append(slot)
    # 행(row) 유무와 상관없이, 파일이 하나도 없는 빈 slot* 폴더는 정리
    try:
        names = os.listdir(SAVE_DIR)
    except OSError:
        names = []
    for name in names:
        if not re.match(r"^slot\d+$", name):
            continue
        d = os.path.join(SAVE_DIR, name)
        try:
            if os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
        except OSError:
            pass
    return removed


def read_versions_clean():
    """읽으면서 유령 슬롯(폴더 없음/빈 폴더)을 자동 정리한다."""
    vers = read_versions()
    if prune_versions(vers):
        write_versions(vers)
    return vers


def delete_numbered(slot, num):
    """slot 폴더에서 그 프로필 번호의 그림을 (확장자 무관) 모두 지운다."""
    d = slot_dir(slot)
    if not os.path.isdir(d):
        return
    stem = "%02d" % num
    for name in os.listdir(d):
        if os.path.splitext(name)[0] == stem:
            try:
                os.remove(os.path.join(d, name))
            except OSError:
                pass


def clean_slot_images(slot, keep):
    """이번 저장에서 쓰지 않는 슬롯 그림만 정리한다(복사가 끝난 뒤 호출)."""
    d = slot_dir(slot)
    if not os.path.isdir(d):
        return
    keep = set(keep or ())
    for name in os.listdir(d):
        if NUM_FILE_RE.match(name) and name not in keep:
            try:
                os.remove(os.path.join(d, name))
            except OSError:
                pass


# ------------------------------------------------------------------ CSV (버전 정보)
def read_versions():
    """slot(int) -> {alias, file, created}"""
    out = {}
    if not os.path.isfile(CSV_FILE):
        return out
    with open(CSV_FILE, encoding="utf-8", newline="") as fp:
        for row in csv.DictReader(fp):
            try:
                slot = int(row.get("slot", ""))
            except (TypeError, ValueError):
                continue
            out[slot] = {
                "alias": (row.get("alias") or "").strip(),
                "file": (row.get("file") or slot_rel(slot)).strip(),
                "created": (row.get("created") or "").strip(),
            }
    return out


def write_versions(versions):
    ensure_dirs()
    tmp = CSV_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for slot in sorted(versions):
            v = versions[slot]
            writer.writerow({
                "slot": slot,
                "alias": v.get("alias", ""),
                "file": v.get("file", slot_rel(slot)),
                "created": v.get("created", ""),
            })
    os.replace(tmp, CSV_FILE)


def choose_slot(versions):
    """빈 슬롯 우선, 모두 차 있으면 가장 오래된 슬롯."""
    for s in range(1, MAX_VERSIONS + 1):
        if s not in versions:
            return s
    return min(versions, key=lambda s: versions[s].get("created", "") or "")


def newest_slot(versions):
    if not versions:
        return None
    return max(versions, key=lambda s: versions[s].get("created", "") or "")


# ------------------------------------------------------------------ 경로 변환
def normalize_root_form(html):
    """루트 기준 경로로 통일 (여러 저장 경로에서 읽어도 동일하게)."""
    html = re.sub(r'href="(?:\.\./)*postcard-cards\.css"', 'href="postcard-cards.css"', html)
    html = re.sub(r'src="(?:\.\./)*postcard-cards\.js"', 'src="postcard-cards.js"', html)
    html = re.sub(r'href="(?:\.\./)*themes/', 'href="themes/', html)
    html = re.sub(r'src="(?:\.\./)*assets/', 'src="assets/', html)
    html = re.sub(r'href="(?:\.\./)*assets/', 'href="assets/', html)
    return html


def normalize_for_slot(html):
    """save/slotN/index.html 은 루트에서 두 단계 아래 → ../.. 로 바꾼다."""
    html = re.sub(r'href="(?:\.\./)*postcard-cards\.css"', 'href="../../postcard-cards.css"', html)
    html = re.sub(r'src="(?:\.\./)*postcard-cards\.js"', 'src="../../postcard-cards.js"', html)
    html = re.sub(r'href="(?:\.\./)*themes/', 'href="../../themes/', html)
    html = re.sub(r'src="(?:\.\./)*assets/', 'src="../../assets/', html)
    html = re.sub(r'href="(?:\.\./)*assets/', 'href="../../assets/', html)
    html = ensure_local_fonts(html, "../../")
    return html


# 구글 폰트 CDN 링크(옛날 저장물) — 오프라인에서 죽으므로 제거 대상
_GOOGLE_FONT_RES = [
    re.compile(r'<link[^>]*href="https://fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*', re.I),
]


def ensure_local_fonts(html, prefix):
    """저장물에 로컬 폰트(assets/fonts/fonts.css) 링크가 없으면 넣어 준다.

    옛날 버전에 저장된 html은 구글 폰트 CDN 링크만 있고 내장 폰트 링크가 없어서
    오프라인(패키지 실행 등)에서 폰트가 전부 기본 글꼴로 떨어진다.
    죽을 수 있는 구글 폰트 링크는 제거하고, 로컬 woff2 링크를 보장한다.
    """
    for rx in _GOOGLE_FONT_RES:
        html = rx.sub("", html)
    if "assets/fonts/fonts.css" in html:
        return html
    link = '<link rel="stylesheet" href="%sassets/fonts/fonts.css">' % prefix
    mh = re.search(r'<head\b[^>]*>', html, re.I)
    if mh:
        return html[:mh.end()] + "\n" + link + html[mh.end():]
    return link + "\n" + html


# ------------------------------------------------------------------ 자동 틀 갱신
_HTML_OPEN_RE = re.compile(r'<html\b[^>]*>', re.I)
_BODY_OPEN_RE = re.compile(r'<body\b[^>]*>', re.I)
_SHEETS_OPEN_RE = re.compile(r'<div\s+class="sheets"[^>]*>', re.I)
_DIV_TOKEN_RE = re.compile(r'<div\b|</div\s*>', re.I)


def _sheets_region(html):
    m = _SHEETS_OPEN_RE.search(html)
    if not m:
        return None
    depth = 1
    for t in _DIV_TOKEN_RE.finditer(html, m.end()):
        if t.group(0).startswith('</'):
            depth -= 1
            if depth == 0:
                return (m.start(), t.end())
        else:
            depth += 1
    return None


def upgrade_slot_html(saved):
    try:
        with open(HTML_FILE, encoding='utf-8') as fp:
            template = fp.read()
    except OSError:
        return saved
    sreg = _sheets_region(saved)
    treg = _sheets_region(template)
    if not sreg or not treg:
        return saved
    content = saved[sreg[0]:sreg[1]]
    merged = template[:treg[0]] + content + template[treg[1]:]
    mh = _HTML_OPEN_RE.search(saved)
    if mh:
        merged = _HTML_OPEN_RE.sub(lambda _m: mh.group(0), merged, count=1)
    mb = _BODY_OPEN_RE.search(saved)
    if mb:
        merged = _BODY_OPEN_RE.sub(lambda _m: mb.group(0), merged, count=1)
    merged = normalize_for_slot(merged)
    if 'class="sheets"' not in merged or 'postcard-cards.js' not in merged:
        return saved
    return merged


def rewrite_images(html, target_slot, from_slot=None):
    """카드 그림을 target 슬롯 폴더로 모으고 경로를 NN.ext 로 바꾼다.
    (바뀐 html, 이 슬롯에서 실제로 쓰는 파일 이름 집합) 을 돌려준다."""
    os.makedirs(slot_dir(target_slot), exist_ok=True)
    used = set()
    counter = [0]

    def find_source(src):
        s = src.split("?")[0].split("#")[0].strip()
        base = os.path.basename(s)
        cands = []
        if s.startswith("/"):
            rel = s.lstrip("/")
            if rel.startswith("save/"):
                cands.append(os.path.join(DATA_DIR, rel))
            cands.append(os.path.join(ROOT, rel))
        elif s.startswith("save/"):
            cands.append(os.path.join(DATA_DIR, s))
            cands.append(os.path.join(ROOT, s))
        else:
            if from_slot:
                cands.append(os.path.join(slot_dir(from_slot), base))
            cands.append(os.path.join(slot_dir(target_slot), base))
            cands.append(os.path.join(ROOT, s))
            if os.path.isdir(SAVE_DIR):
                for name in sorted(os.listdir(SAVE_DIR)):
                    if name.startswith("slot"):
                        cands.append(os.path.join(SAVE_DIR, name, base))
        return next((p for p in cands if os.path.isfile(p)), None)

    def repl(m):
        tag = m.group(0)
        sm = SRC_ATTR_RE.search(tag)
        if not sm:
            return tag
        src = sm.group(1)
        if not src:
            return tag
        am = ART_RE.search(tag)
        num = int(am.group(1)) if am else None

        dm = DATA_URL_RE.match(src)
        if dm:
            if num is None:
                counter[0] += 1
                num = counter[0]
            ext = EXT_BY_MIME.get(dm.group(1).lower(), ".png")
            try:
                raw = base64.b64decode(dm.group(2))
            except Exception:
                return tag
            name = "%02d%s" % (num, ext)
            with open(os.path.join(slot_dir(target_slot), name), "wb") as fp:
                fp.write(raw)
            used.add(name)
            return tag[:sm.start(1)] + name + tag[sm.end(1):]

        base = os.path.basename(src.split("?")[0])
        if not NUM_FILE_RE.match(base):
            return tag                      # 기본 자산(assets/…)은 그대로 둔다
        ext = os.path.splitext(base)[1].lower()
        num = int(os.path.splitext(base)[0])
        name = "%02d%s" % (num, ext)
        actual = find_source(src)
        if actual:
            dst = os.path.join(slot_dir(target_slot), name)
            used.add(name)
            if os.path.abspath(actual) != os.path.abspath(dst):
                try:
                    shutil.copyfile(actual, dst)
                except OSError:
                    return tag
        else:
            used.add(name)
        return tag[:sm.start(1)] + name + tag[sm.end(1):]

    return IMG_TAG_RE.sub(repl, html), used


# ------------------------------------------------------------------ 옛 저장 구조 → 새 구조
def migrate_old_layout():
    """save/slotN.html (+ save/slotN-NN.ext) 을 save/slotN/index.html 폴더 구조로 옮긴다."""
    ensure_dirs()
    changed = False

    for name in list(os.listdir(SAVE_DIR)):
        m = OLD_SLOT_HTML_RE.match(name)
        if not m:
            continue
        slot = int(m.group(1))
        src_path = os.path.join(SAVE_DIR, name)
        try:
            with open(src_path, encoding="utf-8") as fp:
                html = fp.read()
        except OSError:
            continue
        os.makedirs(slot_dir(slot), exist_ok=True)

        def repl(mm):
            num = int(mm.group(2))
            found, ext = None, mm.group(3)
            for cand in os.listdir(SAVE_DIR):
                fm = OLD_SLOT_IMG_FILE_RE.match(cand)
                if fm and int(fm.group(1)) == slot and int(fm.group(2)) == num:
                    found, ext = os.path.join(SAVE_DIR, cand), fm.group(3)
                    break
            if found:
                shutil.copyfile(found, os.path.join(slot_dir(slot), "%02d.%s" % (num, ext)))
            return 'src="%02d.%s"' % (num, ext)

        html = OLD_SLOT_IMG_RE.sub(repl, html)
        html = normalize_root_form(html)
        html = normalize_for_slot(html)
        write_text_atomic(slot_index(slot), html)
        try:
            os.remove(src_path)
        except OSError:
            pass
        changed = True

    for cand in list(os.listdir(SAVE_DIR)):
        if OLD_SLOT_IMG_FILE_RE.match(cand):
            try:
                os.remove(os.path.join(SAVE_DIR, cand))
            except OSError:
                pass

    versions = read_versions()
    for slot in versions:
        versions[slot]["file"] = slot_rel(slot)
    if changed or versions:
        write_versions(versions)


# ------------------------------------------------------------------ HTTP handler
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if QUIET:
            return
        sys.stderr.write("[server] " + (fmt % args) + "\n")

    def translate_path(self, path):
        """정적 자원은 번들(ROOT)에서, /save/... 는 쓰기 가능한 저장 폴더에서 준다.
        exe 로 실행하면 두 폴더가 서로 다르기 때문에 필요하다."""
        raw = path.split("?", 1)[0].split("#", 1)[0]
        if raw == "/save" or raw.startswith("/save/"):
            rel = unquote(raw[len("/save"):]).lstrip("/")
            parts = [p for p in rel.split("/") if p not in ("", ".")]
            if any(p == ".." for p in parts):
                return os.path.join(SAVE_DIR, "__invalid__")
            return os.path.join(SAVE_DIR, *parts) if parts else SAVE_DIR
        return super().translate_path(path)

    # ---- 공통 ----
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _quit(self):
        """서버를 종료한다. (창 없는 exe 에서 페이지의 '종료' 버튼이 부른다)"""
        self._json({"ok": True})
        srv = SERVER
        if srv is not None:
            # serve_forever 는 다른 스레드에서 멈춰야 하므로 스레드로 돌린다.
            threading.Thread(target=srv.shutdown, daemon=True).start()

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def end_headers(self):
        if self.path.split("?")[0].endswith((".html", ".htm", ".css", ".js", ".csv")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _want_slot(self, data, versions, allow_allocate=True):
        """요청의 slot 값을 해석. 없으면(그리고 허용되면) 빈 슬롯을 고른다.
        (slot, allocated) 을 돌려준다. 해석 불가면 (None, False)."""
        req = data.get("slot")
        if req is not None:
            try:
                slot = int(req)
            except (TypeError, ValueError):
                slot = None
            if slot is not None and 1 <= slot <= MAX_VERSIONS:
                return slot, False
        if allow_allocate:
            return choose_slot(versions), True
        return None, False

    def _versions_json(self):
        vers = read_versions_clean()
        return {
            "ok": True,
            "max": MAX_VERSIONS,
            "versions": [
                {"slot": s, "alias": vers[s]["alias"], "file": vers[s]["file"], "created": vers[s]["created"]}
                for s in sorted(vers)
            ],
        }

    # ---- GET ----
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/ping":
            vers = read_versions_clean()
            return self._json({
                "ok": True, "app": APP_ID, "dir": DATA_DIR, "bundle": ROOT,
                "html": HTML_BASENAME,
                "newest": newest_slot(vers) or 0, "count": len(vers),
            })
        if path == "/api/versions":
            return self._json(self._versions_json())
        if path == "/api/quit":          # 브라우저 주소창/링크로도 종료 가능
            return self._quit()

        # 첫 화면(/) 은 '가장 최근 슬롯'으로 안내한다.
        if path in ("/", "/index.html"):
            slot = newest_slot(read_versions_clean())
            if slot is not None and os.path.isfile(slot_index(slot)):
                return self._redirect("/save/slot%d/" % slot)
            self.path = "/" + HTML_BASENAME
            return super().do_GET()

        # 기본 템플릿(postcard-cards.html)은 언제나 원본 그대로
        if path == "/" + HTML_BASENAME:
            self.path = "/" + HTML_BASENAME
            return super().do_GET()

        return super().do_GET()

    # ---- POST ----
    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/image":
                return self._save_image()
            if path == "/api/image/delete":
                return self._delete_image()
            if path == "/api/images/reconcile":
                return self._reconcile_images()
            if path == "/api/alias":
                return self._set_alias()
            if path == "/api/delete_slot":
                return self._delete_slot()
            if path in ("/api/save", "/api/html"):
                return self._save_version()
            if path == "/api/quit":
                return self._quit()
            return self._json({"ok": False, "error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            return self._json({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}, 500)

    # ---- 그림 업로드 ----
    def _save_image(self):
        data = self._read_json()
        try:
            index = int(data.get("index", -1))
        except (TypeError, ValueError):
            index = -1
        data_url = data.get("data", "")
        if index < 0 or not isinstance(data_url, str):
            return self._json({"ok": False, "error": "index/data 누락"}, 400)

        m = re.match(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$", data_url, re.S)
        if not m:
            return self._json({"ok": False, "error": "data URL 형식이 아님"}, 400)
        try:
            raw = base64.b64decode(m.group(2))
        except Exception:
            return self._json({"ok": False, "error": "base64 디코딩 실패"}, 400)

        versions = read_versions()
        slot, allocated = self._want_slot(data, versions)
        if slot is None:
            return self._json({"ok": False, "error": "슬롯을 정하지 못함"}, 400)

        num = index + 1
        ext = EXT_BY_MIME.get(m.group(1).lower(), ".png")
        delete_numbered(slot, num)
        name = "%02d%s" % (num, ext)
        os.makedirs(slot_dir(slot), exist_ok=True)
        with open(os.path.join(slot_dir(slot), name), "wb") as fp:
            fp.write(raw)
        return self._json({
            "ok": True, "slot": slot, "allocated": allocated,
            "url": "/save/slot%d/%s" % (slot, name), "bytes": len(raw),
        })

    def _delete_image(self):
        data = self._read_json()
        try:
            index = int(data.get("index", -1))
        except (TypeError, ValueError):
            index = -1
        if index < 0:
            return self._json({"ok": False, "error": "index 누락"}, 400)
        slot, _ = self._want_slot(data, read_versions(), allow_allocate=False)
        if slot is not None:
            delete_numbered(slot, index + 1)
        return self._json({"ok": True, "slot": slot})

    def _reconcile_images(self):
        data = self._read_json()
        keep = set()
        for v in data.get("keep", []):
            try:
                keep.add("%02d" % (int(v) + 1))
            except (TypeError, ValueError):
                pass
        slot, _ = self._want_slot(data, read_versions(), allow_allocate=False)
        removed = []
        if slot is not None:
            d = slot_dir(slot)
            if os.path.isdir(d):
                for name in os.listdir(d):
                    stem = os.path.splitext(name)[0]
                    if NUM_FILE_RE.match(name) and stem not in keep:
                        try:
                            os.remove(os.path.join(d, name))
                            removed.append(name)
                        except OSError:
                            pass
        return self._json({"ok": True, "slot": slot, "removed": removed})

    # ---- 별칭 ----
    def _set_alias(self):
        data = self._read_json()
        vers = read_versions()
        try:
            slot = int(data.get("slot"))
        except (TypeError, ValueError):
            return self._json({"ok": False, "error": "slot 누락"}, 400)
        if slot not in vers:
            return self._json({"ok": False, "error": "빈 슬롯"}, 404)
        vers[slot]["alias"] = str(data.get("alias", "")).strip()
        write_versions(vers)
        out = self._versions_json()
        out["message"] = "별칭을 저장했어요."
        return self._json(out)

    # ---- 슬롯 삭제 ----
    def _delete_slot(self):
        data = self._read_json()
        try:
            slot = int(data.get("slot"))
        except (TypeError, ValueError):
            return self._json({"ok": False, "error": "slot 누락"}, 400)
        vers = read_versions()
        existed = slot in vers
        vers.pop(slot, None)
        remove_slot(slot)
        write_versions(vers)
        out = self._versions_json()
        out["slot"] = slot
        out["message"] = ("슬롯 %d을(를) 삭제했어요." % slot) if existed else ("빈 슬롯 %d을(를) 정리했어요." % slot)
        return self._json(out)

    # ---- 슬롯 저장 ----
    def _save_version(self):
        data = self._read_json()
        html = data.get("html", "")
        if not isinstance(html, str) or not html.strip():
            return self._json({"ok": False, "error": "html 내용이 비었음"}, 400)

        versions = read_versions()
        slot, allocated = self._want_slot(data, versions)
        if slot is None:
            return self._json({"ok": False, "error": "슬롯을 정하지 못함"}, 400)

        from_slot = None
        try:
            from_slot = int(data.get("from"))
        except (TypeError, ValueError):
            from_slot = None

        explicit = data.get("slot") is not None and not allocated
        alias = str(data.get("alias", "") or "").strip()
        if not alias:
            if explicit:
                alias = versions.get(slot, {}).get("alias", "") or default_alias()
            else:
                alias = default_alias()

        html = normalize_root_form(html)
        html, used = rewrite_images(html, slot, from_slot)   # 그림 모으기
        clean_slot_images(slot, used)                        # 안 쓰는 옛 그림 정리
        html = normalize_for_slot(html)

        os.makedirs(slot_dir(slot), exist_ok=True)
        write_text_atomic(slot_index(slot), html)

        versions[slot] = {"alias": alias, "file": slot_rel(slot), "created": now_str()}
        write_versions(versions)

        out = self._versions_json()
        out.update({
            "slot": slot, "alias": alias, "allocated": allocated,
            "file": slot_url(slot), "bytes": len(html.encode("utf-8")),
        })
        return self._json(out)


def bind_server(start_port, tries=20):
    """start_port 부터 빈 포트를 찾아 서버를 만든다. 이미 쓰이면 다음 포트로."""
    last_err = None
    for p in range(start_port, start_port + tries):
        try:
            return ThreadingHTTPServer(("127.0.0.1", p), Handler), p
        except OSError as exc:
            last_err = exc
    # 그래도 안 되면 운영체제가 비어 있는 포트를 골라 준다.
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    return httpd, httpd.server_address[1]


def find_running(start_port, tries=REUSE_TRIES, timeout=0.5):
    """start_port 부터 훑어서 '이미 떠 있는 우리 서버'의 포트를 찾는다. 없으면 None."""
    import urllib.request
    for p in range(start_port, start_port + tries):
        try:
            with urllib.request.urlopen(
                    "http://127.0.0.1:%d/api/ping" % p, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
            if isinstance(data, dict) and data.get("app") == APP_ID:
                return p
        except Exception:  # noqa: BLE001
            continue
    return None


def main():
    global SERVER
    setup_streams()                # 창 없는 exe 대비 (stdout/stderr 가 None)

    args = sys.argv[1:]
    port = DEFAULT_PORT
    open_browser = FROZEN          # exe 로 실행하면 기본으로 브라우저를 연다
    force_new = False              # 이미 떠 있어도 새로 띄우기
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--open", "-o"):
            open_browser = True
        elif a in ("--no-browser", "--no-open"):
            open_browser = False
        elif a in ("--new", "--force"):
            force_new = True
        elif a in ("--port", "-p") and i + 1 < len(args):
            i += 1
            try:
                port = int(args[i])
            except ValueError:
                print("포트 번호가 올바르지 않습니다:", args[i])
                return 1
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            try:
                port = int(a)
            except ValueError:
                print("알 수 없는 인자:", a)
                return 1
        i += 1

    ensure_dirs()
    migrate_old_layout()

    # 이미 켜져 있으면 새로 띄우지 않고 브라우저만 열어 준다.
    # (창 없는 exe 를 또 더블클릭했을 때 서버가 여러 개 생기는 것을 막는다)
    if not force_new:
        running = find_running(port)
        if running is not None:
            url = "http://localhost:%d/" % running
            print("이미 실행 중인 서버를 엽니다: %s" % url)
            if open_browser:
                webbrowser.open(url)
            return 0

    httpd, port = bind_server(port)
    SERVER = httpd
    url = "http://localhost:%d/" % port
    print("=" * 60)
    print(" 엽서 카드 서버 실행 중")
    print("   주소       : %s" % url)
    print("   저장 폴더  : %s  (슬롯 1~%d)" % (SAVE_DIR, MAX_VERSIONS))
    print("   버전 정보  : %s" % CSV_FILE)
    print("   기본 템플릿: %s  (덮어쓰지 않음)" % HTML_FILE)
    print("   (종료: 이 창을 닫거나 Ctrl+C, 또는 페이지의 '종료' 버튼)")
    print("=" * 60)

    if open_browser:
        # 서버가 뜨는 사이 약간 기다렸다가 기본 브라우저로 연다.
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
