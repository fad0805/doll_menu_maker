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
"""

import base64
import csv
import json
import os
import re
import shutil
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(ROOT, "save")
CSV_FILE = os.path.join(SAVE_DIR, "versions.csv")
HTML_FILE = os.path.join(ROOT, "postcard-cards.html")
HTML_BASENAME = os.path.basename(HTML_FILE)
DEFAULT_PORT = 8899
MAX_VERSIONS = 5
CSV_FIELDS = ["slot", "alias", "file", "created"]

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
    html = re.sub(r'src="(?:\.\./)*assets/', 'src="assets/', html)
    return html


def normalize_for_slot(html):
    """save/slotN/index.html 은 루트에서 두 단계 아래 → ../.. 로 바꾼다."""
    html = re.sub(r'href="(?:\.\./)*postcard-cards\.css"', 'href="../../postcard-cards.css"', html)
    html = re.sub(r'src="(?:\.\./)*postcard-cards\.js"', 'src="../../postcard-cards.js"', html)
    html = re.sub(r'src="(?:\.\./)*assets/', 'src="../../assets/', html)
    return html


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
            cands.append(os.path.join(ROOT, s.lstrip("/")))
        elif s.startswith("save/"):
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
        sys.stderr.write("[server] " + (fmt % args) + "\n")

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
        vers = read_versions()
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
            vers = read_versions()
            return self._json({
                "ok": True, "dir": ROOT, "html": HTML_BASENAME,
                "newest": newest_slot(vers) or 0, "count": len(vers),
            })
        if path == "/api/versions":
            return self._json(self._versions_json())

        # 첫 화면(/) 은 '가장 최근 슬롯'으로 안내한다.
        if path in ("/", "/index.html"):
            slot = newest_slot(read_versions())
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


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("포트 번호가 올바르지 않습니다:", sys.argv[1])
            return 1
    ensure_dirs()
    migrate_old_layout()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("=" * 60)
    print(" 엽서 카드 서버 실행 중")
    print("   http://localhost:%d/" % port)
    print("   버전 폴더 : %s  (슬롯 1~%d, 슬롯마다 html+그림)" % (SAVE_DIR, MAX_VERSIONS))
    print("   버전 정보 : %s" % CSV_FILE)
    print("   기본 템플릿: %s  (덮어쓰지 않음)" % HTML_FILE)
    print("   (종료: Ctrl+C)")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
