/**
 * 伺服器時鐘。所有「現在幾點」都從這裡拿，不信任前端。
 * 開發環境可以設定偏移量（等同原型右上角的「快轉」）；正式環境偏移永遠是 0。
 */
export class Clock {
  private offset: number;
  constructor(
    private readonly allowOffset: boolean,
    initialOffset = 0,
    private readonly base: () => number = Date.now,
  ) {
    this.offset = allowOffset ? initialOffset : 0;
  }
  now(): number {
    return this.base() + this.offset;
  }
  date(): Date {
    return new Date(this.now());
  }
  get offsetMs(): number {
    return this.offset;
  }
  get canShift(): boolean {
    return this.allowOffset;
  }
  setOffset(ms: number): void {
    if (!this.allowOffset) throw new Error('clock offset is disabled in production');
    this.offset = ms;
  }
  advance(ms: number): void {
    this.setOffset(this.offset + ms);
  }
}
