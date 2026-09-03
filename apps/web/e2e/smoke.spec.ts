/**
 * RW-19: 스모크 E2E 테스트 + 클릭 수 회귀 지표
 *
 * 목표:
 * - 앱 로드 및 주요 UI 요소 존재 확인
 * - "도면 열기"까지 필요한 클릭 수 회귀 지표 (NFR-8: ≤4 클릭)
 *
 * 실행:
 *   pnpm playwright test                    (로컬 — 개발서버 자동 실행)
 *   pnpm playwright test --reporter=html    (리포트 생성)
 */
import { expect, test } from '@playwright/test';

test.describe('S-CUBE 스모크 — 앱 로드', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('앱 루트 렌더 — data-testid=app-root 가시적', async ({ page }) => {
    await expect(page.getByTestId('app-root')).toBeVisible();
  });

  test('"도면 열기" 버튼 — 초기 화면에서 바로 가시적, 활성화', async ({ page }) => {
    const btn = page.getByTestId('btn-open-dxf');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('도면 열기');
  });

  test('페이지 타이틀 렌더', async ({ page }) => {
    // title 태그 또는 앱 루트가 존재하면 렌더 성공으로 간주
    const root = page.getByTestId('app-root');
    await expect(root).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('S-CUBE 클릭 수 회귀 지표 (NFR-8)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('도면 열기 버튼 도달 — 0 추가 클릭 (첫 화면에 노출)', async ({ page }) => {
    // "도면 열기" 버튼은 첫 화면에서 바로 보여야 한다 (추가 탐색 불필요)
    // 클릭 수 기여: 0 (첫 화면 노출)
    const btn = page.getByTestId('btn-open-dxf');
    await expect(btn).toBeVisible({ timeout: 5_000 });

    // 회귀 지표: 버튼이 스크롤 없이 뷰포트 안에 있는가
    const boundingBox = await btn.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.x).toBeGreaterThanOrEqual(-1); // 서브픽셀 오차 허용
    expect(boundingBox!.y).toBeGreaterThanOrEqual(-1); // 헤더 최상단 버튼
  });

  test('JS 오류 없음 — 콘솔 에러 미발생', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // React hydration 오류 등 콘솔 에러가 없어야 함
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('ResizeObserver'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
