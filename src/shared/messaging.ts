/** 内容脚本 ↔ 后台的消息协议。 */

import type { ApiResponse, InputTranslateResult, PublicConfig, SourceBlock, TranslateResult } from './types';
import { errMessage } from './types';

export type Msg =
  | { type: 'st:get-config' }
  | { type: 'st:translate'; blocks: SourceBlock[]; targetLang: string }
  | { type: 'st:translate-input'; text: string }
  | { type: 'st:open-options' }
  | { type: 'st:test-connection'; baseUrl: string; apiKey: string; model: string };

export interface MsgMap {
  'st:get-config': PublicConfig;
  'st:translate': TranslateResult;
  'st:translate-input': InputTranslateResult;
  'st:open-options': true;
  'st:test-connection': { status: number; models: string[] };
}

export async function call<T extends Msg['type']>(
  msg: Extract<Msg, { type: T }>,
): Promise<ApiResponse<MsgMap[T]>> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as ApiResponse<MsgMap[T]> | undefined;
    if (!res || typeof res !== 'object' || !('ok' in res)) {
      return { ok: false, error: { code: 'NO_RESPONSE', message: '扩展后台没有响应，请刷新页面后重试' } };
    }
    return res;
  } catch (e) {
    return {
      ok: false,
      error: { code: 'DISCONNECTED', message: `扩展后台未就绪：${errMessage(e)}（刷新页面可恢复）` },
    };
  }
}
