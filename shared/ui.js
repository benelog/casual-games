// 메뉴와 HUD 에서 여러 게임이 같이 쓰는 작은 DOM 도우미.

/**
 * 여러 값 중 하나를 고르는 버튼 묶음을 container 에 그린다. 고른 값은 aria-pressed 로 표시한다.
 * options: [{ value, label, detail }] — detail 은 버튼 아래 작은 글씨
 */
export function segmented(container, options, current, onPick) {
  container.replaceChildren();
  for (const { value, label, detail } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.setAttribute('aria-pressed', String(value === current));
    button.innerHTML = `<span>${label}</span>${detail ? `<small>${detail}</small>` : ''}`;
    button.addEventListener('click', () => onPick(value));
    container.append(button);
  }
}

/**
 * 잠깐 떴다 사라지는 알림. el 에 .show 클래스를 붙였다 duration 초 뒤 뗀다.
 * 창이 포커스를 잃어 게임 프레임이 멈춰도 알림은 제때 사라진다.
 */
export function createToast(el, duration = 1.4) {
  let timer = 0;
  return {
    show(text, tone = '') {
      el.textContent = text;
      el.dataset.tone = tone;
      el.classList.remove('show');
      void el.offsetWidth; // 애니메이션을 처음부터 다시
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), duration * 1000);
    },
  };
}

// 마지막 입력이 손가락이었는지. 터치 화면은 입력 전에도 손가락으로 본다
let touchInput = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
globalThis.addEventListener?.('pointerdown', (event) => (touchInput = event.pointerType !== 'mouse'), true);
globalThis.addEventListener?.('keydown', () => (touchInput = false), true);

/**
 * 메뉴·결과 화면이 열릴 때 기본 버튼으로 포커스를 옮긴다. 키보드 사용자는 바로 Enter·Space 로 누를 수 있고,
 * 손가락으로 쓰는 중에는 옮기지 않아 버튼에 포커스 테두리가 생기지 않는다.
 */
export function focusForKeyboard(el) {
  if (!touchInput) el?.focus();
}
