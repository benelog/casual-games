// 한/영 국제화. 처음에는 브라우저 언어를 따르고, 사용자가 고르면 localStorage 에 남겨 모든 게임이 같이 쓴다.
//
// 게임마다 { ko: {...}, en: {...} } 사전을 만들고 createT(사전) 으로 번역 함수를 얻는다.
//   const t = createT(MESSAGES);
//   t('score', { n: 3 })  // 'score': '{n}점' → '3점'
// HTML 의 고정 문구는 data-i18n="키" (textContent), data-i18n-html, data-i18n-title,
// data-i18n-aria-label, data-i18n-placeholder 로 표시하고 applyI18n(t) 로 채운다.

export const LANGS = ['ko', 'en'];
const STORAGE_KEY = 'casual-games.lang';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 저장된 선택 → 브라우저 언어 순. 한국어가 아니면 영어 */
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
  return 'en';
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

/** 사전에서 현재 언어 문구를 찾아 {이름} 자리를 채우는 함수. 없으면 ko → 키 순으로 물러선다 */
export function createT(messages) {
  return (key, params = {}) => {
    let text = messages[lang]?.[key] ?? messages.ko?.[key] ?? key;
    if (typeof text === 'function') return text(params);
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

/** 언어에 맞는 숫자 표기 */
export function formatNumber(n) {
  return Number(n).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US');
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

/**
 * 한/EN 전환 버튼을 만들어 container 에 붙인다. 누르면 저장하고 새로고침한다.
 * 버튼에는 lang-toggle 클래스가 붙고, className 으로 게임의 버튼 스타일 클래스를 더할 수 있다.
 */
export function mountLangToggle(container, { className = '' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `lang-toggle ${className}`.trim();
  const other = lang === 'ko' ? 'en' : 'ko';
  button.textContent = other === 'en' ? 'EN' : '한국어';
  button.title = other === 'en' ? 'Switch to English' : '한국어로 보기';
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', () => {
    setLang(other);
    location.reload();
  });
  container.append(button);
  return button;
}

if (globalThis.document) document.documentElement.lang = lang;
