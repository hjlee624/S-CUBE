/**
 * MTEXT 서식코드 디코더 — DXF MTEXT/TEXT의 인라인 제어열을 사람이 읽는 평문으로 변환.
 *
 * MTEXT value(그룹코드 1/3)에는 색·폰트·높이·정렬·스택분수 등 서식 제어열이 raw로 섞여 있다.
 * 예: "{\\C4;1. 본 도면...\\P\\pi-1.40251,l1.40251;2. ..." → 제어열 제거 + \P를 줄바꿈으로.
 *
 * 처리 규칙:
 * - \P → 줄바꿈(\n), \N(단 나눔) → 줄바꿈(\n), \~ → 비단절 공백(U+00A0)
 * - \A#; \p…; \f…; \F…; \H…; \W…; \Q…; \T…; \C#; \c…; — 세미콜론까지의 인자형 제어열 제거.
 *   세미콜론이 없으면(잘림·손상) 공백·중괄호·역슬래시 경계까지만 인자로 보고 그 뒤 텍스트는
 *   보존한다(문자열 끝까지 삼켜 정상 노트 텍스트를 통째로 잃지 않도록).
 * - \L \l \O \o \K \k — 인자 없는 토글 제어열 제거
 * - \S 분자^분모; (또는 #, / 구분자) → "분자/분모". 분자가 비면 분모만 낸다.
 *   분수 본문 안의 이스케이프 제어열(\P 등)은 내부에서 처리·제거해 raw로 새지 않게 한다.
 * - 중괄호 그룹 {\...; ...}: 여는 제어열 제거·내용 보존, 최외곽 중괄호 unwrap
 * - 이스케이프 \\ \{ \} → 리터럴 \ { }
 * - \U+XXXX → 해당 유니코드 문자
 * - 알 수 없는 제어열 \X: 역슬래시와 문자 X를 함께 버린다(리터럴로 남기면 X가 텍스트에 섞임).
 *   뒤에 'digits;' 꼴 인자가 이어지면 그 세미콜론까지 건너뛴다(\Z9; → 완전 제거).
 *
 * 순수 텍스트(제어열 없음)는 변형하지 않는다(멱등).
 */

const NBSP = ' ';

/** 인자를 세미콜론까지 갖는 서식 제어 문자 (\X…;) */
const ARG_TERMINATED = new Set(['A', 'C', 'c', 'f', 'F', 'H', 'p', 'Q', 'T', 'W']);

/** 인자 없이 토글되는 서식 제어 문자 (\L \l \O \o \K \k) */
const TOGGLE_ONLY = new Set(['L', 'l', 'O', 'o', 'K', 'k']);

/** \U+XXXX 유니코드 이스케이프를 해석해 문자열로. 실패 시 null */
function readUnicodeEscape(src: string, i: number): { text: string; next: number } | null {
  // src[i] === '\\', src[i+1] === 'U', src[i+2] === '+'
  const hex = src.slice(i + 3, i + 7);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
  return { text: String.fromCharCode(Number.parseInt(hex, 16)), next: i + 7 };
}

/**
 * \S 스택분수 파싱. src[i]는 'S' 다음 위치(인자 시작). 종료 세미콜론까지 소비.
 * 분자/분모 구분자는 ^, #, / 중 하나. "분자/분모" 형태로 반환한다.
 *
 * 분수 본문 안의 이스케이프 제어열(\P \~ \\ 등)은 raw로 새면 안 되므로 내부에서 처리한다:
 * - \\ \{ \} → 리터럴 문자, \~ → 공백, \P·\N 등 그 외 제어 문자는 백슬래시째 제거(문자만 무시).
 * 분자가 비면(예: "\S ^25;") 선행 슬래시 없이 분모만 낸다.
 */
function readStackFraction(src: string, i: number): { text: string; next: number } {
  let numerator = '';
  let denominator = '';
  let sep = '';
  let j = i;
  const push = (s: string): void => {
    if (sep === '') numerator += s;
    else denominator += s;
  };
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === undefined) break;
    if (ch === ';') {
      j += 1; // 종료 세미콜론 소비
      break;
    }
    if (sep === '' && (ch === '^' || ch === '#' || ch === '/')) {
      sep = ch;
      continue;
    }
    if (ch === '\\') {
      const nx = src[j + 1];
      if (nx === ';' || nx === '\\' || nx === '{' || nx === '}') {
        push(nx); // 이스케이프된 리터럴
        j += 1;
        continue;
      }
      if (nx === '~') {
        push(NBSP);
        j += 1;
        continue;
      }
      // 그 외 제어열(\P \N 등)은 분수 내부에서 의미가 없으므로 백슬래시·문자를 함께 버린다
      if (nx !== undefined) j += 1;
      continue;
    }
    push(ch);
  }
  // '^' 스택 구분자는 뒤따르는 공백을 정렬용으로 쓰므로 트림한다
  const num = numerator.trim();
  const den = denominator.trim();
  // 분자가 비면 선행 '/' 아티팩트 없이 분모만, 분모가 비면 분자만 낸다
  const text = num === '' ? den : den === '' ? num : `${num}/${den}`;
  return { text, next: j };
}

/**
 * 인자형 제어열(\X…;)의 인자 끝 인덱스를 돌려준다.
 * - 세미콜론이 있으면 그 다음 위치(세미콜론 소비).
 * - 세미콜론이 없으면(잘림·손상) 첫 공백·중괄호·역슬래시 경계까지만 인자로 보고 그 위치를
 *   돌려준다(경계 문자는 소비하지 않음). 문자열 끝까지 삼켜 정상 텍스트를 잃지 않게 한다.
 */
function skipArgTerminated(src: string, i: number): number {
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === ';') return j + 1;
    // 인자 값에는 보이는 텍스트를 실어 나르는 미이스케이프 공백/구조 문자가 없다 —
    // 이런 경계를 만나면 인자가 세미콜론 없이 끝난 것으로 보고 여기서 멈춘다.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '{' || ch === '}' || ch === '\\') {
      return j;
    }
  }
  return src.length;
}

/**
 * 알 수 없는 제어열 \X 뒤에 이어지는 'digits;' 꼴 인자를 건너뛴다.
 * src[i]는 X 다음 위치. 인자가 없으면 i를 그대로 돌려준다.
 */
function skipUnknownArg(src: string, i: number): number {
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch !== undefined && ch >= '0' && ch <= '9') {
      j += 1;
      continue;
    }
    break;
  }
  // 숫자 뒤 세미콜론이 있으면 인자로 보고 함께 삼킨다
  if (j > i && src[j] === ';') return j + 1;
  return i;
}

/**
 * MTEXT 서식코드를 평문으로 디코딩한다. 다중행 결과에는 '\n'이 포함될 수 있다.
 * 입력에 제어열이 없으면 원본을 그대로 반환한다(멱등).
 */
export function decodeMText(raw: string): string {
  let out = '';
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) {
        out += '\\';
        i += 1;
        continue;
      }
      // 이스케이프 리터럴
      if (next === '\\' || next === '{' || next === '}') {
        out += next;
        i += 2;
        continue;
      }
      if (next === 'P' || next === 'N') {
        // \P 문단 나눔, \N 단(컬럼) 나눔 — 둘 다 줄바꿈으로 낸다
        out += '\n';
        i += 2;
        continue;
      }
      if (next === '~') {
        out += NBSP;
        i += 2;
        continue;
      }
      if (next === 'U' && raw[i + 2] === '+') {
        const u = readUnicodeEscape(raw, i);
        if (u !== null) {
          out += u.text;
          i = u.next;
          continue;
        }
        // \U+ 이지만 4자리 hex가 아님(잘못된 유니코드 이스케이프): 백슬래시만 버리고
        // 'U'는 리터럴로 남긴다(사용자가 원래 의도를 볼 수 있게). 일반 미지 제어열과 달리
        // \U는 인식된 코드가 형식만 어긋난 경우이므로 문자를 통째로 버리지 않는다.
        out += 'U';
        i += 2;
        continue;
      }
      if (next === 'S') {
        const frac = readStackFraction(raw, i + 2);
        out += frac.text;
        i = frac.next;
        continue;
      }
      if (ARG_TERMINATED.has(next)) {
        i = skipArgTerminated(raw, i + 2);
        continue;
      }
      if (TOGGLE_ONLY.has(next)) {
        i += 2;
        continue;
      }
      // 알 수 없는 제어열: 백슬래시와 제어 문자 X를 함께 버린다(리터럴로 남기면 X가 텍스트에
      // 섞여 더 나쁘다). 뒤에 'digits;' 꼴 인자가 있으면 그 세미콜론까지 함께 건너뛴다.
      i = skipUnknownArg(raw, i + 2);
      continue;
    }
    if (ch === '{' || ch === '}') {
      // 중괄호 그룹은 서식 스코프일 뿐 — 여는 제어열은 위 분기에서 이미 제거되므로
      // 괄호 자체만 unwrap 한다
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
