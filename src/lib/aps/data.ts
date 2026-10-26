// E-APS 가상 마스터/시드 데이터 (설계서 5장)
export type Family = "ECU" | "ADAS" | "IOT" | "POWER";
export type ProcCode = "PROC-SMT" | "PROC-DIP" | "PROC-INSP" | "PROC-BURN" | "PROC-PACK";
export type Priority = "P1_URGENT" | "P2_HIGH" | "P3_NORMAL" | "P4_LOW" | "P5_HOLD_CANDIDATE";
export type Role = "ADMIN" | "PLANNER" | "OPERATOR" | "VIEWER";
export type OrderStatus = "REGISTERED" | "PLANNED" | "CONFIRMED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
export type TaskStatus = "WAITING" | "SETUP" | "RUNNING" | "PAUSED" | "COMPLETED" | "ABORTED";
export type EquipmentStatus = "RUN" | "IDLE" | "SETUP" | "DOWN" | "PM";

export const ROLE_META: Record<Role, { label: string; badge: string; canEditPlan: boolean; canEditTask: boolean; canEditMaster: boolean }> = {
  ADMIN: { label: "시스템/공장 관리자 (ADMIN)", badge: "ADMIN", canEditPlan: true, canEditTask: true, canEditMaster: true },
  PLANNER: { label: "생산계획 담당자 (PLANNER)", badge: "PLANNER", canEditPlan: true, canEditTask: true, canEditMaster: true },
  OPERATOR: { label: "현장 설비 반장 (OPERATOR)", badge: "OPERATOR", canEditPlan: false, canEditTask: true, canEditMaster: false },
  VIEWER: { label: "유관부서 조회자 (VIEWER)", badge: "VIEWER", canEditPlan: false, canEditTask: false, canEditMaster: false },
};

export interface RoutingStep {
  seq: number; // 10,20,...
  proc: ProcCode;
  uph?: number;
  fixedMin?: number;
  setup: number;
  defectRate?: number; // 공정별 예상 불량률 (0.000 ~ 0.200)
}
export interface Product {
  code: string;
  name: string;
  family: Family;
  lotSize: number;
  minLotSize?: number;
  routing: RoutingStep[];
}
export interface Equipment {
  code: string;
  name: string;
  proc: ProcCode;
  families: Family[];
  capacity: number;
  eta: number;
  allDay: boolean;
  desc: string;
  lineName?: string;
  status?: EquipmentStatus;
}
export interface Order {
  no: string;
  product: string;
  customer: string;
  qty: number;
  targetQty?: number;
  release: number; // minutes from horizon start
  due: number;
  priority: Priority;
  W: number;
  splittable?: boolean;
  applyYield?: boolean;
  status?: OrderStatus;
  memo?: string;
  cancelReason?: string;
}
export interface Downtime {
  id: string;
  eq: string;
  start: number;
  end: number;
  reason: string;
  type: "BREAKDOWN" | "PM";
  resolved?: boolean;
}

export const HORIZON_START_LABEL = "2026-10-26 08:00 (KST)";
export const SHIFT_MIN = 840; // 08:00~22:00
export const TRANSFER_MIN = 10;

/** dayOffset 0 = 10-26, "HH:MM" → 기준 시각 대비 분 */
export const at = (day: number, hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return day * 1440 + (h - 8) * 60 + m;
};

export const PROCESSES: { code: ProcCode; name: string; short: string }[] = [
  { code: "PROC-SMT", name: "표면실장 (SMT)", short: "SMT" },
  { code: "PROC-DIP", name: "수삽·웨이브 (DIP)", short: "DIP" },
  { code: "PROC-INSP", name: "AOI/ICT 검사", short: "INSP" },
  { code: "PROC-BURN", name: "Burn-in 에이징", short: "BURN" },
  { code: "PROC-PACK", name: "조립·포장", short: "PACK" },
];

export const PRODUCTS: Product[] = [
  {
    code: "PRD-ECU-100", name: "차량용 통합 바디 제어 모듈 (BCM-Pro)", family: "ECU", lotSize: 500, minLotSize: 50,
    routing: [
      { seq: 10, proc: "PROC-SMT", uph: 250, setup: 20, defectRate: 0.005 },
      { seq: 20, proc: "PROC-DIP", uph: 200, setup: 15, defectRate: 0.003 },
      { seq: 30, proc: "PROC-INSP", uph: 300, setup: 10, defectRate: 0.002 },
      { seq: 40, proc: "PROC-BURN", fixedMin: 180, setup: 10, defectRate: 0.001 },
      { seq: 50, proc: "PROC-PACK", uph: 400, setup: 10, defectRate: 0.0 },
    ],
  },
  {
    code: "PRD-ADAS-200", name: "자율주행 전방 레이더 제어보드", family: "ADAS", lotSize: 400, minLotSize: 50,
    routing: [
      { seq: 10, proc: "PROC-SMT", uph: 200, setup: 25, defectRate: 0.006 },
      { seq: 30, proc: "PROC-INSP", uph: 250, setup: 15, defectRate: 0.003 },
      { seq: 40, proc: "PROC-BURN", fixedMin: 240, setup: 10, defectRate: 0.002 },
      { seq: 50, proc: "PROC-PACK", uph: 350, setup: 10, defectRate: 0.0 },
    ],
  },
  {
    code: "PRD-IOT-300", name: "스마트 가전 AI Wi-Fi/BLE 통신모듈", family: "IOT", lotSize: 1000, minLotSize: 50,
    routing: [
      { seq: 10, proc: "PROC-SMT", uph: 500, setup: 15, defectRate: 0.003 },
      { seq: 30, proc: "PROC-INSP", uph: 600, setup: 10, defectRate: 0.002 },
      { seq: 50, proc: "PROC-PACK", uph: 800, setup: 10, defectRate: 0.0 },
    ],
  },
  {
    code: "PRD-PWR-400", name: "산업용 고전력 SMPS 파워보드", family: "POWER", lotSize: 500, minLotSize: 50,
    routing: [
      { seq: 10, proc: "PROC-SMT", uph: 300, setup: 15, defectRate: 0.004 },
      { seq: 20, proc: "PROC-DIP", uph: 150, setup: 20, defectRate: 0.004 },
      { seq: 30, proc: "PROC-INSP", uph: 300, setup: 10, defectRate: 0.002 },
      { seq: 40, proc: "PROC-BURN", fixedMin: 120, setup: 10, defectRate: 0.001 },
      { seq: 50, proc: "PROC-PACK", uph: 350, setup: 10, defectRate: 0.0 },
    ],
  },
];

const ALL: Family[] = ["ECU", "ADAS", "IOT", "POWER"];
export const EQUIPMENTS: Equipment[] = [
  { code: "SMT-01", name: "고속 칩마운터 라인 #1", proc: "PROC-SMT", families: ALL, capacity: 1, eta: 1.15, allDay: false, lineName: "LINE-A", status: "RUN", desc: "ADAS 포함 전 품목 장착 가능 (핵심 설비)" },
  { code: "SMT-02", name: "범용 칩마운터 라인 #2", proc: "PROC-SMT", families: ["ECU", "IOT", "POWER"], capacity: 1, eta: 0.9, allDay: false, lineName: "LINE-B", status: "RUN", desc: "ADAS 작업 불가" },
  { code: "DIP-01", name: "수삽·웨이브 솔더링 #1", proc: "PROC-DIP", families: ["ECU", "POWER"], capacity: 1, eta: 1.0, allDay: false, lineName: "LINE-A", status: "RUN", desc: "ECU·POWER 전용" },
  { code: "INSP-01", name: "3D AOI + ICT 복합 검사기 #1", proc: "PROC-INSP", families: ALL, capacity: 1, eta: 1.05, allDay: false, lineName: "LINE-A", status: "RUN", desc: "전 품목 검사" },
  { code: "INSP-02", name: "3D AOI 표준 검사기 #2", proc: "PROC-INSP", families: ALL, capacity: 1, eta: 0.95, allDay: false, lineName: "LINE-B", status: "IDLE", desc: "전 품목 광학 검사" },
  { code: "BURN-01", name: "고온 신뢰성 에이징 챔버 #1", proc: "PROC-BURN", families: ["ECU", "ADAS", "POWER"], capacity: 2, eta: 1.0, allDay: true, lineName: "CHAMBER", status: "RUN", desc: "2로트 동시 수용, 24시간 무인 가동" },
  { code: "PACK-01", name: "자동 펌웨어 라이팅 & 포장 #1", proc: "PROC-PACK", families: ALL, capacity: 1, eta: 1.0, allDay: false, lineName: "LINE-A", status: "RUN", desc: "최종 조립·출하 포장" },
  { code: "PACK-02", name: "반자동 조립 & 포장 #2", proc: "PROC-PACK", families: ALL, capacity: 1, eta: 0.9, allDay: false, lineName: "LINE-B", status: "IDLE", desc: "최종 조립·출하 포장" },
];

export const SDST: Record<Family, Record<Family, number>> = {
  ECU: { ECU: 0, ADAS: 25, IOT: 35, POWER: 30 },
  ADAS: { ECU: 25, ADAS: 0, IOT: 45, POWER: 40 },
  IOT: { ECU: 35, ADAS: 45, IOT: 0, POWER: 30 },
  POWER: { ECU: 30, ADAS: 40, IOT: 30, POWER: 0 },
};

export const PRIORITY_META: Record<Priority, { label: string; score: number; weightMultiplier: number }> = {
  P1_URGENT: { label: "1등급 긴급/VIP", score: 100, weightMultiplier: 10.0 },
  P2_HIGH: { label: "2등급 높음", score: 75, weightMultiplier: 5.0 },
  P3_NORMAL: { label: "3등급 보통", score: 50, weightMultiplier: 2.0 },
  P4_LOW: { label: "4등급 낮음", score: 25, weightMultiplier: 1.0 },
  P5_HOLD_CANDIDATE: { label: "5등급 유예", score: 10, weightMultiplier: 0.5 },
};

export const ORDERS: Order[] = [
  { no: "PO-20261026-0001", product: "PRD-ECU-100", customer: "현대모비스", qty: 1000, targetQty: 1012, release: at(0, "08:00"), due: at(1, "18:00"), priority: "P2_HIGH", W: 78.5, splittable: true, applyYield: false, status: "CONFIRMED", memo: "주력 양산 수주 물량" },
  { no: "PO-20261026-0002", product: "PRD-ADAS-200", customer: "만도 자율주행사업부", qty: 800, targetQty: 809, release: at(0, "08:00"), due: at(1, "20:00"), priority: "P1_URGENT", W: 94.2, splittable: true, applyYield: false, status: "CONFIRMED", memo: "SMT-01 고정밀 라인 필수" },
  { no: "PO-20261026-0003", product: "PRD-IOT-300", customer: "LG전자 리빙솔루션", qty: 2000, targetQty: 2011, release: at(0, "08:00"), due: at(1, "16:00"), priority: "P3_NORMAL", W: 62.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "고속 대량 양산" },
  { no: "PO-20261026-0004", product: "PRD-PWR-400", customer: "현대로템", qty: 1000, targetQty: 1012, release: at(0, "08:00"), due: at(2, "14:00"), priority: "P3_NORMAL", W: 55.4, splittable: true, applyYield: false, status: "CONFIRMED", memo: "수삽 DIP 공정 경유" },
  { no: "PO-20261026-0005", product: "PRD-ECU-100", customer: "기아 부품사업부", qty: 500, targetQty: 506, release: at(0, "10:00"), due: at(2, "12:00"), priority: "P2_HIGH", W: 74.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "PO-0001 연속 배치 권장" },
  { no: "PO-20261026-0006", product: "PRD-ADAS-200", customer: "현대오트론", qty: 400, targetQty: 405, release: at(0, "13:00"), due: at(2, "18:00"), priority: "P2_HIGH", W: 72.8, splittable: true, applyYield: false, status: "CONFIRMED", memo: "PO-0002 연속 배치 권장" },
  { no: "PO-20261026-0007", product: "PRD-IOT-300", customer: "삼성전자 DA사업부", qty: 1000, targetQty: 1006, release: at(0, "08:00"), due: at(2, "17:00"), priority: "P3_NORMAL", W: 54.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "일반 양산 주문" },
  { no: "PO-20261026-0008", product: "PRD-PWR-400", customer: "LS일렉트릭", qty: 500, targetQty: 506, release: at(1, "08:00"), due: at(3, "15:00"), priority: "P4_LOW", W: 32.5, splittable: true, applyYield: false, status: "CONFIRMED", memo: "2일차 자재 입고분" },
  { no: "PO-20261026-0009", product: "PRD-ECU-100", customer: "SL 라이팅", qty: 500, targetQty: 506, release: at(1, "08:00"), due: at(3, "18:00"), priority: "P3_NORMAL", W: 48.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "일반 양산 주문" },
  { no: "PO-20261026-0010", product: "PRD-IOT-300", customer: "코웨이 홈IoT", qty: 1000, targetQty: 1006, release: at(1, "08:00"), due: at(3, "20:00"), priority: "P4_LOW", W: 29.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "안전재고 보충용" },
  { no: "PO-20261026-0011", product: "PRD-ADAS-200", customer: "모셔널(Motional)", qty: 400, targetQty: 405, release: at(0, "08:00"), due: at(1, "15:00"), priority: "P1_URGENT", W: 96.5, splittable: true, applyYield: false, status: "CONFIRMED", memo: "시나리오 B: 납기 경합 긴급" },
  { no: "PO-20261026-0012", product: "PRD-ECU-100", customer: "현대차 울산공장(긴급)", qty: 500, targetQty: 506, release: at(1, "09:00"), due: at(2, "10:00"), priority: "P1_URGENT", W: 99.0, splittable: true, applyYield: false, status: "CONFIRMED", memo: "시나리오 D: 중도 긴급 VIP 삽입" },
];

export const productOf = (code: string, products: Product[] = PRODUCTS) =>
  products.find((p) => p.code === code) ?? PRODUCTS[0]!;
export const equipmentOf = (code: string, equipments: Equipment[] = EQUIPMENTS) =>
  equipments.find((e) => e.code === code) ?? EQUIPMENTS[0]!;

/** REQ-PLAN-002: 공정 예상 불량률을 반영한 목표 투입 수량 계산 */
export function calcTargetInputQty(productCode: string, orderQty: number, applyYield = true, products: Product[] = PRODUCTS): number {
  if (!applyYield) return orderQty;
  const p = productOf(productCode, products);
  const yieldFactor = p.routing.reduce((acc, step) => acc * (1 - (step.defectRate ?? 0)), 1);
  return Math.ceil(orderQty / Math.max(0.5, yieldFactor));
}

/** 주문의 전 공정 순수 예상 소요시간 합계(분) 계산 */
export function calcEstimatedLeadTimeMin(productCode: string, qty: number, products: Product[] = PRODUCTS): number {
  const p = productOf(productCode, products);
  return p.routing.reduce((sum, step) => {
    const run = step.fixedMin ? step.fixedMin : Math.ceil((qty / (step.uph ?? 300)) * 60);
    return sum + step.setup + run + TRANSFER_MIN;
  }, 0);
}

/** REQ-PLAN-003: 납기 여유지수(CR) 및 종합 우선순위 점수(W_i) 계산 */
export function calcPriorityScore(
  productCode: string,
  qty: number,
  releaseMin: number,
  dueMin: number,
  priority: Priority,
  products: Product[] = PRODUCTS,
): { W: number; cr: number; leadTimeMin: number; shortageWarning: boolean } {
  const leadTimeMin = Math.max(1, calcEstimatedLeadTimeMin(productCode, qty, products));
  const remainingMin = Math.max(0, dueMin - releaseMin);
  const cr = Math.round((remainingMin / leadTimeMin) * 100) / 100;
  const sManual = PRIORITY_META[priority].score;
  const sUrgency = Math.max(0, Math.min(100, 100 * (1 - cr / 5.0)));
  const W = Math.round((0.6 * sManual + 0.4 * sUrgency) * 10) / 10;
  return {
    W: Math.max(1, Math.min(100, W)),
    cr,
    leadTimeMin,
    shortageWarning: cr < 1.0,
  };
}

/** 분 → "10-26 14:00" */
export function fmt(min: number) {
  const total = 8 * 60 + Math.round(min);
  const day = Math.floor(total / 1440);
  const rem = total - day * 1440;
  let d = 26 + day;
  let mo = 10;
  if (d > 31) { d -= 31; mo = 11; }
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return `${mo}-${String(d).padStart(2, "0")} ${hh}:${mm}`;
}
export function fmtDur(min: number) {
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}
