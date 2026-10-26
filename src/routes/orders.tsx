import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAps } from "@/lib/aps/store";
import {
  PRIORITY_META,
  ROLE_META,
  at,
  calcEstimatedLeadTimeMin,
  calcPriorityScore,
  calcTargetInputQty,
  fmt,
  fmtDur,
  productOf,
  type Order,
  type OrderStatus,
  type Priority,
} from "@/lib/aps/data";
import { splitLots } from "@/lib/aps/engine";
import { PageHead, Panel, Pill } from "@/components/aps/ui";
import {
  AlertCircle,
  Calculator,
  CalendarClock,
  CheckSquare,
  Download,
  Edit3,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
});

const STATUS_LABELS: Record<
  OrderStatus,
  { label: string; tone: "muted" | "primary" | "success" | "warning" | "danger" }
> = {
  REGISTERED: { label: "등록됨", tone: "muted" },
  PLANNED: { label: "계획반영", tone: "primary" },
  CONFIRMED: { label: "확정됨", tone: "primary" },
  IN_PRODUCTION: { label: "생산진행중", tone: "warning" },
  COMPLETED: { label: "생산완료", tone: "success" },
  CANCELLED: { label: "취소됨", tone: "danger" },
};

function OrdersPage() {
  const {
    orders,
    currentKpi,
    role,
    products,
    addOrder,
    updateOrder,
    cancelOrder,
    generatePlanFromOrders,
  } = useAps();

  const perms = ROLE_META[role];
  const metricMap = useMemo(
    () => new Map(currentKpi.orders.map((m) => [m.no, m])),
    [currentKpi.orders]
  );

  // Filters
  const [search, setSearch] = useState("");
  const [prioFilter, setPrioFilter] = useState<Priority | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");
  const [selectedNos, setSelectedNos] = useState<string[]>([]);

  // Registration / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState("현대모비스");
  const [productCode, setProductCode] = useState(products[0]?.code ?? "PRD-ECU-100");
  const [qty, setQty] = useState<number>(1000);
  const [applyYield, setApplyYield] = useState<boolean>(true);
  const [splittable, setSplittable] = useState<boolean>(true);
  const [priority, setPriority] = useState<Priority>("P2_HIGH");
  const [releaseDay, setReleaseDay] = useState(0);
  const [releaseHour, setReleaseHour] = useState("08:00");
  const [dueDay, setDueDay] = useState(1);
  const [dueHour, setDueHour] = useState("18:00");
  const [memo, setMemo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Cancel Modal state
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Enrich orders with computed formulas
  const enrichedOrders = useMemo(() => {
    return orders.map((o) => {
      const prod = productOf(o.product, products);
      const targetQty = calcTargetInputQty(o.product, o.qty, true, products);
      const lots = splitLots(
        o.applyYield ? targetQty : o.qty,
        prod.lotSize,
        prod.minLotSize ?? 50,
        o.splittable ?? true
      );
      const scoreInfo = calcPriorityScore(o.product, o.qty, o.release, o.due, o.priority, products);
      const metric = metricMap.get(o.no);
      const effectiveStatus: OrderStatus = o.status ?? "CONFIRMED";

      return {
        ...o,
        prod,
        targetQty,
        lotCount: lots.length,
        W: o.W || scoreInfo.W,
        cr: scoreInfo.cr,
        leadTimeMin: scoreInfo.leadTimeMin,
        shortageWarning: scoreInfo.shortageWarning,
        metric,
        effectiveStatus,
      };
    });
  }, [orders, products, metricMap]);

  const filteredOrders = useMemo(() => {
    return enrichedOrders.filter((o) => {
      if (prioFilter !== "ALL" && o.priority !== prioFilter) return false;
      if (statusFilter !== "ALL" && o.effectiveStatus !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchOrder = o.no.toLowerCase().includes(q);
        const matchCust = o.customer.toLowerCase().includes(q);
        const matchProd = o.prod.name.toLowerCase().includes(q) || o.product.toLowerCase().includes(q);
        if (!matchOrder && !matchCust && !matchProd) return false;
      }
      return true;
    });
  }, [enrichedOrders, prioFilter, statusFilter, search]);

  // Live preview inside modal
  const selectedProd = productOf(productCode, products);
  const modalReleaseMin = at(releaseDay, releaseHour);
  const modalDueMin = at(dueDay, dueHour);
  const modalTargetQty = calcTargetInputQty(productCode, Math.max(1, qty || 0), applyYield, products);
  const modalLots = splitLots(modalTargetQty, selectedProd.lotSize, selectedProd.minLotSize ?? 50, splittable);
  const modalLeadTimeMin = calcEstimatedLeadTimeMin(productCode, Math.max(1, qty || 0), products);
  const modalPreviewScore = calcPriorityScore(
    productCode,
    Math.max(1, qty || 0),
    modalReleaseMin,
    modalDueMin,
    priority,
    products
  );

  const openCreateModal = () => {
    setEditingOrder(null);
    setCustomer("현대모비스");
    setProductCode(products[0]?.code ?? "PRD-ECU-100");
    setQty(1000);
    setApplyYield(true);
    setSplittable(true);
    setPriority("P2_HIGH");
    setReleaseDay(0);
    setReleaseHour("08:00");
    setDueDay(1);
    setDueHour("18:00");
    setMemo("");
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (ord: Order) => {
    setEditingOrder(ord);
    setCustomer(ord.customer);
    setProductCode(ord.product);
    setQty(ord.qty);
    setApplyYield(ord.applyYield ?? true);
    setSplittable(ord.splittable ?? true);
    setPriority(ord.priority);
    const rTotalH = Math.floor(ord.release / 60) + 8;
    setReleaseDay(Math.floor(rTotalH / 24));
    setReleaseHour(`${String(rTotalH % 24).padStart(2, "0")}:00`);
    const dTotalH = Math.floor(ord.due / 60) + 8;
    setDueDay(Math.floor(dTotalH / 24));
    setDueHour(`${String(dTotalH % 24).padStart(2, "0")}:00`);
    setMemo(ord.memo ?? "");
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveOrder = () => {
    if (!perms.canEditPlan) {
      toast.error("권한이 부족합니다. 생산계획 담당자(PLANNER) 또는 시스템 관리자(ADMIN) 역할이 필요합니다.");
      return;
    }
    if (customer.trim().length < 2) {
      setFormError("고객사명을 2자 이상 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(Number(qty)) || qty < 1 || qty > 1_000_000) {
      setFormError("주문 수량은 1 이상 1,000,000 이하의 정수(EA)만 입력 가능합니다.");
      return;
    }
    if (modalDueMin < modalReleaseMin + 120) {
      setFormError("납기일시는 원자재 투입 가능 시각보다 최소 2시간(120분) 이후여야 합니다.");
      return;
    }

    if (editingOrder) {
      updateOrder(editingOrder.no, {
        customer: customer.trim(),
        product: productCode,
        qty: Number(qty),
        targetQty: modalTargetQty,
        applyYield,
        splittable,
        priority,
        W: modalPreviewScore.W,
        release: modalReleaseMin,
        due: modalDueMin,
        memo: memo.trim(),
      });
      toast.success(`주문 수정 완료: ${editingOrder.no}`, {
        description: `수율 보정 투입수량 ${modalTargetQty.toLocaleString()} EA (${modalLots.length}개 로트) 반영`,
      });
    } else {
      const nextSeq = String(orders.length + 1).padStart(4, "0");
      const newOrderNo = `PO-20261026-${nextSeq}`;
      addOrder({
        no: newOrderNo,
        customer: customer.trim(),
        product: productCode,
        qty: Number(qty),
        targetQty: modalTargetQty,
        applyYield,
        splittable,
        priority,
        W: modalPreviewScore.W,
        release: modalReleaseMin,
        due: modalDueMin,
        status: "REGISTERED",
        memo: memo.trim() || "신규 등록 주문",
      });
      toast.success(`신규 생산 주문 등록 완료: ${newOrderNo}`, {
        description: `${customer.trim()} · ${selectedProd.name} (${qty.toLocaleString()} EA → 보정 ${modalTargetQty.toLocaleString()} EA)`,
      });
    }
    setModalOpen(false);
  };

  const handleConfirmCancel = () => {
    if (!cancellingOrder) return;
    if (cancelReason.trim().length < 10) {
      toast.error("취소 사유를 최소 10자 이상 입력해 주세요.");
      return;
    }
    cancelOrder(cancellingOrder.no, cancelReason.trim());
    toast.warning(`주문 취소 처리 완료: ${cancellingOrder.no}`, {
      description: `사유: ${cancelReason.trim()}`,
    });
    setCancellingOrder(null);
    setCancelReason("");
  };

  const handleExportCsv = () => {
    const headers = [
      "주문번호",
      "고객사",
      "품목코드",
      "품목명",
      "주문수량(EA)",
      "수율보정투입량(EA)",
      "분할로트수",
      "우선순위",
      "가중치점수(W)",
      "납기여유지수(CR)",
      "투입시각",
      "납기일시",
      "예상완료시각",
      "상태",
    ];
    const rows = filteredOrders.map((o) => [
      o.no,
      o.customer,
      o.product,
      o.prod.name,
      o.qty,
      o.targetQty,
      o.lotCount,
      o.priority,
      o.W,
      o.cr,
      fmt(o.release),
      fmt(o.due),
      o.metric ? fmt(o.metric.completion) : "-",
      STATUS_LABELS[o.effectiveStatus].label,
    ]);
    const csvContent =
      "\uFEFF" + [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `E-APS_생산주문목록_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV 내보내기 완료 (${filteredOrders.length}건)`);
  };

  const toggleSelectAll = () => {
    if (selectedNos.length === filteredOrders.length) {
      setSelectedNos([]);
    } else {
      setSelectedNos(filteredOrders.map((o) => o.no));
    }
  };

  const toggleSelectOne = (no: string) => {
    setSelectedNos((prev) => (prev.includes(no) ? prev.filter((x) => x !== no) : [...prev, no]));
  };

  const handleGeneratePlan = () => {
    const targetNos = selectedNos.length > 0 ? selectedNos : filteredOrders.map((o) => o.no);
    if (targetNos.length === 0) {
      toast.error("생산계획을 생성할 주문을 최소 1건 이상 선택해 주세요.");
      return;
    }
    generatePlanFromOrders(
      targetNos,
      `선택 주문(${targetNos.length}건) 기반 자동 생성 계획`
    );
    toast.success(`선택 주문(${targetNos.length}건) 기반 신규 생산계획 초안이 생성되었습니다.`);
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="생산 주문 관리 (SCR-ORD-01)"
        desc="수율 손실 보정 투입수량(Q'), 로트 자동 분할, 납기 여유지수(CR) 및 동적 우선순위 가중치(W)를 실시간 산출·관리합니다."
      >
        <button
          onClick={handleExportCsv}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />
          CSV 내보내기
        </button>

        <button
          onClick={handleGeneratePlan}
          disabled={!perms.canEditPlan}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {selectedNos.length > 0 ? `선택 주문(${selectedNos.length}건) 계획 생성` : "전체 주문 계획 재생성"}
        </button>

        <button
          onClick={openCreateModal}
          disabled={!perms.canEditPlan}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          신규 주문 등록
        </button>
      </PageHead>

      {/* Summary Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-3.5 shadow-2xs">
          <div className="text-xs text-muted-foreground">조회된 주문 / 전체 주문</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-2xl font-bold">{filteredOrders.length}</span>
            <span className="text-xs text-muted-foreground">/ 총 {orders.length}건</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-2xs">
          <div className="text-xs text-muted-foreground">총 주문수량 → 수율보정 투입수량(Q')</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-2xl font-bold">
              {filteredOrders.reduce((s, o) => s + o.qty, 0).toLocaleString()}
            </span>
            <span className="num text-xs font-semibold text-primary">
              → {filteredOrders.reduce((s, o) => s + o.targetQty, 0).toLocaleString()} EA (
              {filteredOrders.reduce((s, o) => s + o.lotCount, 0)} Lots)
            </span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-2xs">
          <div className="text-xs text-muted-foreground">납기 여유지수 위험 (CR &lt; 1.0)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-2xl font-bold text-warning">
              {filteredOrders.filter((o) => o.cr < 1.0).length}
            </span>
            <span className="text-xs text-muted-foreground">건 (리드타임 대비 납기 촉박)</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-2xs">
          <div className="text-xs text-muted-foreground">현재 스케줄 납기 지연 주문</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-2xl font-bold text-destructive">
              {filteredOrders.filter((o) => (o.metric?.tardy ?? 0) > 0).length}
            </span>
            <span className="text-xs text-muted-foreground">건 (OTD {currentKpi.otd.toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="주문번호, 고객사, 품목명 검색..."
                className="h-9 w-64 rounded-md border bg-background pr-3 pl-8 text-xs focus:border-primary focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">우선순위:</span>
              <select
                value={prioFilter}
                onChange={(e) => setPrioFilter(e.target.value as Priority | "ALL")}
                className="h-9 rounded-md border bg-background px-2.5 text-xs font-medium"
              >
                <option value="ALL">전체 우선순위</option>
                <option value="P1_URGENT">1등급 긴급/VIP (P1_URGENT)</option>
                <option value="P2_HIGH">2등급 높음 (P2_HIGH)</option>
                <option value="P3_NORMAL">3등급 보통 (P3_NORMAL)</option>
                <option value="P4_LOW">4등급 낮음 (P4_LOW)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">상태:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "ALL")}
                className="h-9 rounded-md border bg-background px-2.5 text-xs font-medium"
              >
                <option value="ALL">전체 상태</option>
                <option value="REGISTERED">등록됨 (REGISTERED)</option>
                <option value="PLANNED">계획반영 (PLANNED)</option>
                <option value="CONFIRMED">확정됨 (CONFIRMED)</option>
                <option value="CANCELLED">취소됨 (CANCELLED)</option>
              </select>
            </div>

            {(search || prioFilter !== "ALL" || statusFilter !== "ALL") && (
              <button
                onClick={() => {
                  setSearch("");
                  setPrioFilter("ALL");
                  setStatusFilter("ALL");
                }}
                className="inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs text-muted-foreground hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" />
                필터 초기화
              </button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            체크박스 선택: <b className="num text-foreground">{selectedNos.length}</b>건
          </div>
        </div>

        {/* Orders Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                <th className="w-8 p-2.5">
                  <input
                    type="checkbox"
                    checked={filteredOrders.length > 0 && selectedNos.length === filteredOrders.length}
                    onChange={toggleSelectAll}
                    aria-label="전체 주문 선택"
                    className="rounded border-border"
                  />
                </th>
                <th className="p-2.5">주문번호</th>
                <th className="p-2.5">고객사</th>
                <th className="p-2.5">품목 (패밀리)</th>
                <th className="p-2.5 text-right">주문수량 → 보정투입(Q')</th>
                <th className="p-2.5 text-center">분할 로트</th>
                <th className="p-2.5">우선순위 · 가중치(W)</th>
                <th className="p-2.5">납기여유지수(CR)</th>
                <th className="p-2.5">투입시각 → 납기일시</th>
                <th className="p-2.5">예상완료 / 여유·지연</th>
                <th className="p-2.5">상태</th>
                <th className="p-2.5 text-right">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-muted-foreground">
                    검색 조건에 일치하는 생산 주문이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => {
                  const stMeta = STATUS_LABELS[o.effectiveStatus];
                  const isLate = (o.metric?.tardy ?? 0) > 0;
                  return (
                    <tr key={o.no} className="hover:bg-muted/30">
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={selectedNos.includes(o.no)}
                          onChange={() => toggleSelectOne(o.no)}
                          aria-label={`${o.no} 선택`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="p-2.5">
                        <div className="num font-bold text-foreground">{o.no}</div>
                        {o.memo && <div className="text-[10px] text-muted-foreground">{o.memo}</div>}
                      </td>
                      <td className="p-2.5 font-medium text-foreground">{o.customer}</td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                            {o.prod.family}
                          </span>
                          <span className="font-medium">{o.prod.name}</span>
                        </div>
                        <div className="num text-[10px] text-muted-foreground">{o.product}</div>
                      </td>
                      <td className="num p-2.5 text-right">
                        <div className="font-semibold">{o.qty.toLocaleString()} EA</div>
                        <div className="text-[11px] text-primary">
                          보정 {o.targetQty.toLocaleString()} EA (+{o.targetQty - o.qty})
                        </div>
                      </td>
                      <td className="num p-2.5 text-center">
                        <Pill tone="muted">{o.lotCount} Lots</Pill>
                      </td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-1.5">
                          <Pill
                            tone={
                              o.priority === "P1_URGENT"
                                ? "danger"
                                : o.priority === "P2_HIGH"
                                ? "warning"
                                : "muted"
                            }
                          >
                            {PRIORITY_META[o.priority].label}
                          </Pill>
                          <span className="num text-[11px] font-bold text-foreground">W={o.W}</span>
                        </div>
                      </td>
                      <td className="num p-2.5">
                        <Pill tone={o.cr < 1.0 ? "danger" : o.cr < 1.3 ? "warning" : "success"}>
                          CR {o.cr.toFixed(2)} {o.cr < 1.0 ? "⚠" : ""}
                        </Pill>
                      </td>
                      <td className="num p-2.5 text-[11px]">
                        <div className="text-muted-foreground">투입: {fmt(o.release)}</div>
                        <div className="font-semibold text-foreground">납기: {fmt(o.due)}</div>
                      </td>
                      <td className="num p-2.5">
                        {o.metric ? (
                          <div>
                            <div className="text-[11px] font-medium">{fmt(o.metric.completion)}</div>
                            {isLate ? (
                              <span className="text-[11px] font-bold text-destructive">
                                +{fmtDur(o.metric.tardy)} 지연
                              </span>
                            ) : (
                              <span className="text-[11px] text-success">
                                {fmtDur(Math.max(0, o.due - o.metric.completion))} 여유
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-2.5">
                        <Pill tone={stMeta.tone}>{stMeta.label}</Pill>
                      </td>
                      <td className="p-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEditModal(o)}
                            disabled={!perms.canEditPlan || o.status === "CANCELLED"}
                            className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
                            title="주문 수정"
                          >
                            <Edit3 className="h-3 w-3" />
                            수정
                          </button>
                          <button
                            onClick={() => {
                              setCancellingOrder(o);
                              setCancelReason("");
                            }}
                            disabled={!perms.canEditPlan || o.status === "CANCELLED"}
                            className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/15 disabled:opacity-40"
                            title="주문 취소"
                          >
                            <Trash2 className="h-3 w-3" />
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Create / Edit Order Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <div>
                <h3 className="text-base font-bold">
                  {editingOrder ? `생산 주문 수정 (${editingOrder.no})` : "신규 생산 주문 등록 (Capable-to-Promise 검증)"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  수율 보정 투입수량(Q'), 로트 분할 수, 예상 리드타임 및 납기 여유지수(CR)를 실시간 시뮬레이션합니다.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              {formError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold">고객사명 *</label>
                  <input
                    type="text"
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    placeholder="예: 현대모비스"
                    className="h-9 w-full rounded-md border bg-background px-3 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">생산 품목 (Product) *</label>
                  <select
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2.5 text-xs"
                  >
                    {products.map((p) => (
                      <option key={p.code} value={p.code}>
                        [{p.family}] {p.name} ({p.code}) - 표준로트 {p.lotSize}EA
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">주문 수량 (1 ~ 1,000,000 EA) *</label>
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={50}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="num h-9 w-full rounded-md border bg-background px-3 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">우선순위 등급 *</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className="h-9 w-full rounded-md border bg-background px-2.5 text-xs"
                  >
                    <option value="P1_URGENT">1등급 긴급/VIP (P1_URGENT)</option>
                    <option value="P2_HIGH">2등급 높음 (P2_HIGH)</option>
                    <option value="P3_NORMAL">3등급 보통 (P3_NORMAL)</option>
                    <option value="P4_LOW">4등급 낮음 (P4_LOW)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">원자재 투입 가능 시각 (Release Time)</label>
                  <div className="flex gap-2">
                    <select
                      value={releaseDay}
                      onChange={(e) => setReleaseDay(Number(e.target.value))}
                      className="h-9 flex-1 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value={0}>Day 1 (10-26)</option>
                      <option value={1}>Day 2 (10-27)</option>
                    </select>
                    <select
                      value={releaseHour}
                      onChange={(e) => setReleaseHour(e.target.value)}
                      className="num h-9 flex-1 rounded-md border bg-background px-2 text-xs"
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
                </div>

                <div>
                  <label className="mb-1 block font-semibold">납기 요청 일시 (Due Date) *</label>
                  <div className="flex gap-2">
                    <select
                      value={dueDay}
                      onChange={(e) => setDueDay(Number(e.target.value))}
                      className="h-9 flex-1 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value={0}>Day 1 (10-26)</option>
                      <option value={1}>Day 2 (10-27)</option>
                      <option value={2}>Day 3 (10-28)</option>
                      <option value={3}>Day 4 (10-29)</option>
                    </select>
                    <select
                      value={dueHour}
                      onChange={(e) => setDueHour(e.target.value)}
                      className="num h-9 flex-1 rounded-md border bg-background px-2 text-xs"
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
                </div>

                <div className="flex items-center gap-4 pt-1">
                  <label className="inline-flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={applyYield}
                      onChange={(e) => setApplyYield(e.target.checked)}
                      className="rounded border-border"
                    />
                    수율 손실 보정(Q') 적용
                  </label>
                  <label className="inline-flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={splittable}
                      onChange={(e) => setSplittable(e.target.checked)}
                      className="rounded border-border"
                    />
                    표준 로트 자동 분할
                  </label>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">비고 / 특이사항</label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="긴급 라인 대응 또는 특이사항 메모"
                    className="h-9 w-full rounded-md border bg-background px-3 text-xs"
                  />
                </div>
              </div>

              {/* Real-time Capable-to-Promise & Formula Box */}
              <div className="rounded-lg border bg-muted/40 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                    <Calculator className="h-4 w-4 text-primary" />
                    실시간 수율 보정 · 로트 분할 · 납기 가능성(CTP) 자동 산출
                  </span>
                  <Pill tone={modalPreviewScore.cr < 1.0 ? "danger" : "success"}>
                    CR = {modalPreviewScore.cr.toFixed(2)} · 종합 우선순위 W = {modalPreviewScore.W}점
                  </Pill>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded border bg-card p-2.5">
                    <div className="text-[11px] text-muted-foreground">수율보정 투입량 (Q')</div>
                    <div className="num mt-0.5 text-sm font-bold text-primary">
                      {modalTargetQty.toLocaleString()} EA
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      여유분 +{modalTargetQty - (qty || 0)} EA
                    </div>
                  </div>
                  <div className="rounded border bg-card p-2.5">
                    <div className="text-[11px] text-muted-foreground">자동 분할 로트 수</div>
                    <div className="num mt-0.5 text-sm font-bold">{modalLots.length} Lots</div>
                    <div className="text-[10px] text-muted-foreground">
                      표준 로트 {selectedProd.lotSize} EA 기준
                    </div>
                  </div>
                  <div className="rounded border bg-card p-2.5">
                    <div className="text-[11px] text-muted-foreground">예상 총 공정 리드타임</div>
                    <div className="num mt-0.5 text-sm font-bold">{fmtDur(modalLeadTimeMin)}</div>
                    <div className="text-[10px] text-muted-foreground">전 공정 누적 소요시간</div>
                  </div>
                  <div className="rounded border bg-card p-2.5">
                    <div className="text-[11px] text-muted-foreground">최단 완료 예상시각</div>
                    <div className="num mt-0.5 text-sm font-bold">
                      {fmt(modalReleaseMin + modalLeadTimeMin)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">납기: {fmt(modalDueMin)}</div>
                  </div>
                </div>

                {modalPreviewScore.shortageWarning && (
                  <div className="mt-2.5 flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                    <CalendarClock className="h-4 w-4 shrink-0" />
                    <span>
                      <b>납기 여유지수 부족 경고 (CR = {modalPreviewScore.cr.toFixed(2)} &lt; 1.0):</b> 남은 납기 시간 대비 예상 공정 리드타임이 길어 등록 후 AI 최적화 실행이 권장됩니다.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <button
                onClick={() => setModalOpen(false)}
                className="h-9 rounded-md border px-4 text-xs font-medium hover:bg-muted"
              >
                취소
              </button>
              <button
                onClick={handleSaveOrder}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {editingOrder ? "주문 수정 저장" : "주문 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <h3 className="text-sm font-bold text-destructive">
                생산 주문 취소 확인 ({cancellingOrder.no})
              </h3>
              <button
                onClick={() => setCancellingOrder(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5 text-xs">
              <p className="text-muted-foreground">
                주문을 취소하면 해당 주문에서 분할된 모든 로트 및 공정 작업이 활성 스케줄에서 즉시 회수되며 설비 부하가 재계산됩니다.
              </p>
              <div>
                <label className="mb-1 block font-semibold">취소 사유 입력 (최소 10자 이상 필수) *</label>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="예: 고객사 발주 변경 요청에 따른 긴급 취소 처리"
                  className="w-full rounded-md border bg-background p-2.5 text-xs"
                />
                <div className="mt-1 text-right text-[10px] text-muted-foreground">
                  현재 {cancelReason.trim().length}자 / 최소 10자
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button
                onClick={() => setCancellingOrder(null)}
                className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted"
              >
                닫기
              </button>
              <button
                onClick={handleConfirmCancel}
                className="h-8 rounded-md bg-destructive px-3.5 text-xs font-semibold text-white hover:bg-destructive/90"
              >
                주문 취소 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
