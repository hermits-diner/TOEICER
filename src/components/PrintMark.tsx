/**
 * The line at the foot of every printed page of a locked bought set, answer keys too. Printing is allowed; a sheet that
 * travels can be traced to its purchase by the operator, and it names no person. Other sets print without it.
 */
export default function PrintMark({ purchaseNo }: { purchaseNo?: string | null }) {
  if (!purchaseNo) return null;
  const day = new Date().toLocaleDateString("sv-SE");
  return <div className="ps-foot">개인 학습용 · 구매 번호 {purchaseNo} · {day} 인쇄 · 무단 배포 금지</div>;
}
