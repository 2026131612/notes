/* =========================================================================
 * 낙서장 (Scratchpad) — 개인용 노트 웹앱
 * 순수 HTML/CSS/JavaScript. 데이터는 브라우저 localStorage에 저장됩니다.
 * ========================================================================= */

'use strict';

/* ---------------------------------------------------------------------------
 * 1. 상태(state)와 저장소
 * ------------------------------------------------------------------------- */
const STORAGE_KEY = 'scratchpad.v1';

// 폴더와 노트는 id를 키로 갖는 객체로 보관합니다(조회가 빠릅니다).
//   folders[id] = { id, name, parentId }      parentId === null 이면 최상위 폴더
//   notes[id]   = { id, title, content, folderId, createdAt, updatedAt }
//                 folderId === null 이면 폴더에 속하지 않은 최상위 노트
let state = {
  folders: {},
  notes: {},
  expanded: {},          // folderId -> true/false (트리 펼침 상태)
  activeNoteId: null,    // 현재 편집 중인 노트
  currentFolderId: null, // '새 노트'가 생성될 대상 폴더
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (err) {
    console.warn('저장된 데이터를 불러오지 못했습니다.', err);
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('저장에 실패했습니다. 저장 공간이 가득 찼을 수 있습니다.', err);
    setStatus('저장 실패');
  }
}

// 짧고 충돌이 잘 나지 않는 id 생성기
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// HTML에 문자열을 넣기 전 특수문자를 변환해 안전하게 만듭니다(XSS 방지).
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------------------------------------------------------------------
 * 2. 데이터 조회 헬퍼
 * ------------------------------------------------------------------------- */
function childFolders(parentId) {
  return Object.values(state.folders)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function folderNotes(folderId) {
  return Object.values(state.notes)
    .filter((n) => n.folderId === folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt); // 최근 수정 순
}

// 폴더 삭제 시 그 안의 모든 하위 폴더/노트 id를 모읍니다.
function collectDescendants(folderId, acc) {
  acc.folders.push(folderId);
  childFolders(folderId).forEach((sf) => collectDescendants(sf.id, acc));
  folderNotes(folderId).forEach((n) => acc.notes.push(n.id));
  return acc;
}

// 현재 대상 폴더의 경로 문자열 (예: "예시 폴더 / 하위 폴더")
function folderPath(folderId) {
  if (!folderId) return '최상위';
  const parts = [];
  let cur = state.folders[folderId];
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? state.folders[cur.parentId] : null;
  }
  return parts.join(' / ');
}

/* ---------------------------------------------------------------------------
 * 3. DOM 참조
 * ------------------------------------------------------------------------- */
const treeEl       = document.getElementById('tree');
const btnNewFolder = document.getElementById('btnNewFolder');
const btnNewNote   = document.getElementById('btnNewNote');

const emptyState   = document.getElementById('emptyState');
const noteEditor   = document.getElementById('noteEditor');
const titleInput   = document.getElementById('noteTitle');
const bodyEl       = document.getElementById('noteBody');
const btnBold      = document.getElementById('btnBold');
const btnItalic    = document.getElementById('btnItalic');
const sizeSelect   = document.getElementById('sizeSelect');
const saveStatus   = document.getElementById('saveStatus');
const noteMeta     = document.getElementById('noteMeta');
const noteLocation = document.getElementById('noteLocation');

const menuToggle   = document.getElementById('menuToggle');
const sidebar      = document.getElementById('sidebar');
const backdrop     = document.getElementById('backdrop');
const targetLabel  = document.getElementById('targetFolder');

/* ---------------------------------------------------------------------------
 * 4. 사이드바 트리 렌더링
 * ------------------------------------------------------------------------- */
function renderTree() {
  const roots = childFolders(null);
  const rootNotes = folderNotes(null);

  let html = '<ul class="tree-root">';
  roots.forEach((f) => { html += renderFolder(f, 0); });
  rootNotes.forEach((n) => { html += renderNoteRow(n, 0); });
  html += '</ul>';

  if (roots.length === 0 && rootNotes.length === 0) {
    html = '<p class="tree-empty">아직 비어 있어요.<br>위의 버튼으로 폴더나 노트를 만들어 보세요.</p>';
  }
  treeEl.innerHTML = html;

  // 새 노트가 생성될 대상 폴더 표시
  if (targetLabel) targetLabel.textContent = folderPath(state.currentFolderId);
}

function renderFolder(folder, depth) {
  const open = !!state.expanded[folder.id];
  const subs = childFolders(folder.id);
  const notes = folderNotes(folder.id);
  const hasChildren = subs.length > 0 || notes.length > 0;
  const isTarget = state.currentFolderId === folder.id;

  let html = `
    <li class="tree-item">
      <div class="row folder-row${isTarget ? ' is-target' : ''}" style="--depth:${depth}">
        <button class="twisty" data-action="toggle" data-id="${folder.id}"
                aria-label="${open ? '접기' : '펼치기'}">${hasChildren ? (open ? '▾' : '▸') : '·'}</button>
        <button class="label" data-action="select-folder" data-id="${folder.id}" title="${esc(folder.name)}">
          <span class="ic">📁</span><span class="name">${esc(folder.name)}</span>
        </button>
        <span class="row-actions">
          <button data-action="add-subfolder" data-id="${folder.id}" title="하위 폴더 추가" aria-label="하위 폴더 추가">＋📁</button>
          <button data-action="add-note" data-id="${folder.id}" title="이 폴더에 노트 추가" aria-label="이 폴더에 노트 추가">＋📝</button>
          <button data-action="rename-folder" data-id="${folder.id}" title="이름 변경" aria-label="폴더 이름 변경">✎</button>
          <button data-action="delete-folder" data-id="${folder.id}" title="삭제" aria-label="폴더 삭제">🗑</button>
        </span>
      </div>`;

  if (open) {
    html += '<ul class="tree-children">';
    subs.forEach((sf) => { html += renderFolder(sf, depth + 1); });
    notes.forEach((n) => { html += renderNoteRow(n, depth + 1); });
    html += '</ul>';
  }
  html += '</li>';
  return html;
}

function renderNoteRow(note, depth) {
  const active = state.activeNoteId === note.id;
  return `
    <li class="tree-item">
      <div class="row note-row${active ? ' is-active' : ''}" style="--depth:${depth}">
        <span class="twisty empty">·</span>
        <button class="label" data-action="select-note" data-id="${note.id}" title="${esc(note.title)}">
          <span class="ic">📝</span><span class="name">${esc(note.title || '제목 없는 노트')}</span>
        </button>
        <span class="row-actions">
          <button data-action="rename-note" data-id="${note.id}" title="제목 변경" aria-label="노트 제목 변경">✎</button>
          <button data-action="delete-note" data-id="${note.id}" title="삭제" aria-label="노트 삭제">🗑</button>
        </span>
      </div>
    </li>`;
}

// 트리 안의 모든 클릭을 한 곳에서 처리(이벤트 위임)
treeEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'toggle':         toggleFolder(id); break;
    case 'select-folder':  selectFolder(id); break;
    case 'add-subfolder':  addFolder(id); break;
    case 'add-note':       addNote(id); break;
    case 'rename-folder':  renameFolder(id); break;
    case 'delete-folder':  deleteFolder(id); break;
    case 'select-note':    openNote(id); closeSidebarOnMobile(); break;
    case 'rename-note':    renameNote(id); break;
    case 'delete-note':    deleteNote(id); break;
  }
});

/* ---------------------------------------------------------------------------
 * 5. 폴더 동작
 * ------------------------------------------------------------------------- */
function toggleFolder(id) {
  state.expanded[id] = !state.expanded[id];
  save();
  renderTree();
}

// 폴더를 '새 노트'의 대상으로 지정하고, 펼침 상태도 토글
function selectFolder(id) {
  state.currentFolderId = id;
  state.expanded[id] = !state.expanded[id] ? true : state.expanded[id]; // 처음 누르면 펼침
  save();
  renderTree();
}

function addFolder(parentId) {
  const name = prompt('폴더 이름을 입력하세요.', '새 폴더');
  if (name === null) return; // 취소
  const id = uid();
  state.folders[id] = { id, name: name.trim() || '새 폴더', parentId: parentId || null };
  if (parentId) state.expanded[parentId] = true;
  state.currentFolderId = id;
  save();
  renderTree();
}

function renameFolder(id) {
  const f = state.folders[id];
  if (!f) return;
  const name = prompt('새 폴더 이름을 입력하세요.', f.name);
  if (name === null) return;
  f.name = name.trim() || f.name;
  save();
  renderTree();
}

function deleteFolder(id) {
  const f = state.folders[id];
  if (!f) return;
  if (!confirm(`'${f.name}' 폴더와 그 안의 모든 하위 폴더·노트가 함께 삭제됩니다.\n계속할까요?`)) return;

  const acc = collectDescendants(id, { folders: [], notes: [] });
  acc.notes.forEach((nid) => {
    if (state.activeNoteId === nid) clearEditor();
    delete state.notes[nid];
  });
  acc.folders.forEach((fid) => {
    delete state.folders[fid];
    delete state.expanded[fid];
  });
  if (state.currentFolderId && acc.folders.includes(state.currentFolderId)) {
    state.currentFolderId = null;
  }
  save();
  renderTree();
}

/* ---------------------------------------------------------------------------
 * 6. 노트 동작
 * ------------------------------------------------------------------------- */
function addNote(folderId) {
  const id = uid();
  const now = Date.now();
  state.notes[id] = {
    id,
    title: '제목 없는 노트',
    content: '',
    folderId: folderId || null,
    createdAt: now,
    updatedAt: now,
  };
  if (folderId) state.expanded[folderId] = true;
  state.currentFolderId = folderId || null;
  save();
  renderTree();
  openNote(id);
  titleInput.focus();
  titleInput.select();
}

function openNote(id) {
  const note = state.notes[id];
  if (!note) return;
  state.activeNoteId = id;
  state.currentFolderId = note.folderId;

  emptyState.hidden = true;
  noteEditor.hidden = false;

  titleInput.value = note.title === '제목 없는 노트' ? '' : note.title;
  titleInput.placeholder = '제목 없는 노트';
  bodyEl.innerHTML = note.content || '';
  noteLocation.textContent = folderPath(note.folderId);
  updateMeta(note);
  setStatus('저장됨');

  save();
  renderTree();
}

function renameNote(id) {
  const note = state.notes[id];
  if (!note) return;
  const title = prompt('노트 제목을 입력하세요.', note.title);
  if (title === null) return;
  note.title = title.trim() || '제목 없는 노트';
  note.updatedAt = Date.now();
  if (state.activeNoteId === id) {
    titleInput.value = note.title === '제목 없는 노트' ? '' : note.title;
  }
  save();
  renderTree();
}

function deleteNote(id) {
  const note = state.notes[id];
  if (!note) return;
  if (!confirm(`'${note.title}' 노트를 삭제할까요?`)) return;
  if (state.activeNoteId === id) clearEditor();
  delete state.notes[id];
  save();
  renderTree();
}

function clearEditor() {
  state.activeNoteId = null;
  noteEditor.hidden = true;
  emptyState.hidden = false;
  titleInput.value = '';
  bodyEl.innerHTML = '';
}

function updateMeta(note) {
  const d = new Date(note.updatedAt);
  const stamp = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.` +
                `${String(d.getDate()).padStart(2, '0')} ` +
                `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  noteMeta.textContent = `마지막 수정 ${stamp}`;
}

/* ---------------------------------------------------------------------------
 * 7. 편집 + 자동 저장
 * ------------------------------------------------------------------------- */
let saveTimer = null;
function scheduleSave(renderTreeToo) {
  setStatus('저장 중…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save();
    setStatus('저장됨');
    if (renderTreeToo) renderTree();
  }, 350);
}

function setStatus(text) {
  if (saveStatus) saveStatus.textContent = text;
}

// 제목 입력 → 노트 제목 갱신(트리 라벨도 갱신)
titleInput.addEventListener('input', () => {
  const note = state.notes[state.activeNoteId];
  if (!note) return;
  note.title = titleInput.value.trim() || '제목 없는 노트';
  note.updatedAt = Date.now();
  updateMeta(note);
  scheduleSave(true);
});

// 제목에서 Enter → 본문으로 이동
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    bodyEl.focus();
  }
});

// 본문 입력 → 노트 내용 갱신(트리는 갱신 불필요)
function onBodyChange() {
  const note = state.notes[state.activeNoteId];
  if (!note) return;
  note.content = bodyEl.innerHTML;
  note.updatedAt = Date.now();
  updateMeta(note);
  scheduleSave(false);
}
bodyEl.addEventListener('input', onBodyChange);

/* ---------------------------------------------------------------------------
 * 8. 서식: 볼드 · 이탤릭 · 글씨 크기
 *    contenteditable + document.execCommand 사용.
 *    (execCommand는 MDN 기준 deprecated 이지만 모든 주요 브라우저에서
 *     여전히 동작하며, 실행취소(Ctrl+Z) 기록이 보존됩니다. README 참고.)
 * ------------------------------------------------------------------------- */

// 마지막 선택 영역을 기억해 둡니다(드롭다운 클릭 시 선택이 풀리는 것을 방지).
let savedRange = null;
bodyEl.addEventListener('blur', () => {
  const sel = window.getSelection();
  if (sel.rangeCount && bodyEl.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
});
function restoreRange() {
  if (!savedRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

function exec(cmd, value) {
  bodyEl.focus();
  document.execCommand(cmd, false, value ?? null);
  updateToolbarState();
  onBodyChange();
}

// 버튼을 mousedown 할 때 기본동작을 막아 편집기 선택이 풀리지 않게 합니다.
[btnBold, btnItalic].forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault());
});
btnBold.addEventListener('click', () => exec('bold'));
btnItalic.addEventListener('click', () => exec('italic'));

// 글씨 크기: select 는 클릭 시 편집기 선택이 풀리므로 저장해 둔 영역을 복원합니다.
sizeSelect.addEventListener('change', () => {
  bodyEl.focus();
  restoreRange();
  document.execCommand('fontSize', false, sizeSelect.value);
  sizeSelect.selectedIndex = 1; // '보통'으로 되돌려 표시
  onBodyChange();
});

// 선택 영역이 볼드/이탤릭인지에 따라 버튼 강조
function updateToolbarState() {
  if (!state.activeNoteId) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !bodyEl.contains(sel.anchorNode)) return;
  btnBold.classList.toggle('is-on', document.queryCommandState('bold'));
  btnItalic.classList.toggle('is-on', document.queryCommandState('italic'));
}
document.addEventListener('selectionchange', updateToolbarState);

// 단축키: Ctrl/Cmd + B / I
bodyEl.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); exec('bold'); }
  if (k === 'i') { e.preventDefault(); exec('italic'); }
});

/* ---------------------------------------------------------------------------
 * 9. 상단 버튼 + 모바일 사이드바
 * ------------------------------------------------------------------------- */
// '새 폴더'는 현재 대상 폴더의 하위에, 대상이 없으면 최상위에 만듭니다.
btnNewFolder.addEventListener('click', () => addFolder(state.currentFolderId || null));
// '새 노트'는 현재 대상 폴더 안에 만듭니다.
btnNewNote.addEventListener('click', () => addNote(state.currentFolderId || null));

function openSidebar()  { sidebar.classList.add('open'); backdrop.hidden = false; }
function closeSidebar() { sidebar.classList.remove('open'); backdrop.hidden = true; }
function closeSidebarOnMobile() {
  if (window.matchMedia('(max-width: 760px)').matches) closeSidebar();
}
if (menuToggle) menuToggle.addEventListener('click', openSidebar);
if (backdrop)   backdrop.addEventListener('click', closeSidebar);

/* ---------------------------------------------------------------------------
 * 10. 첫 실행 시 예시 데이터
 * ------------------------------------------------------------------------- */
function seedIfEmpty() {
  const empty = Object.keys(state.folders).length === 0 &&
                Object.keys(state.notes).length === 0;
  if (!empty) return;

  const now = Date.now();
  const f1 = uid();
  const f2 = uid();
  state.folders[f1] = { id: f1, name: '예시 폴더', parentId: null };
  state.folders[f2] = { id: f2, name: '하위 폴더', parentId: f1 };
  state.expanded[f1] = true;

  const n1 = uid();
  state.notes[n1] = {
    id: n1,
    title: '낙서장 사용법',
    content:
      '<div>왼쪽에서 <b>폴더</b>와 <i>노트</i>를 만들 수 있어요.</div>' +
      '<div><br></div>' +
      '<div>• 폴더 위에 마우스를 올리면 <b>＋📁(하위 폴더)</b>, <b>＋📝(노트)</b> 버튼이 보여요.</div>' +
      '<div>• 글을 드래그해서 선택한 뒤 위쪽 <b>B</b>·<i>I</i> 버튼이나 <b>크기</b> 메뉴로 꾸며 보세요.</div>' +
      '<div>• 작성한 내용은 자동으로 이 브라우저에 저장됩니다.</div>',
    folderId: null,
    createdAt: now,
    updatedAt: now,
  };
  save();
}

/* ---------------------------------------------------------------------------
 * 11. 시작
 * ------------------------------------------------------------------------- */
function init() {
  load();
  seedIfEmpty();
  // execCommand('fontSize')가 <font size> 태그를 만들도록 고정(CSS로 크기 지정).
  try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
  renderTree();
  setStatus('준비됨');
}

init();
