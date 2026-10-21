/**
 * 落子無悔：書寫輸入框的防護（移植自原型 #ime／#eime 的事件處理，規則見 .claude/agents/frontend.md）。
 *
 * 輸入框只是「接字的漏斗」：使用者打的字（含輸入法組字結果）一送出就清空輸入框，
 * 轉成「追加字元」交給 onText。信紙內容另外存放，輸入框裡永遠沒有東西可以刪。
 *
 * 擋下的入口：
 * - keydown：Backspace／Delete、Ctrl/⌘+Z/Y（復原、重做）、Ctrl/⌘+C/X（複製、剪下）、Ctrl/⌘+V（貼上）、Ctrl/⌘+A、方向鍵與 Home/End/PageUp/PageDown
 * - beforeinput：delete*、history*、insertFromPaste／insertFromDrop／insertFromYank（虛擬鍵盤的退格也走這裡）
 * - paste、cut、copy、drop、dragover、contextmenu（右鍵選單）
 * 方向鍵與 Home／End 不會移動輸入框裡的游標（輸入框永遠是空的）；有 onNav 時交給它移動紙上的打字頭（只移動，不刪字）。
 * 放行：輸入法組字中的按鍵與退格（isComposing、keyCode 229、deleteCompositionText、insertCompositionText），
 * 因為那是在選字，還沒寫到紙上。
 */

export interface NoRegretOptions {
  /** 寫到紙上的字（已經把 \r\n 換成 \n） */
  onText: (text: string) => void;
  /** 提醒文字（呼叫端自己節流） */
  nag?: (msg: string) => void;
  /** Tab 要不要變成全形空白（書桌是；信封不是） */
  tabAsSpace?: boolean;
  /** 組字狀態改變（打字機的「魔眼」顯示組字中的字） */
  onComposition?: (text: string | null) => void;
  /** 每個按鍵（打字機鍵盤動畫、聲音），不影響防護 */
  onKey?: (e: KeyboardEvent, phase: 'down' | 'up') => void;
  /**
   * 退格交給自己的組字器（拼音鍵盤）：回傳 true 表示刪的是還沒寫到紙上的拼音，放行；
   * false 表示沒在組字，照落子無悔擋下。
   */
  onBackspace?: () => boolean;
  /** Esc：清掉組字中的拼音 */
  onEscape?: () => void;
  /** 方向鍵、Home、End：移動紙上的打字頭（書桌）；回傳 true 表示處理了 */
  onNav?: (key: string) => boolean;
  /** 書桌與信封的提醒文字略有不同 */
  messages?: Partial<typeof DEFAULT_MESSAGES>;
}

export const DEFAULT_MESSAGES = {
  backspace: '落子無悔：這台打字機沒有退格鍵。要改字，請按「改錯」。',
  undo: '沒有復原。寫下的就是寫下了。',
  copy: '複製已停用。',
  paste: '貼上已停用。一個字一個字來。',
  delete: '落子無悔：沒有刪除，也沒有復原。',
};

export const ENVELOPE_MESSAGES: Partial<typeof DEFAULT_MESSAGES> = {
  backspace: '落子無悔：信封上的字也擦不掉。',
  undo: '這裡不能復原、複製或貼上。',
  copy: '這裡不能復原、複製或貼上。',
  paste: '這裡不能復原、複製或貼上。',
  delete: '落子無悔：信封上的字也擦不掉。',
};

type Field = HTMLTextAreaElement | HTMLInputElement;

/** 這個 keydown 該不該擋；回傳提醒文字（空字串＝靜靜擋掉），null＝放行 */
export function blockedKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'>, m = DEFAULT_MESSAGES): string | null {
  if (e.isComposing || e.keyCode === 229) return null;
  const k = e.key,
    mod = e.ctrlKey || e.metaKey;
  if (k === 'Backspace' || k === 'Delete') return m.backspace;
  if (mod && /^[zy]$/i.test(k)) return m.undo;
  if (mod && /^[cx]$/i.test(k)) return m.copy;
  if (mod && /^v$/i.test(k)) return m.paste;
  if (mod && /^a$/i.test(k)) return '';
  if (/^(Arrow|Home|End|Page)/.test(k)) return '';
  return null;
}

/** 這個 beforeinput 該不該擋（inputType） */
export function blockedInput(inputType: string, m = DEFAULT_MESSAGES): string | null {
  if (inputType === 'deleteCompositionText' || inputType === 'insertCompositionText') return null;
  if (/^(delete|history)/.test(inputType)) return m.delete;
  if (/insertFrom(Paste|Drop|Yank)/.test(inputType)) return m.paste;
  return null;
}

/** 掛上防護，回傳拆除函式 */
export function guardNoRegret(fieldIn: Field, o: NoRegretOptions): () => void {
  const field = fieldIn as HTMLTextAreaElement;
  const m = { ...DEFAULT_MESSAGES, ...o.messages };
  const nag = (s: string) => {
    if (s) o.nag?.(s);
  };
  let composing = false;

  const flush = () => {
    const v = field.value;
    if (!v) return;
    field.value = '';
    o.onText(v.replace(/\r\n?/g, '\n'));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    o.onKey?.(e, 'down');
    if (!e.isComposing && e.keyCode !== 229) {
      if (e.key === 'Backspace' && o.onBackspace?.()) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && o.onEscape) {
        e.preventDefault();
        o.onEscape();
        return;
      }
      if (/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && o.onNav?.(e.key)) {
        e.preventDefault();
        return;
      }
    }
    const b = blockedKey(e, m);
    if (b !== null) {
      e.preventDefault();
      nag(b);
      return;
    }
    if (e.key === 'Tab' && !e.isComposing) {
      e.preventDefault();
      if (o.tabAsSpace) o.onText('　');
    }
  };
  const onKeyUp = (e: KeyboardEvent) => o.onKey?.(e, 'up');
  const onBeforeInput = (e: InputEvent) => {
    // 手機虛擬鍵盤的退格不走 keydown，從這裡進來
    if (e.inputType === 'deleteContentBackward' && o.onBackspace?.()) {
      e.preventDefault();
      return;
    }
    const b = blockedInput(e.inputType || '', m);
    if (b !== null) {
      e.preventDefault();
      nag(b);
    }
  };
  const onCompStart = () => {
    composing = true;
    field.classList.add('composing');
  };
  const onCompUpdate = (e: CompositionEvent) => o.onComposition?.(e.data || '');
  const onCompEnd = () => {
    composing = false;
    field.classList.remove('composing');
    o.onComposition?.(null);
    flush();
  };
  const onInput = (e: Event) => {
    if ((e as InputEvent).isComposing || composing) return;
    flush();
  };
  const stopPaste = (e: Event) => {
    e.preventDefault();
    nag(m.paste);
  };
  const stopCopy = (e: Event) => {
    e.preventDefault();
    nag(m.copy);
  };
  const stopDrag = (e: Event) => {
    e.preventDefault();
  };
  const stopMenu = (e: Event) => e.preventDefault();

  field.addEventListener('keydown', onKeyDown);
  field.addEventListener('keyup', onKeyUp);
  field.addEventListener('beforeinput', onBeforeInput as EventListener);
  field.addEventListener('compositionstart', onCompStart);
  field.addEventListener('compositionupdate', onCompUpdate as EventListener);
  field.addEventListener('compositionend', onCompEnd);
  field.addEventListener('input', onInput);
  field.addEventListener('paste', stopPaste);
  field.addEventListener('cut', stopCopy);
  field.addEventListener('copy', stopCopy);
  field.addEventListener('drop', stopPaste);
  field.addEventListener('dragover', stopDrag);
  field.addEventListener('contextmenu', stopMenu);
  return () => {
    field.removeEventListener('keydown', onKeyDown);
    field.removeEventListener('keyup', onKeyUp);
    field.removeEventListener('beforeinput', onBeforeInput as EventListener);
    field.removeEventListener('compositionstart', onCompStart);
    field.removeEventListener('compositionupdate', onCompUpdate as EventListener);
    field.removeEventListener('compositionend', onCompEnd);
    field.removeEventListener('input', onInput);
    field.removeEventListener('paste', stopPaste);
    field.removeEventListener('cut', stopCopy);
    field.removeEventListener('copy', stopCopy);
    field.removeEventListener('drop', stopPaste);
    field.removeEventListener('dragover', stopDrag);
    field.removeEventListener('contextmenu', stopMenu);
  };
}

/** 書寫區（整個書桌）上的複製、剪下、右鍵、拖放貼入 */
export function guardWritingArea(area: HTMLElement, nag: (s: string) => void): () => void {
  const copy = (e: Event) => {
    e.preventDefault();
    nag(DEFAULT_MESSAGES.copy);
  };
  const menu = (e: Event) => e.preventDefault();
  const drop = (e: DragEvent) => {
    // 只擋拖進文字；附件用檔案選擇器上傳
    e.preventDefault();
  };
  area.addEventListener('copy', copy);
  area.addEventListener('cut', copy);
  area.addEventListener('contextmenu', menu);
  area.addEventListener('drop', drop);
  area.addEventListener('dragover', drop);
  return () => {
    area.removeEventListener('copy', copy);
    area.removeEventListener('cut', copy);
    area.removeEventListener('contextmenu', menu);
    area.removeEventListener('drop', drop);
    area.removeEventListener('dragover', drop);
  };
}
