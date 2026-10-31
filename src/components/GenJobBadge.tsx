import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { isBusy } from "../lib/jobStore";
import { dismissGenJob, JOB_RUNNING, JOB_TEXT, useGenJob } from "../lib/toeicJob";

/** The AI generation job in the sidebar, on every page: how far it is while it runs, and its outcome until dismissed.
 *  Studio only (the sidebar loads it behind __STUDIO__). */
export default function GenJobBadge({
  onOpenPage,
  onOpenTest,
}: {
  /** The generation page, where the job's steps, report, sets or error are shown. */
  onOpenPage: () => void;
  onOpenTest: (testId: number) => void;
}) {
  const job = useGenJob();
  if (job.status === "idle") return null;
  const busy = isBusy(job);

  const click = () => {
    // One set opens straight away; a full test's two sets are offered side by side on the generation page.
    if (job.status === "done" && job.result?.sets.length === 1) {
      const [only] = job.result.sets;
      dismissGenJob();
      onOpenTest(only.testId);
      return;
    }
    // A plain cancel has nothing more to show; a cancel that could not end the AI does.
    if (job.status === "cancelled" && !job.error) return dismissGenJob();
    onOpenPage();
  };

  const text = job.status === "running" || job.status === "saving" ? `${JOB_RUNNING} ${job.step}` : JOB_TEXT[job.status];
  const title = busy
    ? `${job.label}: ${job.percent}% · ${job.step}. 눌러서 진행 상황 보기`
    : job.status === "failed"
      ? `${job.label}: ${job.error ?? ""}`
      : job.status === "cancelled"
        ? job.error
          ? `생성을 취소했습니다. ${job.error}`
          : "생성을 취소했습니다. 눌러서 닫기"
        : `${job.label}: 눌러서 열기`;

  return (
    <div className="sidebar-job">
      <button className={`nav-item gen-badge ${job.status}${job.error ? " has-error" : ""}`} title={title} onClick={click}>
        {busy ? <Loader2 className="spin" /> : job.status === "done" ? <Check /> : job.status === "cancelled" && !job.error ? <X /> : <AlertTriangle />}
        <span className="gen-badge-body">
          <span className="gen-badge-text">{text}</span>
          {(job.status === "running" || job.status === "saving") && (
            <span className="gen-bar thin" role="progressbar" aria-label="AI 생성 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent}>
              <span className="gen-bar-fill live" style={{ width: `${job.percent}%` }} />
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
