"use client";

import React from "react";

export type TxStepStatus = "upcoming" | "pending" | "completed" | "error";

export type TxStep = {
  id: string;
  title: string;
  description?: string;
  status: TxStepStatus;
};

type TransactionModalProps = {
  isOpen: boolean;
  steps: TxStep[];
  onClose?: () => void;
};

const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  steps,
  onClose,
}) => {
  if (!isOpen) return null;

  const total = steps.length;
  const completed = steps.filter((s) => s.status === "completed").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const hasPending = steps.some((s) => s.status === "pending");

  const statusLabel = hasPending
    ? "Processing"
    : completed === total && total > 0
    ? "Completed"
    : "Waiting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-slate-700 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Transaction in Progress</h2>
              <p className="mt-1 text-sm text-slate-400">
                Please do not close this window or refresh the page
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-1.5">
                <div
                  className={`h-2 w-2 rounded-full ${
                    hasPending ? "bg-green-500 animate-pulse" : "bg-slate-500"
                  }`}
                />
                <span className="text-xs font-medium text-slate-300">
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-6">
          {/* Overall progress */}
          <div className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">
                Overall Progress
              </span>
              <span className="text-sm font-bold text-white">
                {completed} of {total} completed
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Each step is a separate on-chain transaction
              </span>
              <span className="text-xs text-slate-500">{percent}%</span>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => {
              const isCompleted = step.status === "completed";
              const isPending = step.status === "pending";
              const isError = step.status === "error";

              let borderClasses = "border-slate-700";
              let bgClasses = "bg-slate-900/50";
              let badgeText = "Pending";
              let badgeClasses =
                "bg-slate-700/50 text-slate-300 border border-slate-600/50";
              let iconNode: React.ReactNode = (
                <span className="text-sm font-semibold text-slate-500">
                  {index + 1}
                </span>
              );
              let circleClasses = "bg-slate-700";

              if (isCompleted) {
                borderClasses = "border-green-500/40";
                bgClasses = "bg-slate-900/60";
                badgeText = "Completed";
                badgeClasses = "bg-green-500/10 text-green-400 border-0";
                iconNode = (
                  <i className="fa-solid fa-check text-white text-sm" />
                );
                circleClasses = "bg-green-500";
              } else if (isPending) {
                borderClasses = "border-indigo-500/60";
                bgClasses =
                  "bg-gradient-to-r from-indigo-500/10 to-purple-500/10 shadow-lg shadow-indigo-500/20";
                badgeText = "In Progress";
                badgeClasses =
                  "bg-indigo-500/20 text-indigo-300 border border-indigo-400/40";
                iconNode = (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                );
                circleClasses =
                  "bg-gradient-to-r from-indigo-500 to-purple-500";
              } else if (isError) {
                borderClasses = "border-red-500/50";
                bgClasses = "bg-red-950/40";
                badgeText = "Error";
                badgeClasses =
                  "bg-red-500/10 text-red-400 border border-red-400/40";
                iconNode = (
                  <i className="fa-solid fa-triangle-exclamation text-white text-sm" />
                );
                circleClasses = "bg-red-500";
              }

              return (
                <div
                  key={step.id}
                  className={`flex items-start gap-4 rounded-xl border ${borderClasses} ${bgClasses} p-4`}
                >
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${circleClasses}`}
                  >
                    {iconNode}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between">
                      <h3 className="text-base font-semibold text-white">
                        {step.title}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badgeClasses}`}
                      >
                        {badgeText}
                      </span>
                    </div>
                    {step.description && (
                      <p className="mb-1 text-sm text-slate-400">
                        {step.description}
                      </p>
                    )}
                    {!isCompleted && !isError && (
                      <p className="text-xs text-slate-500">
                        Confirm this transaction in your wallet…
                      </p>
                    )}
                    {isError && (
                      <p className="text-xs text-red-300">
                        This step failed. You can try again or adjust the
                        amount.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Info */}
          <div className="mt-6 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-circle-info mt-0.5 text-lg text-blue-400" />
              <div>
                <h4 className="mb-1 text-sm font-semibold text-blue-300">
                  Important Information
                </h4>
                <ul className="space-y-1 text-xs text-slate-300">
                  <li>• Each contract requires a separate on-chain tx.</li>
                  <li>• Gas fees are charged for every transaction.</li>
                  <li>
                    • Do not refresh the page while steps are still in progress.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="rounded-b-2xl border-t border-slate-700 bg-slate-900/40 px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-green-500" />
                <span>Secure Connection</span>
              </div>
              <div className="h-1 w-1 rounded-full bg-slate-600" />
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-gas-pump text-yellow-500" />
                <span>Gas fees apply</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (onClose) onClose();
              }}
              className="cursor-pointer flex items-center rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-600"
            >
              <i className="fa-solid fa-xmark mr-2" />
              {hasPending ? "Close" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionModal;
