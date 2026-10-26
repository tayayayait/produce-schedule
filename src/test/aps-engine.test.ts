import { describe, expect, it } from "vitest";
import {
  ORDERS,
  PRODUCTS,
  calcEstimatedLeadTimeMin,
  calcPriorityScore,
  calcTargetInputQty,
} from "@/lib/aps/data";
import {
  checkTaskMove,
  evaluate,
  moveTaskWithCascade,
  optimize,
  reschedule,
  scheduleFIFO,
  splitLots,
  validateScheduleIntegrity,
} from "@/lib/aps/engine";
import { SCENARIO_C_DOWN, SCENARIO_C_TIME } from "@/lib/aps/store";

describe("E-APS 핵심 도메인 계산기 및 스케줄링 최적화 엔진 검증 (상세서 Chapter 7)", () => {
  it("TC-PLAN-001: 5단계 공정 누적 수율 보정 목표 투입수량(Q') 및 로트 분할 계산", () => {
    const targetQty = calcTargetInputQty("PRD-ECU-100", 1000, true, PRODUCTS);
    expect(targetQty).toBeGreaterThan(1000);
    expect(targetQty).toBeLessThanOrEqual(1050);

    const lots = splitLots(targetQty, 500, 50, true);
    expect(lots.reduce((a, b) => a + b, 0)).toBe(targetQty);

    const leadTime = calcEstimatedLeadTimeMin("PRD-ECU-100", 600, PRODUCTS);
    expect(leadTime).toBeGreaterThan(0);
  });

  it("TC-PLAN-002: 동적 우선순위 가중치(W) 및 납기 여유지수(CR) 산출", () => {
    const urgentScore = calcPriorityScore("PRD-ADAS-200", 500, 0, 480, "P1_URGENT", PRODUCTS);
    const lowScore = calcPriorityScore("PRD-ADAS-200", 200, 0, 2400, "P4_LOW", PRODUCTS);
    expect(urgentScore.W).toBeGreaterThan(lowScore.W);
    expect(urgentScore.cr).toBeLessThan(lowScore.cr);
  });

  it("TC-OPT-001 & HC-001~007: 초기 기준 계획(FIFO Baseline) 및 2-Phase 하이브리드 최적화 무결성 검증", () => {
    const baseOrders = ORDERS.slice(0, 10);
    const baseTasks = scheduleFIFO(baseOrders, []);
    const baseKpi = evaluate(baseTasks, baseOrders, [], "BALANCED");

    expect(baseTasks.length).toBeGreaterThanOrEqual(baseOrders.length * 3);

    const baseIntegrity = validateScheduleIntegrity(baseTasks, baseOrders, []);
    expect(baseIntegrity.isValid).toBe(true);
    expect(baseIntegrity.violations).toHaveLength(0);

    const optTasks = optimize({ orders: baseOrders, downs: [], preset: "BALANCED" });
    const optKpi = evaluate(optTasks, baseOrders, [], "BALANCED");

    const optIntegrity = validateScheduleIntegrity(optTasks, baseOrders, []);
    expect(optIntegrity.isValid).toBe(true);
    expect(optIntegrity.violations).toHaveLength(0);

    expect(optKpi.Z).toBeLessThanOrEqual(baseKpi.Z);
    expect(optKpi.tardiness).toBeLessThanOrEqual(baseKpi.tardiness);
  });

  it("TC-OPT-002 (시나리오 C): SMT-02 4시간 돌발 고장 시 비가동 중첩 회피(HC-005) 및 우회 재스케줄링", () => {
    const baseOrders = ORDERS.slice(0, 10);
    const prevTasks = optimize({ orders: baseOrders, downs: [], preset: "BALANCED" });
    const reschedTasks = reschedule(
      prevTasks,
      baseOrders,
      [SCENARIO_C_DOWN],
      SCENARIO_C_TIME,
      120,
      "DUE_DATE_FIRST"
    );
    const integrity = validateScheduleIntegrity(reschedTasks, baseOrders, [SCENARIO_C_DOWN]);

    expect(integrity.violations.filter((v) => v.hcCode === "HC-005")).toHaveLength(0);

    const smt02Overlap = reschedTasks.filter(
      (t) =>
        t.eq === "SMT-02" &&
        t.start - t.setup < SCENARIO_C_DOWN.end &&
        t.end > SCENARIO_C_DOWN.start
    );
    expect(smt02Overlap).toHaveLength(0);
  });

  it("TC-OPT-003 (시나리오 D): 긴급 주문(PO-20261026-0012) 중도 투입 시 정상 배정 검증", () => {
    const allOrders = ORDERS.slice(0, 12);
    const tasks = optimize({ orders: allOrders, downs: [], preset: "DUE_DATE_FIRST" });
    const kpi = evaluate(tasks, allOrders, [], "DUE_DATE_FIRST");

    const urgentMetric = kpi.orders.find((m) => m.no === "PO-20261026-0012");
    expect(urgentMetric).toBeDefined();
    const urgentTasks = tasks.filter((t) => t.orderNo === "PO-20261026-0012");
    expect(urgentTasks.length).toBeGreaterThanOrEqual(5);
  });

  it("TC-UI-001: 간트 차트 드래그 앤 드롭 제약 검증(checkTaskMove) 및 연쇄 밀림(moveTaskWithCascade)", () => {
    const baseOrders = ORDERS.slice(0, 10);
    const tasks = optimize({ orders: baseOrders, downs: [], preset: "BALANCED" });
    const sampleSmtTask = tasks.find((t) => t.proc === "PROC-SMT")!;

    // 비호환 설비(PACK-01)로 SMT 공정 이동 시도 -> INVALID (HC-001 위반)
    const invalidCheck = checkTaskMove(
      tasks,
      sampleSmtTask.code,
      "PACK-01",
      0,
      sampleSmtTask.start - sampleSmtTask.setup,
      baseOrders,
      []
    );
    expect(invalidCheck.canDrop).toBe(false);
    expect(invalidCheck.status).toBe("INVALID");
    expect(invalidCheck.reason).toContain("HC-001");

    // 호환 설비(SMT-01)로 60분 뒤쪽 시간 이동 시 정상 Cascade 수행
    const { tasks: nextTasks, check } = moveTaskWithCascade(
      tasks,
      sampleSmtTask.code,
      "SMT-01",
      0,
      sampleSmtTask.start - sampleSmtTask.setup + 60,
      baseOrders,
      []
    );
    expect(check.canDrop).toBe(true);
    expect(["VALID", "CASCADE_WARN"]).toContain(check.status);

    const afterIntegrity = validateScheduleIntegrity(nextTasks, baseOrders, []);
    expect(
      afterIntegrity.violations.filter((v) => v.hcCode === "HC-003" || v.hcCode === "HC-004")
    ).toHaveLength(0);
  });
});
