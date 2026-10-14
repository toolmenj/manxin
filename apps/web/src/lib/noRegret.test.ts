/**
 * 落子無悔：書寫輸入框的防護（keydown、beforeinput、IME 組字、虛擬鍵盤、右鍵、貼上、拖放）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedInput, blockedKey, DEFAULT_MESSAGES, ENVELOPE_MESSAGES, guardNoRegret, guardWritingArea } from './noRegret.ts';

function key(t: EventTarget, init: KeyboardEventInit & { keyCode?: number }, type: 'keydown' | 'keyup' = 'keydown') {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  t.dispatchEvent(e);
  return e;
}

function beforeInput(t: EventTarget, inputType: string, data: string | null = null) {
  const e = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data });
  t.dispatchEvent(e);
  return e;
}

function typeInto(ta: HTMLTextAreaElement, v: string, composing = false) {
  ta.value += v;
  ta.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: composing ? 'insertCompositionText' : 'insertText', isComposing: composing }));
}

describe('blockedKey：哪些按鍵要擋', () => {
  const k = (key: string, o: Partial<KeyboardEvent> = {}) => blockedKey({ key, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 0, ...o });
  it('退格、刪除一律擋下並提醒', () => {
    expect(k('Backspace')).toBe(DEFAULT_MESSAGES.backspace);
    expect(k('Delete')).toBe(DEFAULT_MESSAGES.backspace);
  });
  it('復原、重做、複製、剪下、貼上（Ctrl 與 ⌘ 都算）', () => {
    expect(k('z', { ctrlKey: true })).toBe(DEFAULT_MESSAGES.undo);
    expect(k('Z', { metaKey: true })).toBe(DEFAULT_MESSAGES.undo);
    expect(k('y', { ctrlKey: true })).toBe(DEFAULT_MESSAGES.undo);
    expect(k('c', { ctrlKey: true })).toBe(DEFAULT_MESSAGES.copy);
    expect(k('x', { metaKey: true })).toBe(DEFAULT_MESSAGES.copy);
    expect(k('v', { ctrlKey: true })).toBe(DEFAULT_MESSAGES.paste);
  });
  it('全選、方向鍵、Home/End/PageUp 靜靜擋掉（不能移到前面改字）', () => {
    for (const x of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']) expect(k(x)).toBe('');
    expect(k('a', { ctrlKey: true })).toBe('');
  });
  it('一般打字放行', () => {
    expect(k('a')).toBeNull();
    expect(k('Enter')).toBeNull();
    expect(k(' ')).toBeNull();
  });
  it('輸入法組字中（isComposing、keyCode 229）的退格要放行：那是在選字', () => {
    expect(k('Backspace', { isComposing: true })).toBeNull();
    expect(k('Backspace', { keyCode: 229 })).toBeNull();
  });
});

describe('blockedInput：beforeinput 的 inputType', () => {
  it('delete*、history* 擋下（虛擬鍵盤的退格走這裡）', () => {
    for (const t of ['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteByCut', 'deleteByDrag', 'historyUndo', 'historyRedo'])
      expect(blockedInput(t)).not.toBeNull();
  });
  it('貼上、拖放、yank 擋下', () => {
    for (const t of ['insertFromPaste', 'insertFromDrop', 'insertFromYank', 'insertFromPasteAsQuotation']) expect(blockedInput(t)).toBe(DEFAULT_MESSAGES.paste);
  });
  it('組字中的刪改放行', () => {
    expect(blockedInput('deleteCompositionText')).toBeNull();
    expect(blockedInput('insertCompositionText')).toBeNull();
  });
  it('一般輸入放行', () => {
    expect(blockedInput('insertText')).toBeNull();
    expect(blockedInput('insertLineBreak')).toBeNull();
  });
});

describe('guardNoRegret：掛在輸入框上', () => {
  let ta: HTMLTextAreaElement;
  let onText: ReturnType<typeof vi.fn<(t: string) => void>>;
  let nag: ReturnType<typeof vi.fn<(m: string) => void>>;
  let off: () => void;
  beforeEach(() => {
    document.body.innerHTML = '';
    ta = document.createElement('textarea');
    document.body.append(ta);
    onText = vi.fn<(t: string) => void>();
    nag = vi.fn<(m: string) => void>();
    off = guardNoRegret(ta, { onText, nag, tabAsSpace: true });
  });

  it('打的字送出去後輸入框立刻清空：輸入框裡永遠沒有東西可以刪', () => {
    typeInto(ta, '慢');
    expect(onText).toHaveBeenCalledWith('慢');
    expect(ta.value).toBe('');
  });

  it('\\r\\n 轉成 \\n', () => {
    typeInto(ta, 'a\r\nb');
    expect(onText).toHaveBeenCalledWith('a\nb');
  });

  it('Backspace／Delete／Ctrl+Z／Ctrl+Y／Ctrl+C／Ctrl+X／Ctrl+V 的 keydown 被 preventDefault，並提醒', () => {
    const cases: KeyboardEventInit[] = [
      { key: 'Backspace' },
      { key: 'Delete' },
      { key: 'z', ctrlKey: true },
      { key: 'y', ctrlKey: true },
      { key: 'c', ctrlKey: true },
      { key: 'x', ctrlKey: true },
      { key: 'v', metaKey: true },
    ];
    for (const c of cases) expect(key(ta, c).defaultPrevented).toBe(true);
    expect(nag).toHaveBeenCalledWith(DEFAULT_MESSAGES.backspace);
    expect(nag).toHaveBeenCalledWith(DEFAULT_MESSAGES.undo);
    expect(nag).toHaveBeenCalledWith(DEFAULT_MESSAGES.copy);
    expect(nag).toHaveBeenCalledWith(DEFAULT_MESSAGES.paste);
    expect(onText).not.toHaveBeenCalled();
  });

  it('一般按鍵不擋', () => {
    expect(key(ta, { key: 'a' }).defaultPrevented).toBe(false);
  });

  it('虛擬鍵盤（Android 等只送 beforeinput 的退格）也擋', () => {
    expect(beforeInput(ta, 'deleteContentBackward').defaultPrevented).toBe(true);
    expect(beforeInput(ta, 'historyUndo').defaultPrevented).toBe(true);
    expect(beforeInput(ta, 'insertFromPaste').defaultPrevented).toBe(true);
    expect(beforeInput(ta, 'insertFromDrop').defaultPrevented).toBe(true);
    expect(beforeInput(ta, 'insertText', 'a').defaultPrevented).toBe(false);
  });

  it('IME 組字：組字中不送出、組字中的退格放行；選好字（compositionend）才送出', () => {
    const onComposition = vi.fn();
    off();
    off = guardNoRegret(ta, { onText, nag, onComposition });
    ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    expect(ta.classList.contains('composing')).toBe(true);
    typeInto(ta, 'ㄇ', true);
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ㄇㄢ' }));
    expect(onComposition).toHaveBeenLastCalledWith('ㄇㄢ');
    // 組字中按退格：放行（不 preventDefault，也不提醒）
    expect(key(ta, { key: 'Backspace', isComposing: true }).defaultPrevented).toBe(false);
    expect(key(ta, { key: 'Backspace', keyCode: 229 }).defaultPrevented).toBe(false);
    expect(beforeInput(ta, 'deleteCompositionText').defaultPrevented).toBe(false);
    expect(onText).not.toHaveBeenCalled();
    expect(nag).not.toHaveBeenCalled();
    // 選字完成
    ta.value = '慢';
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: '慢' }));
    expect(onText).toHaveBeenCalledWith('慢');
    expect(ta.value).toBe('');
    expect(ta.classList.contains('composing')).toBe(false);
    expect(onComposition).toHaveBeenLastCalledWith(null);
  });

  it('paste、cut、copy、drop、dragover、右鍵選單都被擋', () => {
    for (const t of ['paste', 'cut', 'copy', 'drop', 'dragover', 'contextmenu']) {
      const e = new Event(t, { bubbles: true, cancelable: true });
      ta.dispatchEvent(e);
      expect(e.defaultPrevented, t).toBe(true);
    }
    expect(onText).not.toHaveBeenCalled();
  });

  it('Tab 變成全形空白（書桌）', () => {
    const e = key(ta, { key: 'Tab' });
    expect(e.defaultPrevented).toBe(true);
    expect(onText).toHaveBeenCalledWith('　');
  });

  it('信封上的輸入框用信封的提醒文字', () => {
    off();
    off = guardNoRegret(ta, { onText, nag, messages: ENVELOPE_MESSAGES });
    key(ta, { key: 'Backspace' });
    expect(nag).toHaveBeenCalledWith(ENVELOPE_MESSAGES.backspace);
  });

  it('拆掉之後不再攔截', () => {
    off();
    expect(key(ta, { key: 'Backspace' }).defaultPrevented).toBe(false);
  });
});

describe('guardWritingArea：整個書寫區', () => {
  it('右鍵、複製、剪下、拖放都擋', () => {
    const div = document.createElement('div');
    const nag = vi.fn();
    const off = guardWritingArea(div, nag);
    for (const t of ['contextmenu', 'copy', 'cut', 'drop', 'dragover']) {
      const e = new Event(t, { bubbles: true, cancelable: true });
      div.dispatchEvent(e);
      expect(e.defaultPrevented, t).toBe(true);
    }
    expect(nag).toHaveBeenCalledWith(DEFAULT_MESSAGES.copy);
    off();
  });
});
