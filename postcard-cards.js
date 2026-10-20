  (function () {
    /* 이 스크립트보다 뒤(문서 끝)에 남아 있을 수 있는 오염 요소까지 보려면
       DOM이 완전히 만들어진 뒤에 시작해야 한다. */
    function start() {
    /* 저장물에 섞여 들어간 '그리기용 복제본'이나 진단용 덩어리를 먼저 걷어낸다.
       (이게 남아 있으면 화면이 두 겹으로 겹쳐 보이거나 개수가 늘어난 것처럼 보인다) */
    (function cleanSavedJunk() {
      Array.prototype.slice.call(document.querySelectorAll('[data-capture-host]')).forEach(function (h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      Array.prototype.slice.call(document.querySelectorAll('pre#RES')).forEach(function (p) {
        if (p.parentNode) p.parentNode.removeChild(p);
      });
      document.body.classList.remove('capturing');
    })();
    var cards = Array.prototype.slice.call(document.querySelectorAll('.deck .postcard'));
    var modal = document.getElementById('editor');
    if (!cards.length || !modal) return;

    function hex2(n) { return ('0' + (n | 0).toString(16)).slice(-2); }
    /* 그림칸의 현재 '단색' 값을 읽어 #rrggbb 로 돌려준다 */
    function sceneColor(c) {
      var photo = c.querySelector('.photo');
      if (!photo) return '#cdbb98';
      var v = (photo.style.getPropertyValue('--scene') || '').trim();
      var m6 = v.match(/^#([0-9a-fA-F]{6})$/);
      if (m6) return v.toLowerCase();
      var m3 = v.match(/^#([0-9a-fA-F]{3})$/);
      if (m3) { var h = m3[1]; return ('#' + h[0]+h[0]+h[1]+h[1]+h[2]+h[2]).toLowerCase(); }
      var rgb = getComputedStyle(photo).backgroundColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) return '#' + hex2(+rgb[0]) + hex2(+rgb[1]) + hex2(+rgb[2]);
      return '#cdbb98';
    }

    /* 한마디(quote)에는 따옴표를 직접 입력하지 않아도 되게 한다.
       - 저장된 값·기본값 어느 쪽으로 들어와도 바깥쪽 따옴표는 걷어내고,
         화면에 그릴 때 “ ” 를 자동으로 붙인다. (따옴표 중복 방지) */
    function bareQuote(s) {
      var t = String(s == null ? '' : s);
      return t.replace(/^[\s"'“”‘’「」『』]+/, '').replace(/[\s"'“”‘’「」『』]+$/, '');
    }
    function wrapQuote(s) {
      var t = bareQuote(s);
      return t ? '“' + t + '”' : '';
    }

    function readCard(i) {
      var c = cards[i], nameEl = c.querySelector('.name'), small = c.querySelector('.name small');
      return {
        name: (nameEl.firstChild && nameEl.firstChild.nodeValue) ? nameEl.firstChild.nodeValue.trim() : '',
        alias: small ? small.textContent.trim() : '',
        desc: c.querySelector('.desc').textContent,
        traits: Array.prototype.map.call(c.querySelectorAll('.traits li'), function (li) { return li.textContent.trim(); }),
        quote: bareQuote(c.querySelector('.quote').textContent),
        img: c.querySelector('.art-img').getAttribute('src') || '',
        color: sceneColor(c)
      };
    }

    var defaults = cards.map(function (_, i) { return readCard(i); });
    /* 카드별 기본값은 '카드 요소'에 붙여 둔다 → 순서를 바꿔도 기본값이 따라간다 */
    cards.forEach(function (c, i) { c.__defaults = defaults[i]; });
    /* 그림 파일 이름은 카드 '고유 번호'(data-art)로 정한다 → 순서를 바꿔도 그림이 안 깨진다.
       서버 규약(index 0-기준, 파일명 = index+1)에 맞춰 (번호-1)을 보낸다. */
    function cardImgKey(c) {
      var im = c && c.querySelector('.art-img');
      var n = im ? parseInt(im.getAttribute('data-art'), 10) : NaN;
      return isNaN(n) ? -1 : n - 1;
    }

    /* ===== 한 프레임(액자)에 9장씩. 넘으면 오른쪽에 새 프레임 → 가로 스크롤 ===== */
    var PER_FRAME = 9;
    var sheetsEl = document.getElementById('sheets');
    var baseBoard = document.getElementById('board');
    var frameBoards = [];   /* 프레임(액자) 요소들 */
    var frameDecks = [];    /* 각 프레임의 엽서 그리드(.deck) */

    function distributeCards() {
      frameDecks.forEach(function (d) {
        Array.prototype.slice.call(d.querySelectorAll('.postcard')).forEach(function (c) { c.parentNode.removeChild(c); });
      });
      cards.forEach(function (c, i) { frameDecks[Math.floor(i / PER_FRAME)].appendChild(c); });
    }

    function buildFrames() {
      if (!sheetsEl || !baseBoard) return;
      var frameCount = Math.max(1, Math.ceil(cards.length / PER_FRAME));
      frameBoards = [baseBoard];
      for (var k = 1; k < frameCount; k++) {
        var b = baseBoard.cloneNode(true);
        b.removeAttribute('id');
        var d = b.querySelector('.deck');
        Array.prototype.slice.call(d.querySelectorAll('.postcard')).forEach(function (c) { c.parentNode.removeChild(c); });
        sheetsEl.appendChild(b);
        frameBoards.push(b);
      }
      frameDecks = frameBoards.map(function (b) { return b.querySelector('.deck'); });
      distributeCards();
    }
    buildFrames();

    /* ===== 화면(뷰포트)에 맞춰 프레임(액자)을 자동 축소 → 세로 스크롤 없앰 =====
       세로 높이가 모자라면 액자 전체를 비율대로 줄여 화면 안에 담는다.
       (엽서 두 줄 min-height 등 프레임 '내부' 최소 높이는 그대로 유지됨)
       단, 브라우저 자체 확대/축소(배율 변경)에는 맞서지 않는다 →
       사용자가 키운 만큼 크게 보이고, 넘치면 .sheets 안에서 스크롤해 볼 수 있다. */
    var MIN_ZOOM = 0.2;
    var fitRaf = 0;
    var lastDpr = window.devicePixelRatio || 1;
    /* '물리' 뷰포트 크기(CSS px × 배율). 브라우저 확대/축소로는 거의 안 변하고,
       창 크기를 실제로 바꿀 때만 변한다 → 둘을 구분하는 기준으로 쓴다. */
    var lastPhys = (window.innerWidth || 0) * lastDpr;
    function fitBoard() {
      if (!baseBoard || !sheetsEl || !frameBoards.length) return;
      /* zoom을 지운 '자연 크기'로 측정해야 배율이 매번 어긋나지 않는다 */
      frameBoards.forEach(function (b) { b.style.zoom = ''; });
      var natW = baseBoard.offsetWidth || 1754;
      var natH = baseBoard.offsetHeight || 1700;
      var cs = getComputedStyle(sheetsEl);
      var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      /* 기준 좌우 여백은 34px 로 고정해 두고 계산한다(실제 여백은 아래에서 다시 잡음)
         → 여백을 바꿔도 배율 계산이 흔들리지 않는다 */
      var BASE_PAD = 34;
      var availW = sheetsEl.clientWidth - BASE_PAD * 2;
      var availH = sheetsEl.clientHeight - padY;
      if (availW <= 0 || availH <= 0) return;
      var z = Math.min(availW / natW, availH / natH, 1);   /* 1을 넘겨 확대하진 않음 */
      if (z < MIN_ZOOM) z = MIN_ZOOM;
      /* 내림: 딱 맞을 때 미세한 넘침으로 스크롤바가 뜨는 것을 막는다 */
      z = Math.floor(z * 1000) / 1000;
      frameBoards.forEach(function (b) { b.style.zoom = String(z); });
      /* 좌우 '끝' 프레임도 포커스 시 화면 가운데로 올 수 있도록
         양옆에 (남는 폭의 절반)만큼 여백을 준다.
         프레임이 화면에 꽉 차면 예전처럼 34px 그대로. */
      var shownW = natW * z;
      var side = Math.max(BASE_PAD, Math.round((sheetsEl.clientWidth - shownW) / 2));
      sheetsEl.style.paddingLeft = side + 'px';
      sheetsEl.style.paddingRight = side + 'px';
      /* 화면에 맞을 땐 스크롤이 없고, 브라우저 확대 등으로 넘칠 때만 스크롤되게 */
      sheetsEl.style.overflowY = 'auto';
    }
    function scheduleFit() {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(function () { fitRaf = 0; fitBoard(); });
    }
    function onViewportResize() {
      var d = window.devicePixelRatio || 1;
      var phys = (window.innerWidth || 0) * d;
      var zoomChanged = Math.abs(d - lastDpr) > 0.01;      /* 배율이 바뀜 = 확대/축소 가능성 */
      var physChanged = Math.abs(phys - lastPhys) > 2;     /* 물리 크기가 바뀜 = 실제 창 크기 변경 */
      lastDpr = d;
      lastPhys = phys;
      if (zoomChanged && !physChanged) {
        /* 브라우저 확대/축소 → 다시 줄이지 않는다. 키운 크기 그대로 두고,
           넘치면 .sheets 안에서 스크롤해 볼 수 있다. */
        if (sheetsEl) sheetsEl.style.overflowY = 'auto';
        return;
      }
      scheduleFit();   /* 실제 창 크기 변경일 때만 화면에 맞춰 다시 계산 */
    }
    window.addEventListener('resize', onViewportResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        /* 핀치 줌(모바일)은 배율 그대로 두고 스크롤 가능하게 */
        if (sheetsEl) sheetsEl.style.overflowY = 'auto';
      });
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      /* 웹폰트가 준비된 뒤에 이름 크기를 다시 맞춘다(폭이 달라짐) */
      document.fonts.ready.then(function () { fitNames(); scheduleFit(); }).catch(function () {});
    }

    /* ===== 엽서 순서 바꾸기 (드래그 앤 드롭) =====
       카드를 끌어 다른 카드의 왼쪽/오른쪽에 놓으면 순서가 바뀐다.
       그림 파일은 카드 고유 번호(data-art)로 저장되므로 순서를 바꿔도 안 깨진다. */
    var dragSrcEl = null;
    function clearDropMarks() {
      Array.prototype.slice.call(document.querySelectorAll('.postcard.drop-before, .postcard.drop-after'))
        .forEach(function (c) { c.classList.remove('drop-before', 'drop-after'); });
    }
    function endDrag() {
      if (dragSrcEl) { dragSrcEl.classList.remove('dragging'); dragSrcEl = null; }
      document.body.classList.remove('reordering');
      clearDropMarks();
      suppressCardClick = Date.now() + 350;   /* 드롭 직후 클릭으로 편집창이 열리지 않게 */
    }
    function applyOrderChange() {
      distributeCards();                 /* cards 배열 순서대로 다시 배치 */
      setCount(currentN, false);         /* 숨김/가운데 정렬/꼬리말/화면맞춤 재적용 */
      if (SERVER.ok) { setStatus('↔ 엽서 순서를 바꿨어요. 저장하는 중…', false); commitHTML(); }
      else { setStatus('↔ 엽서 순서를 바꿨어요. 저장하려면 💾 저장(Ctrl+S)를 누르세요.', false); }
    }
    if (sheetsEl) {
      cards.forEach(function (c) { c.setAttribute('draggable', 'true'); });
      /* 카드 안의 그림 자체가 끌리지 않게(카드 단위로 끌리도록) */
      Array.prototype.slice.call(document.querySelectorAll('.photo .art-img, .photo .stamp-img'))
        .forEach(function (im) { im.setAttribute('draggable', 'false'); });
      sheetsEl.addEventListener('dragstart', function (e) {
        var card = (e.target && e.target.closest) ? e.target.closest('.postcard') : null;
        if (!card) return;
        dragSrcEl = card;
        card.classList.add('dragging');
        document.body.classList.add('reordering');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'postcard');
        } catch (err) {}
      });
      sheetsEl.addEventListener('dragover', function (e) {
        if (!dragSrcEl) return;
        /* 가장자리에서 가로 자동 스크롤 */
        var sr = sheetsEl.getBoundingClientRect();
        if (e.clientX < sr.left + 70) { sheetsEl.scrollLeft -= 16; }
        else if (e.clientX > sr.right - 70) { sheetsEl.scrollLeft += 16; }
        var card = (e.target && e.target.closest) ? e.target.closest('.postcard') : null;
        if (!card || card === dragSrcEl) { clearDropMarks(); return; }
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
        var r = card.getBoundingClientRect();
        var before = (e.clientX - r.left) < r.width / 2;
        clearDropMarks();
        card.classList.add(before ? 'drop-before' : 'drop-after');
      });
      sheetsEl.addEventListener('dragleave', function (e) {
        if (e.target === sheetsEl) clearDropMarks();
      });
      sheetsEl.addEventListener('drop', function (e) {
        if (!dragSrcEl) return;
        e.preventDefault();
        var src = dragSrcEl;
        var card = (e.target && e.target.closest) ? e.target.closest('.postcard') : null;
        var changed = false;
        if (card && card !== src) {
          var r = card.getBoundingClientRect();
          var before = (e.clientX - r.left) < r.width / 2;
          var from = cards.indexOf(src);
          if (from >= 0) {
            cards.splice(from, 1);
            var to = cards.indexOf(card);
            cards.splice(before ? to : to + 1, 0, src);
            changed = true;
          }
        }
        endDrag();
        if (changed) applyOrderChange();
      });
      sheetsEl.addEventListener('dragend', endDrag);
    }

    /* 저장용: 프레임을 하나로 합쳤다가(HTML엔 36장이 한 덱으로 저장) 다시 펼친다 */
    function normalizeForSave() {
      if (frameBoards.length < 2) return null;
      var hidden = frameBoards.map(function (b) { return b.classList.contains('is-hidden-frame'); });
      var center = frameDecks.map(function (d) { return d.classList.contains('center-v'); });
      frameDecks.forEach(function (d) {
        Array.prototype.slice.call(d.querySelectorAll('.postcard')).forEach(function (c) { frameDecks[0].appendChild(c); });
      });
      frameBoards.forEach(function (b) { b.classList.remove('is-hidden-frame'); });
      frameDecks[0].classList.remove('center-v');
      var extra = frameBoards.slice(1);
      extra.forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
      return { extra: extra, hidden: hidden, center: center };
    }
    function restoreFromSave(state) {
      if (!state) return;
      state.extra.forEach(function (b) { sheetsEl.appendChild(b); });
      distributeCards();
      frameBoards.forEach(function (b, f) { b.classList.toggle('is-hidden-frame', !!state.hidden[f]); });
      /* 프레임별 세로 중앙 정렬 상태 복원 (3장 미만 프레임) */
      if (state.center) frameDecks.forEach(function (d, f) { d.classList.toggle('center-v', !!state.center[f]); });
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
      });
    }

    function apply(i, data) {
      var c = cards[i], nameEl = c.querySelector('.name'), small = c.querySelector('.name small');
      if (!nameEl.firstChild || nameEl.firstChild.nodeType !== 3) {
        nameEl.insertBefore(document.createTextNode(''), nameEl.firstChild);
      }
      nameEl.firstChild.nodeValue = data.name;
      if (small) small.textContent = data.alias;
      c.querySelector('.desc').textContent = data.desc;
      var traits = (data.traits || []).filter(function (t) { return String(t).trim().length; });
      c.querySelector('.traits').innerHTML = traits.map(function (t) {
        return '<li>' + esc(t.trim()) + '</li>';
      }).join('');
      c.querySelector('.quote').textContent = wrapQuote(data.quote);
      var im = c.querySelector('.art-img');
      if (data.img !== undefined) {              /* undefined = 그림은 그대로 둠 */
        if (data.img) {
          im.setAttribute('src', data.img);
          im.classList.toggle('is-user', data.img !== cards[i].__defaults.img);
        } else {
          im.removeAttribute('src');
          im.classList.remove('is-user');
        }
      }
      /* 그림 없이 색만 지정 (그라데이션 없이 단색)
         - 기본 배정색과 다른 색을 고르면 .is-user-color 를 붙여,
           모던 테마의 회색 덮어쓰기에서 제외한다 (고른 색이 그대로 보이게). */
      var photo = c.querySelector('.photo');
      if (photo && data.color) {
        photo.style.setProperty('--scene', data.color);
        var base = (cards[i].__defaults && cards[i].__defaults.color) || '';
        var changed = String(data.color).toLowerCase() !== String(base).toLowerCase();
        photo.classList.toggle('is-user-color', changed || photo.classList.contains('is-user-color'));
      }
      fitName(nameEl);   /* 이름이 길면 글씨를 줄여 가로폭에 맞춤 */
    }

    /* ===== 이름이 길면 글씨 크기를 줄여 한 줄 가로폭에 '전부' 들어가게 한다 =====
       (말줄임 없이 항상 다 보이게. 하한 없이 비례 축소)
       zoom 영향을 받지 않는 scrollWidth/clientWidth(레이아웃 값)로 측정한다. */
    function fitName(h2) {
      if (!h2) return;
      var tn = h2.firstChild;
      var text = (tn && tn.nodeType === 3) ? tn.nodeValue : '';
      h2.style.fontSize = '';                          /* 매번 기본 크기에서 다시 계산 */
      if (!text || !text.trim() || !h2.offsetWidth) return;   /* 숨은 프레임이면 건너뜀 */
      var basePx = parseFloat(getComputedStyle(h2).fontSize) || 27;
      var size = basePx;
      /* 넘치면 비례 축소를 반복해 오차 없이 딱 맞춘다 */
      for (var k = 0; k < 6; k++) {
        h2.style.fontSize = size + 'px';
        var cw = h2.clientWidth, sw = h2.scrollWidth;
        if (!cw || !sw || sw <= cw + 0.5) break;       /* 다 들어감 */
        size = size * (cw - 1) / sw;                   /* 조금 여유를 두고 다시 축소 */
        if (size < 1) { size = 1; break; }
      }
      h2.style.fontSize = size.toFixed(2) + 'px';
    }
    function fitNames() {
      cards.forEach(function (c) { fitName(c.querySelector('.name')); });
    }

    var f = {
      no: document.getElementById('editorNo'),
      name: document.getElementById('fName'),
      alias: document.getElementById('fAlias'),
      desc: document.getElementById('fDesc'),
      traits: document.getElementById('fTraits'),
      quote: document.getElementById('fQuote'),
      file: document.getElementById('fFile'),
      preview: document.getElementById('fPreview'),
      save: document.getElementById('fSave'),
      cancel: document.getElementById('fCancel'),
      reset: document.getElementById('fReset'),
      delImg: document.getElementById('fDelImg'),
      color: document.getElementById('fColor')
    };
    var cur = -1, pendingImg = null, curData = null;

    /* 입력창은 비워 두고 '지금 값'을 플레이스홀더로 보여 준다.
       (직접 지우지 않아도, 빈 채로 저장하면 지금 값이 그대로 유지됨) */
    function fillPlaceholder(el, text) {
      if (!el) return;
      el.value = '';
      el.placeholder = text || '';
    }

    function open(i) {
      cur = i;
      var d = readCard(i);
      curData = d;
      f.no.textContent = 'NO.' + ('0' + (i + 1)).slice(-2);
      fillPlaceholder(f.name, d.name);
      fillPlaceholder(f.alias, d.alias);
      fillPlaceholder(f.desc, d.desc);
      fillPlaceholder(f.traits, d.traits.join(', '));
      fillPlaceholder(f.quote, d.quote);
      if (d.img) { f.preview.setAttribute('src', d.img); } else { f.preview.removeAttribute('src'); }
      if (f.color) f.color.value = d.color || '#cdbb98';
      f.file.value = '';
      pendingImg = null;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      setTimeout(function () { try { f.name.focus(); } catch (e) {} }, 30);
    }
    function close() {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      cur = -1;
      pendingImg = null;
      curData = null;
    }

    /* 드래그로 순서를 바꾼 직후의 클릭은 편집창을 열지 않게 */
    var suppressCardClick = 0;
    cards.forEach(function (c) {
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.addEventListener('click', function () {
        if (Date.now() < suppressCardClick) return;
        open(cards.indexOf(c));   /* 순서가 바뀌어도 '지금 위치'로 연다 */
      });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(cards.indexOf(c)); }
      });
    });

    f.file.addEventListener('change', function () {
      var file = f.file.files && f.file.files[0];
      f.file.value = '';                       /* 같은 파일을 다시 골라도 열리도록 */
      if (!file) return;
      openCropEditor(file);                    /* 자르기 창에서 '이미지 적용'을 눌러야 반영됨 */
    });

    f.delImg.addEventListener('click', function () {
      if (cur < 0) return;
      pendingImg = '';                          /* 빈 값 → 저장하면 그림이 제거됨 */
      f.preview.removeAttribute('src');
      f.file.value = '';
    });

    f.save.addEventListener('click', function () {
      if (cur < 0) return;
      var idx = cur;
      var imgVal = pendingImg;   /* null=그림 그대로, ''=그림 삭제, 문자열=새 그림 */
      function finish(val) {
        var d = curData || readCard(idx);
        apply(idx, {
          /* 비워 둔 칸은 '지금 값'을 그대로 유지 */
          name: f.name.value.trim() || d.name,
          alias: f.alias.value.trim() || d.alias,
          desc: f.desc.value.trim() || d.desc,
          traits: f.traits.value.trim() ? f.traits.value.split(',') : d.traits,
          quote: f.quote.value.trim() || d.quote,
          img: val,
          color: f.color ? f.color.value : undefined
        });
        close();
        notifyApplied();   /* 서버가 있으면 save 폴더에 버전으로 저장 */
      }
      if (imgVal === null) { finish(undefined); return; }
      if (imgVal === '') { deleteServerImage(cards[idx]); finish(''); return; }
      if (imgVal.indexOf('data:') === 0 && SERVER.ok) {
        /* 새 그림 → 서버 슬롯 폴더에 '카드 고유 번호' 이름으로 저장 */
        uploadServerImage(cards[idx], imgVal, function (url) { finish(url || undefined); });
        return;
      }
      finish(imgVal);
    });

    f.reset.addEventListener('click', function () {
      if (cur < 0) return;
      apply(cur, { name: '', alias: '', desc: '', traits: [], quote: '', img: '' });
      deleteServerImage(cards[cur]);   /* 서버에 저장된 그림도 지움 */
      close();
      /* 비우기는 실수로 누를 수 있으니 서버에는 자동 저장하지 않는다 */
      screenOnly('🗑 이 카드를 비웠어요. 저장하려면 💾 저장(Ctrl+S)을 누르세요.');
    });
    f.cancel.addEventListener('click', close);
    modal.querySelector('.editor-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });

    var resetAll = document.getElementById('resetAllBtn');
    if (resetAll) {
      resetAll.addEventListener('click', function () {
        if (!window.confirm('처음 상태로 되돌릴까요?\n\n확인을 눌러도 💾 저장(Ctrl+S)을 하기 전에는 서버에 반영되지 않아요.')) return;
        cards.forEach(function (c, i) { apply(i, c.__defaults); });
        close();
        setCount(Math.min(PER_FRAME, cards.length));   /* 아예 9장 기본 화면으로 */
        scrollFrameTo(0);                              /* 첫 프레임으로 */
        /* 초기화는 실수로 누를 수 있으니 서버에는 자동 저장하지 않는다 */
        screenOnly('↺ 처음 상태로 되돌렸어요. 저장하려면 💾 저장(Ctrl+S)을 누르세요.');
      });
    }

    /* ============ 머리말(제목/부제목) + 바닥글 클릭 편집 ============ */
    var footSpan = document.querySelector('.foot span');
    var footFull = footSpan ? footSpan.textContent : '';
    /* 바닥글의 'N Portraits' 부분만 개수에 맞춰 자동 갱신 (나머지 문구는 편집 가능) */
    var FOOT_COUNT_RE = /\b(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|\d+)\s+Portraits/;
    function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    var headEls = {
      overline: qsa('.head .overline'),
      date: qsa('.head .date'),
      title: qsa('.head h1'),
      tagline: qsa('.head p'),
      foot: qsa('.foot [data-head]')
    };
    /* 제목·날짜 등 머리말 아무 곳이나, 바닥글 아무 곳이나 눌러도 편집창이 열리게 */
    var headAreas = qsa('.head').concat(qsa('.foot'));
    var headModal = document.getElementById('headEditor');
    if (headModal && headEls.title.length) {
      var hf = {
        overline: document.getElementById('hOverline'),
        date: document.getElementById('hDate'),
        dateNow: document.getElementById('hDateNow'),
        title: document.getElementById('hTitle'),
        tagline: document.getElementById('hTagline'),
        foot: document.getElementById('hFoot'),
        reset: document.getElementById('hReset'),
        cancel: document.getElementById('hCancel'),
        save: document.getElementById('hSave')
      };
      var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
      /* 화면에 보이는 날짜 문구 → 날짜 선택창 값(YYYY-MM-DD) */
      function dateToISO(text) {
        var s = String(text || '');
        var m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
        var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) return iso[1] + '-' + pad2(iso[2]) + '-' + pad2(iso[3]);
        return '';
      }
      /* 날짜 선택창 값(YYYY-MM-DD) → 화면에 보이는 날짜 문구 */
      function isoToDate(iso) {
        var m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) return '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (isNaN(d.getTime())) return '';
        return m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일 · ' + WEEKDAYS[d.getDay()] + '요일';
      }
      var headDefaults = {
        overline: headEls.overline[0] ? headEls.overline[0].textContent : '',
        date: headEls.date[0] ? headEls.date[0].textContent : '',
        title: headEls.title[0].textContent,
        tagline: headEls.tagline[0] ? headEls.tagline[0].textContent : '',
        foot: headEls.foot[0] ? headEls.foot[0].textContent : ''
      };

      function headCurrent() {
        return {
          overline: headEls.overline[0] ? headEls.overline[0].textContent : '',
          date: headEls.date[0] ? headEls.date[0].textContent : '',
          title: headEls.title[0] ? headEls.title[0].textContent : '',
          tagline: headEls.tagline[0] ? headEls.tagline[0].textContent : '',
          foot: footFull
        };
      }
      function setAll(list, text) { list.forEach(function (el) { el.textContent = text; }); }
      function applyHead(d) {
        setAll(headEls.overline, d.overline);
        setAll(headEls.date, d.date);
        setAll(headEls.title, d.title);
        setAll(headEls.tagline, d.tagline);
        if (headEls.foot.length && d.foot != null) { footFull = d.foot; renderFoots(); }
      }
      function openHead() {
        /* 지금 값을 플레이스홀더로: 비워 두면 그대로 유지 */
        var c = headCurrent();
        hf.overline.value = ''; hf.overline.placeholder = c.overline;
        /* 날짜는 글씨 대신 날짜 선택창 → 지금 날짜를 미리 골라 둔다 */
        hf.date.value = dateToISO(c.date);
        if (hf.dateNow) hf.dateNow.textContent = c.date ? ('지금: ' + c.date) : '지금: (없음)';
        hf.title.value = ''; hf.title.placeholder = c.title;
        hf.tagline.value = ''; hf.tagline.placeholder = c.tagline;
        if (hf.foot) { hf.foot.value = ''; hf.foot.placeholder = c.foot; }
        headModal.classList.add('open');
        headModal.setAttribute('aria-hidden', 'false');
        setTimeout(function () { try { hf.title.focus(); } catch (e) {} }, 30);
      }
      function closeHead() {
        headModal.classList.remove('open');
        headModal.setAttribute('aria-hidden', 'true');
      }

      /* 날짜 입력칸: 숫자를 직접 타이핑하지 않고 클릭하면 달력이 뜨게 한다 */
      function showDatePicker() {
        if (!hf.date || typeof hf.date.showPicker !== 'function') return;
        try { hf.date.showPicker(); } catch (e) {}   /* 사용자 동작 없이 부르면 브라우저가 거부 → 무시 */
      }
      if (hf.date) {
        hf.date.addEventListener('click', showDatePicker);
        hf.date.addEventListener('focus', showDatePicker);
        /* 숫자·문자 키는 막고(직접 입력 방지), 달력 조작 키만 허용.
           달력 기능이 없는 브라우저에서는 직접 입력을 그대로 허용한다. */
        hf.date.addEventListener('keydown', function (e) {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (typeof hf.date.showPicker !== 'function') return;
          if (e.key.length === 1) { e.preventDefault(); showDatePicker(); }
        });
      }

      var headKeys = ['overline', 'date', 'title', 'tagline', 'foot'];
      headKeys.forEach(function (k) {
        if (!headEls[k]) return;
        headEls[k].forEach(function (el) {
          if (!el) return;
          el.addEventListener('click', openHead);
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHead(); }
          });
        });
      });
      /* 머리말/바닥글 영역 전체 클릭 */
      headAreas.forEach(function (el) {
        if (!el) return;
        el.addEventListener('click', openHead);
      });

      hf.save.addEventListener('click', function () {
        var c = headCurrent();
        applyHead({
          /* 비워 둔 칸은 '지금 값'을 그대로 유지 */
          overline: hf.overline.value.trim() || c.overline,
          date: hf.date.value ? (isoToDate(hf.date.value) || c.date) : c.date,
          title: hf.title.value.trim() || c.title,
          tagline: hf.tagline.value.trim() || c.tagline,
          foot: hf.foot ? (hf.foot.value.trim() || c.foot) : c.foot
        });
        closeHead();
        notifyApplied();
      });
      hf.reset.addEventListener('click', function () {
        applyHead(headDefaults);
        closeHead();
        /* 초기화는 실수로 누를 수 있으니 서버에는 자동 저장하지 않는다 */
        screenOnly('↺ 머리말을 기본값으로 되돌렸어요. 저장하려면 💾 저장(Ctrl+S)을 누르세요.');
      });
      hf.cancel.addEventListener('click', closeHead);
      headModal.querySelector('.editor-backdrop').addEventListener('click', closeHead);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && headModal.classList.contains('open')) closeHead();
      });
      if (resetAll) resetAll.addEventListener('click', function () { applyHead(headDefaults); screenOnly('↺ 머리말을 기본값으로 되돌렸어요. 저장하려면 💾 저장(Ctrl+S)을 누르세요.'); });
    }

    /* ============ 편집창: 플레이스홀더(지금 값) 복사 버튼 ============
       각 입력칸 옆의 [복사] 버튼을 누르면 플레이스홀더에 있는 지금 값을
       입력칸에 채워 넣어 바로 고칠 수 있게 한다(클립보드에도 복사). */
    (function addPlaceholderCopyButtons() {
      function addTo(panel) {
        if (!panel) return;
        Array.prototype.slice.call(panel.querySelectorAll('input[type=text], textarea')).forEach(function (inp) {
          if (!inp.id) return;
          var lab = inp.closest ? inp.closest('label') : null;
          if (!lab || lab.querySelector('.copy-ph')) return;   /* 이미 있으면 건너뜀(중복 방지) */
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'copy-ph';
          btn.setAttribute('data-for', inp.id);
          btn.textContent = '복사';
          btn.title = '지금 값(플레이스홀더)을 입력칸에 복사';
          lab.appendChild(btn);
        });
      }
      addTo(document.getElementById('editor'));
      addTo(document.getElementById('headEditor'));
    })();

    document.addEventListener('click', function (e) {
      var t = e.target;
      var btn = (t && t.closest) ? t.closest('.copy-ph') : null;
      if (!btn) return;
      e.preventDefault();
      var inp = document.getElementById(btn.getAttribute('data-for'));
      if (!inp) return;
      var val = inp.placeholder || '';
      if (val) inp.value = val;                 /* 지금 값을 입력칸에 채움 */
      try {
        inp.focus();
        var n = inp.value.length;
        if (inp.setSelectionRange) inp.setSelectionRange(n, n);
      } catch (err) {}
      if (val && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(function () {
          setStatus('⧉ 지금 값을 복사했어요. 필요하면 고쳐서 저장하세요.', true);
        }, function () {});
      }
    });

    /* ============ 엽서 개수 조절 (프레임 단위 배치) ============ */
    var cntVal = document.getElementById('cntVal');
    var cntMinus = document.getElementById('cntMinus');
    var cntPlus = document.getElementById('cntPlus');
    var cntRange = document.getElementById('cntRange');
    var NUMWORDS = {
      1:'One',2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',
      11:'Eleven',12:'Twelve',13:'Thirteen',14:'Fourteen',15:'Fifteen',16:'Sixteen',17:'Seventeen',18:'Eighteen',19:'Nineteen',20:'Twenty',
      21:'Twenty-One',22:'Twenty-Two',23:'Twenty-Three',24:'Twenty-Four',25:'Twenty-Five',26:'Twenty-Six',27:'Twenty-Seven',28:'Twenty-Eight',29:'Twenty-Nine',30:'Thirty',
      31:'Thirty-One',32:'Thirty-Two',33:'Thirty-Three',34:'Thirty-Four',35:'Thirty-Five',36:'Thirty-Six'
    };
    var FOOT_SHEET_RE = /Sheet\s+\d+\s*\/\s*\d+/i;
    var currentN = Math.min(PER_FRAME, cards.length);

    /* 프레임 이동 표시(내비게이션) */
    var frameNav = document.getElementById('frameNav');
    var frameInd = document.getElementById('frameInd');
    var framePrev = document.getElementById('framePrev');
    var frameNext = document.getElementById('frameNext');
    var curFrame = 0;        /* 현재 보고 있는(왼쪽에 맞춰진) 프레임 */
    var navLock = 0;         /* 내비로 이동 중에는 스크롤 감지가 튀지 않게 */
    var hasInit = false;

    function pad2(x) { return ('0' + x).slice(-2); }
    function visibleFrameCount() { return Math.max(1, Math.ceil(currentN / PER_FRAME)); }

    /* 프레임마다 머리말/바닥글 반복 + 시트 번호 자동 */
    function renderFoots() {
      if (!frameBoards.length) return;
      var total = Math.max(1, Math.ceil(currentN / PER_FRAME));
      var word = (NUMWORDS[currentN] || currentN) + ' Portraits';
      var base = footFull.replace(FOOT_COUNT_RE, word);
      frameBoards.forEach(function (b, f) {
        var span = b.querySelector('.foot span');
        if (!span) return;
        span.textContent = base.replace(FOOT_SHEET_RE, 'Sheet ' + pad2(f + 1) + ' / ' + pad2(total));
      });
    }

    function updateFrameNav() {
      var n = visibleFrameCount();
      if (curFrame > n - 1) curFrame = n - 1;
      if (frameNav) frameNav.setAttribute('aria-hidden', n <= 1 ? 'true' : 'false');
      if (frameInd) frameInd.textContent = (curFrame + 1) + ' / ' + n;
      if (framePrev) framePrev.disabled = (curFrame <= 0);
      if (frameNext) frameNext.disabled = (curFrame >= n - 1);
    }

    /* 특정 프레임을 스크롤 영역의 왼쪽(패딩)에 맞춘다 */
    function scrollFrameTo(idx) {
      if (!sheetsEl) return;
      var n = visibleFrameCount();
      idx = Math.max(0, Math.min(n - 1, idx));
      var el = frameBoards[idx];
      if (!el) return;
      var cr = sheetsEl.getBoundingClientRect();
      var er = el.getBoundingClientRect();
      var pad = parseFloat(getComputedStyle(sheetsEl).paddingLeft) || 0;
      sheetsEl.scrollLeft += (er.left - cr.left) - pad;   /* 현재 위치 → 목표 위치 */
      curFrame = idx;
      navLock = Date.now() + 700;   /* smooth 스크롤 동안 감지 잠금 */
      updateFrameNav();
    }

    /* 스크롤 위치에서 왼쪽에 가장 가까운 프레임을 현재 프레임으로 */
    function frameFromScroll() {
      var n = visibleFrameCount();
      var cr = sheetsEl.getBoundingClientRect();
      var pad = parseFloat(getComputedStyle(sheetsEl).paddingLeft) || 0;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < n; i++) {
        var b = frameBoards[i];
        if (!b || b.classList.contains('is-hidden-frame')) continue;
        var d = Math.abs((b.getBoundingClientRect().left - cr.left) - pad);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    if (sheetsEl) {
      sheetsEl.addEventListener('scroll', function () {
        if (!hasInit || Date.now() < navLock) return;
        var f = frameFromScroll();
        if (f !== curFrame) { curFrame = f; updateFrameNav(); }
      }, { passive: true });
    }
    if (framePrev) framePrev.addEventListener('click', function () { scrollFrameTo(curFrame - 1); });
    if (frameNext) frameNext.addEventListener('click', function () { scrollFrameTo(curFrame + 1); });

    /* ===== 포커스(키보드 탭)로 들어온 프레임을 화면 가운데로 =====
       좌우 '끝' 프레임도 중앙에 올 수 있게 fitBoard 가 양옆 여백을 절반씩 잡아 준다.
       (마우스 클릭/드래그로 생긴 포커스는 화면이 튀지 않게 건너뛴다) */
    var pointerFocusAt = 0;
    document.addEventListener('pointerdown', function () { pointerFocusAt = Date.now(); }, true);
    if (sheetsEl) {
      sheetsEl.addEventListener('focusin', function (e) {
        if (Date.now() - pointerFocusAt < 250) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var board = t.closest('.board');
        if (!board || !sheetsEl.contains(board)) return;
        var cr = sheetsEl.getBoundingClientRect();
        var br = board.getBoundingClientRect();
        if (br.width >= cr.width - 1) {
          /* 프레임이 화면보다 넓을 때(브라우저 확대 등)는 포커스된 엽서를 가운데로 */
          var card = t.closest('.postcard') || t;
          var r = card.getBoundingClientRect();
          var target = sheetsEl.scrollLeft + (r.left - cr.left) - (cr.width - r.width) / 2;
          var maxS = sheetsEl.scrollWidth - sheetsEl.clientWidth;
          sheetsEl.scrollLeft = Math.max(0, Math.min(maxS, target));
          return;
        }
        var idx = frameBoards.indexOf(board);
        if (idx >= 0) scrollFrameTo(idx);
      });
    }

    function setCount(n, focusLast) {
      n = Math.max(1, Math.min(cards.length, parseInt(n, 10) || 1));
      currentN = n;
      cards.forEach(function (c, i) { c.classList.toggle('is-hidden', i >= n); });
      var shownFrames = Math.ceil(n / PER_FRAME);
      frameBoards.forEach(function (b, f) {
        var hidden = f >= shownFrames;
        b.classList.toggle('is-hidden-frame', hidden);
        var inThis = Math.min(n, (f + 1) * PER_FRAME) - f * PER_FRAME;
        frameDecks[f].classList.toggle('center-v', !hidden && inThis > 0 && inThis < 3);
      });
      if (cntVal) cntVal.textContent = n;
      if (cntRange) cntRange.value = n;
      if (cntMinus) cntMinus.disabled = (n <= 1);
      if (cntPlus) cntPlus.disabled = (n >= cards.length);
      renderFoots();
      if (curFrame > shownFrames - 1) curFrame = shownFrames - 1;
      if (focusLast && shownFrames > 1) {
        /* 늘리면 새 엽서가 있는 마지막(오른쪽) 프레임으로 이동
           (scrollFrameTo 안의 getBoundingClientRect 가 레이아웃을 즉시 반영) */
        scrollFrameTo(shownFrames - 1);
      } else {
        updateFrameNav();
      }
      fitNames();      /* 이름이 길면 글씨를 줄여 가로폭에 맞춤 */
      scheduleFit();   /* 장수에 따라 액자 높이가 달라지므로 화면에 맞춰 다시 축소 */
    }
    if (cntRange) cntRange.max = String(cards.length);
    function countChanged() { setCount.apply(null, arguments); notifyApplied(); }
    if (cntMinus) cntMinus.addEventListener('click', function () { countChanged(parseInt(cntVal.textContent, 10) - 1, true); });
    if (cntPlus)  cntPlus.addEventListener('click',  function () { countChanged(parseInt(cntVal.textContent, 10) + 1, true); });
    if (cntRange) cntRange.addEventListener('input',  function () { countChanged(cntRange.value, true); });

    /* 개수 숫자를 더블클릭하면 직접 입력 */
    function commitCountEdit() {
      if (!cntVal || !cntVal.isContentEditable) return;
      cntVal.contentEditable = 'false';
      cntVal.classList.remove('editing');
      var v = parseInt((cntVal.textContent || '').replace(/[^0-9]/g, ''), 10);
      setCount(isNaN(v) ? currentN : v, true);
      notifyApplied();
    }
    if (cntVal) {
      cntVal.addEventListener('dblclick', function () {
        if (cntVal.isContentEditable) return;
        cntVal.contentEditable = 'true';
        cntVal.classList.add('editing');
        var range = document.createRange();
        range.selectNodeContents(cntVal);
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        try { cntVal.focus(); } catch (e) {}
      });
      cntVal.addEventListener('blur', commitCountEdit);
      cntVal.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitCountEdit(); try { cntVal.blur(); } catch (err) {} }
        else if (e.key === 'Escape') {
          cntVal.textContent = currentN;
          cntVal.contentEditable = 'false';
          cntVal.classList.remove('editing');
          try { cntVal.blur(); } catch (err) {}
        }
      });
    }

    var savedCount = parseInt(document.body.getAttribute('data-count') || '', 10);
    setCount(isNaN(savedCount) ? Math.min(PER_FRAME, cards.length) : savedCount);   /* 저장된 장수 없으면 기본 9장 */
    hasInit = true;
    updateFrameNav();
    scheduleFit();   /* 첫 화면도 뷰포트 높이에 맞춰 축소 */

    /* ============ 텍스트를 HTML 파일에 저장 ============ */
    var statusEl = document.getElementById('saveStatus');
    var htmlSaveBtn = document.getElementById('htmlSaveBtn');
    var fileHandle = null;
    var FILE_NAME = (function () {
      try {
        var p = decodeURIComponent(location.pathname.split('/').pop() || '');
        return /\.html?$/i.test(p) ? p : 'postcard-cards.html';
      } catch (e) { return 'postcard-cards.html'; }
    })();

    function setStatus(msg, ok) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.background = ok ? 'rgba(28,74,32,.85)' : 'rgba(0,0,0,.5)';
    }

    /* ---- 파이썬 서버 연동: images 폴더 저장 + save 폴더에 버전 저장 ---- */
    var SERVER = { ok: false };
    /* 지금 열려 있는 슬롯 번호(save/slotN/ 로 열었을 때). 없으면 null → 서버가 빈 슬롯을 골라줌 */
    var pageSlot = (function () {
      var m = location.pathname.match(/\/save\/slot(\d+)(?:\/|\/index\.html)?$/i);
      return m ? parseInt(m[1], 10) : null;
    })();
    function api(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    }
    function setServerMode() {
      if (SERVER.ok) {
        setStatus('서버 연결됨 · 고친 내용은 save 폴더에 버전으로 저장돼요. (버전 / 저장 버튼)', true);
      } else {
        setStatus('오프라인 모드 · 💾 버튼으로 파일에 저장하세요.', false);
      }
      /* ⏻ 서버 종료 버튼은 서버가 있을 때만 보인다 */
      var qb = document.getElementById('quitBtn');
      if (qb) qb.style.display = SERVER.ok ? '' : 'none';
      refreshSlotBadge();   /* 지금 켜둔 슬롯 배지 갱신 */
    }
    function pingServer() {
      fetch('/api/ping', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { SERVER.ok = !!(j && j.ok); setServerMode(); })
        .catch(function () { SERVER.ok = false; setServerMode(); });
    }
    function uploadServerImage(card, dataUrl, cb) {
      api('/api/image', { index: cardImgKey(card), data: dataUrl, slot: pageSlot })
        .then(function (j) {
          if (j && j.ok && j.url) {
            if (!pageSlot && j.slot) pageSlot = j.slot;   /* 처음 만든 슬롯을 기억 */
            cb(j.url);
          } else {
            setStatus('이미지 저장 실패: ' + ((j && j.error) || '알 수 없음'), false);
            cb(null);
          }
        })
        .catch(function () { setStatus('서버에 이미지를 저장하지 못했어요.', false); cb(null); });
    }
    function deleteServerImage(card) {
      if (!SERVER.ok) return;
      api('/api/image/delete', { index: cardImgKey(card), slot: pageSlot }).catch(function () {});
    }
    /* 파일에 남아 있어야 할 그림들을 '카드 고유 번호' 기준으로 모은다 */
    function currentImageKeys() {
      var keep = [];
      cards.forEach(function (c) {
        var s = c.querySelector('.art-img').getAttribute('src') || '';
        if (s && s.indexOf('data:') !== 0) keep.push(cardImgKey(c));
      });
      return keep;
    }
    /* 파일에서 빠진 그림은 지금 슬롯 폴더에서도 정리 */
    function reconcileImages() {
      if (!SERVER.ok) return;
      api('/api/images/reconcile', { keep: currentImageKeys(), slot: pageSlot }).catch(function () {});
    }

    var saveTimer = null;
    function notifyApplied() {
      if (!SERVER.ok) {
        setStatus('화면에 적용했어요. 파일에 저장하려면 💾 버튼을 누르세요.', false);
        return;
      }
      setStatus('💾 save 폴더에 저장하는 중…', false);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { commitHTML(); }, 400);
    }
    /* 화면에만 반영하고 서버에는 저장하지 않는다 (초기화처럼 실수로 되돌릴 수 있는 동작) */
    function screenOnly(msg) {
      clearTimeout(saveTimer);
      setStatus(msg || '화면에 적용했어요. 서버에 반영하려면 💾 저장(Ctrl+S)을 누르세요.', false);
    }
    /* opts.slot / opts.alias 를 주면 그 슬롯에 저장, 없으면 지금 슬롯(또는 서버가 고른 빈 슬롯) */
    function commitHTML(opts) {
      opts = opts || {};
      clearTimeout(saveTimer);
      if (!SERVER.ok) { persistText(); return Promise.resolve(false); }
      /* PNG로 그리는 동안은 화면이 특수 상태라 그대로 저장하면 오염된다 → 끝나고 다시 저장 */
      if (document.body.classList.contains('capturing')) {
        saveTimer = setTimeout(function () { commitHTML(opts); }, 700);
        return Promise.resolve(false);
      }
      var payload = { html: buildHTML() };
      var slot = opts.slot || pageSlot;
      if (slot) payload.slot = slot;
      if (pageSlot) payload.from = pageSlot;   /* 그림을 옮겨 담을 때 원본 슬롯을 알려 줌 */
      if (opts.alias) payload.alias = opts.alias;
      return api('/api/save', payload)
        .then(function (j) {
          if (j && j.ok) {
            if (!pageSlot && j.slot) pageSlot = j.slot;   /* 처음 만든 슬롯을 기억 */
            if (j.alias) slotAlias = j.alias;
            setStatus('✅ 저장했어요 · 슬롯 ' + j.slot + (j.alias ? ' (' + j.alias + ')' : ''), true);
            refreshSlotBadge();   /* 지금 켜둔 슬롯 배지 갱신 */
            reconcileImages();   /* 파일에서 지운 그림은 서버에서도 삭제 */
          } else {
            setStatus('저장 실패: ' + ((j && j.error) || '알 수 없음'), false);
          }
        })
        .catch(function () { setStatus('서버에 저장하지 못했어요. (서버 실행 여부를 확인해 주세요)', false); });
    }

    /* 이미지 요소에 src/사용자표시를 안전하게 반영 */
    function setImg(im, src, user) {
      if (src) im.setAttribute('src', src); else im.removeAttribute('src');
      im.classList.toggle('is-user', !!user);
    }

    /* 현재 텍스트만 반영한 HTML 문서를 만든다
       - 임시 그림(data:)은 저장하지 않고, 서버에 저장된 그림(경로)은 그대로 저장
       - 편집창 상태·개수는 저장하지 않음 */
    function buildHTML() {
      var savedSrc = [], savedUser = [], savedHidden = [];
      cards.forEach(function (c, i) {
        var im = c.querySelector('.art-img');
        var s = im.getAttribute('src');
        var isData = !!(s && s.indexOf('data:') === 0);
        savedSrc.push(s);
        savedUser.push(im.classList.contains('is-user'));
        savedHidden.push(c.classList.contains('is-hidden'));
        if (isData) setImg(im, cards[i].__defaults.img, false);   /* 임시 그림은 저장하지 않음 */
        else setImg(im, s, !!s);                          /* 서버 그림(경로)은 저장 */
        c.classList.remove('is-hidden');                  /* 개수 설정은 화면용이라 저장하지 않음 */
      });
      var openModals = Array.prototype.slice.call(document.querySelectorAll('.editor.open'));
      var modalAria = openModals.map(function (m) { return m.getAttribute('aria-hidden'); });
      openModals.forEach(function (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); });
      /* 그리기용 복제본과 특수 상태는 저장물에 절대 넣지 않는다 */
      Array.prototype.slice.call(document.querySelectorAll('[data-capture-host]')).forEach(function (h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      var wasCapturing = document.body.classList.contains('capturing');
      if (wasCapturing) document.body.classList.remove('capturing');
      /* 플로팅 UI 숨김 상태는 화면 전용 → 저장물에는 담지 않는다 */
      var wasUIHidden = document.body.classList.contains('hide-ui');
      if (wasUIHidden) document.body.classList.remove('hide-ui');
      if (statusEl) statusEl.textContent = '';
      var verListEl = document.getElementById('verList');          /* 버전 목록은 저장하지 않음 */
      var verSaved = verListEl ? verListEl.innerHTML : null;
      if (verListEl) verListEl.innerHTML = '';
      var hadPrev = f.preview.hasAttribute('src');
      var prevPrev = f.preview.getAttribute('src');
      f.preview.removeAttribute('src');        /* 미리보기(임시 그림)는 저장하지 않음 */
      var frameState = normalizeForSave();     /* 여러 프레임을 한 덱으로 합쳐 저장 */
      var prevCount = document.body.getAttribute('data-count');
      document.body.setAttribute('data-count', String(currentN));   /* 펼쳐 놓은 장수 저장 */
      /* 저장물에는 항상 모든 테마 <link> 와 최신 테마 목록을 담는다
         (예전 저장본을 열어 다시 저장해도 새 테마가 함께 담기도록) */
      ensureThemeInfra();
      var html = '<!doctype html>\n' + document.documentElement.outerHTML;
      if (prevCount === null) document.body.removeAttribute('data-count');
      else document.body.setAttribute('data-count', prevCount);
      restoreFromSave(frameState);             /* 다시 프레임으로 펼침 */
      if (verListEl && verSaved !== null) verListEl.innerHTML = verSaved;
      if (hadPrev) f.preview.setAttribute('src', prevPrev);
      openModals.forEach(function (m, i) { m.classList.add('open'); if (modalAria[i] != null) m.setAttribute('aria-hidden', modalAria[i]); });
      if (wasCapturing) document.body.classList.add('capturing');
      if (wasUIHidden) document.body.classList.add('hide-ui');
      cards.forEach(function (c, i) {
        var im = c.querySelector('.art-img');
        setImg(im, savedSrc[i], savedUser[i]);
        c.classList.toggle('is-hidden', savedHidden[i]);
      });
      return html;
    }

    async function persistText() {
      var blob = new Blob([buildHTML()], { type: 'text/html;charset=utf-8' });

      if (window.showSaveFilePicker) {
        try {
          if (!fileHandle) {
            fileHandle = await window.showSaveFilePicker({
              suggestedName: FILE_NAME,
              types: [{ description: 'HTML 파일', accept: { 'text/html': ['.html', '.htm'] } }]
            });
          }
          var w = await fileHandle.createWritable();
          await w.write(blob);
          await w.close();
          setStatus('✅ "' + fileHandle.name + '" 파일에 저장했어요.', true);
        } catch (e) {
          if (e && e.name === 'AbortError') { setStatus('저장을 취소했어요.', false); return; }
          setStatus('파일 저장 실패 (' + (e && e.name) + ')', false);
        }
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = FILE_NAME;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        setStatus('자동 저장이 안 되는 브라우저예요. 새 파일을 내려받았으니 기존 파일에 덮어써 주세요.', false);
      }
    }

    if (htmlSaveBtn) {
      htmlSaveBtn.addEventListener('click', function () { clearTimeout(saveTimer); commitHTML(); });
    }

    /* Ctrl+S(⌘S) → 지금 열려 있는 슬롯에 바로 저장 (브라우저 '페이지 저장' 창은 막는다) */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      clearTimeout(saveTimer);
      if (SERVER.ok) {
        setStatus('💾 현재 슬롯에 저장하는 중…', false);
        commitHTML();
      } else {
        persistText();
      }
    });
    pingServer();   /* 서버가 있으면 자동 저장 모드로 */

    /* ============ 프레임(엽서판)마다 따로 이미지(PNG)로 저장 ============ */
    var saveBtn = document.getElementById('saveBtn');

    function visibleBoards() {
      return frameBoards.filter(function (b) { return !b.classList.contains('is-hidden-frame'); });
    }
    /* 액자는 #sheets(가로 스크롤 영역) 안에 있어서 화면 밖 프레임은 그대로 그리면 잘려 나온다.
       → 복제본을 문서 원점에 잠깐 두고 그리면 모든 프레임이 같은 나무 배경으로 나온다. */
    function captureBoard(board, opts) {
      /* modern-screenshot(SVG foreignObject): 브라우저가 실제로 그리는 그대로 그려서
         그림자·drop-shadow 필터·배경 블렌드까지 화면과 똑같이 저장된다. */
      var MS = window.modernScreenshot;
      if (MS && typeof MS.domToCanvas === 'function') {
        var nw = board.offsetWidth || 1754;
        var nh = board.offsetHeight || 1700;
        return MS.domToCanvas(board, {
          width: nw,
          height: nh,
          scale: (opts && opts.scale) || 1,
          backgroundColor: (opts && opts.backgroundColor) || '#20241d'
        });
      }
      var host = document.createElement('div');
      host.setAttribute('data-capture-host', '1');
      host.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;pointer-events:none;';
      var clone = board.cloneNode(true);
      clone.removeAttribute('id');
      host.appendChild(clone);
      document.body.appendChild(host);
      /* body.capturing 상태에서는 zoom:1 이라 클론이 '자연 크기'로 측정된다.
         (화면 맞춤용 zoom이 그려지는 이미지 크기를 줄이지 않도록) */
      var natW = clone.offsetWidth || board.offsetWidth || 1754;
      var natH = clone.offsetHeight || board.offsetHeight || 1700;
      host.style.width = natW + 'px';
      var o = {};
      for (var k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]; }
      o.windowWidth = Math.max(opts.windowWidth || 0, natW + 80);
      o.windowHeight = Math.max(opts.windowHeight || 0, natH + 80);
      function cleanup() { if (host.parentNode) host.parentNode.removeChild(host); }
      return html2canvas(clone, o).then(function (cv) { cleanup(); return cv; }, function (err) { cleanup(); throw err; });
    }
    /* 한 장의 캔버스를 파일로 내려받는다 (완료하면 true/false) */
    function downloadCanvas(canvas, name) {
      return new Promise(function (resolve) {
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) { resolve(false); return; }
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
            resolve(true);
          }, 'image/png');
        } else {
          var a2 = document.createElement('a');
          a2.href = canvas.toDataURL('image/png');
          a2.download = name;
          document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
          resolve(true);
        }
      });
    }
    /* 프레임 한 장 → 파일 한 장. 여러 장이면 이름 뒤에 번호(_01, _02 …)를 붙인다 */
    function saveFramesAsImages(list) {
      var base = pageSlot ? ('slot' + pageSlot) : (FILE_NAME.replace(/\.html?$/i, '') || 'postcard-cards');
      var many = list.length > 1;
      var okN = 0;
      var seq = Promise.resolve();
      list.forEach(function (cv, i) {
        seq = seq.then(function () {
          var name = many ? (base + '_' + pad2(i + 1) + '.png') : (base + '.png');
          return downloadCanvas(cv, name).then(function (ok) { if (ok) okN += 1; });
        });
      });
      return seq.then(function () {
        if (okN === list.length) {
          setStatus('✅ 프레임 ' + okN + '장을 각각 이미지로 저장했어요.', true);
        } else {
          setStatus('이미지 ' + okN + ' / ' + list.length + '장만 저장했어요.', false);
        }
      });
    }

    /* html2canvas가 배경 이미지를 패턴으로 만들 때, 브라우저가 그 이미지의 고유 크기를
       0으로 보고하면(일부 Safari·특정 SVG 등) 0×0 캔버스로 createPattern을 호출해
       이미지 저장이 통째로 실패한다. 그런 경우에만 1×1 투명 패턴으로 대체해
       저장이 끝까지 진행되도록 한다. (정상 크기 배경은 그대로 그린다) */
    function installPatternGuard() {
      var proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
      if (!proto || typeof proto.createPattern !== 'function') return null;
      var orig = proto.createPattern;
      var blank = null;
      proto.createPattern = function (img, rep) {
        if (img && (img.width === 0 || img.height === 0)) {
          if (!blank) { blank = document.createElement('canvas'); blank.width = 1; blank.height = 1; }
          try { return orig.call(this, blank, rep); } catch (e) { return null; }
        }
        return orig.apply(this, arguments);
      };
      return function restore() { proto.createPattern = orig; };
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (typeof html2canvas !== 'function' && !(window.modernScreenshot && window.modernScreenshot.domToCanvas)) {
          setStatus('이미지 저장 도구를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.', false);
          return;
        }
        var boards = visibleBoards();
        if (!boards.length) {
          setStatus('저장할 대상을 찾지 못했어요.', false);
          return;
        }
        saveBtn.disabled = true;
        setStatus('🖼️ 프레임 ' + boards.length + '장을 각각 이미지로 저장하는 중…', false);
        document.body.classList.add('capturing');
        var restorePatternGuard = installPatternGuard();

        var opts = {
          backgroundColor: (function () {
            /* 저장 이미지 배경도 지금 테마의 벽 색을 따른다 (예전엔 항상 기본 나무 테마 색) */
            var wall = getComputedStyle(document.documentElement).getPropertyValue('--wall-base').trim();
            return wall || '#20241d';
          })(),
          scale: (function () {
            var s = Math.max(1.5, Math.min(2, window.devicePixelRatio || 1.5));
            s = s / 2;                                            /* 해상도를 절반으로 → 용량 절감 */
            if (1754 * s > 8000) s = Math.max(1, 8000 / 1754);   /* 프레임 한 장이 너무 커지지 않게 */
            return s;
          })(),
          useCORS: true,
          allowTaint: false,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight
        };

        /* 프레임을 하나씩(순차로) 그려 메모리를 아낀다 */
        var chain = Promise.resolve([]);
        boards.forEach(function (b) {
          chain = chain.then(function (acc) {
            return captureBoard(b, opts).then(function (cv) { acc.push(cv); return acc; });
          });
        });

        chain.then(function (list) {
          if (!list.length) throw new Error('빈 이미지');
          return saveFramesAsImages(list);   /* 프레임마다 따로 저장 */
        }).catch(function (e) {
          setStatus('이미지 저장 실패 (' + ((e && e.message) || e) + ')', false);
        }).then(function () {
          if (restorePatternGuard) restorePatternGuard();
          saveBtn.disabled = false;
          document.body.classList.remove('capturing');
        });
      });
    }

    /* ============ 저장 버전(슬롯) 창 ============ */
    var verModal = document.getElementById('versions');
    var verList = document.getElementById('verList');
    var versionsBtn = document.getElementById('versionsBtn');
    var verCloseBtn = document.getElementById('verClose');
    var verSaveNew = document.getElementById('verSaveNew');
    var verMaxNote = document.getElementById('verMaxNote');
    var verMax = 5;

    function closeVersions() {
      if (!verModal) return;
      verModal.classList.remove('open');
      verModal.setAttribute('aria-hidden', 'true');
    }
    function renderVersionRows(list) {
      if (!verList) return;
      var bySlot = {};
      list.forEach(function (v) { bySlot[v.slot] = v; });
      verList.innerHTML = '';
      for (var s = 1; s <= verMax; s++) {
        var v = bySlot[s];
        var li = document.createElement('li');
        li.className = 'ver-row' + (v ? '' : ' empty') + ((v && s === pageSlot) ? ' current' : '');

        var slotEl = document.createElement('span');
        slotEl.className = 'ver-slot';
        slotEl.textContent = '슬롯 ' + s + (s === pageSlot ? ' · 지금' : '');

        var mid = document.createElement('div');
        mid.className = 'ver-mid';
        var alias = document.createElement('input');
        alias.type = 'text';
        alias.className = 'ver-alias';
        alias.setAttribute('data-slot', String(s));
        alias.setAttribute('autocomplete', 'off');
        if (v) {
          alias.value = v.alias || '';
          alias.placeholder = '별칭 없음';
        } else {
          alias.value = '';
          alias.placeholder = '비어 있는 슬롯';
          alias.disabled = true;
        }
        var meta = document.createElement('span');
        meta.className = 'ver-meta';
        meta.textContent = v ? ('저장 ' + (v.created || '')) : '아직 저장된 내용이 없어요';
        mid.appendChild(alias);
        mid.appendChild(meta);

        var btns = document.createElement('div');
        btns.className = 'ver-btns';
        var loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.setAttribute('data-act', 'load');
        loadBtn.setAttribute('data-slot', String(s));
        loadBtn.textContent = '불러오기';
        loadBtn.disabled = !v;
        var saveBtn2 = document.createElement('button');
        saveBtn2.type = 'button';
        saveBtn2.className = 'primary';
        saveBtn2.setAttribute('data-act', 'save');
        saveBtn2.setAttribute('data-slot', String(s));
        saveBtn2.textContent = '이 슬롯에 저장';
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'danger';
        delBtn.setAttribute('data-act', 'del');
        delBtn.setAttribute('data-slot', String(s));
        delBtn.textContent = '삭제';
        delBtn.title = '이 슬롯(html+그림)을 서버에서 지웁니다';
        delBtn.disabled = !v;
        btns.appendChild(loadBtn);
        btns.appendChild(saveBtn2);
        btns.appendChild(delBtn);

        li.appendChild(slotEl);
        li.appendChild(mid);
        li.appendChild(btns);
        verList.appendChild(li);
      }
    }
    function renderVersions() {
      if (!verList) return;
      verList.innerHTML = '<li class="ver-empty">버전 정보를 불러오는 중…</li>';
      return fetch('/api/versions', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) { verList.innerHTML = '<li class="ver-empty">버전 정보를 읽지 못했어요.</li>'; return; }
          verMax = j.max || verMax;
          if (verMaxNote) verMaxNote.textContent = '(최대 ' + verMax + '개)';
          renderVersionRows(j.versions || []);
        })
        .catch(function () {
          verList.innerHTML = '<li class="ver-empty">서버에 연결하지 못했어요.</li>';
        });
    }
    function openVersions() {
      if (!verModal) return;
      verModal.classList.add('open');
      verModal.setAttribute('aria-hidden', 'false');
      renderVersions();
    }

    /* ---- 지금 켜둔 슬롯(번호 + 별칭)을 화면 왼쪽 위에 띄운다 ---- */
    var slotBadge = document.getElementById('slotBadge');
    if (!slotBadge) {
      /* 예전에 저장한 슬롯에는 배지가 없을 수 있으니 만들어 넣는다 */
      var topLeft = document.querySelector('.topleft');
      if (topLeft) {
        slotBadge = document.createElement('button');
        slotBadge.type = 'button';
        slotBadge.id = 'slotBadge';
        slotBadge.className = 'slot-badge';
        slotBadge.setAttribute('data-html2canvas-ignore', 'true');
        slotBadge.style.display = 'none';
        slotBadge.textContent = '🏷️ 슬롯 —';
        topLeft.insertBefore(slotBadge, topLeft.firstChild);
      }
    }
    var slotAlias = '';   /* 지금 슬롯의 별칭 캐시 */
    function paintSlotBadge() {
      if (!slotBadge) return;
      if (!SERVER.ok) { slotBadge.style.display = 'none'; return; }
      slotBadge.style.display = '';
      if (pageSlot) {
        slotBadge.textContent = '🏷️ 슬롯 ' + pageSlot + (slotAlias ? ' · ' + slotAlias : ' · 별칭 없음');
        slotBadge.title = '지금 켜둔 슬롯 ' + pageSlot + (slotAlias ? ' (' + slotAlias + ')' : '') + ' · 눌러서 버전 창 열기';
        slotBadge.classList.remove('is-template');
      } else {
        slotBadge.textContent = '🏷️ 기본 템플릿 · 아직 슬롯 없음';
        slotBadge.title = '아직 저장된 슬롯이 없어요(기본 템플릿) · 눌러서 버전 창 열기';
        slotBadge.classList.add('is-template');
      }
    }
    /* 지금 슬롯의 별칭을 서버에서 다시 읽어 배지에 반영 */
    function refreshSlotBadge() {
      if (!slotBadge) return;
      if (!SERVER.ok || !pageSlot) { slotAlias = ''; paintSlotBadge(); return; }
      fetch('/api/versions', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            var v = null;
            (j.versions || []).forEach(function (x) { if (x.slot === pageSlot) v = x; });
            slotAlias = (v && v.alias) ? v.alias : '';
          }
          paintSlotBadge();
        })
        .catch(function () { paintSlotBadge(); });
    }
    if (slotBadge) slotBadge.addEventListener('click', openVersions);
    /* 지금 화면을 특정 슬롯에 저장 */
    function saveIntoSlot(slot) {
      if (!SERVER.ok) { setStatus('서버에 연결되어야 슬롯에 저장할 수 있어요.', false); return; }
      Promise.resolve(commitHTML({ slot: slot })).then(function () { renderVersions(); });
    }
    /* 슬롯(폴더 + CSV)을 서버에서 삭제 */
    function deleteSlot(slot) {
      if (!SERVER.ok) { setStatus('서버에 연결되어야 슬롯을 지울 수 있어요.', false); return; }
      if (!window.confirm('슬롯 ' + slot + '을(를) 지울까요?\n\n저장된 화면과 그림이 서버에서 함께 삭제돼요. 되돌릴 수 없어요.')) return;
      api('/api/delete_slot', { slot: slot })
        .then(function (j) {
          if (j && j.ok) {
            if (slot === pageSlot) pageSlot = null;   /* 지금 슬롯을 지웠으면 기억을 비운다 */
            setStatus('🗑️ ' + (j.message || ('슬롯 ' + slot + '을(를) 삭제했어요.')), true);
            renderVersionRows(j.versions || []);
            refreshSlotBadge();   /* 지금 슬롯을 지웠으면 배지도 갱신 */
          } else {
            setStatus('삭제 실패: ' + ((j && j.error) || '알 수 없음'), false);
          }
        })
        .catch(function () { setStatus('슬롯을 삭제하지 못했어요.', false); });
    }
    function setAlias(slot, alias) {
      api('/api/alias', { slot: slot, alias: alias })
        .then(function (j) {
          if (j && j.ok) {
            if (j.message) setStatus('🏷️ ' + j.message, true);
            if (verMaxNote && j.max) { verMax = j.max; verMaxNote.textContent = '(최대 ' + j.max + '개)'; }
            slotAlias = (String(slot) === String(pageSlot)) ? (alias || '') : slotAlias;
            renderVersionRows(j.versions || []);
            paintSlotBadge();   /* 지금 슬롯의 별칭이 바뀌었으면 배지도 갱신 */
          } else {
            setStatus('별칭 저장 실패: ' + ((j && j.error) || '알 수 없음'), false);
          }
        })
        .catch(function () { setStatus('별칭을 저장하지 못했어요.', false); });
    }

    if (versionsBtn) versionsBtn.addEventListener('click', openVersions);
    if (verCloseBtn) verCloseBtn.addEventListener('click', closeVersions);

    /* 저장된 슬롯(save/slotN/)에서 '기본 템플릿(새 화면)'으로 나가는 길.
       루트(/)는 항상 최신 슬롯으로 보내므로, 슬롯 안에서 템플릿으로 빠져나올 때 쓴다. */
    var verTemplateBtn = document.getElementById('verTemplate');
    if (verTemplateBtn) {
      if (!pageSlot) {
        /* 이미 기본 템플릿이면 안내만 */
        verTemplateBtn.title = '지금 화면이 기본 템플릿이에요.';
        verTemplateBtn.addEventListener('click', function () {
          setStatus('지금 화면이 기본 템플릿이에요.', true);
        });
      } else {
        verTemplateBtn.addEventListener('click', function () {
          /* save/slotN/ → 두 단계 위가 템플릿(루트).
             슬롯 파일 이름은 index.html 이라 템플릿 이름으로 쓸 수 없다. */
          var name = (FILE_NAME && !/^index\.html?$/i.test(FILE_NAME)) ? FILE_NAME : 'postcard-cards.html';
          location.href = '../../' + name;
        });
      }
    }
    if (verSaveNew) verSaveNew.addEventListener('click', function () {
      Promise.resolve(commitHTML()).then(function () { renderVersions(); });
    });
    if (verModal) verModal.querySelector('.editor-backdrop').addEventListener('click', closeVersions);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && verModal && verModal.classList.contains('open')) closeVersions();
    });
    if (verList) {
      verList.addEventListener('click', function (e) {
        var btn = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
        if (!btn || btn.disabled) return;
        var slot = parseInt(btn.getAttribute('data-slot'), 10);
        var act = btn.getAttribute('data-act');
        if (act === 'load') location.href = '/save/slot' + slot + '/';
        else if (act === 'save') saveIntoSlot(slot);
        else if (act === 'del') deleteSlot(slot);
      });
      verList.addEventListener('change', function (e) {
        var inp = (e.target && e.target.closest) ? e.target.closest('.ver-alias') : null;
        if (!inp || inp.disabled) return;
        setAlias(parseInt(inp.getAttribute('data-slot'), 10), inp.value);
      });
    }

    /* ============ 테마 (프리셋 전환) ============
       기본 틀(큰 액자에 엽서를 넣는 배치)은 그대로 두고 색·질감·글자만 바꾼다.
       - 테마별 스타일은 themes/ 폴더에 파일로 나눠 둔다 (themes/classic.css, themes/modern.css …)
       - 새 테마를 추가하려면: themes/새이름.css 파일 + <head>에 <link> 한 줄 + 아래 THEMES 목록에 한 줄
       - 고른 테마는 <html data-theme="..."> 로 남아 저장한 버전에 함께 담긴다 */
    var THEMES = [
      { id: 'classic', name: '기본 (클래식)', desc: '지금의 나무 액자 · 캔버스 마운트 디자인' },
      { id: 'modern',  name: '모던 시크', desc: '블랙앤화이트 · 회색 사진 · 검은 특징 버블 · 올고딕' },
      { id: 'halloween', name: '할로윈', desc: '보라 벽 · 녹색 도는 늙은 나무 액자 · 주황빛 빈티지 엽서' },
      { id: 'christmas', name: '크리스마스', desc: '짙은 남색 밤하늘 액자 속 · 클래식 나무 액자(홀리 덩굴·전구줄) · 짙은 초록 엽서(흰 글씨·금색) · 눈/선물' },
      { id: 'queerpride', name: '퀴어프라이드', desc: '무지개 프라이드 · 연한 회색 액자 · 왼쪽 기둥에 끈으로 묶인 연한 프라이드 깃발(엽서 뒤 배경) · 핑크 엽서' },
      { id: 'white', name: '화이트 심플', desc: '흰 게시판 · 테두리 없는 판 · 헤어라인 구분선 · 앤티크 모서리 장식 · 엽서 이름·한마디는 명조체' },
      { id: 'botanical', name: '보태니컬', desc: '식물도감 · 옅은 세이지 벽 · 크림빛 종이 액자 · 이끼빛 잎 덩굴 · 도감 종이 엽서 · 잎맥 구분선' }
    ];
    var DEFAULT_THEME = 'classic';

    function hasTheme(id) {
      for (var ti = 0; ti < THEMES.length; ti++) { if (THEMES[ti].id === id) return true; }
      return false;
    }
    function currentTheme() {
      var id = document.documentElement.getAttribute('data-theme') || '';
      return hasTheme(id) ? id : DEFAULT_THEME;
    }
    function applyTheme(id) {
      if (!hasTheme(id)) id = DEFAULT_THEME;
      document.documentElement.setAttribute('data-theme', id);
    }
    applyTheme(currentTheme());   /* 저장된 값이 없으면 기본 테마로 확정(저장에도 함께 반영) */

    /* ---- 이미지 저장기(modern-screenshot) 준비 ----
       브라우저가 실제로 그리는 그대로(SVG foreignObject) 저장해 그림자·필터·블렌드가
       화면과 같아진다. 저장 슬롯 HTML엔 아직 <script>가 없을 수 있어 여기서 넣어준다. */
    (function ensureScreenshotLib() {
      if (window.modernScreenshot) return;
      var prefix = '';
      var scripts = document.getElementsByTagName('script');
      for (var si = scripts.length - 1; si >= 0; si--) {
        var ssrc = scripts[si].getAttribute('src') || '';
        if (/postcard-cards\.js(\?.*)?$/.test(ssrc)) {
          prefix = ssrc.replace(/postcard-cards\.js(\?.*)?$/, '');
          break;
        }
      }
      var el = document.createElement('script');
      el.src = prefix + 'assets/vendor/modern-screenshot.js';
      el.async = true;
      document.head.appendChild(el);
    })();

    /* ---- 예전에 저장한 슬롯 HTML도 테마를 바꿀 수 있게 자동 보정 ----
       저장된 슬롯에는 테마 <link>·🎨 버튼·테마 선택창이 없을 수 있다(테마 기능 이전 저장본).
       그럴 때 이 스크립트가 페이지에 없으면 만들어 넣는다. (한 번 저장하면 파일에도 함께 담긴다)
       저장(buildHTML) 직전에도 한 번 호출해서, 파일에 담기는 HTML에
       현재의 모든 테마 <link> 와 테마 목록이 항상 들어가게 한다. */
    function ensureThemeInfra() {
      /* 이 스크립트의 src에서 페이지 기준 상대 경로 접두어를 구한다 ('' 또는 '../../' 등) */
      var prefix = '';
      var scripts = document.getElementsByTagName('script');
      for (var si = scripts.length - 1; si >= 0; si--) {
        var ssrc = scripts[si].getAttribute('src') || '';
        if (/postcard-cards\.js(\?.*)?$/.test(ssrc)) {
          prefix = ssrc.replace(/postcard-cards\.js(\?.*)?$/, '');
          break;
        }
      }

      /* 1) 테마 CSS <link>가 없으면 추가 */
      THEMES.forEach(function (t) {
        var tail = 'themes/' + t.id + '.css';
        var links = document.getElementsByTagName('link');
        var exists = false;
        for (var li = 0; li < links.length; li++) {
          var href = links[li].getAttribute('href') || '';
          if (href === tail || href.slice(-tail.length) === tail) { exists = true; break; }
        }
        if (!exists) {
          var l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = prefix + tail;
          document.head.appendChild(l);
        }
      });

      /* 2) 🎨 테마 버튼이 없으면 툴바에 추가 */
      if (!document.getElementById('themeBtn')) {
        var bar = document.querySelector('.toolbar');
        if (bar) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.id = 'themeBtn';
          btn.title = '테마 바꾸기';
          btn.setAttribute('aria-label', '테마 바꾸기');
          btn.textContent = '🎨';
          var anchor = document.getElementById('versionsBtn');
          if (anchor && anchor.parentNode === bar) bar.insertBefore(btn, anchor);
          else bar.appendChild(btn);
        }
      }

      /* 3) 테마 선택창이 없으면 추가 */
      if (!document.getElementById('themePicker')) {
        var wrap = document.createElement('div');
        wrap.className = 'editor';
        wrap.id = 'themePicker';
        wrap.setAttribute('data-html2canvas-ignore', 'true');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML =
          '<div class="editor-backdrop"></div>' +
          '<div class="editor-panel theme-panel" role="dialog" aria-modal="true" aria-label="테마">' +
            '<h3>테마</h3>' +
            '<p class="ver-hint">기본 틀(큰 액자에 엽서를 넣는 배치)은 그대로 두고, <b>색·질감·글자</b>만 테마로 바꿔요. 고른 테마는 <b>화면에 미리 보기</b>로만 적용되고, 저장(<b>💾</b>)할 때 지금 버전에 함께 담겨요.</p>' +
            '<ul class="theme-list" id="themeList"></ul>' +
            '<div class="editor-actions"><button type="button" id="themeClose">닫기</button></div>' +
          '</div>';
        document.body.appendChild(wrap);
      }

      /* 4) 보태니컬 등나무 장식 span(.vine-swag)이 없으면 .frame 끝에 넣는다.
         예전 저장본에는 이 span이 없어 테마만 적용되고 꽃이 안 보였다. */
      var frameEl = document.querySelector('.frame');
      if (frameEl && !frameEl.querySelector('.vine-swag')) {
        var swag = document.createElement('span');
        swag.className = 'vine-swag';
        frameEl.appendChild(swag);
      }

      /* 5) 테마 목록(#themeList)을 현재 THEMES 기준으로 채운다.
         예전 저장본은 목록이 3개(클래식·모던·할로윈)로 굳어 있어 새 테마가 안 보인다.
         JS가 켜져 있으면 항상 최신 목록으로 다시 그려 준다. */
      var listEl = document.getElementById('themeList');
      if (listEl) {
        var cur = currentTheme();
        listEl.innerHTML = '';
        THEMES.forEach(function (t) {
          var li = document.createElement('li');
          li.className = 'theme-row' + (t.id === cur ? ' current' : '');
          li.setAttribute('data-theme-id', t.id);
          li.setAttribute('role', 'button');
          li.setAttribute('tabindex', '0');
          var radio = document.createElement('span');
          radio.className = 't-radio';
          radio.textContent = (t.id === cur ? '●' : '○');
          var mid = document.createElement('div');
          var nm = document.createElement('span');
          nm.className = 't-name';
          nm.textContent = t.name;
          var ds = document.createElement('span');
          ds.className = 't-desc';
          ds.textContent = t.desc || '';
          mid.appendChild(nm);
          mid.appendChild(ds);
          var badge = document.createElement('span');
          badge.className = 't-badge';
          badge.textContent = (t.id === cur ? '사용 중' : '전환');
          li.appendChild(radio);
          li.appendChild(mid);
          li.appendChild(badge);
          listEl.appendChild(li);
        });
      }
    }
    ensureThemeInfra();   /* 페이지가 열릴 때 한 번 보정 */

    /* ⏻ 서버 종료 버튼 — 창 없는 exe 에서 앱을 닫을 수 있게 한다 (서버가 있을 때만 보임) */
    (function ensureQuitButton() {
      if (document.getElementById('quitBtn')) return;
      var bar = document.querySelector('.toolbar');
      if (!bar) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'quitBtn';
      btn.title = '서버 종료 (앱 닫기)';
      btn.setAttribute('aria-label', '서버 종료');
      btn.textContent = '⏻';
      btn.style.display = 'none';
      bar.appendChild(btn);
    })();

    /* ============ 플로팅 메뉴 숨김/표시 ============
       화면의 플로팅 UI(왼쪽 위 안내·개수상자, 하단 프레임 이동, 오른쪽 툴바)를
       👁 버튼이나 H 키로 한 번에 감춘다. 감춘 상태에서도 오른쪽 아래 👁 버튼으로
       다시 꺼내올 수 있고, 이 상태는 저장물(html)에 담기지 않는다(화면 전용). */
    (function setupUIToggle() {
      /* 예전에 저장한 슬롯에는 버튼이 없을 수 있으니 없으면 만들어 넣는다. */
      var bar = document.querySelector('.toolbar');
      if (bar && !document.getElementById('uiToggleBtn')) {
        var b = document.createElement('button');
        b.type = 'button'; b.id = 'uiToggleBtn';
        b.title = '플로팅 메뉴 숨기기 (H)';
        b.setAttribute('aria-label', '플로팅 메뉴 숨기기');
        b.textContent = '👁';
        bar.appendChild(b);
      }
      if (!document.getElementById('uiReveal')) {
        var r = document.createElement('button');
        r.type = 'button'; r.id = 'uiReveal'; r.className = 'ui-reveal';
        r.setAttribute('data-html2canvas-ignore', 'true');
        r.title = '플로팅 메뉴 보이기 (H)';
        r.setAttribute('aria-label', '플로팅 메뉴 보이기');
        r.textContent = '👁';
        document.body.appendChild(r);
      }

      function uiHidden() { return document.body.classList.contains('hide-ui'); }
      function setUIHidden(on) {
        document.body.classList.toggle('hide-ui', !!on);
      }
      function toggleUI() { setUIHidden(!uiHidden()); }

      var toggleBtn = document.getElementById('uiToggleBtn');
      var revealBtn = document.getElementById('uiReveal');
      if (toggleBtn) toggleBtn.addEventListener('click', function () { setUIHidden(true); });
      if (revealBtn) revealBtn.addEventListener('click', function () { setUIHidden(false); });

      /* H 키로 토글 — 입력칸에 글을 쓰는 중이거나 창(모달)이 열려 있으면 무시 */
      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        /* 한글 입력모드에서도 동작하도록 물리 키(code)를 우선 본다 */
        if (!(e.code === 'KeyH' || e.key === 'h' || e.key === 'H' || e.key === 'ㅗ')) return;
        if (e.repeat) return;
        var t = e.target;
        var tag = (t && t.tagName) ? t.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        if (document.querySelector('.editor.open')) return;
        e.preventDefault();
        toggleUI();
      });
    })();

    var themeModal = document.getElementById('themePicker');
    var themeList = document.getElementById('themeList');
    var themeBtn = document.getElementById('themeBtn');
    var themeCloseBtn = document.getElementById('themeClose');

    function renderThemes() {
      if (!themeList) return;
      var cur = currentTheme();
      themeList.innerHTML = '';
      THEMES.forEach(function (t) {
        var li = document.createElement('li');
        li.className = 'theme-row' + (t.id === cur ? ' current' : '');
        li.setAttribute('data-theme-id', t.id);
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');

        var radio = document.createElement('span');
        radio.className = 't-radio';
        radio.textContent = (t.id === cur ? '●' : '○');

        var mid = document.createElement('div');
        var nm = document.createElement('span');
        nm.className = 't-name';
        nm.textContent = t.name;
        var ds = document.createElement('span');
        ds.className = 't-desc';
        ds.textContent = t.desc || '';
        mid.appendChild(nm);
        mid.appendChild(ds);

        var badge = document.createElement('span');
        badge.className = 't-badge';
        badge.textContent = (t.id === cur ? '사용 중' : '전환');

        li.appendChild(radio);
        li.appendChild(mid);
        li.appendChild(badge);
        themeList.appendChild(li);
      });
    }
    function openThemes() {
      if (!themeModal) return;
      renderThemes();
      themeModal.classList.add('open');
      themeModal.setAttribute('aria-hidden', 'false');
    }
    function closeThemes() {
      if (!themeModal) return;
      themeModal.classList.remove('open');
      themeModal.setAttribute('aria-hidden', 'true');
    }
    function pickTheme(id) {
      if (!hasTheme(id) || id === currentTheme()) return;
      applyTheme(id);
      renderThemes();
      /* 테마마다 이름의 기준 글씨 크기가 다르므로(예: 할로윈은 크게) 다시 맞춘다.
         (안 하면 처음 로드한 테마 기준 인라인 크기가 그대로 남아 다른 테마에서 어긋난다) */
      fitNames();
      scheduleFit();
      /* 테마는 '보기'만 하는 경우가 많으니 자동 저장하지 않는다.
         실제로 버전에 담으려면 💾(Ctrl+S) 저장을 누른다. */
      screenOnly('🎨 테마를 화면에 적용했어요. 저장하려면 💾(Ctrl+S)를 누르세요.');
    }
    if (themeBtn) themeBtn.addEventListener('click', openThemes);
    if (themeCloseBtn) themeCloseBtn.addEventListener('click', closeThemes);
    var quitBtn = document.getElementById('quitBtn');
    if (quitBtn) {
      quitBtn.addEventListener('click', function () {
        if (!window.confirm('서버를 종료할까요?\n(저장하지 않은 내용은 사라져요)')) return;
        quitBtn.disabled = true;
        fetch('/api/quit', { method: 'POST' }).then(function () {
          setStatus('서버를 종료했어요. 이 창을 닫아도 됩니다.', true);
        }).catch(function () {
          setStatus('종료하지 못했어요. 창을 닫아 주세요.', false);
          quitBtn.disabled = false;
        });
      });
    }
    if (themeModal) themeModal.querySelector('.editor-backdrop').addEventListener('click', closeThemes);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && themeModal && themeModal.classList.contains('open')) closeThemes();
    });
    if (themeList) {
      themeList.addEventListener('click', function (e) {
        var row = (e.target && e.target.closest) ? e.target.closest('.theme-row') : null;
        if (row) pickTheme(row.getAttribute('data-theme-id'));
      });
      themeList.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var row = (e.target && e.target.closest) ? e.target.closest('.theme-row') : null;
        if (!row) return;
        e.preventDefault();
        pickTheme(row.getAttribute('data-theme-id'));
      });
    }

    /* ============ 이미지 자르기 (엽서 그림칸 비율에 맞춰 자름) ============ */
    var cropModal = document.getElementById('cropEditor');
    var cropFrame = document.getElementById('cropFrame');
    var cropImg   = document.getElementById('cropImg');
    var cropZoom  = document.getElementById('cropZoom');
    var cropState = { natW:0, natH:0, frameW:0, frameH:0, base:1, zoom:1, dx:0, dy:0, url:null, dragging:false, sx:0, sy:0, sdx:0, sdy:0 };

    function clampCrop() {
      var dispW = cropState.natW * cropState.base * cropState.zoom;
      var dispH = cropState.natH * cropState.base * cropState.zoom;
      cropState.dx = Math.min(0, Math.max(cropState.frameW - dispW, cropState.dx));
      cropState.dy = Math.min(0, Math.max(cropState.frameH - dispH, cropState.dy));
    }
    function renderCrop() {
      var dispW = cropState.natW * cropState.base * cropState.zoom;
      var dispH = cropState.natH * cropState.base * cropState.zoom;
      cropImg.style.width = dispW + 'px';
      cropImg.style.height = dispH + 'px';
      cropImg.style.transform = 'translate(' + cropState.dx + 'px,' + cropState.dy + 'px)';
    }
    function fitCrop() {
      cropState.zoom = 1;
      if (cropZoom) cropZoom.value = '1';
      cropState.dx = (cropState.frameW - cropState.natW * cropState.base) / 2;
      cropState.dy = (cropState.frameH - cropState.natH * cropState.base) / 2;
      clampCrop(); renderCrop();
    }
    function closeCrop() {
      if (!cropModal) return;
      cropModal.classList.remove('open');
      cropModal.setAttribute('aria-hidden', 'true');
      if (cropImg) cropImg.removeAttribute('src');
      if (cropState.url) { try { URL.revokeObjectURL(cropState.url); } catch (e) {} cropState.url = null; }
    }
    /* 자르기 창이 없을 때를 위한 예전 방식(비율 맞춤 없이 축소만) */
    function legacyCompress(file) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 900, s = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var x = cv.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        try { URL.revokeObjectURL(url); } catch (e) {}
        pendingImg = cv.toDataURL('image/jpeg', 0.86);
        f.preview.src = pendingImg;
      };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} alert('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.'); };
      img.src = url;
    }
    /* 자르기 틀을 엽서 그림칸(.photo) 비율에 맞춰 준비 */
    function prepareCropFrame() {
      var ratio = 148 / 100;
      var target = (cur >= 0 && cards[cur]) ? cards[cur].querySelector('.photo') : null;
      if (target) {
        /* 사진칸이 살짝 회전해 있어도 영향받지 않도록 레이아웃 크기를 쓴다 */
        var w = target.clientWidth, h = target.clientHeight;
        if (w && h) ratio = w / h;
      }
      var fh = 320, fw = Math.round(fh * ratio);
      if (fw > 460) { fw = 460; fh = Math.round(fw / ratio); }
      if (fw < 150) { fw = 150; fh = Math.round(fw / ratio); }
      cropState.frameW = fw; cropState.frameH = fh;
      cropFrame.style.width = fw + 'px';
      cropFrame.style.height = fh + 'px';
    }
    /* 자르기 창에 이미지 소스를 올린다. isObjectUrl=true면 닫을 때 해제 */
    function loadCropSource(src, isObjectUrl) {
      if (cropState.url) { try { URL.revokeObjectURL(cropState.url); } catch (e) {} }
      cropState.url = isObjectUrl ? src : null;
      cropImg.onload = function () {
        cropState.natW = cropImg.naturalWidth || 1;
        cropState.natH = cropImg.naturalHeight || 1;
        cropState.base = Math.max(cropState.frameW / cropState.natW, cropState.frameH / cropState.natH);
        fitCrop();
        cropModal.classList.add('open');
        cropModal.setAttribute('aria-hidden', 'false');
      };
      cropImg.onerror = function () {
        if (isObjectUrl) { try { URL.revokeObjectURL(src); } catch (e) {} cropState.url = null; }
        alert('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.');
      };
      cropImg.src = src;
    }
    function openCropEditor(file) {
      if (!cropModal || !cropFrame || !cropImg) { legacyCompress(file); return; }
      prepareCropFrame();
      loadCropSource(URL.createObjectURL(file), true);
    }
    /* 이미 저장돼 있는 그림(경로 또는 data URL)을 눌러 다시 자르기 */
    function openCropFromSrc(src) {
      if (!cropModal || !cropFrame || !cropImg || !src) return;
      prepareCropFrame();
      loadCropSource(src, false);
    }
    /* 엽서 편집창에서 지금 보이는 그림을 클릭하면 자르기 창을 연다 */
    if (f.preview) {
      f.preview.title = '클릭하면 자르기(이미지 편집) 창이 열려요';
      f.preview.addEventListener('click', function () {
        if (cur < 0) return;
        var src = f.preview.getAttribute('src');
        if (!src) return;
        openCropFromSrc(src);
      });
    }

    if (cropModal && cropFrame && cropImg) {
      cropFrame.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        cropState.dragging = true;
        cropState.sx = e.clientX; cropState.sy = e.clientY;
        cropState.sdx = cropState.dx; cropState.sdy = cropState.dy;
        try { cropFrame.setPointerCapture(e.pointerId); } catch (err) {}
      });
      cropFrame.addEventListener('pointermove', function (e) {
        if (!cropState.dragging) return;
        cropState.dx = cropState.sdx + (e.clientX - cropState.sx);
        cropState.dy = cropState.sdy + (e.clientY - cropState.sy);
        clampCrop(); renderCrop();
      });
      function endCropDrag(e) {
        if (!cropState.dragging) return;
        cropState.dragging = false;
        try { cropFrame.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      cropFrame.addEventListener('pointerup', endCropDrag);
      cropFrame.addEventListener('pointercancel', endCropDrag);

      if (cropZoom) cropZoom.addEventListener('input', function () {
        var nz = parseFloat(cropZoom.value) || 1;
        var s = cropState.base * cropState.zoom;
        var cx = (cropState.frameW / 2 - cropState.dx) / s;
        var cy = (cropState.frameH / 2 - cropState.dy) / s;
        cropState.zoom = nz;
        var s2 = cropState.base * cropState.zoom;
        cropState.dx = cropState.frameW / 2 - cx * s2;
        cropState.dy = cropState.frameH / 2 - cy * s2;
        clampCrop(); renderCrop();
      });

      var cropFit = document.getElementById('cropFit');
      if (cropFit) cropFit.addEventListener('click', fitCrop);
      var cropCancel = document.getElementById('cropCancel');
      if (cropCancel) cropCancel.addEventListener('click', closeCrop);
      cropModal.querySelector('.editor-backdrop').addEventListener('click', closeCrop);

      var cropApply = document.getElementById('cropApply');
      if (cropApply) cropApply.addEventListener('click', function () {
        if (!cropState.natW) { closeCrop(); return; }
        var s = cropState.base * cropState.zoom;
        var sx = -cropState.dx / s;
        var sy = -cropState.dy / s;
        var sw = cropState.frameW / s;
        var sh = cropState.frameH / s;
        sx = Math.max(0, Math.min(cropState.natW - sw, sx));
        sy = Math.max(0, Math.min(cropState.natH - sh, sy));
        var maxDim = 1200, outW, outH;
        if (cropState.frameW >= cropState.frameH) { outW = maxDim; outH = Math.max(1, Math.round(maxDim * cropState.frameH / cropState.frameW)); }
        else { outH = maxDim; outW = Math.max(1, Math.round(maxDim * cropState.frameW / cropState.frameH)); }
        var cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, outW, outH);
        var data = null;
        try { data = cv.toDataURL('image/jpeg', 0.9); } catch (e) { data = null; }
        if (!data) { alert('이미지를 자르지 못했어요.'); closeCrop(); return; }
        pendingImg = data;
        f.preview.src = data;                    /* '이미지 적용'을 눌러야 편집창에 반영됨 */
        closeCrop();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && cropModal.classList.contains('open')) closeCrop();
      });
    }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  })();
