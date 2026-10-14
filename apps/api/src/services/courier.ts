/**
 * 快遞基礎天數來源（D-007 暫用縣市距離表）。
 */
import { countyTableCourier, type CourierFn } from '@manxin/engine';

export interface CourierProvider {
  readonly name: string;
  /** 回傳給引擎用的同步函式 */
  prepare(fromAddr: string, toAddr: string): Promise<CourierFn>;
}

export class CountyTableCourier implements CourierProvider {
  readonly name = 'county-table';
  async prepare(): Promise<CourierFn> {
    return countyTableCourier;
  }
}

/* TODO(D-007)：串接快遞網站或付費 API 時，在 prepare() 先查好天數，再回傳 () => ({ base, why })。 */
