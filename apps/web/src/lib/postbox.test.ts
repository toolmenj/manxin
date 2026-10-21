/**
 * 郵筒與寄出的過場：依年代長相不同、晃動一下比一下小、最後停回原位；
 * 場景可以略過（按鈕、Esc），換頁時收掉不留殘影。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { abortScenes, endScene, isFast, makeScene } from './motion.ts';
import { boxLook, postboxHTML, shakeFrames } from './postbox.ts';
import * as scenes from './scenes.ts';
import { POST_SCENE, postScene, postSceneMs } from './scenes.ts';

const rot = (t: unknown) => {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(String(t));
  return m ? Math.abs(parseFloat(m[1]!)) : 0;
};

describe('郵筒長相', () => {
  it('三種年代各有樣子；不認得的年代（例如之後的 map）用八〇年代的', () => {
    expect(boxLook('80s')).toBe('80s');
    expect(boxLook('minguo')).toBe('minguo');
    expect(boxLook('doodle')).toBe('doodle');
    expect(boxLook('map')).toBe('80s');
    expect(boxLook('whatever')).toBe('80s');
    expect(postboxHTML('green', 'map')).toBe(postboxHTML('green', '80s'));
  });

  it('都有投信口、取信門；綠的寫「郵政」、紅的寫「限時」', () => {
    for (const era of ['80s', 'minguo', 'doodle'] as const) {
      const d = document.createElement('div');
      d.innerHTML = postboxHTML('red', era);
      const pbx = d.querySelector('.pbx')!;
      expect(pbx.classList.contains('pb-' + era)).toBe(true);
      expect(pbx.querySelector('.slit')).not.toBeNull();
      expect(pbx.querySelector('.pb-door')).not.toBeNull();
      expect(pbx.querySelector('.t')!.textContent).toBe('限時');
    }
    expect(postboxHTML('green', 'minguo')).toContain('pb-cap');
    expect(postboxHTML('green', '80s')).toContain('>郵政<');
  });
});

describe('郵筒晃一下', () => {
  it.each(['80s', 'minguo', 'doodle', 'map'])('%s：從原位開始、停回原位，一下比一下小，而且慢（≥ 1 秒）', (era) => {
    const { kf, d } = shakeFrames(era);
    expect(kf[0]!.transform).toBe('none');
    expect(kf.at(-1)!.transform).toBe('none');
    expect(d).toBeGreaterThanOrEqual(1000);
    const amps = kf.map((k) => rot(k.transform)).filter((a) => a > 0);
    expect(amps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < amps.length; i++) expect(amps[i]!).toBeLessThan(amps[i - 1]!);
    // 不用等速：每一段都有 easing
    expect(kf.slice(0, -1).every((k) => k.easing && k.easing !== 'linear')).toBe(true);
  });

  it('民國的鑄鐵信筒比八〇年代沉：幅度小、晃得久', () => {
    const a = shakeFrames('80s', 1),
      b = shakeFrames('minguo', 1);
    expect(b.d).toBeGreaterThan(a.d);
    expect(rot(b.kf[1]!.transform)).toBeLessThan(rot(a.kf[1]!.transform));
  });

  it('力道小（關取信門）就晃得小', () => {
    expect(rot(shakeFrames('80s', 0.45).kf[1]!.transform)).toBeLessThan(rot(shakeFrames('80s', 1).kf[1]!.transform) * 0.7);
  });
});

describe('場景：略過與中斷', () => {
  afterEach(() => document.querySelectorAll('.scene').forEach((s) => s.remove()));

  it('「略過」和 Esc 都會讓剩下的動畫立刻跑完；收場後恢復正常速度', async () => {
    const { sc } = makeScene();
    expect(isFast()).toBe(false);
    (document.querySelector('.scene .skip') as HTMLButtonElement).click();
    expect(isFast()).toBe(true);
    await endScene(sc);
    expect(isFast()).toBe(false);
    expect(document.querySelector('.scene')).toBeNull();

    const s2 = makeScene();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isFast()).toBe(true);
    await endScene(s2.sc);
    // 收場後 Esc 不再有作用
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isFast()).toBe(false);
  });

  it('換頁時 abortScenes：畫面立刻拿掉，還在跑的場景程式快速收尾', async () => {
    const { sc } = makeScene();
    abortScenes();
    expect(document.querySelector('.scene')).toBeNull();
    expect(isFast()).toBe(true);
    await endScene(sc);
    expect(isFast()).toBe(false);
  });

  it('沒有場景時 abortScenes 什麼都不做（不會讓之後的動畫都變成瞬間）', () => {
    abortScenes();
    expect(isFast()).toBe(false);
  });
});

describe('郵差收信的過場（postScene）', () => {
  it('約 5 秒（2026-10-21 從 9 秒以上縮短），但每個動作都還是慢慢做，不是快轉', () => {
    const total = postSceneMs();
    expect(total).toBeGreaterThanOrEqual(4500);
    expect(total).toBeLessThanOrEqual(5600);
    // 有重量的動作不能快：郵差走來、開門、信滑進郵袋、提走都至少半秒以上；關門至少 0.3 秒
    for (const k of ['bagIn', 'doorOpen', 'mail', 'mailOurs', 'bagOut'] as const) expect(POST_SCENE[k]).toBeGreaterThanOrEqual(500);
    expect(POST_SCENE.doorClose).toBeGreaterThanOrEqual(300);
    // 單號打出來後至少停近一秒讓人看清楚
    expect(POST_SCENE.noRead).toBeGreaterThanOrEqual(900);
  });

  it('敘事照舊：郵筒、郵袋、取信門、信（最後一封是剛投的）、單號；可以略過', async () => {
    const p = postScene({ no: 'RR123456785TW', box: 'green', era: '80s' });
    const scene = document.querySelector('.scene')!;
    expect(scene.querySelector('.pb-stage .pbx .pb-door')).not.toBeNull();
    expect(scene.querySelector('.pb-bag')).not.toBeNull();
    const t0 = Date.now();
    (scene.querySelector('.skip') as HTMLButtonElement).click();
    await p;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(document.querySelector('.scene')).toBeNull();
  });

  it('沒接上的全自動寄信／拆信場景（sendScene／openScene）已改成註解保留，不再匯出', () => {
    expect('sendScene' in scenes).toBe(false);
    expect('openScene' in scenes).toBe(false);
    expect(typeof scenes.postScene).toBe('function');
    expect(typeof scenes.arriveLetter).toBe('function');
    expect(typeof scenes.openMouth).toBe('function');
  });
});
