/** 共用的 JSON Schema 片段（Fastify 用 ajv 驗證；多餘欄位一律 400） */

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

export const str = (o: Record<string, unknown> = {}) => ({ type: 'string', ...o });
export const num = (o: Record<string, unknown> = {}) => ({ type: 'number', ...o });
export const int = (o: Record<string, unknown> = {}) => ({ type: 'integer', ...o });
export const bool = { type: 'boolean' };
export const enm = (...values: string[]) => ({ type: 'string', enum: values });

export const uuidParam = (name = 'id') => obj({ [name]: str({ pattern: '^[0-9a-fA-F-]{36}$' }) }, [name]);

export const seqProp = { seq: int({ minimum: 0 }) };

const uuidStr = str({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' });

/** 追加請求共用：seq（樂觀鎖）、sheetId（換紙偵測）、opId（重送不重複） */
export const appendMetaProps = { ...seqProp, sheetId: uuidStr, opId: uuidStr };

export const strokeSchema = obj(
  {
    pen: enm('fountain', 'ball', 'pencil'),
    color: str({ pattern: '^#[0-9A-Fa-f]{6}$' }),
    pts: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'array', minItems: 3, maxItems: 3, items: num() } },
  },
  ['pen', 'color', 'pts'],
);

export const posSchema = obj({ x: num(), y: num(), r: num() }, ['x', 'y', 'r']);

export const envSchema = obj({
  fromName: str({ maxLength: 60 }),
  fromEmail: str({ maxLength: 254 }),
  fromAddr: str({ maxLength: 200 }),
  toName: str({ maxLength: 60 }),
  toEmail: str({ maxLength: 254 }),
  toAddr: str({ maxLength: 200 }),
});
