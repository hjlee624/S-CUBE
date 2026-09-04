/**
 * DXF 파싱 워커 ↔ 메인 스레드 메시지 프로토콜 (P1-4).
 * 구조적 복제 가능한 plain 객체만 사용.
 */
import type { DrawingModel } from '@s-cube/schema';

/**
 * 파싱 단계 — 진행바 라벨링에 사용.
 * 'convert'는 워커가 아니라 메인 스레드의 DWG→DXF 서버 변환(FR-1.2) 단계 —
 * 동일한 로딩 오버레이를 재사용하기 위해 여기에 합류한다.
 */
export type ParseStage = 'convert' | 'read' | 'parse' | 'normalize';

export const PARSE_STAGE_LABELS: Readonly<Record<ParseStage, string>> = {
  convert: 'DWG 변환 중',
  read: '파일 읽기',
  parse: 'DXF 파싱',
  normalize: '정규화·블록 전개',
};

/** 메인 → 워커: 파싱 요청 (File은 구조적 복제 가능) */
export interface ParseRequest {
  type: 'parse';
  file: File;
}

/** 메인 → DWG 워커: DWG 브라우저 변환+파싱 요청 (RW-24) */
export interface ParseDwgRequest {
  type: 'parse-dwg';
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
  | {
      type: 'done';
      model: DrawingModel;
      elapsed_ms: number;
      /** DWG 변환 시 미지원으로 건너뛴 형식별 개수 (RW-24). DXF 경로는 미설정. */
      skipped?: Record<string, number>;
      /**
       * 미배치 블록(어떤 INSERT 로도 배치 안 된 정의) — 이 DWG 자체에 배치정보가 없어 못 그린
       * 객체 수·블록명. 크면 DXF 대비 내용이 빠져 보인다 → 경고용. (RW-24)
       */
      unplaced?: { count: number; names: string[] };
    }
  | { type: 'error'; message: string };
