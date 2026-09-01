/**
 * 셀 주소 맵 + 논리 키 규약 (P4-12 2-pass 셀 할당).
 *
 * 1-pass 에서 상세/측정 시트가 각 값에 실제 엑셀 셀 주소를 부여하며 이 맵을 채운다.
 * 2-pass 에서 수량산출서가 TakeoffItem.basis 의 ref 노드(논리 키)를 이 맵으로
 * 실제 셀 주소로 해석해 수식을 렌더한다 (renderExcelFormula 의 cellOf).
 *
 * 논리 키(TakeoffItem.basis 의 ref.cell 에 넣는 값)는 시트 레이아웃과 독립적이어야
 * 한다 — 도메인(store)이 셀 위치를 모른 채 항목을 조립할 수 있게 하기 위함.
 * 규약:
 *   section:<sectionId>:area        측점별 단면적 셀 (상세 시트)
 *   segment:<segId>:a1|a2|length    구간 시·종점 단면적/연장 셀 (상세 시트)
 *   segment:<segId>:volume          구간 체적 셀 (상세 시트, 그 자체가 =(A1+A2)/2*L 수식)
 *   measurement:<measId>:value      측정값 셀 (측정 원장 시트)
 *   item:<itemId>:quantity          다른 산출 항목 수량 셀 (항목 간 참조)
 */

/** 측점 단면적 논리 키 */
export function sectionAreaKey(sectionId: string): string {
  return `section:${sectionId}:area`;
}

/** 구간 필드 논리 키 (a1·a2·length·volume) */
export function segmentKey(segId: string, field: 'a1' | 'a2' | 'length' | 'volume'): string {
  return `segment:${segId}:${field}`;
}

/** 측정값 논리 키 */
export function measurementValueKey(measurementId: string): string {
  return `measurement:${measurementId}:value`;
}

/** 산출 항목 수량 논리 키 (항목 간 참조) */
export function itemQuantityKey(itemId: string): string {
  return `item:${itemId}:quantity`;
}

/** 논리 키 → 실제 엑셀 셀 주소 맵 (1-pass 에서 채우고 2-pass 에서 읽는다) */
export class CellMap {
  private readonly map = new Map<string, string>();

  /** 논리 키에 실제 셀 주소(시트 수식화 완료) 등록. 중복 등록은 에러 */
  set(logicalKey: string, address: string): void {
    if (this.map.has(logicalKey)) {
      throw new Error(`CellMap: 논리 키 중복 할당: ${logicalKey}`);
    }
    this.map.set(logicalKey, address);
  }

  /** 논리 키 → 셀 주소. 미등록이면 undefined */
  get(logicalKey: string): string | undefined {
    return this.map.get(logicalKey);
  }

  /** renderExcelFormula 에 넘길 cellOf 해석기. 미등록 키는 에러로 승격 */
  resolver(): (ref: string) => string {
    return (ref: string): string => {
      const address = this.map.get(ref);
      if (address === undefined) {
        throw new Error(
          `수식 렌더: 참조 셀을 찾을 수 없습니다: ${ref} — 상세/측정 시트에 해당 값이 배치되지 않았습니다`,
        );
      }
      return address;
    };
  }

  /** 등록된 논리 키 개수 */
  get size(): number {
    return this.map.size;
  }
}

/**
 * 시트명을 엑셀 수식에서 안전하게 참조하도록 인용한다.
 * 한글·공백·특수문자 시트명은 작은따옴표로 감싸고 내부 따옴표는 이스케이프한다.
 * 예: 측점별 상세 → '측점별 상세'!D12
 */
export function sheetRef(sheetName: string, cellAddress: string): string {
  const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName);
  if (!needsQuote) {
    return `${sheetName}!${cellAddress}`;
  }
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${cellAddress}`;
}

/** 0-based 컬럼 인덱스 → 엑셀 컬럼 문자 (0→A, 25→Z, 26→AA) */
export function columnLetter(index0: number): string {
  if (index0 < 0 || !Number.isInteger(index0)) {
    throw new Error(`columnLetter: 잘못된 컬럼 인덱스: ${index0}`);
  }
  let n = index0;
  let out = '';
  do {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
