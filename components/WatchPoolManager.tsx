"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  MAX_CUSTOM_COMPANIES,
  createCustomWatchCompany,
  createWatchPoolSyncCode,
  emptyWatchPoolState,
  mergeWatchPoolStates,
  parseWatchPoolImport,
  serializeWatchPoolExport,
  stateWithTimestamp,
  type CustomCompanyInput,
  type CustomMarket,
  type CustomWatchCompany,
  type ParsedWatchPoolImport,
  type WatchPoolState,
} from "@/lib/watch-pool";

export interface DefaultWatchCompany {
  id: string;
  name: string;
  ticker: string;
  group: string;
  region: string;
}

interface WatchPoolManagerProps {
  open: boolean;
  defaultCompanies: DefaultWatchCompany[];
  state: WatchPoolState;
  storageWarning?: string;
  customQuotesRefreshing?: boolean;
  onClose: () => void;
  onChange: (next: WatchPoolState) => void;
  onRefreshCustom: (companies?: CustomWatchCompany[]) => void;
}

type ManagerSection = "defaults" | "custom" | "transfer";
type ImportMode = "replace" | "merge";

const EMPTY_FORM: CustomCompanyInput = {
  name: "",
  ticker: "",
  market: "A",
  quoteCode: "",
  note: "",
};

function statusText(status: string | undefined): string {
  if (status === "fresh") return "行情正常";
  if (status === "stale") return "沿用最近行情";
  return "行情未接入";
}

function fileDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isSameCustomCompany(
  left: CustomWatchCompany,
  right: CustomWatchCompany,
): boolean {
  if (left.quoteCode && right.quoteCode) {
    return left.quoteCode.toLowerCase() === right.quoteCode.toLowerCase();
  }
  return (
    left.market === right.market &&
    left.ticker.toUpperCase() === right.ticker.toUpperCase()
  );
}

export default function WatchPoolManager({
  open,
  defaultCompanies,
  state,
  storageWarning,
  customQuotesRefreshing = false,
  onClose,
  onChange,
  onRefreshCustom,
}: WatchPoolManagerProps) {
  const [section, setSection] = useState<ManagerSection>("defaults");
  const [defaultQuery, setDefaultQuery] = useState("");
  const [form, setForm] = useState<CustomCompanyInput>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [transferText, setTransferText] = useState("");
  const [syncCode, setSyncCode] = useState("");
  const [parsedImport, setParsedImport] =
    useState<ParsedWatchPoolImport | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("replace");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const syncCodeRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const defaultIds = useMemo(
    () => defaultCompanies.map((company) => company.id),
    [defaultCompanies],
  );
  const hiddenIds = useMemo(
    () => new Set(state.hiddenDefaultIds),
    [state.hiddenDefaultIds],
  );
  const filteredDefaults = useMemo(() => {
    const query = defaultQuery.trim().toLocaleLowerCase("zh-CN");
    return defaultCompanies.filter((company) => {
      if (!query) return true;
      return [company.name, company.ticker, company.group, company.region]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    });
  }, [defaultCompanies, defaultQuery]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      setNotice("");
      setFormError("");
      setParsedImport(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const commit = (next: WatchPoolState, message: string) => {
    onChange({ ...next, updatedAt: new Date().toISOString() });
    setNotice(message);
  };

  const toggleDefault = (id: string) => {
    const hidden = new Set(state.hiddenDefaultIds);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    commit(
      {
        ...state,
        hiddenDefaultIds: [...hidden],
      },
      hidden.has(id) ? "已从当前看板隐藏" : "已恢复到当前看板",
    );
  };

  const addCompany = (
    input: CustomCompanyInput,
    successMessage = "已添加自定义公司",
  ) => {
    try {
      if (state.customCompanies.length >= MAX_CUSTOM_COMPANIES) {
        throw new Error(`自定义公司最多 ${MAX_CUSTOM_COMPANIES} 家`);
      }
      const company = createCustomWatchCompany(input);
      if (
        state.customCompanies.some((existing) =>
          isSameCustomCompany(existing, company),
        )
      ) {
        throw new Error("该公司或行情代码已在自定义观察池中");
      }
      const next = stateWithTimestamp({
        ...state,
        customCompanies: [...state.customCompanies, company],
      });
      onChange(next);
      setForm(EMPTY_FORM);
      setFormError("");
      setNotice(successMessage);
      if (company.quoteCode) onRefreshCustom([company]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "添加失败");
    }
  };

  const addLongxin = () => {
    addCompany(
      {
        name: "长鑫科技",
        ticker: "688825",
        market: "A",
        quoteCode: "sh688825",
        note: "预设快捷观察；仅接入可验证行情，不自动补充财务或估值数据。",
      },
      "已添加长鑫科技 688825",
    );
  };

  const deleteCustom = (id: string) => {
    const company = state.customCompanies.find((item) => item.id === id);
    if (
      !company ||
      !window.confirm(`确认从本机观察池删除“${company.name}”吗？`)
    ) {
      return;
    }
    const quoteCache = { ...state.quoteCache };
    delete quoteCache[id];
    commit(
      {
        ...state,
        customCompanies: state.customCompanies.filter(
          (item) => item.id !== id,
        ),
        quoteCache,
      },
      `已删除 ${company.name}`,
    );
  };

  const restoreDefaults = () => {
    commit(
      { ...state, hiddenDefaultIds: [] },
      "已恢复全部 31 家默认公司",
    );
  };

  const resetAll = () => {
    if (
      !window.confirm(
        "确认重置整个本机观察池吗？这会恢复全部默认公司并删除所有自定义公司。",
      )
    ) {
      return;
    }
    commit(emptyWatchPoolState(), "观察池已恢复为默认状态");
  };

  const exportFile = () => {
    downloadText(
      `科技股观察池-${fileDate()}.json`,
      serializeWatchPoolExport(state, defaultIds),
    );
    setNotice("观察池文件已导出");
  };

  const generateSyncCode = () => {
    const nextCode = createWatchPoolSyncCode(state, defaultIds);
    setSyncCode(nextCode);
    setNotice("同步码已生成；可复制到其他线路");
  };

  const copySyncCode = async () => {
    if (!syncCode) {
      generateSyncCode();
      return;
    }
    try {
      await navigator.clipboard.writeText(syncCode);
      setNotice("同步码已复制");
    } catch {
      syncCodeRef.current?.focus();
      syncCodeRef.current?.select();
      document.execCommand("copy");
      setNotice("同步码已复制");
    }
  };

  const inspectImport = (text = transferText) => {
    try {
      const parsed = parseWatchPoolImport(text, defaultIds);
      setParsedImport(parsed);
      setFormError("");
      setNotice("导入内容校验通过，请确认后应用");
    } catch (error) {
      setParsedImport(null);
      setFormError(error instanceof Error ? error.message : "导入内容无效");
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setTransferText(text);
      inspectImport(text);
    } catch {
      setFormError("无法读取所选文件");
    }
  };

  const applyImport = () => {
    if (!parsedImport) return;
    const imported =
      importMode === "merge"
        ? mergeWatchPoolStates(state, parsedImport.state)
        : parsedImport.state;
    onChange({ ...imported, updatedAt: new Date().toISOString() });
    setNotice(
      `已${importMode === "merge" ? "合并" : "替换"}观察池：隐藏 ${
        parsedImport.summary.hiddenCount
      } 家，自定义 ${parsedImport.summary.customCount} 家`,
    );
    setParsedImport(null);
    setTransferText("");
    const quoteCompanies = imported.customCompanies.filter(
      (company) => company.quoteCode,
    );
    if (quoteCompanies.length) onRefreshCustom(quoteCompanies);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const visibleDefaultCount =
    defaultCompanies.length - state.hiddenDefaultIds.length;
  const longxinExists = state.customCompanies.some(
    (company) =>
      company.quoteCode?.toLowerCase() === "sh688825" ||
      company.ticker.startsWith("688825"),
  );

  return (
    <div
      className="watch-pool-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="watch-pool-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-pool-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="watch-pool-header">
          <div>
            <p>本机个性化范围</p>
            <h2 id="watch-pool-title">统一观察池</h2>
            <span>
              默认 {visibleDefaultCount}/{defaultCompanies.length} · 自定义{" "}
              {state.customCompanies.length}
            </span>
          </div>
          <button
            ref={closeButtonRef}
            className="watch-pool-close"
            type="button"
            onClick={onClose}
            aria-label="关闭观察池"
          >
            ×
          </button>
        </header>

        <nav className="watch-pool-tabs" aria-label="观察池管理">
          {(
            [
              ["defaults", "默认公司"],
              ["custom", "自定义公司"],
              ["transfer", "迁移与重置"],
            ] as Array<[ManagerSection, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "is-active" : ""}
              onClick={() => {
                setSection(id);
                setFormError("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="watch-pool-body">
          {storageWarning ? (
            <div className="watch-pool-alert is-warning" role="alert">
              {storageWarning}
            </div>
          ) : null}
          {notice ? (
            <div className="watch-pool-alert is-success" role="status">
              {notice}
            </div>
          ) : null}
          {formError ? (
            <div className="watch-pool-alert is-danger" role="alert">
              {formError}
            </div>
          ) : null}

          {section === "defaults" ? (
            <section className="watch-pool-section">
              <div className="watch-pool-section-heading">
                <div>
                  <h3>默认 31 家</h3>
                  <p>
                    隐藏只改变本机显示，不会删除共享数据、历史或定时更新。
                  </p>
                </div>
                <button
                  type="button"
                  className="watch-pool-link-button"
                  onClick={restoreDefaults}
                  disabled={!state.hiddenDefaultIds.length}
                >
                  全部恢复
                </button>
              </div>
              <label className="watch-pool-search">
                <span className="sr-only">搜索默认公司</span>
                <input
                  type="search"
                  value={defaultQuery}
                  onChange={(event) => setDefaultQuery(event.target.value)}
                  placeholder="搜索公司、代码或分组"
                />
              </label>
              <div className="watch-pool-list">
                {filteredDefaults.map((company) => {
                  const hidden = hiddenIds.has(company.id);
                  return (
                    <article
                      className={`watch-pool-row ${hidden ? "is-hidden" : ""}`}
                      key={company.id}
                    >
                      <div>
                        <span className="ticker">{company.ticker}</span>
                        <strong>{company.name}</strong>
                        <small>
                          {company.group} · {company.region}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={hidden ? "pool-show-button" : "pool-hide-button"}
                        onClick={() => toggleDefault(company.id)}
                        aria-pressed={!hidden}
                      >
                        {hidden ? "恢复" : "隐藏"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {section === "custom" ? (
            <section className="watch-pool-section">
              <div className="watch-pool-section-heading">
                <div>
                  <h3>自定义观察</h3>
                  <p>
                    只接入可验证行情；财务、估值和可比统计不会自动补齐。
                  </p>
                </div>
                <button
                  type="button"
                  className="watch-pool-link-button"
                  onClick={() => onRefreshCustom()}
                  disabled={
                    customQuotesRefreshing ||
                    !state.customCompanies.some((company) => company.quoteCode)
                  }
                >
                  {customQuotesRefreshing ? "更新中…" : "更新行情"}
                </button>
              </div>

              <div className="watch-pool-preset">
                <div>
                  <strong>快捷新增：长鑫科技</strong>
                  <span>688825.SH · A股 · 仅行情观察</span>
                </div>
                <button
                  type="button"
                  onClick={addLongxin}
                  disabled={longxinExists}
                >
                  {longxinExists ? "已添加" : "一键添加"}
                </button>
              </div>

              <form
                className="watch-pool-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCompany(form);
                }}
              >
                <label>
                  <span>公司名称</span>
                  <input
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="例如：长鑫科技"
                  />
                </label>
                <label>
                  <span>证券代码或自定义代码</span>
                  <input
                    required
                    maxLength={24}
                    value={form.ticker}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ticker: event.target.value,
                      }))
                    }
                    placeholder="例如：688825"
                  />
                </label>
                <label>
                  <span>市场</span>
                  <select
                    value={form.market}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        market: event.target.value as CustomMarket,
                      }))
                    }
                  >
                    <option value="A">A股</option>
                    <option value="HK">港股</option>
                    <option value="US">美股</option>
                    <option value="OTHER">其他市场 / 仅记录</option>
                  </select>
                </label>
                <label>
                  <span>腾讯行情代码（可选）</span>
                  <input
                    maxLength={32}
                    value={form.quoteCode ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        quoteCode: event.target.value,
                      }))
                    }
                    placeholder="自动推断，或填写 sh688825"
                  />
                </label>
                <label className="watch-pool-form-wide">
                  <span>观察备注（可选）</span>
                  <input
                    maxLength={240}
                    value={form.note ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="仅保存在当前浏览器和导出文件中"
                  />
                </label>
                <div className="watch-pool-form-actions">
                  <small>
                    不提供行情代码也可保存；对应行情和全部计算指标将留空。
                  </small>
                  <button type="submit">添加到观察池</button>
                </div>
              </form>

              {state.customCompanies.length ? (
                <div className="watch-pool-list custom-list">
                  {state.customCompanies.map((company) => {
                    const quote = state.quoteCache[company.id];
                    return (
                      <article className="watch-pool-row" key={company.id}>
                        <div>
                          <span className="ticker">{company.ticker}</span>
                          <strong>{company.name}</strong>
                          <small>
                            {company.region} ·{" "}
                            {company.quoteCode ?? "未接入行情"}
                          </small>
                          {company.note ? <em>{company.note}</em> : null}
                        </div>
                        <div className="custom-quote-summary">
                          <strong>
                            {quote?.priceLocal === null ||
                            quote?.priceLocal === undefined
                              ? "—"
                              : `${quote.priceLocal.toLocaleString("zh-CN", {
                                  maximumFractionDigits: 2,
                                })} ${company.currency}`}
                          </strong>
                          <span className={`quote-state is-${quote?.status ?? "unavailable"}`}>
                            {statusText(quote?.status)}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteCustom(company.id)}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="watch-pool-empty">
                  尚未添加自定义公司。默认 31 家不会受到影响。
                </div>
              )}
            </section>
          ) : null}

          {section === "transfer" ? (
            <section className="watch-pool-section">
              <div className="watch-pool-section-heading">
                <div>
                  <h3>三线路迁移</h3>
                  <p>
                    浏览器保存不会跨域同步；可用文件或同步码复制同一观察池。
                  </p>
                </div>
              </div>

              <div className="watch-pool-transfer-card">
                <h4>导出当前设置</h4>
                <p>
                  仅包含隐藏项、自定义公司身份和备注，不包含行情缓存、财务或估值数据。
                </p>
                <div className="watch-pool-button-row">
                  <button type="button" onClick={exportFile}>
                    下载 JSON 文件
                  </button>
                  <button type="button" onClick={generateSyncCode}>
                    生成同步码
                  </button>
                  {syncCode ? (
                    <button type="button" onClick={copySyncCode}>
                      复制同步码
                    </button>
                  ) : null}
                </div>
                {syncCode ? (
                  <textarea
                    ref={syncCodeRef}
                    className="watch-pool-code"
                    readOnly
                    value={syncCode}
                    aria-label="观察池同步码"
                  />
                ) : null}
              </div>

              <div className="watch-pool-transfer-card">
                <h4>导入观察池</h4>
                <p>
                  导入前会严格校验并丢弃所有财务、员工、倍数和估值字段。
                </p>
                <label className="watch-pool-file">
                  <span>选择 JSON 文件</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => void handleImportFile(event)}
                  />
                </label>
                <label>
                  <span>或粘贴同步码 / JSON</span>
                  <textarea
                    value={transferText}
                    onChange={(event) => {
                      setTransferText(event.target.value);
                      setParsedImport(null);
                    }}
                    placeholder="KTV1.…"
                  />
                </label>
                <div className="watch-pool-button-row">
                  <button
                    type="button"
                    onClick={() => inspectImport()}
                    disabled={!transferText.trim()}
                  >
                    校验导入内容
                  </button>
                </div>

                {parsedImport ? (
                  <div className="watch-pool-import-preview">
                    <strong>校验结果</strong>
                    <ul>
                      <li>
                        隐藏默认公司 {parsedImport.summary.hiddenCount} 家
                      </li>
                      <li>
                        自定义公司 {parsedImport.summary.customCount} 家
                      </li>
                      <li>
                        跳过无效或冲突项{" "}
                        {parsedImport.summary.skippedHiddenCount +
                          parsedImport.summary.skippedCustomCount}{" "}
                        项
                      </li>
                      <li>
                        丢弃外来财务/估值字段{" "}
                        {parsedImport.summary.discardedFinancialFieldCount} 项
                      </li>
                    </ul>
                    <div className="watch-pool-import-mode">
                      <label>
                        <input
                          type="radio"
                          name="watch-pool-import-mode"
                          checked={importMode === "replace"}
                          onChange={() => setImportMode("replace")}
                        />
                        替换当前观察池（迁移推荐）
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="watch-pool-import-mode"
                          checked={importMode === "merge"}
                          onChange={() => setImportMode("merge")}
                        />
                        与当前观察池合并
                      </label>
                    </div>
                    <button type="button" onClick={applyImport}>
                      确认应用
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="watch-pool-danger-zone">
                <div>
                  <h4>恢复与重置</h4>
                  <p>
                    “恢复默认”保留自定义公司；“重置全部”会删除本机自定义公司。
                  </p>
                </div>
                <div className="watch-pool-button-row">
                  <button
                    type="button"
                    onClick={restoreDefaults}
                    disabled={!state.hiddenDefaultIds.length}
                  >
                    恢复全部默认公司
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={resetAll}
                    disabled={
                      !state.hiddenDefaultIds.length &&
                      !state.customCompanies.length
                    }
                  >
                    重置全部观察池
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
