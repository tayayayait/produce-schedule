import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAps } from "@/lib/aps/store";
import {
  PROCESSES,
  ROLE_META,
  at,
  fmt,
  type EquipmentStatus,
  type Family,
} from "@/lib/aps/data";
import { PageHead, Panel, Pill, biTone } from "@/components/aps/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Grid,
  Play,
  Plus,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/equipments")({
  component: EquipmentsPage,
});

const FAMILIES: Family[] = ["ECU", "ADAS", "IOT", "POWER"];

function EquipmentsPage() {
  const {
    current,
    currentKpi,
    downs,
    role,
    nowMin,
    freezeMin,
    equipments,
    products,
    sdstMatrix,
    addDowntime,
    removeDowntime,
    rescheduleNow,
    updateEquipmentStatus,
    updateEquipmentSpec,
    updateSdst,
    updateProductRouting,
  } = useAps();

  const perms = ROLE_META[role];
  const [tab, setTab] = useState<"STATUS_DOWN" | "MATRIX" | "ROUTING_SDST">("STATUS_DOWN");

  // Downtime form state
  const [downEq, setDownEq] = useState("SMT-02");
  const [downType, setDownType] = useState<"BREAKDOWN" | "PM">("BREAKDOWN");
  const [downDay, setDownDay] = useState(0);
  const [downHour, setDownHour] = useState("14:00");
  const [downDurMin, setDownDurMin] = useState(240);
  const [downReason, setDownReason] = useState("노즐 진공 압력 저하 및 피더 긴급 교체");

  // Product selection for routing editor
  const [selectedProdCode, setSelectedProdCode] = useState(products[0]?.code ?? "PRD-ECU-100");

  const startMin = at(downDay, downHour);
  const endMin = startMin + downDurMin;

  // Live impact preview: tasks on downEq overlapping [startMin, endMin]
  const affectedTasks = useMemo(() => {
    return current.tasks.filter(
      (t) => t.eq === downEq && t.start - t.setup < endMin && t.end > startMin
    );
  }, [current.tasks, downEq, startMin, endMin]);

  const procName = (proc: string) => PROCESSES.find((p) => p.code === proc)?.name ?? proc;

  const handleRegisterDowntimeOnly = () => {
    if (!perms.canEditMaster && !perms.canEditTask) {
      toast.error("권한이 부족합니다. 설비 제어 권한이 있는 역할로 전환해 주세요.");
      return;
    }
    if (downDurMin <= 0) {
      toast.error("비가동 시간은 15분 이상이어야 합니다.");
      return;
    }
    addDowntime({
      eq: downEq,
      start: startMin,
      end: endMin,
      type: downType,
      reason: downReason.trim() || `${downEq} 비가동 이벤트`,
    });
    toast.warning(`${downEq} 비가동 구간 등록 완료`, {
      description: `영향 작업 ${affectedTasks.length}건이 감지되었습니다. 우회 재스케줄링을 권장합니다.`,
    });
  };

  const handleRegisterAndReschedule = async () => {
    if (!perms.canEditPlan) {
      toast.error("재스케줄링 권한(PLANNER 또는 ADMIN)이 필요합니다.");
      return;
    }
    addDowntime({
      eq: downEq,
      start: startMin,
      end: endMin,
      type: downType,
      reason: downReason.trim() || `${downEq} 긴급 비가동`,
    });
    await rescheduleNow(nowMin, freezeMin, current.preset);
    toast.success(`${downEq} 비가동 등록 및 자동 우회 재스케줄링 완료`);
  };

  const selectedProduct = products.find((p) => p.code === selectedProdCode) ?? products[0]!;
  const cumulativeYield = useMemo(() => {
    const y = selectedProduct.routing.reduce((acc, s) => acc * (1 - (s.defectRate ?? 0)), 1);
    return Math.round(y * 10000) / 100;
  }, [selectedProduct]);

  return (
    <div className="space-y-5">
      <PageHead
        title="설비 및 공정 마스터 관리 (SCR-EQP-01)"
        desc="8대 생산설비 가동 상태·효율 계수(η), 돌발 고장/예방점검(PM) 비가동 스케줄, 공정 호환성 및 품목 전환 셋업(SDST) 매트릭스를 관리합니다."
      >
        <div className="inline-flex rounded-lg border bg-card p-1 shadow-2xs">
          <button
            onClick={() => setTab("STATUS_DOWN")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "STATUS_DOWN"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            1. 설비 상태 및 고장·비가동 관리
          </button>
          <button
            onClick={() => setTab("MATRIX")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "MATRIX"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            2. 설비-공정 호환성 매트릭스 (8×5)
          </button>
          <button
            onClick={() => setTab("ROUTING_SDST")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "ROUTING_SDST"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            3. 공정 라우팅 및 SDST 셋업 매트릭스
          </button>
        </div>
      </PageHead>

      {/* TAB 1: Equipment Status & Downtime Management */}
      {tab === "STATUS_DOWN" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left 7 cols: 8 Equipment Master List */}
          <Panel
            className="lg:col-span-7"
            title={
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-primary" />
                <span>생산설비 8대 실시간 상태 및 설비 효율 계수(η) 제어</span>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                    <th className="p-2.5">설비코드 / 명칭</th>
                    <th className="p-2.5">담당 공정</th>
                    <th className="p-2.5">지원 패밀리</th>
                    <th className="p-2.5">효율 계수(η)</th>
                    <th className="p-2.5">가동률 / BI</th>
                    <th className="p-2.5">설비 운전 상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {equipments.map((eq) => {
                    const u = currentKpi.eqs.find((x) => x.eq === eq.code);
                    const hasDown = downs.some((d) => d.eq === eq.code && !d.resolved);
                    const currentSt: EquipmentStatus = hasDown ? "DOWN" : eq.status ?? "RUN";

                    return (
                      <tr key={eq.code} className="hover:bg-muted/30">
                        <td className="p-2.5">
                          <div className="num font-bold text-foreground">{eq.code}</div>
                          <div className="text-[11px] text-muted-foreground">{eq.name}</div>
                        </td>
                        <td className="p-2.5">
                          <Pill tone="muted">{procName(eq.proc)}</Pill>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-wrap gap-1">
                            {eq.families.map((f) => (
                              <span
                                key={f}
                                className="rounded border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="num p-2.5">
                          <input
                            type="number"
                            min={0.5}
                            max={1.3}
                            step={0.05}
                            value={eq.eta}
                            disabled={!perms.canEditMaster}
                            onChange={(e) => {
                              const val = Math.max(0.5, Math.min(1.3, Number(e.target.value)));
                              updateEquipmentSpec(eq.code, { eta: val });
                              toast.info(`${eq.code} 설비 효율 계수(η) → ${val.toFixed(2)} 반영`);
                            }}
                            aria-label={`${eq.code} 설비 효율 계수`}
                            className="h-7 w-16 rounded border bg-background px-2 text-xs font-bold"
                          />
                        </td>
                        <td className="num p-2.5">
                          <div className="font-bold">{(u?.util ?? 0).toFixed(1)}%</div>
                          {u && <Pill tone={biTone(u.level)}>BI {u.BI.toFixed(1)}</Pill>}
                        </td>
                        <td className="p-2.5">
                          <select
                            value={currentSt}
                            disabled={!perms.canEditMaster && !perms.canEditTask}
                            onChange={(e) => {
                              const nextSt = e.target.value as EquipmentStatus;
                              updateEquipmentStatus(eq.code, nextSt);
                              toast.success(`${eq.code} 설비 상태 → ${nextSt}`);
                            }}
                            aria-label={`${eq.code} 운전 상태`}
                            className={`h-8 rounded border px-2 text-xs font-bold ${
                              currentSt === "DOWN"
                                ? "border-destructive bg-destructive/10 text-destructive"
                                : currentSt === "PM"
                                ? "border-warning bg-warning/10 text-warning"
                                : "bg-background text-foreground"
                            }`}
                          >
                            <option value="RUN">RUN (정상 가동)</option>
                            <option value="IDLE">IDLE (유휴 대기)</option>
                            <option value="SETUP">SETUP (품목 전환중)</option>
                            <option value="PM">PM (예방 점검)</option>
                            <option value="DOWN">DOWN (고장 정지)</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Right 5 cols: Downtime Registration & Impact Analyzer */}
          <div className="space-y-4 lg:col-span-5">
            <Panel
              title={
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span>설비 고장(DOWN) 및 예방점검(PM) 비가동 이벤트 등록</span>
                </div>
              }
            >
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-semibold">대상 설비 *</label>
                    <select
                      value={downEq}
                      onChange={(e) => setDownEq(e.target.value)}
                      className="h-9 w-full rounded border bg-background px-2.5 text-xs font-semibold"
                    >
                      {equipments.map((eq) => (
                        <option key={eq.code} value={eq.code}>
                          {eq.code} ({eq.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">비가동 유형 *</label>
                    <select
                      value={downType}
                      onChange={(e) => setDownType(e.target.value as "BREAKDOWN" | "PM")}
                      className="h-9 w-full rounded border bg-background px-2.5 text-xs font-semibold"
                    >
                      <option value="BREAKDOWN">돌발 고장 (BREAKDOWN)</option>
                      <option value="PM">정기 예방점검 (PM)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="mb-1 block font-semibold">발생 일자</label>
                    <select
                      value={downDay}
                      onChange={(e) => setDownDay(Number(e.target.value))}
                      className="h-9 w-full rounded border bg-background px-2 text-xs"
                    >
                      <option value={0}>Day 1 (10-26)</option>
                      <option value={1}>Day 2 (10-27)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">시작 시각</label>
                    <select
                      value={downHour}
                      onChange={(e) => setDownHour(e.target.value)}
                      className="num h-9 w-full rounded border bg-background px-2 text-xs"
                    >
                      {Array.from({ length: 24 }, (_, h) => {
                        const hh = `${String(h).padStart(2, "0")}:00`;
                        return (
                          <option key={hh} value={hh}>
                            {hh}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">지속 시간</label>
                    <select
                      value={downDurMin}
                      onChange={(e) => setDownDurMin(Number(e.target.value))}
                      className="num h-9 w-full rounded border bg-background px-2 text-xs font-semibold"
                    >
                      <option value={60}>1시간 (60분)</option>
                      <option value={120}>2시간 (120분)</option>
                      <option value={180}>3시간 (180분)</option>
                      <option value={240}>4시간 (240분)</option>
                      <option value={360}>6시간 (360분)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">고장 / 점검 상세 사유</label>
                  <input
                    type="text"
                    value={downReason}
                    onChange={(e) => setDownReason(e.target.value)}
                    className="h-9 w-full rounded border bg-background px-3 text-xs"
                  />
                </div>

                {/* Live Impact Analysis Box */}
                <div
                  className={`rounded-md border p-3 ${
                    affectedTasks.length > 0
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-success/40 bg-success/5"
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      실시간 충돌 영향도 분석 ({fmt(startMin)} ~ {fmt(endMin)})
                    </span>
                    <Pill tone={affectedTasks.length > 0 ? "danger" : "success"}>
                      충돌 작업 {affectedTasks.length}건
                    </Pill>
                  </div>
                  {affectedTasks.length > 0 ? (
                    <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                      <p>
                        해당 구간에 배정된 <b>{affectedTasks.map((t) => t.code).join(", ")}</b> 작업이 고장 구간과 직접 충돌합니다.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      해당 시간대에 {downEq}에 배정된 작업이 없어 즉시 등록 가능합니다.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={handleRegisterDowntimeOnly}
                    disabled={!perms.canEditMaster && !perms.canEditTask}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    비가동만 등록
                  </button>
                  <button
                    onClick={handleRegisterAndReschedule}
                    disabled={!perms.canEditPlan}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    등록 후 즉시 우회 재스케줄링
                  </button>
                </div>
              </div>
            </Panel>

            {/* Active Downtimes List */}
            <Panel title={`현재 등록된 비가동(Downtime) 이벤트 (${downs.length}건)`}>
              <div className="space-y-2 text-xs">
                {downs.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span>현재 활성화된 설비 고장 또는 점검 일정이 없습니다.</span>
                  </div>
                ) : (
                  downs.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-md border border-warning/40 bg-warning/5 p-2.5"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="num">{d.eq}</span>
                          <Pill tone="warning">{d.type}</Pill>
                          <span className="num text-[11px] text-muted-foreground">
                            {fmt(d.start)} ~ {fmt(d.end)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{d.reason}</div>
                      </div>
                      <button
                        onClick={() => {
                          removeDowntime(d.id);
                          toast.success(`${d.eq} 비가동 해제 및 정상 복구 완료`);
                        }}
                        disabled={!perms.canEditMaster && !perms.canEditTask}
                        className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-card px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        복구/해제
                      </button>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* TAB 2: 8x5 Equipment-Process Compatibility Matrix */}
      {tab === "MATRIX" && (
        <Panel title="설비-공정 호환성 매트릭스 (8대 설비 × 5대 공정) 및 지원 보드 패밀리">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                  <th className="p-3">설비 코드 / 설비명</th>
                  {PROCESSES.map((p) => (
                    <th key={p.code} className="p-3 text-center">
                      {p.name} ({p.short})
                    </th>
                  ))}
                  <th className="p-3">지원 보드 패밀리</th>
                  <th className="p-3 text-right">설비 효율 계수 (η)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {equipments.map((eq) => (
                  <tr key={eq.code} className="hover:bg-muted/30">
                    <td className="p-3">
                      <div className="num font-bold">{eq.code}</div>
                      <div className="text-[11px] text-muted-foreground">{eq.name}</div>
                    </td>
                    {PROCESSES.map((p) => {
                      const supported = eq.proc === p.code;
                      return (
                        <td key={p.code} className="p-3 text-center">
                          {supported ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success">
                              ● 가용 (효율 {Math.round(eq.eta * 100)}%)
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {FAMILIES.map((f) => {
                          const ok = eq.families.includes(f);
                          return (
                            <Pill key={f} tone={ok ? "primary" : "muted"}>
                              {f} {ok ? "✓" : "✕"}
                            </Pill>
                          );
                        })}
                      </div>
                    </td>
                    <td className="num p-3 text-right font-bold">{eq.eta.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* TAB 3: Product Routing & 4x4 SDST Matrix */}
      {tab === "ROUTING_SDST" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel
            className="lg:col-span-7"
            title="품목별 공정 라우팅 (UPH · 기본 셋업 · 공정 불량률)"
            action={
              <select
                value={selectedProdCode}
                onChange={(e) => setSelectedProdCode(e.target.value)}
                className="h-8 rounded border bg-background px-2.5 text-xs font-semibold"
              >
                {products.map((p) => (
                  <option key={p.code} value={p.code}>
                    [{p.family}] {p.name} ({p.code})
                  </option>
                ))}
              </select>
            }
          >
            <div className="mb-3 flex flex-wrap items-center justify-between rounded-md border bg-muted/30 px-3.5 py-2 text-xs">
              <span>
                선택 품목: <b>{selectedProduct.name}</b> · 표준 로트 크기:{" "}
                <b className="num">{selectedProduct.lotSize} EA</b>
              </span>
              <span>
                전 공정 누적 양품 수율:{" "}
                <b className="num text-primary">{cumulativeYield.toFixed(2)}%</b>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                    <th className="p-2.5">공정 순번(Seq)</th>
                    <th className="p-2.5">공정 코드 / 명칭</th>
                    <th className="p-2.5">표준 UPH (EA/h)</th>
                    <th className="p-2.5">기본 준비시간 (분)</th>
                    <th className="p-2.5">공정 불량률 (%)</th>
                    <th className="p-2.5 text-right">1로트({selectedProduct.lotSize}EA) 본가공</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedProduct.routing.map((step) => {
                    const lotRunMin = step.fixedMin
                      ? step.fixedMin
                      : Math.ceil((selectedProduct.lotSize / (step.uph ?? 300)) * 60);
                    return (
                      <tr key={step.seq} className="hover:bg-muted/30">
                        <td className="num p-2.5 font-bold">Seq #{step.seq}</td>
                        <td className="p-2.5">
                          <span className="font-semibold">{procName(step.proc)}</span>{" "}
                          <span className="text-muted-foreground">({step.proc})</span>
                        </td>
                        <td className="num p-2.5">
                          {step.fixedMin ? (
                            <span className="text-muted-foreground">고정 {step.fixedMin}분</span>
                          ) : (
                            <input
                              type="number"
                              min={10}
                              max={2000}
                              step={10}
                              value={step.uph ?? 300}
                              onChange={(e) => {
                                updateProductRouting(selectedProduct.code, step.seq, {
                                  uph: Math.max(10, Number(e.target.value)),
                                });
                              }}
                              className="h-7 w-20 rounded border bg-background px-2 text-xs font-bold"
                            />
                          )}
                        </td>
                        <td className="num p-2.5">
                          <input
                            type="number"
                            min={0}
                            max={180}
                            step={5}
                            value={step.setup}
                            onChange={(e) => {
                              updateProductRouting(selectedProduct.code, step.seq, {
                                setup: Math.max(0, Number(e.target.value)),
                              });
                            }}
                            className="h-7 w-16 rounded border bg-background px-2 text-xs font-bold"
                          />
                        </td>
                        <td className="num p-2.5">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            step={0.1}
                            value={Math.round((step.defectRate ?? 0) * 1000) / 10}
                            onChange={(e) => {
                              updateProductRouting(selectedProduct.code, step.seq, {
                                defectRate: Math.max(0, Number(e.target.value)) / 100,
                              });
                            }}
                            className="h-7 w-16 rounded border bg-background px-2 text-xs font-bold"
                          />
                          <span className="ml-1 text-muted-foreground">%</span>
                        </td>
                        <td className="num p-2.5 text-right font-semibold text-primary">
                          약 {lotRunMin}분
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Right 5 cols: 4x4 SDST Matrix */}
          <Panel
            className="lg:col-span-5"
            title="품목 패밀리 전환 셋업 매트릭스 (SDST 4×4, 단위: 분)"
          >
            <p className="mb-3 text-xs text-muted-foreground">
              SMT 설비에서 선행 로트 패밀리(행 From) 작업 완료 후 후속 로트 패밀리(열 To)로 전환할 때 소요되는 의무 셋업 시간(분)입니다. 동일 패밀리 연속 배정 시 0분이 적용됩니다.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-center text-xs">
                <thead>
                  <tr className="bg-muted/50 text-[11px] font-bold">
                    <th className="border p-2">From \ To</th>
                    {FAMILIES.map((to) => (
                      <th key={to} className="border p-2">
                        {to}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FAMILIES.map((from) => (
                    <tr key={from}>
                      <td className="border bg-muted/30 p-2 font-bold">{from}</td>
                      {FAMILIES.map((to) => {
                        const val = sdstMatrix[from][to];
                        const isDiag = from === to;
                        return (
                          <td
                            key={to}
                            className={`border p-2 ${
                              isDiag
                                ? "bg-success/10 font-bold text-success"
                                : val >= 35
                                ? "bg-destructive/10"
                                : "bg-background"
                            }`}
                          >
                            {isDiag ? (
                              <span className="num">0분 (동일)</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                max={120}
                                step={5}
                                value={val}
                                onChange={(e) => {
                                  updateSdst(from, to, Math.max(0, Number(e.target.value)));
                                  toast.info(`SDST [${from} → ${to}] 셋업시간 변경됨`);
                                }}
                                aria-label={`${from}에서 ${to} 전환 셋업시간`}
                                className="num h-7 w-14 rounded border bg-card text-center text-xs font-bold"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
