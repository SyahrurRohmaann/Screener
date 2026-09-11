import Link from "next/link";
import { redirect } from "next/navigation";
import AccountPanel from "../components/auth/AccountPanel";
import OriginalReplay from "../components/OriginalReplay";
import { currentSession } from "../lib/session";
import "../reverse/reverse.css";

export const dynamic = "force-dynamic";

export default async function OriginalPage() {
  if (!await currentSession()) redirect("/login?next=%2Foriginal");

  return <main className="reversePage">
    <header className="reverseNav">
      <Link href="/" className="brand"><div><b>SCREENER</b><small>PAPER REPLAY LAB</small></div></Link>
      <Link href="/reverse">Reverse replay</Link>
      <Link href="/">Kembali ke sinyal teknikal</Link>
    </header>
    <AccountPanel />
    <section className="reverseHero">
      <div><p className="reverseEyebrow">RETROSPECTIVE_REPLAY / PAPER ONLY</p>
        <h1>MESIN ORI /<br /><em>DATA ASLI</em></h1>
        <p>Sinyal, rencana entry/SL/TP, dan hasil sesuai mesin asli sebelum pembalikan. Arah ORI dipulihkan dari ledger mesin aktif (reverse), lalu dievaluasi ulang dengan candle; bukan membalik angka hasil. Halaman ini tidak mengubah engine live.</p>
      </div>
      <aside className="reverseWarning"><b>HIPOTETIS, BUKAN FILL</b><strong>Tidak ada bukti forward.</strong><span>Hasil setelah melihat sejarah tidak memvalidasi edge. Bukan izin uang nyata atau leverage.</span></aside>
    </section>
    <section className="reversePanel reverseRules" aria-labelledby="original-rules">
      <h2 id="original-rules">Asumsi & batas replay</h2>
      <ul>
        <li>Ledger tersimpan dalam arah REVERSE. Sinyal dan mode dikembalikan ke ORI, entry tetap, dan stop/TP dipulihkan dengan 2 x entry - level tersimpan. Yang ditampilkan hanya mesin ORI, tanpa pembalikan tambahan.</li>
        <li>Entry menggunakan harga tercatat secara hipotetis; tidak membuktikan order terisi.</li>
        <li>STOP menang bila stop dan target tersentuh pada candle yang sama. Jika tidak STOP, prioritas TP2 lalu TP1; TP1 adalah full exit, bukan partial.</li>
        <li>Fee round-trip diperhitungkan; slippage dan funding tidak dimodelkan. Hasil net ORI bukan sekadar negatif hasil reverse.</li>
        <li>Coverage hanya 500 candle terbaru per aset. Replay memakai pemeriksaan coverage berpasangan yang sama dengan /reverse: jika salah satu sisi tidak dapat dievaluasi, hasil UNKNOWN. Rentang 30/60/90 hari bukan jaminan seluruh candle tersedia.</li>
        <li>Sumber history dibatasi jumlah record. SEMUA berarti seluruh history yang tersedia, bukan seluruh sejarah pasar.</li>
        <li>Max drawdown mengikuti urutan sinyal dalam R, bukan equity akun; tidak memodelkan modal atau posisi tumpang tindih.</li>
      </ul>
    </section>
    <OriginalReplay />
  </main>;
}
