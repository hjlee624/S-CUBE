/**
 * DXF 파싱 워커 ↔ 메인 스레드 메시지 프로토콜 (P1-4).
 * 구조적 복제 가능한 plain 객체만 사용.
 */
import type { DrawingModel } from '@s-cube/schema';

/** 파싱 단계 — 진행바 라벨링에 사용 */
export type ParseStage = 'read' | 'parse' | 'normalize';

export const PARSE_STAGE_LABELS: Readonly<Record<ParseStage, string>> = {
  read: '파일 읽기',
  parse: 'DXF 파싱',
  normalize: '정규화·블록 전개',
};

/** 메인 → 워커: 파싱 요청 (File은 구조적 복제 가능) */
export interface ParseRequest {
  type: 'parse';
  file: File;
}

/** 워커 → 메인 */
export type ParseResponse =
  | {
      type: 'progress';
      stage: ParseStage;
      /** 0~1. 단계 내 진행률을 알 수 없으면 -1 (indeterminate) */
      progress: number;
    }
  | { type: 'done'; model: DrawingModel; elapsed_ms: number }
  | { type: 'error'; message: string };
