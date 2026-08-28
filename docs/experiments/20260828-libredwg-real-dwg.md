# LibreDWG dwg2dxf 실도면 변환 검증

- 일자: 2026-08-28
- 목적: DWG→DXF 변환기를 ODA File Converter(등록 필요) 대신 LibreDWG(완전 무료,
  GPL, 등록 불필요)로 대체 가능한지 실도면으로 검증
- 방법: LibreDWG 0.14.8592 win64 바이너리(GitHub Releases) 다운로드 →
  `dwg2dxf -y -o output.dxf input.dwg` 로 사연댐 실도면
  "053. 여수로 굴착 횡단면도(1).dwg" (396KB, AC1021/2007 포맷) 변환 →
  산출 DXF(1.1MB)를 `parseAndNormalizeDxf` 에 투입

## 결과: 성공

| 항목 | 값 |
|---|---|
| 변환 | 정상 (경고: Unknown object eed/reactors/xdic 다수 — 무해) |
| 파싱 시간 | 30ms |
| 엔티티 | 510개 (polyline 360, text 142, line 8) |
| 레이어 | 22개 |
| 미지원 집계 | HATCH 65, ATTRIB 43, ATTDEF 43, VIEWPORT 2, MULTILEADER 1 |
| bounds | 252.3 × 178.2 (도곽 좌표, $INSUNITS=0 → 캘리브레이션 필수 확인) |

## 결론

- **채택.** LibreDWG를 변환 백엔드 1순위로, ODA File Converter를 폴백으로 재구성
- 별도 프로세스 CLI 호출이므로 GPL 전염 없음, 재배포도 소스 공개된 원본 링크로 안내
- 횡단면 측정 대상인 폐합 폴리라인이 360개로 풍부 — Phase 2 측정 검증에 이 도면 사용 가능
- HATCH 65건은 기존 알려진 한계(dxf-parser 미지원)와 동일 — Phase 2에서 자체 파서 필요
- ATTRIB/ATTDEF(도곽 표제부 텍스트)는 뷰어 표시에 비필수, 추후 정규화 검토
