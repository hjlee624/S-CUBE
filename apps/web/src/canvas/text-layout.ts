/**
 * 다중행 텍스트 레이아웃 (순수 로직) — MTEXT 디코딩으로 NText.value에 줄바꿈(\n)이
 * 포함될 수 있다. 렌더러가 소비할 "줄별 오프셋"을 순수 함수로 계산해 단위테스트한다.
 *
 * 좌표 규약: baselineOffset은 "첫 줄 baseline(=삽입점) 기준, 화면 아래로 내려가는 양(+)".
 * 첫 줄은 항상 0 → 단일행 텍스트는 기존 렌더( fillText(value,0,0) )와 완전히 동일하다(무회귀).
 * 렌더러는 스크린 스페이스(y-down)에서 그리므로 일반 텍스트는 글리프가 그대로 바로 서고,
 * baselineOffset을 +y로 더하면 화면 아래로 내려간다(플립 없음). 미러 텍스트(e.mirrored)만
 * scale(1,-1) 반사이며 오프셋 부호가 반전된다. 단위는 호출자가 넘긴 lineHeight 기준
 * (렌더러는 화면 px = height×ppu 를 넘긴다).
 */

/** 한 줄의 렌더 정보 — 텍스트와 첫 줄 baseline 대비 아래 방향 오프셋(양수 = 화면 하강) */
export interface TextLine {
  text: string;
  /** 첫 줄 baseline(=삽입점) 대비 화면 아래로의 오프셋 (도면 단위). 첫 줄은 0 */
  baselineOffset: number;
}

/**
 * value를 줄 단위로 분해하고 각 줄의 baseline 오프셋을 계산한다.
 *
 * - 좌상단(삽입점) 기준 하강: 첫 줄 baseline은 삽입점 그대로(오프셋 0), 이후 줄이 아래로 내려간다.
 *   → 단일행이면 결과는 [{ text, baselineOffset: 0 }] 하나뿐 = 기존 렌더와 동일.
 * - 줄 높이 = height × lineSpacing (기본 1.0 근사; DXF 기본 행간 계수).
 * - \r\n / \r 은 \n 으로 정규화. 빈 줄도 한 줄로 센다.
 *
 * @param value    NText.value (다중행 가능)
 * @param height   글자 높이 (도면 단위)
 * @param lineSpacing 행간 계수 (기본 1.0)
 */
export function layoutTextLines(value: string, height: number, lineSpacing = 1): TextLine[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const raw = normalized.split('\n');
  const lineHeight = height * lineSpacing;
  const lines: TextLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i] ?? '';
    lines.push({ text, baselineOffset: i * lineHeight });
  }
  return lines;
}

/** value에 줄바꿈이 있는지 — 단일행 빠른 경로 판별용 */
export function isMultiline(value: string): boolean {
  return value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0;
}
