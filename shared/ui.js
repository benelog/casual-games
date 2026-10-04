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
 * 시간은 게임 프레임(tick)으로 재므로 창이 포커스를 잃어 그리기가 멈추면 알림도 그대로 머문다.
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
      timer = duration;
    },
    tick(dt) {
      if (timer > 0 && (timer -= dt) <= 0) el.classList.remove('show');
    },
  };
}
