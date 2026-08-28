/**
 * @s-cube/core — 순수 계산 로직
 *
 * 브라우저·서버 공용. DOM·Node API에 의존하지 않는다.
 * - dxf/      DXF 파싱·정규화·블록 전개 (Phase 1)
 * - geometry/ shoelace·bulge·폐합·히트테스트 (Phase 2)
 * - quantity/ 양단면평균법·단위 환산·할증 (Phase 3~4)
 * - station/  측점 파싱·정렬·불연속 처리 (Phase 3)
 */

export { averageEndArea } from './quantity/volume.ts';
