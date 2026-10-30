import { useMemo, useState, type FormEvent } from "react";
import {
  getGetWalletQueryKey,
  useCancelWithdrawal,
  useCreateWithdrawal,
  useGetPayoutPreferences,
  useGetWallet,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Ban, WalletCards } from "lucide-react";
import { useAppLanguage, type AppLanguage } from "@/lib/i18n";

const locales: Record<AppLanguage, string> = {
  id: "id-ID",
  en: "en-US",
  zh: "zh-CN",
};
const currencyScale = { IDR: 1, USD: 100, CNY: 100 } as const;
const statusNames = ["pending", "paid", "rejected", "cancelled"] as const;

function money(
  amount: number,
  currency: "IDR" | "USD" | "CNY",
  language: AppLanguage,
) {
  return new Intl.NumberFormat(locales[language], {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "IDR" ? 0 : 2,
  }).format(amount / currencyScale[currency]);
}

export default function WithdrawalPage() {
  const { language, t } = useAppLanguage();
  const wallet = useGetWallet({ query: { refetchInterval: 15_000 } });
  const payout = useGetPayoutPreferences();
  const createWithdrawal = useCreateWithdrawal();
  const cancelWithdrawal = useCancelWithdrawal();
  const cache = useQueryClient();
  const [amount, setAmount] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const overview = wallet.data;
  const amountInMinorUnits = overview
    ? Math.round(Number(amount) * currencyScale[overview.currency])
    : 0;
  const filteredWithdrawals = useMemo(
    () =>
      (overview?.withdrawals ?? []).filter(
        (item) => statusFilter === "all" || item.status === statusFilter,
      ),
    [overview?.withdrawals, statusFilter],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!overview || amountInMinorUnits <= 0) return;
    if (
      !window.confirm(
        t("Confirm withdrawal of {{amount}}?", {
          amount: money(amountInMinorUnits, overview.currency, language),
        }),
      )
    )
      return;
    createWithdrawal.mutate(
      { data: { amount: amountInMinorUnits, currency: overview.currency } },
      {
        onSuccess: () => {
          setAmount("");
          void cache.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        },
      },
    );
  };
  const cancelRequest = (withdrawalId: string) => {
    if (!window.confirm(t("Cancel this pending withdrawal request?"))) return;
    cancelWithdrawal.mutate({ withdrawalId }, {
      onSuccess: () => {
        void cache.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      },
    });
  };

  if (wallet.isLoading)
    return <div className="panel loading-stack" aria-label={t("Loading")} />;
  if (wallet.isError || !overview)
    return (
      <div className="error-state">
        {t("This information could not be loaded.")}{" "}
        <button
          className="text-link"
          type="button"
          onClick={() => void wallet.refetch()}
        >
          {t("Try again")}
        </button>
      </div>
    );

  const reachedMinimum =
    overview.availableBalance >= overview.minimumWithdrawal;
  const canSubmit =
    !!payout.data?.accountNumber &&
    amountInMinorUnits >= overview.minimumWithdrawal &&
    amountInMinorUnits <= overview.availableBalance &&
    !createWithdrawal.isPending;
  const presets =
    overview.currency === "IDR"
      ? [100_000, 200_000, 300_000, 600_000, 1_000_000, 2_000_000]
      : overview.currency === "USD"
        ? [10, 20, 50, 100, 250, 500]
        : [70, 140, 350, 700, 1_750, 3_500];

  return (
    <div className="settings-grid">
      <section
        className="panel settings-panel"
        style={{ gridColumn: "1 / -1" }}
      >
        <div className="section-heading">
          <div>
            <h2 className="section-title">{t("Withdraw your earnings")}</h2>
            <p className="section-subtitle">
              {t(
                "Request a payout to your saved bank or e-wallet destination.",
              )}
            </p>
          </div>
          <WalletCards size={18} className="muted" />
        </div>
        <div className="metric-grid">
          <div className="panel metric">
            <div className="metric-label">{t("Available balance")}</div>
            <div className="metric-value">
              {money(overview.availableBalance, overview.currency, language)}
            </div>
            <div className="metric-note">
              {t("Currency")}: {overview.currency}
            </div>
          </div>
          <div className="panel metric">
            <div className="metric-label">{t("Minimum withdrawal")}</div>
            <div className="metric-value">
              {money(overview.minimumWithdrawal, overview.currency, language)}
            </div>
            <div className="metric-note">
              {reachedMinimum ? t("Minimum reached") : t("Below minimum")}
            </div>
          </div>
          <div className="panel metric">
            <div className="metric-label">{t("Already withdrawn")}</div>
            <div className="metric-value">
              {money(overview.totalWithdrawn, overview.currency, language)}
            </div>
            <div className="metric-note">{t("Paid withdrawal requests")}</div>
          </div>
        </div>
        {!payout.data?.accountNumber && (
          <div className="notice" style={{ marginTop: 16 }}>
            {t("Add a payout destination before requesting a withdrawal.")}{" "}
            <Link href="/settings" className="text-link">
              {t("Open settings")} <ArrowRight size={12} />
            </Link>
          </div>
        )}
        {payout.data?.accountNumber && (
          <p className="small-caption" style={{ marginTop: 16 }}>
            {t("Payout destination")}: {payout.data.institution} · ••••
            {payout.data.accountNumber.slice(-4)} · {payout.data.accountHolder}
          </p>
        )}
        <form onSubmit={submit} style={{ marginTop: 18 }}>
          <label className="field-label" htmlFor="withdrawal-amount">
            {t("Withdrawal amount")} ({overview.currency})
          </label>
          <div className="form-field">
            <input
              className="field"
              id="withdrawal-amount"
              type="number"
              min={
                overview.minimumWithdrawal / currencyScale[overview.currency]
              }
              max={overview.availableBalance / currencyScale[overview.currency]}
              step={overview.currency === "IDR" ? 1 : 0.01}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {presets.map((preset) => (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                key={preset}
                onClick={() => setAmount(String(preset))}
              >
                {overview.currency === "IDR"
                  ? `${preset.toLocaleString(locales[language])}`
                  : preset}
              </button>
            ))}
          </div>
          {amount && amountInMinorUnits < overview.minimumWithdrawal && (
            <p className="dialog-error">
              {t("The amount is below the minimum withdrawal.")}
            </p>
          )}
          {amount && amountInMinorUnits > overview.availableBalance && (
            <p className="dialog-error">
              {t("The amount exceeds your available balance.")}
            </p>
          )}
          {createWithdrawal.isError && (
            <p className="dialog-error" role="alert">
              {t(
                "Withdrawal request could not be created. Check your balance and payout destination.",
              )}
            </p>
          )}
          <div className="notice" style={{ marginBottom: 14 }}>
            {t("Requests may be submitted at any time. Manual payout review is available from 07:00 to 22:00 WIB; requests outside those hours are reviewed the next day.")}
          </div>
          <p className="small-caption" style={{ marginBottom: 14 }}>
            {t("Payouts are sent manually by an administrator outside ShareWa.")}
          </p>
          {cancelWithdrawal.isError && (
            <p className="dialog-error" role="alert">
              {t("The withdrawal could not be cancelled. It may already be processing.")}
            </p>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!canSubmit}
          >
            {createWithdrawal.isPending
              ? t("Submitting…")
              : t("Request withdrawal")}
            <ArrowRight size={14} />
          </button>
        </form>
      </section>
      <section
        className="panel settings-panel"
        style={{ gridColumn: "1 / -1" }}
      >
        <div className="section-heading">
          <div>
            <h2 className="section-title">{t("Previous withdrawals")}</h2>
            <p className="section-subtitle">
              {t("Track the status of your payout requests.")}
            </p>
          </div>
        </div>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          {(["pending", "paid", "rejected", "cancelled", "all"] as const).map(
            (status) => (
              <button
                type="button"
                key={status}
                className={`btn btn-sm ${statusFilter === status ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setStatusFilter(status)}
              >
                {t(
                  status === "all"
                    ? "All"
                    : status === "pending"
                      ? "Processing"
                      : status === "paid"
                        ? "Paid"
                        : status === "rejected"
                          ? "Rejected"
                          : "Cancelled",
                )}
              </button>
            ),
          )}
        </div>
        {filteredWithdrawals.length ? (
          <div className="admin-user-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("Date")}</th>
                  <th>{t("Amount")}</th>
                  <th>{t("Destination")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Note")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredWithdrawals.map((request) => (
                  <tr key={request.id}>
                    <td>
                      {new Intl.DateTimeFormat(locales[language], {
                        dateStyle: "medium",
                      }).format(new Date(request.createdAt))}
                    </td>
                    <td>{money(request.amount, request.currency, language)}</td>
                    <td>
                      {request.payoutInstitution} · ••••
                      {request.payoutAccountNumber.slice(-4)}
                    </td>
                    <td>
                      {t(
                        request.status === "pending"
                          ? "Processing"
                          : request.status === "paid"
                            ? "Paid"
                            : request.status === "rejected"
                              ? "Rejected"
                              : "Cancelled",
                      )}
                    </td>
                    <td>{request.adminNote || "—"}</td>
                    <td>
                      {request.status === "pending" && (
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={cancelWithdrawal.isPending}
                          onClick={() => cancelRequest(request.id)}
                        >
                          <Ban size={13} />
                          {cancelWithdrawal.isPending ? t("Cancelling…") : t("Cancel request")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-title">{t("No withdrawals yet")}</div>
            <p className="empty-copy">
              {t("Your withdrawal requests will appear here.")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
