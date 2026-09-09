import Link from "next/link";
import { redirect } from "next/navigation";
import AccountPanel from "../components/auth/AccountPanel";
import ReverseReplay from "../components/ReverseReplay";
import { currentSession } from "../lib/session";
import "./reverse.css";

export const dynamic = "force-dynamic";

export default async function ReversePage() {
  if (!await currentSession()) redirect("/login?next=%2Freverse");

  return <main className="reversePage">
    <header className="reverseNav">
      <Link href="/" className="brand"><div><b>SCREENER</b><small>PAPER REPLAY LAB</small></div></Link>
      <Link href="/">Kembali ke sinyal teknikal</Link>
    </header>
    <AccountPanel />
    <section className="reverseHero">
      <div><p className="reverseEyebrow">RETROSPECTIVE_REPLAY / PAPER ONLY</p>
        <h1>Sinyal yang sama.<br /><em>Arah berlawanan.</em></h1>
        <p>Bandingkan original dan reverse pada riwayat tercatat. Eksperimen terpisah dari dashboard live, bukan rekomendasi transaksi.</p>
      </div>
      <aside className="reverseWarning"><b>HIPOTETIS, BUKAN FILL</b><strong>Tidak ada bukti forward.</strong><span>Hasil setelah melihat sejarah tidak memvalidasi edge. Bukan izin uang nyata atau leverage.</span></aside>
    </section>
    <section className="reversePanel reverseRules" aria-labelledby="reverse-rules">
      <h2 id="reverse-rules">Asumsi & batas replay</h2>
      <ul>
        <li>LONG menjadi SHORT, SHORT menjadi LONG, WAIT tetap WAIT (tidak masuk log sinyal aktif). Entry dan kondisi sinyal tetap; stop/TP dicerminkan dengan 2 x entry - level asli.</li>
        <li>Entry menggunakan harga tercatat secara hipotetis; tidak membuktikan order terisi.</li>
        <li>STOP menang bila stop dan target tersentuh pada candle yang sama. Jika tidak STOP, prioritas TP2 lalu TP1; TP1 adalah full exit, bukan partial.</li>
        <li>Fee round-trip diperhitungkan; slippage dan funding tidak dimodelkan.</li>
        <li>Coverage hanya 500 candle terbaru per aset. Coverage yang dibutuhkan salah satu sisi hilang membuat kedua sisi UNKNOWN; rentang 30/60/90 hari bukan jaminan seluruh candle tersedia. Perbandingan memakai record dan candle yang sama; original di sini dapat berbeda dari History lama karena validasi coverage lebih ketat.</li>
        <li>Sumber history dibatasi jumlah record. SEMUA berarti seluruh history yang tersedia, bukan seluruh sejarah pasar.</li>
        <li>Max drawdown mengikuti urutan sinyal dalam R, bukan equity akun; tidak memodelkan modal atau posisi tumpang tindih.</li>
      </ul>
    </section>
    <ReverseReplay />
  </main>;
}
