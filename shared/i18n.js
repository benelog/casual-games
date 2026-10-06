// 국제화. 처음에는 브라우저 언어를 따르고, 사용자가 고르면 localStorage 에 남겨 모든 게임이 같이 쓴다.
// 언어를 늘릴 때는 LANGUAGES 에 한 줄 더하고 각 사전에 그 언어를 채운다. 빠진 문구는 영어 → 한국어 순으로 물러선다.
//
// 게임마다 { ko: {...}, en: {...} } 사전을 만들고 createT(사전) 으로 번역 함수를 얻는다.
//   const t = createT(MESSAGES);
//   t('score', { n: 3 })  // 'score': '{n}점' → '3점'
// HTML 의 고정 문구는 data-i18n="키" (textContent), data-i18n-html, data-i18n-title,
// data-i18n-aria-label, data-i18n-placeholder 로 표시하고 applyI18n(t) 로 채운다.

/** 지원 언어. name 은 그 언어로 쓴 이름, short 는 좁은 화면의 버튼에 쓰는 짧은 이름, label 은 그 언어로 '언어', locale 은 숫자 표기에 쓴다 */
export const LANGUAGES = {
  ko: { name: '한국어', short: '한', label: '언어', locale: 'ko-KR' },
  en: { name: 'English', short: 'EN', label: 'Language', locale: 'en-US' },
};
export const LANGS = Object.keys(LANGUAGES);
/** 브라우저 언어를 지원하지 않거나 사전에 문구가 없을 때 쓰는 언어 */
const FALLBACK = 'en';
const STORAGE_KEY = 'casual-games.lang';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 저장된 선택 → 브라우저 언어 순. 지원하지 않는 언어면 영어 */
export function detectLang() {
  try {
    const saved = storage()?.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // 저장소가 막혀 있으면 브라우저 언어만 본다
  }
  const preferred = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''];
  for (const tag of preferred) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return FALLBACK;
}

export let lang = detectLang();

/** 언어를 바꾼다. persist 가 false 면 저장하지 않는다 (테스트용) */
export function setLang(next, { persist = true } = {}) {
  if (!LANGS.includes(next)) return;
  lang = next;
  if (persist) {
    try {
      storage()?.setItem(STORAGE_KEY, next);
    } catch {
      // 저장하지 못해도 이번 페이지에서는 바뀐다
    }
  }
  if (globalThis.document) document.documentElement.lang = next;
}

/** 사전에서 현재 언어 문구를 찾아 {이름} 자리를 채우는 함수. 없으면 en → ko → 키 순으로 물러선다 */
export function createT(messages) {
  return (key, params = {}) => {
    let text = messages[lang]?.[key] ?? messages[FALLBACK]?.[key] ?? messages.ko?.[key] ?? key;
    if (typeof text === 'function') return text(params);
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

/** 언어에 맞는 숫자 표기 */
export function formatNumber(n) {
  return Number(n).toLocaleString(LANGUAGES[lang].locale);
}

/** data-i18n* 속성이 붙은 요소의 문구를 채운다 */
export function applyI18n(t, root = globalThis.document) {
  if (!root) return;
  if (root === globalThis.document) document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

// 언어 메뉴는 게임마다 다른 버튼 스타일과 상관없이 같은 모습이 되도록 여기서 스타일을 한 번 넣는다
const MENU_STYLE = `
.lang-toggle { display: inline-flex; align-items: center; gap: 0.35em; }
.lang-toggle svg { flex: none; }
.lang-toggle .lang-short { display: none; }
@media (max-width: 480px) {
  .lang-toggle .lang-name { display: none; }
  .lang-toggle .lang-short { display: inline; }
}
.lang-menu {
  position: fixed; z-index: 10000; min-width: 140px; padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px;
  background: rgba(20, 22, 28, 0.96); color: #f3ecdc;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  font: 14px/1.2 var(--font-body, system-ui, sans-serif);
}
.lang-menu[hidden] { display: none; }
.lang-menu button {
  position: relative; display: block; width: 100%; margin: 0; padding: 9px 14px 9px 30px;
  border: 0; border-radius: 6px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.lang-menu button:hover, .lang-menu button:focus-visible { background: rgba(255, 255, 255, 0.1); }
.lang-menu button:focus-visible { outline: 2px solid var(--focus, #f3ecdc); outline-offset: -2px; }
.lang-menu button[aria-checked='true']::before { content: '✓'; position: absolute; left: 11px; }
`;

const GLOBE =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2">' +
  '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>';

function injectMenuStyle() {
  if (document.getElementById('lang-menu-style')) return;
  const style = document.createElement('style');
  style.id = 'lang-menu-style';
  style.textContent = MENU_STYLE;
  document.head.append(style);
}

/**
 * 지금 언어 이름이 적힌 언어 선택 버튼을 만들어 container 에 붙인다. 누르면 LANGUAGES 의 언어 목록이 열리고,
 * 다른 언어를 고르면 저장하고 새로고침한다.
 * 버튼에는 lang-toggle 클래스가 붙고, className 으로 게임의 버튼 스타일 클래스를 더할 수 있다.
 */
export function mountLangToggle(container, { className = '' } = {}) {
  injectMenuStyle();
  const current = LANGUAGES[lang];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `lang-toggle ${className}`.trim();
  // 좁은 화면에서는 위쪽 막대에 버튼이 다 들어가도록 짧은 이름(한·EN)을 보인다
  button.innerHTML = `${GLOBE}<span class="lang-name"></span><span class="lang-short"></span><span aria-hidden="true">▾</span>`;
  button.querySelector('.lang-name').textContent = current.name;
  button.querySelector('.lang-short').textContent = current.short;
  button.title = current.label;
  button.setAttribute('aria-label', `${current.label}: ${current.name}`);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  // 메뉴는 body 에 붙여 게임 화면의 overflow 에 잘리지 않게 하고, 열 때 버튼 옆에 자리를 잡는다
  const menu = document.createElement('div');
  menu.className = 'lang-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const code of LANGS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.lang = code;
    item.textContent = LANGUAGES[code].name;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(code === lang));
    item.addEventListener('click', () => {
      close();
      if (code === lang) return;
      setLang(code);
      location.reload();
    });
    menu.append(item);
  }
  document.body.append(menu);
  const items = [...menu.children];

  function place() {
    const rect = button.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const below = rect.bottom + 6;
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, rect.top - 6 - height);
    const left = Math.min(Math.max(8, rect.right - width), innerWidth - 8 - width);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function open() {
    menu.hidden = false;
    place();
    button.setAttribute('aria-expanded', 'true');
    (items.find((item) => item.lang === lang) ?? items[0]).focus();
    document.addEventListener('pointerdown', onOutside, true);
    addEventListener('resize', close);
    addEventListener('scroll', close, true);
  }

  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    removeEventListener('resize', close);
    removeEventListener('scroll', close, true);
  }

  function onOutside(event) {
    if (!menu.contains(event.target) && !button.contains(event.target)) close();
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' || !menu.hidden) return;
    event.preventDefault();
    open();
  });
  // 메뉴 안의 키 입력은 게임 조작(방향키·Space 등)으로 새어 나가지 않게 여기서 멈춘다
  menu.addEventListener('keydown', (event) => {
    event.stopPropagation();
    const index = items.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      items[(moves[event.key] + items.length) % items.length].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      button.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  });

  container.append(button);
  return button;
}

if (globalThis.document) document.documentElement.lang = lang;
