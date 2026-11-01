import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Whether a key hint inside a text field (the search's "/") can show without
 * cutting the field's placeholder off. On a narrow list pane, or with a longer
 * translation, it cannot, and then the hint gives way: the placeholder says
 * what the field is for, the hint only names a shortcut.
 *
 * The hint is the field's last item. While it is off (.rgh-kbd-off) it stays
 * out of the flow but keeps its size, so that it can still be measured.
 * `shown` is false while the hint is not rendered at all.
 */
export function useHintFits(
  input: RefObject<HTMLInputElement>,
  hint: RefObject<HTMLElement>,
  placeholder: string,
  shown: boolean,
): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const field = input.current?.parentElement;
    if (!shown || !field || typeof ResizeObserver === 'undefined') return;
    const canvas = document.createElement('canvas').getContext('2d');
    if (!canvas) return;
    const check = () => {
      const el = input.current;
      const kbd = hint.current;
      if (!el || !kbd) return;
      const style = getComputedStyle(el);
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const needed = canvas.measureText(placeholder).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      // Off, the hint leaves its width and the gap before it to the input.
      const off = getComputedStyle(kbd).position === 'absolute';
      const gap = parseFloat(getComputedStyle(field).columnGap) || 0;
      setFits(needed <= el.clientWidth - (off ? kbd.offsetWidth + gap : 0));
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(field);
    // The web font may load after the first check, and it sets the placeholder's width.
    document.fonts?.addEventListener('loadingdone', check);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', check);
    };
  }, [input, hint, placeholder, shown]);
  return fits;
}
